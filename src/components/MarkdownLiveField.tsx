import React, { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import {
  applyVisibleEditToRaw,
  MarkdownLineKind,
  MarkdownProjection,
  MarkdownTokenStyle,
  projectMarkdownLive,
  rawOffsetToVisible,
  visibleOffsetToRaw,
} from '../utils/markdownLive';

export interface MarkdownLiveFieldHandle {
  focus: () => void;
  setCaret: (pos: number | 'start' | 'end') => void;
  getCaret: () => number;
  scrollIntoView: (opts?: ScrollIntoViewOptions) => void;
  isFocused: () => boolean;
}

interface MarkdownLiveFieldProps {
  value: string;
  placeholder?: string;
  multiline?: boolean;
  allowBlockSyntax?: boolean;
  className?: string;
  placeholderClassName?: string;
  onChange: (nextValue: string) => void;
  onCaretChange?: (caret: number) => void;
  onEnterSingleLine?: () => void;
  onBackspaceEmpty?: () => void;
  fieldRef?: (handle: MarkdownLiveFieldHandle | null) => void;
}

function getLineClassName(kind: MarkdownLineKind): string {
  switch (kind) {
    case 'h1':
      return 'font-display text-[20px] font-semibold text-stone-900 dark:text-stone-100 leading-snug';
    case 'h2':
      return 'font-display text-[17.5px] font-semibold text-stone-900 dark:text-stone-100 leading-snug';
    case 'h3':
      return 'font-display text-[16px] font-semibold text-stone-800 dark:text-stone-200 leading-snug';
    case 'quote':
      return 'border-l-2 border-[var(--tf-accent)] pl-2.5 italic text-stone-600 dark:text-stone-400';
    default:
      return '';
  }
}

function getSegmentClassName(style: MarkdownTokenStyle): string {
  switch (style) {
    case 'syntax':
      return 'text-stone-400 dark:text-stone-500 font-normal not-italic no-underline';
    case 'bold':
      return 'font-semibold text-stone-900 dark:text-stone-100';
    case 'italic':
      return 'italic';
    case 'bold-italic':
      return 'font-semibold italic text-stone-900 dark:text-stone-100';
    case 'strike':
      return 'line-through text-stone-400 dark:text-stone-500';
    case 'code':
      return 'font-mono text-[0.9em] px-1 py-0.5 rounded bg-stone-200/75 dark:bg-stone-700/70 text-stone-800 dark:text-stone-100';
    case 'link':
      return 'underline decoration-[var(--tf-accent)] text-[var(--tf-accent-text)]';
    default:
      return '';
  }
}

/**
 * Walks visible text nodes inside `root` (respecting line wrappers as `\n`)
 * to read the current visible plain text and DOM selection offsets.
 */
function readVisibleTextAndSelection(root: HTMLElement): {
  text: string;
  selStart: number;
  selEnd: number;
  hasSelection: boolean;
} {
  const sel = window.getSelection();
  const hasRange = Boolean(
    sel && sel.rangeCount > 0 && root.contains(sel.anchorNode) && root.contains(sel.focusNode)
  );
  const range = hasRange && sel ? sel.getRangeAt(0) : null;

  let text = '';
  let selStart = 0;
  let selEnd = 0;
  let foundStart = false;
  let foundEnd = false;

  const markBoundary = (node: Node, offset: number, currentLen: number) => {
    if (!range) return;
    if (!foundStart && range.startContainer === node && range.startOffset === offset) {
      selStart = currentLen;
      foundStart = true;
    }
    if (!foundEnd && range.endContainer === node && range.endOffset === offset) {
      selEnd = currentLen;
      foundEnd = true;
    }
  };

  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const data = node.textContent || '';
      if (range && !foundStart && range.startContainer === node) {
        selStart = text.length + Math.min(range.startOffset, data.length);
        foundStart = true;
      }
      if (range && !foundEnd && range.endContainer === node) {
        selEnd = text.length + Math.min(range.endOffset, data.length);
        foundEnd = true;
      }
      text += data;
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;

    if (el.tagName === 'BR') {
      if (el.dataset.mdSentinel === 'true') {
        return;
      }
      text += '\n';
      return;
    }

    const isLineBlock = el !== root && el.dataset.mdLine === 'true';
    const isBrowserDivBlock =
      el !== root && !isLineBlock && (el.tagName === 'DIV' || el.tagName === 'P');

    if ((isLineBlock && el.previousSibling) || (isBrowserDivBlock && el.previousSibling)) {
      text += '\n';
    }

    const children = el.childNodes;
    for (let i = 0; i < children.length; i += 1) {
      markBoundary(el, i, text.length);
      walk(children[i]);
    }
    markBoundary(el, children.length, text.length);
  };

  walk(root);

  if (range) {
    if (!foundStart) selStart = text.length;
    if (!foundEnd) selEnd = selStart;
  }

  return { text, selStart, selEnd, hasSelection: hasRange };
}

/**
 * Places the DOM selection caret at `[visStart, visEnd]` inside our rendered line DOM.
 */
function setVisibleSelection(root: HTMLElement, visStart: number, visEnd: number): void {
  const sel = window.getSelection();
  if (!sel) return;

  const findPoint = (targetOffset: number): { node: Node; offset: number } => {
    let remaining = Math.max(0, targetOffset);
    const lineEls = Array.from(root.children) as HTMLElement[];

    for (let li = 0; li < lineEls.length; li += 1) {
      const lineEl = lineEls[li];
      const walker = document.createTreeWalker(lineEl, NodeFilter.SHOW_TEXT);
      let textNode = walker.nextNode();
      let lastTextNode: Node | null = null;

      while (textNode) {
        const len = textNode.textContent?.length ?? 0;
        if (remaining <= len) {
          return { node: textNode, offset: remaining };
        }
        remaining -= len;
        lastTextNode = textNode;
        textNode = walker.nextNode();
      }

      if (remaining === 0) {
        if (lastTextNode) {
          return { node: lastTextNode, offset: lastTextNode.textContent?.length ?? 0 };
        }
        return { node: lineEl, offset: 0 };
      }

      // Account for newline separator between lines
      if (li < lineEls.length - 1) {
        if (remaining === 1) {
          const nextLine = lineEls[li + 1];
          const nextWalker = document.createTreeWalker(nextLine, NodeFilter.SHOW_TEXT);
          const firstNextText = nextWalker.nextNode();
          if (firstNextText) {
            return { node: firstNextText, offset: 0 };
          }
          return { node: nextLine, offset: 0 };
        }
        remaining -= 1;
      }
    }

    const lastLine = lineEls[lineEls.length - 1];
    if (lastLine) {
      const walker = document.createTreeWalker(lastLine, NodeFilter.SHOW_TEXT);
      let lastText: Node | null = null;
      let curr = walker.nextNode();
      while (curr) {
        lastText = curr;
        curr = walker.nextNode();
      }
      if (lastText) {
        return { node: lastText, offset: lastText.textContent?.length ?? 0 };
      }
      return { node: lastLine, offset: 0 };
    }
    return { node: root, offset: 0 };
  };

  try {
    const startPt = findPoint(visStart);
    const endPt = visStart === visEnd ? startPt : findPoint(visEnd);
    const range = document.createRange();
    range.setStart(startPt.node, startPt.offset);
    range.setEnd(endPt.node, endPt.offset);
    sel.removeAllRanges();
    sel.addRange(range);
  } catch {
    // Ignore selection errors if detached
  }
}

/**
 * Renders the markdown projection cleanly into `root` using safe DOM APIs.
 */
function renderProjectionToDom(root: HTMLElement, projection: MarkdownProjection): void {
  const frag = document.createDocumentFragment();

  for (const line of projection.lines) {
    const lineEl = document.createElement('div');
    lineEl.dataset.mdLine = 'true';
    const lineClass = getLineClassName(line.kind);
    if (lineClass) {
      lineEl.className = lineClass;
    }

    let hasVisibleContent = false;
    for (const seg of line.segments) {
      if (!seg.visible) continue;
      hasVisibleContent = true;
      const span = document.createElement('span');
      const segClass = getSegmentClassName(seg.style);
      if (segClass) {
        span.className = segClass;
      }
      span.textContent = seg.raw;
      lineEl.appendChild(span);
    }

    if (!hasVisibleContent) {
      const br = document.createElement('br');
      br.dataset.mdSentinel = 'true';
      lineEl.appendChild(br);
    }

    frag.appendChild(lineEl);
  }

  root.replaceChildren(frag);
}

export const MarkdownLiveField: React.FC<MarkdownLiveFieldProps> = ({
  value,
  placeholder = '',
  multiline = true,
  allowBlockSyntax = true,
  className = '',
  placeholderClassName = '',
  onChange,
  onCaretChange,
  onEnterSingleLine,
  onBackspaceEmpty,
  fieldRef,
}) => {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<MarkdownLiveFieldHandle | null>(null);
  const [isFocused, setIsFocused] = useState(false);

  const rawRef = useRef(value);
  rawRef.current = value;
  const focusedRef = useRef(false);
  const composingRef = useRef(false);
  const caretRef = useRef<{ start: number; end: number }>({
    start: value.length,
    end: value.length,
  });
  const projectionRef = useRef<MarkdownProjection>(
    projectMarkdownLive(value, value.length, value.length, false, allowBlockSyntax)
  );
  const renderKeyRef = useRef<string>('');
  const suppressSelectionSyncRef = useRef(false);
  const lastVisCaretRef = useRef<number>(0);

  const syncDom = (force = false) => {
    const root = editorRef.current;
    if (!root || composingRef.current) return;

    const raw = rawRef.current;
    const focused = focusedRef.current;
    const cStart = Math.max(0, Math.min(caretRef.current.start, raw.length));
    const cEnd = Math.max(0, Math.min(caretRef.current.end, raw.length));

    const nextProj = projectMarkdownLive(raw, cStart, cEnd, focused, allowBlockSyntax);
    const nextKey = nextProj.lines
      .map(
        (l) =>
          `${l.kind}:${l.segments
            .filter((s) => s.visible)
            .map((s) => `${s.style}[${s.raw}]`)
            .join('|')}`
      )
      .join('\n');

    projectionRef.current = nextProj;

    if (!force && renderKeyRef.current === nextKey && root.childNodes.length > 0) {
      return;
    }

    renderKeyRef.current = nextKey;
    suppressSelectionSyncRef.current = true;
    renderProjectionToDom(root, nextProj);

    if (focused && document.activeElement === root) {
      const visStart = rawOffsetToVisible(nextProj, cStart);
      const visEnd = rawOffsetToVisible(nextProj, cEnd);
      lastVisCaretRef.current = visStart;
      setVisibleSelection(root, visStart, visEnd);
    }

    Promise.resolve().then(() => {
      suppressSelectionSyncRef.current = false;
    });
  };

  useImperativeHandle(handleRef, () => ({
    focus: () => {
      editorRef.current?.focus();
    },
    setCaret: (pos: number | 'start' | 'end') => {
      const rawLen = rawRef.current.length;
      const resolved =
        pos === 'start' ? 0 : pos === 'end' ? rawLen : Math.max(0, Math.min(pos, rawLen));
      caretRef.current = { start: resolved, end: resolved };
      focusedRef.current = true;
      setIsFocused(true);
      onCaretChange?.(resolved);
      syncDom(true);
    },
    getCaret: () => caretRef.current.start,
    scrollIntoView: (opts?: ScrollIntoViewOptions) => {
      editorRef.current?.scrollIntoView(opts);
    },
    isFocused: () => Boolean(editorRef.current && document.activeElement === editorRef.current),
  }));

  useEffect(() => {
    fieldRef?.(handleRef.current);
    return () => fieldRef?.(null);
  }, [fieldRef]);

  useLayoutEffect(() => {
    syncDom(false);
  }, [value, isFocused, allowBlockSyntax]);

  // Track cursor movement (arrows, taps, drag selection) to toggle grey syntax markers live
  useEffect(() => {
    const handleSelectionChange = () => {
      const root = editorRef.current;
      if (!root || !focusedRef.current || composingRef.current || suppressSelectionSyncRef.current) {
        return;
      }
      if (document.activeElement !== root) return;

      const { selStart, selEnd, hasSelection } = readVisibleTextAndSelection(root);
      if (!hasSelection) return;

      const proj = projectionRef.current;
      const isCollapsed = selStart === selEnd;
      const movingLeft = isCollapsed && selStart < lastVisCaretRef.current;
      const atVeryEnd = isCollapsed && selStart === proj.visibleText.length;
      const startBias: 'before' | 'after' = atVeryEnd || movingLeft ? 'after' : 'before';
      const endBias: 'before' | 'after' =
        selEnd === proj.visibleText.length ? 'after' : startBias;

      const rawStart = visibleOffsetToRaw(proj, selStart, startBias);
      const rawEnd = isCollapsed ? rawStart : visibleOffsetToRaw(proj, selEnd, endBias);
      lastVisCaretRef.current = selStart;

      if (rawStart !== caretRef.current.start || rawEnd !== caretRef.current.end) {
        caretRef.current = { start: rawStart, end: rawEnd };
        onCaretChange?.(rawStart);
        syncDom(false);
      }
    };

    document.addEventListener('selectionchange', handleSelectionChange);
    return () => document.removeEventListener('selectionchange', handleSelectionChange);
  }, [allowBlockSyntax, onCaretChange]);

  const commitDomInput = () => {
    const root = editorRef.current;
    if (!root || composingRef.current) return;

    const { text: newVisibleRaw, selStart, hasSelection } = readVisibleTextAndSelection(root);
    const newVisible = multiline ? newVisibleRaw : newVisibleRaw.replace(/\n+/g, ' ');
    const caretVis = hasSelection ? Math.min(selStart, newVisible.length) : newVisible.length;

    const { nextRaw, nextRawCaret } = applyVisibleEditToRaw(
      rawRef.current,
      projectionRef.current,
      newVisible,
      caretVis
    );

    rawRef.current = nextRaw;
    caretRef.current = { start: nextRawCaret, end: nextRawCaret };
    onCaretChange?.(nextRawCaret);
    onChange(nextRaw);
    syncDom(true);
  };

  const insertNewlineAtCaret = () => {
    const raw = rawRef.current;
    const lo = Math.min(caretRef.current.start, caretRef.current.end);
    const hi = Math.max(caretRef.current.start, caretRef.current.end);
    const nextRaw = `${raw.slice(0, lo)}\n${raw.slice(hi)}`;
    const nextCaret = lo + 1;
    rawRef.current = nextRaw;
    caretRef.current = { start: nextCaret, end: nextCaret };
    onCaretChange?.(nextCaret);
    onChange(nextRaw);
    syncDom(true);
  };

  return (
    <div className="relative w-full min-w-0">
      {!value && placeholder && (
        <span
          aria-hidden="true"
          className={`pointer-events-none select-none absolute inset-x-0 top-0 text-stone-400 truncate ${placeholderClassName}`}
        >
          {placeholder}
        </span>
      )}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline={multiline}
        spellCheck
        onFocus={() => {
          focusedRef.current = true;
          setIsFocused(true);
          const syncFocusCaret = () => {
            const root = editorRef.current;
            if (!root || !focusedRef.current) return;
            const { selStart, selEnd, hasSelection } = readVisibleTextAndSelection(root);
            if (hasSelection) {
              const proj = projectionRef.current;
              const startBias: 'before' | 'after' =
                selStart === proj.visibleText.length ? 'after' : 'before';
              const endBias: 'before' | 'after' =
                selEnd === proj.visibleText.length ? 'after' : 'before';
              const rawStart = visibleOffsetToRaw(proj, selStart, startBias);
              const rawEnd =
                selStart === selEnd ? rawStart : visibleOffsetToRaw(proj, selEnd, endBias);
              lastVisCaretRef.current = selStart;
              caretRef.current = { start: rawStart, end: rawEnd };
              onCaretChange?.(rawStart);
            }
            syncDom(false);
          };
          Promise.resolve().then(syncFocusCaret);
          window.requestAnimationFrame(() => {
            syncFocusCaret();
            editorRef.current?.scrollIntoView({ block: 'nearest' });
          });
        }}
        onBlur={() => {
          composingRef.current = false;
          focusedRef.current = false;
          setIsFocused(false);
          syncDom(true);
        }}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
          commitDomInput();
        }}
        onBeforeInput={(e) => {
          const native = e.nativeEvent as InputEvent;
          if (native.inputType === 'insertParagraph' || native.inputType === 'insertLineBreak') {
            e.preventDefault();
            if (multiline) {
              insertNewlineAtCaret();
            } else {
              onEnterSingleLine?.();
            }
          }
        }}
        onInput={() => {
          if (!composingRef.current) {
            commitDomInput();
          }
        }}
        onPaste={(e) => {
          e.preventDefault();
          const pasted = e.clipboardData.getData('text/plain');
          const clean = multiline ? pasted : pasted.replace(/\r?\n+/g, ' ');
          const raw = rawRef.current;
          const lo = Math.min(caretRef.current.start, caretRef.current.end);
          const hi = Math.max(caretRef.current.start, caretRef.current.end);
          const nextRaw = raw.slice(0, lo) + clean + raw.slice(hi);
          const nextCaret = lo + clean.length;
          rawRef.current = nextRaw;
          caretRef.current = { start: nextCaret, end: nextCaret };
          onCaretChange?.(nextCaret);
          onChange(nextRaw);
          syncDom(true);
        }}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === 'Enter') {
            e.preventDefault();
            if (multiline) {
              insertNewlineAtCaret();
            } else {
              onEnterSingleLine?.();
            }
          } else if (e.key === 'Backspace' && !rawRef.current) {
            e.preventDefault();
            onBackspaceEmpty?.();
          }
        }}
        className={`w-full bg-transparent focus:outline-none whitespace-pre-wrap break-words min-h-[1.75rem] ${className}`}
      />
    </div>
  );
};
