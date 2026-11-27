import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ArrowUpDown,
  Check,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Code2,
  Folder,
  FolderOpen,
  GripVertical,
  Heading2,
  List,
  Pin,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { FoldPosture, NoteBlock, NoteItem } from '../../types/taskflow';
import { StyleThemeTokens } from '../../utils/themeTokens';
import { ensureCaretVisibleInContainer } from '../../utils/caretScroll';
import { scrollElementIntoContainer, scrollFirstMarkIntoContainer } from '../../utils/scrollToMatch';
import { useBackLayer } from '../../hooks/useAndroidBackNavigation';
import { HighlightedText } from '../HighlightedText';
import { MarkdownLiveField, MarkdownLiveFieldHandle } from '../MarkdownLiveField';
import { MarkdownPreviewText } from '../MarkdownPreviewText';

function wrapNativeInputHandle(
  el: HTMLInputElement | HTMLTextAreaElement | null
): MarkdownLiveFieldHandle | null {
  if (!el) return null;
  return {
    focus: () => el.focus(),
    setCaret: (pos: number | 'start' | 'end') => {
      const resolved =
        pos === 'start' ? 0 : pos === 'end' ? el.value.length : Math.max(0, Math.min(pos, el.value.length));
      try {
        el.setSelectionRange(resolved, resolved);
      } catch {
        // Some input types do not support selection range
      }
    },
    getCaret: () => el.selectionStart ?? el.value.length,
    getElement: () => el,
    scrollIntoView: (opts?: ScrollIntoViewOptions) => el.scrollIntoView(opts),
    isFocused: () => document.activeElement === el,
  };
}

interface AutoGrowParagraphProps {
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onCaretChange?: (caret: number) => void;
  onCaretActivity?: () => void;
  inputRef: (el: HTMLTextAreaElement | null) => void;
}

const AutoGrowParagraph: React.FC<AutoGrowParagraphProps> = ({
  value,
  placeholder,
  onChange,
  onKeyDown,
  onCaretChange,
  onCaretActivity,
  inputRef,
}) => {
  const localRef = useRef<HTMLTextAreaElement | null>(null);
  const lastWidthRef = useRef<number>(0);

  const syncHeight = () => {
    const el = localRef.current;
    if (!el) return;
    const scrollContainer = el.closest('.device-scroll') as HTMLElement | null;
    const prevScrollTop = scrollContainer ? scrollContainer.scrollTop : null;
    const prevHeight = el.style.height;
    el.style.height = 'auto';
    const nextHeight = `${el.scrollHeight}px`;
    el.style.height = nextHeight || prevHeight;
    if (scrollContainer && prevScrollTop !== null && scrollContainer.scrollTop !== prevScrollTop) {
      scrollContainer.scrollTop = prevScrollTop;
    }
    lastWidthRef.current = el.clientWidth;
  };

  useLayoutEffect(() => {
    syncHeight();
  }, [value]);

  useEffect(() => {
    const el = localRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    lastWidthRef.current = el.clientWidth;
    const ro = new ResizeObserver(() => {
      if (Math.abs(el.clientWidth - lastWidthRef.current) > 1) {
        syncHeight();
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const reportCaret = (el: HTMLTextAreaElement) => {
    onCaretChange?.(el.selectionStart ?? el.value.length);
  };

  return (
    <textarea
      ref={(el) => {
        localRef.current = el;
        inputRef(el);
      }}
      rows={1}
      value={value}
      placeholder={placeholder}
      onFocus={(e) => {
        reportCaret(e.currentTarget);
        onCaretActivity?.();
      }}
      onClick={(e) => {
        reportCaret(e.currentTarget);
        onCaretActivity?.();
      }}
      onKeyUp={(e) => {
        reportCaret(e.currentTarget);
        onCaretActivity?.();
      }}
      onSelect={(e) => reportCaret(e.currentTarget)}
      onChange={(e) => {
        onChange(e.target.value);
        reportCaret(e.currentTarget);
        onCaretActivity?.();
      }}
      onKeyDown={onKeyDown}
      onInput={() => {
        syncHeight();
        onCaretActivity?.();
      }}
      className="block w-full bg-transparent text-[15px] leading-relaxed text-stone-700 dark:text-stone-300 focus:outline-none resize-none overflow-hidden min-h-[1.75rem]"
    />
  );
};

interface NotesScreenProps {
  posture: FoldPosture;
  tokens: StyleThemeTokens;
  notes: NoteItem[];
  noteFolders: string[];
  collapsedFolders: string[];
  onToggleFolderCollapsed: (folder: string) => void;
  onExpandFolder?: (folder: string) => void;
  hingeAwareSplit: boolean;
  selectedNoteId: string;
  onSelectNoteId: (id: string) => void;
  coverEditing: boolean;
  onSetCoverEditing: (editing: boolean) => void;
  onEditorBack?: () => void;
  showReturnBack?: boolean;
  backAriaLabel?: string;
  highlightedNoteId?: string | null;
  highlightQuery?: string;
  highlightTrigger?: number;
  onDismissHighlight?: () => void;
  onUpdateNote: (note: NoteItem) => void;
  onDeleteNote: (noteId: string) => void;
  onCreateNote: (folder?: string) => string;
  onReorderNote: (noteId: string, targetFolder: string, targetIndexInFolder: number) => void;
  autoFocusTitleNoteId?: string | null;
  onConsumeAutoFocusTitle?: () => void;
  keyboardOpen?: boolean;
}

interface ShiftDragGhost {
  title: string;
  preview: string;
  pinned: boolean;
  left: number;
  top: number;
  width: number;
  isDark: boolean;
}

interface ActiveShiftDrag {
  noteId: string;
  pointerId: number;
  offsetY: number;
  scrollContainer: HTMLElement | null;
  lastClientX: number;
  lastClientY: number;
  rafId: number | null;
  cleanup: () => void;
}

export const NotesScreen: React.FC<NotesScreenProps> = ({
  posture,
  tokens,
  notes,
  noteFolders,
  collapsedFolders,
  onToggleFolderCollapsed,
  onExpandFolder,
  hingeAwareSplit,
  selectedNoteId,
  onSelectNoteId,
  coverEditing,
  onSetCoverEditing,
  onEditorBack,
  showReturnBack = false,
  backAriaLabel = 'Back to notes',
  highlightedNoteId = null,
  highlightQuery = '',
  highlightTrigger,
  onDismissHighlight,
  onUpdateNote,
  onDeleteNote,
  onCreateNote,
  onReorderNote,
  autoFocusTitleNoteId = null,
  onConsumeAutoFocusTitle,
  keyboardOpen = false,
}) => {
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  const [shiftMode, setShiftMode] = useState(false);
  const [draggingNoteId, setDraggingNoteId] = useState<string | null>(null);
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);
  const [dragGhost, setDragGhost] = useState<ShiftDragGhost | null>(null);
  const editorScrollRef = useRef<HTMLDivElement | null>(null);
  const noteListScrollRef = useRef<HTMLDivElement | null>(null);
  const lastScrolledEditorMatchKeyRef = useRef<string | null>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const pendingFocusTitleNoteIdRef = useRef<string | null>(null);
  const blockInputRefs = useRef<Record<string, MarkdownLiveFieldHandle | null>>({});
  const pendingFocusRef = useRef<{ blockId: string; caret: 'start' | 'end' } | null>(null);
  const activeBlockRef = useRef<{ blockId: string; caret: number } | null>(null);

  const folderOptions = noteFolders.length > 0 ? noteFolders : ['Work'];
  const activeNote = notes.find((n) => n.id === selectedNoteId) || notes[0];
  const isNoteHighlighted =
    Boolean(activeNote && highlightedNoteId === activeNote.id && highlightQuery.trim());

  const latestActiveNoteRef = useRef<NoteItem | undefined>(activeNote);
  latestActiveNoteRef.current = activeNote;
  const onDeleteNoteRef = useRef(onDeleteNote);
  onDeleteNoteRef.current = onDeleteNote;
  const onUpdateNoteRef = useRef(onUpdateNote);
  onUpdateNoteRef.current = onUpdateNote;
  const notesRef = useRef<NoteItem[]>(notes);
  notesRef.current = notes;
  const folderOptionsRef = useRef<string[]>(folderOptions);
  folderOptionsRef.current = folderOptions;
  const collapsedFoldersRef = useRef<string[]>(collapsedFolders);
  collapsedFoldersRef.current = collapsedFolders;
  const onReorderNoteRef = useRef(onReorderNote);
  onReorderNoteRef.current = onReorderNote;
  const onExpandFolderRef = useRef(onExpandFolder);
  onExpandFolderRef.current = onExpandFolder;
  const activeDragRef = useRef<ActiveShiftDrag | null>(null);
  const finalizedDeletedIdRef = useRef<string | null>(null);

  const stopShiftDrag = () => {
    const active = activeDragRef.current;
    if (active) {
      if (active.rafId !== null) {
        window.cancelAnimationFrame(active.rafId);
      }
      active.cleanup();
    }
    activeDragRef.current = null;
    setDraggingNoteId(null);
    setDragOverFolder(null);
    setDragGhost(null);
  };

  useBackLayer(
    shiftMode,
    () => {
      stopShiftDrag();
      setShiftMode(false);
    },
    15
  );

  const finalizeNote = (note?: NoteItem) => {
    if (!note || finalizedDeletedIdRef.current === note.id) return;
    const hasTitle = note.title.trim().length > 0;
    const hasContent = note.blocks.some((b) => b.text.trim().length > 0);
    if (!hasTitle && !hasContent) {
      finalizedDeletedIdRef.current = note.id;
      onDeleteNoteRef.current(note.id);
    } else if (!hasTitle && hasContent) {
      onUpdateNoteRef.current({ ...note, title: 'Untitled Note' });
    }
  };

  useEffect(() => {
    return () => {
      stopShiftDrag();
      finalizeNote(latestActiveNoteRef.current);
    };
  }, []);

  useEffect(() => {
    if (!shiftMode) {
      stopShiftDrag();
    }
  }, [shiftMode]);

  useEffect(() => {
    if (coverEditing && shiftMode) {
      stopShiftDrag();
      setShiftMode(false);
    }
  }, [coverEditing, shiftMode]);

  useEffect(() => {
    if (notes.length === 0 && shiftMode) {
      stopShiftDrag();
      setShiftMode(false);
    }
  }, [notes.length, shiftMode]);

  const prevCoverEditingRef = useRef<boolean>(coverEditing);
  useEffect(() => {
    if (prevCoverEditingRef.current && !coverEditing) {
      finalizeNote(latestActiveNoteRef.current);
    }
    prevCoverEditingRef.current = coverEditing;
  }, [coverEditing]);

  useEffect(() => {
    activeBlockRef.current = null;
    if (pendingFocusTitleNoteIdRef.current && pendingFocusTitleNoteIdRef.current === activeNote?.id) {
      pendingFocusTitleNoteIdRef.current = null;
      titleInputRef.current?.focus();
    }
  }, [activeNote?.id, coverEditing]);

  useEffect(() => {
    if (!autoFocusTitleNoteId || activeNote?.id !== autoFocusTitleNoteId) return;
    const frame = window.requestAnimationFrame(() => {
      titleInputRef.current?.focus();
    });
    onConsumeAutoFocusTitle?.();
    return () => window.cancelAnimationFrame(frame);
  }, [autoFocusTitleNoteId, activeNote?.id, coverEditing, onConsumeAutoFocusTitle]);

  useEffect(() => {
    setEditingBlockId(null);
    lastScrolledEditorMatchKeyRef.current = null;
    if (highlightedNoteId) {
      const target = notes.find((n) => n.id === highlightedNoteId);
      if (target) {
        const resolvedFolder = folderOptions.includes(target.folder)
          ? target.folder
          : folderOptions[0];
        if (collapsedFolders.includes(resolvedFolder)) {
          onExpandFolder?.(resolvedFolder);
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightedNoteId, highlightQuery, highlightTrigger]);

  useEffect(() => {
    if (!highlightedNoteId || !highlightQuery.trim()) return;
    const raf = window.requestAnimationFrame(() => {
      const container = noteListScrollRef.current;
      if (!container) return;
      const escapedId = highlightedNoteId.replace(/"/g, '\\"');
      const row = container.querySelector<HTMLElement>(`[data-note-id="${escapedId}"]`);
      scrollElementIntoContainer(container, row, 'smooth');
    });
    return () => window.cancelAnimationFrame(raf);
  }, [highlightedNoteId, highlightQuery, highlightTrigger, collapsedFolders, posture, coverEditing]);

  useEffect(() => {
    const trimmed = highlightQuery.trim();
    if (!isNoteHighlighted || !activeNote || !trimmed || editingBlockId !== null) {
      if (!isNoteHighlighted) {
        lastScrolledEditorMatchKeyRef.current = null;
      }
      return;
    }

    const matchKey = `${activeNote.id}::${trimmed}::${highlightTrigger ?? 0}`;
    if (lastScrolledEditorMatchKeyRef.current === matchKey) return;

    let raf2: number | null = null;
    const raf1 = window.requestAnimationFrame(() => {
      if (scrollFirstMarkIntoContainer(editorScrollRef.current, 'smooth')) {
        lastScrolledEditorMatchKeyRef.current = matchKey;
        return;
      }
      raf2 = window.requestAnimationFrame(() => {
        if (scrollFirstMarkIntoContainer(editorScrollRef.current, 'smooth')) {
          lastScrolledEditorMatchKeyRef.current = matchKey;
        }
      });
    });

    return () => {
      window.cancelAnimationFrame(raf1);
      if (raf2 !== null) window.cancelAnimationFrame(raf2);
    };
  }, [isNoteHighlighted, activeNote?.id, highlightQuery, highlightTrigger, editingBlockId, posture, coverEditing]);

  const caretScrollRafRef = useRef<number | null>(null);

  const scheduleEnsureActiveCaretVisible = () => {
    if (caretScrollRafRef.current !== null) {
      window.cancelAnimationFrame(caretScrollRafRef.current);
    }
    caretScrollRafRef.current = window.requestAnimationFrame(() => {
      caretScrollRafRef.current = null;
      const container = editorScrollRef.current;
      if (!container) return;

      const activeEl = document.activeElement;
      if (activeEl instanceof HTMLElement && container.contains(activeEl)) {
        ensureCaretVisibleInContainer(activeEl, container);
        return;
      }

      const tracked = activeBlockRef.current;
      if (tracked) {
        const handle = blockInputRefs.current[tracked.blockId];
        if (handle?.isFocused()) {
          ensureCaretVisibleInContainer(handle.getElement(), container);
        }
      }
    });
  };

  useEffect(() => {
    return () => {
      if (caretScrollRafRef.current !== null) {
        window.cancelAnimationFrame(caretScrollRafRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const pending = pendingFocusRef.current;
    if (!pending) return;
    const handle = blockInputRefs.current[pending.blockId];
    if (!handle) return;
    pendingFocusRef.current = null;
    handle.focus();
    handle.setCaret(pending.caret);
    activeBlockRef.current = { blockId: pending.blockId, caret: handle.getCaret() };
    scheduleEnsureActiveCaretVisible();
  }, [activeNote?.id, activeNote?.blocks]);

  // Keep the active caret line visible above the toolbar when mobile keyboard opens/resizes
  useEffect(() => {
    const vv = window.visualViewport;
    let settleTimer: number | null = null;
    const onViewportResize = () => {
      scheduleEnsureActiveCaretVisible();
      if (settleTimer !== null) window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(() => {
        settleTimer = null;
        scheduleEnsureActiveCaretVisible();
      }, 120);
    };
    vv?.addEventListener('resize', onViewportResize);
    return () => {
      vv?.removeEventListener('resize', onViewportResize);
      if (settleTimer !== null) window.clearTimeout(settleTimer);
    };
  }, []);

  useEffect(() => {
    if (keyboardOpen) {
      scheduleEnsureActiveCaretVisible();
    }
  }, [keyboardOpen]);

  const handleCreate = (targetFolder?: string) => {
    finalizeNote(activeNote);
    const resolvedFolder =
      targetFolder && folderOptions.includes(targetFolder)
        ? targetFolder
        : folderOptions[0];
    onExpandFolder?.(resolvedFolder);
    const newId = onCreateNote(resolvedFolder);
    pendingFocusTitleNoteIdRef.current = newId;
    onSelectNoteId(newId);
    if (posture === FoldPosture.Cover) {
      onSetCoverEditing(true);
    }
  };

  const handleUpdateBlock = (blockId: string, patch: Partial<NoteBlock>) => {
    if (!activeNote) return;
    onUpdateNote({
      ...activeNote,
      updatedAt: 'Edited just now',
      blocks: activeNote.blocks.map((b) => (b.id === blockId ? { ...b, ...patch } : b)),
    });
  };

  const handleRemoveBlock = (blockId: string, focusPrevious = false) => {
    if (!activeNote) return;
    const idx = activeNote.blocks.findIndex((b) => b.id === blockId);
    const remaining = activeNote.blocks.filter((b) => b.id !== blockId);
    if (remaining.length > 0) {
      if (focusPrevious) {
        const targetBlock = remaining[Math.max(0, idx - 1)];
        if (targetBlock) {
          pendingFocusRef.current = { blockId: targetBlock.id, caret: 'end' };
        }
      }
      onUpdateNote({
        ...activeNote,
        updatedAt: 'Edited just now',
        blocks: remaining,
      });
    } else {
      const replacementId = `b-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      if (focusPrevious) {
        pendingFocusRef.current = { blockId: replacementId, caret: 'start' };
      }
      onUpdateNote({
        ...activeNote,
        updatedAt: 'Edited just now',
        blocks: [{ id: replacementId, type: 'paragraph', text: '' }],
      });
    }
  };

  const makeBlockId = () => `b-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  const handleAppendBlock = (type: NoteBlock['type'], afterBlockId?: string) => {
    if (!activeNote) return;
    const newBlock: NoteBlock = {
      id: makeBlockId(),
      type,
      text: '',
      checked: type === 'checklist' ? false : undefined,
    };
    pendingFocusRef.current = { blockId: newBlock.id, caret: 'end' };
    if (afterBlockId) {
      const idx = activeNote.blocks.findIndex((b) => b.id === afterBlockId);
      const next = [...activeNote.blocks];
      next.splice(idx + 1, 0, newBlock);
      onUpdateNote({ ...activeNote, updatedAt: 'Edited just now', blocks: next });
    } else {
      onUpdateNote({
        ...activeNote,
        updatedAt: 'Edited just now',
        blocks: [...activeNote.blocks, newBlock],
      });
    }
  };

  const handleStartFormattedBlock = (type: 'heading' | 'checklist' | 'bullet') => {
    if (!activeNote) return;

    const newBlock: NoteBlock = {
      id: makeBlockId(),
      type,
      text: '',
      checked: type === 'checklist' ? false : undefined,
    };
    pendingFocusRef.current = { blockId: newBlock.id, caret: 'start' };

    const blocks = activeNote.blocks;
    if (blocks.length === 0) {
      onUpdateNote({ ...activeNote, updatedAt: 'Edited just now', blocks: [newBlock] });
      return;
    }

    // Determine the active block and caret position (prefer live DOM selection if still focused)
    const tracked = activeBlockRef.current;
    let targetIdx = tracked ? blocks.findIndex((b) => b.id === tracked.blockId) : -1;
    let caret = tracked?.caret ?? 0;

    if (targetIdx === -1) {
      targetIdx = blocks.length - 1;
      caret = blocks[targetIdx].text.length;
    } else {
      const liveHandle = blockInputRefs.current[blocks[targetIdx].id];
      if (liveHandle?.isFocused()) {
        caret = liveHandle.getCaret();
      }
    }

    const targetBlock = blocks[targetIdx];

    if (targetBlock.type === 'paragraph') {
      const text = targetBlock.text;
      const safeCaret = Math.max(0, Math.min(caret, text.length));
      const lineStart = safeCaret === 0 ? 0 : text.lastIndexOf('\n', safeCaret - 1) + 1;
      const nextNewline = text.indexOf('\n', safeCaret);
      const lineEnd = nextNewline === -1 ? text.length : nextNewline;
      const currentLine = text.slice(lineStart, lineEnd);

      // If cursor is on an empty line inside the paragraph, start the formatted block on THAT exact line
      if (currentLine.trim().length === 0) {
        const beforeText = lineStart > 0 ? text.slice(0, lineStart - 1) : '';
        const afterText = lineEnd < text.length ? text.slice(lineEnd + 1) : '';
        const replacement: NoteBlock[] = [];

        if (beforeText.length > 0) {
          replacement.push({ ...targetBlock, text: beforeText });
        }
        replacement.push(newBlock);
        if (afterText.length > 0) {
          replacement.push({ id: makeBlockId(), type: 'paragraph', text: afterText });
        }

        const next = [...blocks];
        next.splice(targetIdx, 1, ...replacement);
        onUpdateNote({ ...activeNote, updatedAt: 'Edited just now', blocks: next });
        return;
      }

      // Cursor is on a non-empty line inside a paragraph: insert right after the current line
      const beforeText = text.slice(0, lineEnd);
      const afterText = lineEnd < text.length ? text.slice(lineEnd + 1) : '';
      const replacement: NoteBlock[] = [{ ...targetBlock, text: beforeText }, newBlock];
      if (afterText.length > 0) {
        replacement.push({ id: makeBlockId(), type: 'paragraph', text: afterText });
      }
      const next = [...blocks];
      next.splice(targetIdx, 1, ...replacement);
      onUpdateNote({ ...activeNote, updatedAt: 'Edited just now', blocks: next });
      return;
    }

    // If cursor is on an empty heading/checklist/list row, convert it in-place on the same line
    if (!targetBlock.text.trim()) {
      const next = blocks.map((b, i) => (i === targetIdx ? newBlock : b));
      onUpdateNote({ ...activeNote, updatedAt: 'Edited just now', blocks: next });
      return;
    }

    // Otherwise insert directly after the active block
    const next = [...blocks];
    next.splice(targetIdx + 1, 0, newBlock);
    onUpdateNote({ ...activeNote, updatedAt: 'Edited just now', blocks: next });
  };

  const handleConvertBlockToParagraph = (blockId: string) => {
    if (!activeNote) return;
    pendingFocusRef.current = { blockId, caret: 'start' };
    onUpdateNote({
      ...activeNote,
      updatedAt: 'Edited just now',
      blocks: activeNote.blocks.map((b) =>
        b.id === blockId ? { id: b.id, type: 'paragraph', text: '' } : b
      ),
    });
  };

  const handleFocusDefaultWritingArea = () => {
    if (!activeNote) return;
    const last = activeNote.blocks[activeNote.blocks.length - 1];
    if (last && last.type === 'paragraph') {
      const handle = blockInputRefs.current[last.id];
      if (handle) {
        handle.focus();
        handle.setCaret('end');
        return;
      }
    }
    handleAppendBlock('paragraph');
  };

  const getNoteLocation = (noteId: string) => {
    const folders = folderOptionsRef.current;
    const fallback = folders[0] || 'Work';
    const resolveFolder = (n: NoteItem) => (folders.includes(n.folder) ? n.folder : fallback);
    const list = notesRef.current;
    const target = list.find((n) => n.id === noteId);
    if (!target) return null;
    const folder = resolveFolder(target);
    let idxInFolder = 0;
    let folderCount = 0;
    for (const item of list) {
      if (resolveFolder(item) === folder) {
        if (item.id === noteId) {
          idxInFolder = folderCount;
        }
        folderCount += 1;
      }
    }
    return { folder, idxInFolder, folderCount };
  };

  const hitTestAndReorder = (clientX: number, clientY: number) => {
    const drag = activeDragRef.current;
    if (!drag) return;

    const elements = document.elementsFromPoint(clientX, clientY);
    let hitNoteEl: HTMLElement | null = null;
    let hitFolderEl: HTMLElement | null = null;

    for (const el of elements) {
      if (!(el instanceof HTMLElement)) continue;
      if (!hitNoteEl) {
        const noteTarget = el.closest('[data-shift-note-id]') as HTMLElement | null;
        if (noteTarget) {
          hitNoteEl = noteTarget;
          break;
        }
      }
      if (!hitFolderEl) {
        const folderTarget = el.closest('[data-shift-folder-drop]') as HTMLElement | null;
        if (folderTarget) {
          hitFolderEl = folderTarget;
        }
      }
    }

    const currentLoc = getNoteLocation(drag.noteId);
    if (!currentLoc) return;

    if (hitNoteEl) {
      const targetNoteId = hitNoteEl.getAttribute('data-shift-note-id');
      const targetFolder = hitNoteEl.getAttribute('data-shift-folder');
      const targetIdxRaw = hitNoteEl.getAttribute('data-shift-index');
      if (!targetNoteId || !targetFolder || targetIdxRaw === null) return;

      setDragOverFolder(targetFolder);
      if (targetNoteId === drag.noteId) return;

      const targetIdx = Number(targetIdxRaw);
      if (!Number.isFinite(targetIdx)) return;

      const rect = hitNoteEl.getBoundingClientRect();
      if (currentLoc.folder === targetFolder) {
        if (currentLoc.idxInFolder < targetIdx) {
          if (clientY < rect.top + rect.height * 0.35) return;
          onReorderNoteRef.current(drag.noteId, targetFolder, targetIdx);
        } else if (currentLoc.idxInFolder > targetIdx) {
          if (clientY > rect.top + rect.height * 0.65) return;
          onReorderNoteRef.current(drag.noteId, targetFolder, targetIdx);
        }
      } else {
        const insertAfter = clientY >= rect.top + rect.height * 0.5;
        onReorderNoteRef.current(
          drag.noteId,
          targetFolder,
          insertAfter ? targetIdx + 1 : targetIdx
        );
      }
      return;
    }

    if (hitFolderEl) {
      const dropFolder = hitFolderEl.getAttribute('data-shift-folder-drop');
      const dropPos = hitFolderEl.getAttribute('data-shift-folder-pos') || 'end';
      if (!dropFolder) return;

      setDragOverFolder(dropFolder);

      if (collapsedFoldersRef.current.includes(dropFolder)) {
        onExpandFolderRef.current?.(dropFolder);
      }

      const folders = folderOptionsRef.current;
      const fallback = folders[0] || 'Work';
      const resolveFolder = (n: NoteItem) => (folders.includes(n.folder) ? n.folder : fallback);
      const targetFolderCount = notesRef.current.filter(
        (n) => resolveFolder(n) === dropFolder
      ).length;

      if (dropPos === 'start') {
        if (currentLoc.folder !== dropFolder || currentLoc.idxInFolder !== 0) {
          onReorderNoteRef.current(drag.noteId, dropFolder, 0);
        }
      } else if (currentLoc.folder !== dropFolder) {
        onReorderNoteRef.current(drag.noteId, dropFolder, targetFolderCount);
      }
    }
  };

  const syncShiftAutoScroll = () => {
    const drag = activeDragRef.current;
    if (!drag || !drag.scrollContainer) return;

    const EDGE_THRESHOLD = 52;
    const MAX_STEP = 10;

    const getScrollDelta = (): number => {
      const current = activeDragRef.current;
      if (!current || !current.scrollContainer) return 0;
      const rect = current.scrollContainer.getBoundingClientRect();
      if (current.lastClientY < rect.top + EDGE_THRESHOLD) {
        const ratio = Math.min(
          1,
          (rect.top + EDGE_THRESHOLD - current.lastClientY) / EDGE_THRESHOLD
        );
        return -Math.max(2, Math.round(ratio * MAX_STEP));
      }
      if (current.lastClientY > rect.bottom - EDGE_THRESHOLD) {
        const ratio = Math.min(
          1,
          (current.lastClientY - (rect.bottom - EDGE_THRESHOLD)) / EDGE_THRESHOLD
        );
        return Math.max(2, Math.round(ratio * MAX_STEP));
      }
      return 0;
    };

    const delta = getScrollDelta();
    if (delta === 0) {
      if (drag.rafId !== null) {
        window.cancelAnimationFrame(drag.rafId);
        drag.rafId = null;
      }
      return;
    }

    if (drag.rafId !== null) return;

    const step = () => {
      const current = activeDragRef.current;
      if (!current || !current.scrollContainer) return;
      const nextDelta = getScrollDelta();
      if (nextDelta === 0) {
        current.rafId = null;
        return;
      }
      const before = current.scrollContainer.scrollTop;
      current.scrollContainer.scrollTop += nextDelta;
      if (current.scrollContainer.scrollTop !== before) {
        hitTestAndReorder(current.lastClientX, current.lastClientY);
      }
      current.rafId = window.requestAnimationFrame(step);
    };

    drag.rafId = window.requestAnimationFrame(step);
  };

  const handleShiftPointerDown = (
    e: React.PointerEvent<HTMLDivElement>,
    note: NoteItem,
    folderName: string,
    previewText: string
  ) => {
    if (!shiftMode) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if ((e.target as HTMLElement).closest('[data-shift-step="true"]')) return;

    e.preventDefault();
    stopShiftDrag();

    const rowEl = e.currentTarget;
    const rect = rowEl.getBoundingClientRect();
    const scrollContainer = rowEl.closest('.device-scroll') as HTMLElement | null;
    const isDarkContext = Boolean(
      rowEl.closest('.dark') || document.documentElement.classList.contains('dark')
    );

    const onWindowPointerMove = (moveEvent: PointerEvent) => {
      const drag = activeDragRef.current;
      if (!drag || drag.pointerId !== moveEvent.pointerId) return;
      moveEvent.preventDefault();
      drag.lastClientX = moveEvent.clientX;
      drag.lastClientY = moveEvent.clientY;
      const nextTop = moveEvent.clientY - drag.offsetY;
      setDragGhost((prev) => (prev ? { ...prev, top: nextTop } : prev));
      hitTestAndReorder(moveEvent.clientX, moveEvent.clientY);
      syncShiftAutoScroll();
    };

    const onWindowPointerEnd = (endEvent: PointerEvent) => {
      const drag = activeDragRef.current;
      if (!drag || drag.pointerId !== endEvent.pointerId) return;
      stopShiftDrag();
    };

    window.addEventListener('pointermove', onWindowPointerMove, { passive: false });
    window.addEventListener('pointerup', onWindowPointerEnd);
    window.addEventListener('pointercancel', onWindowPointerEnd);

    activeDragRef.current = {
      noteId: note.id,
      pointerId: e.pointerId,
      offsetY: e.clientY - rect.top,
      scrollContainer,
      lastClientX: e.clientX,
      lastClientY: e.clientY,
      rafId: null,
      cleanup: () => {
        window.removeEventListener('pointermove', onWindowPointerMove);
        window.removeEventListener('pointerup', onWindowPointerEnd);
        window.removeEventListener('pointercancel', onWindowPointerEnd);
      },
    };

    setDraggingNoteId(note.id);
    setDragOverFolder(folderName);
    setDragGhost({
      title: note.title.trim() || 'Untitled Note',
      preview: previewText,
      pinned: Boolean(note.pinned),
      left: rect.left,
      top: rect.top,
      width: rect.width,
      isDark: isDarkContext,
    });
  };

  const handleStepShift = (
    noteId: string,
    folderName: string,
    noteIdx: number,
    folderNotesLength: number,
    direction: -1 | 1,
    notesByFolder: Map<string, NoteItem[]>
  ) => {
    const folderIdx = folderOptions.indexOf(folderName);
    if (direction === -1) {
      if (noteIdx > 0) {
        onReorderNote(noteId, folderName, noteIdx - 1);
      } else if (folderIdx > 0) {
        const prevFolder = folderOptions[folderIdx - 1];
        if (collapsedFolders.includes(prevFolder)) {
          onExpandFolder?.(prevFolder);
        }
        const prevCount = notesByFolder.get(prevFolder)?.length ?? 0;
        onReorderNote(noteId, prevFolder, prevCount);
      }
    } else {
      if (noteIdx < folderNotesLength - 1) {
        onReorderNote(noteId, folderName, noteIdx + 1);
      } else if (folderIdx !== -1 && folderIdx < folderOptions.length - 1) {
        const nextFolder = folderOptions[folderIdx + 1];
        if (collapsedFolders.includes(nextFolder)) {
          onExpandFolder?.(nextFolder);
        }
        onReorderNote(noteId, nextFolder, 0);
      }
    }
  };

  const renderNoteList = () => {
    const notesByFolder = new Map<string, NoteItem[]>();
    for (const folderName of folderOptions) {
      notesByFolder.set(folderName, []);
    }
    for (const note of notes) {
      const resolvedFolder = folderOptions.includes(note.folder)
        ? note.folder
        : folderOptions[0];
      notesByFolder.get(resolvedFolder)?.push(note);
    }

    return (
      <div className="space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <h2 className={`font-display font-semibold text-stone-900 dark:text-stone-100 ${tokens.headingScale}`}>
            Notes
          </h2>
          <div className="flex items-center gap-1.5 shrink-0">
            {shiftMode ? (
              <button
                type="button"
                onClick={() => {
                  stopShiftDrag();
                  setShiftMode(false);
                }}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium ${tokens.accentBg} ${tokens.buttonRadius} whitespace-nowrap shrink-0`}
              >
                <Check className="w-4 h-4" />
                Done
              </button>
            ) : (
              <>
                {notes.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShiftMode(true)}
                    aria-label="Shift note order"
                    title="Shift note order"
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[13px] font-medium ${tokens.subtleBg} text-stone-700 dark:text-stone-200 hover:text-[var(--tf-accent-text)] ${tokens.buttonRadius} transition-colors whitespace-nowrap shrink-0`}
                  >
                    <ArrowUpDown className="w-3.5 h-3.5" />
                    Shift
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleCreate()}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium ${tokens.accentBg} ${tokens.buttonRadius} whitespace-nowrap shrink-0`}
                >
                  <Plus className="w-4 h-4" />
                  New note
                </button>
              </>
            )}
          </div>
        </div>

        {shiftMode && (
          <p className="text-[12.5px] text-stone-500 dark:text-stone-400 px-0.5">
            Drag notes to shift their order or move between folders.
          </p>
        )}

        <div className="space-y-2">
          {folderOptions.map((folderName, folderIdx) => {
            const folderNotes = notesByFolder.get(folderName) ?? [];
            const isCollapsed = collapsedFolders.includes(folderName);
            const isDropHighlighted = Boolean(draggingNoteId && dragOverFolder === folderName);
            return (
              <div
                key={folderName}
                className={`${tokens.cardBg} ${tokens.cardRadius} overflow-hidden transition-shadow ${
                  isDropHighlighted ? 'ring-1 ring-[var(--tf-accent)]/60' : ''
                }`}
              >
                <div
                  data-shift-folder-drop={folderName}
                  data-shift-folder-pos="start"
                  className={`flex items-center justify-between gap-2 px-3 py-2.5 ${
                    !isCollapsed ? `border-b ${tokens.divider}` : ''
                  } ${isDropHighlighted ? tokens.accentSoftBg : ''}`}
                >
                  <button
                    type="button"
                    aria-expanded={!isCollapsed}
                    onClick={() => onToggleFolderCollapsed(folderName)}
                    className="flex-1 min-w-0 flex items-center gap-2 text-left py-0.5 hover:opacity-85 transition-opacity"
                  >
                    {isCollapsed ? (
                      <ChevronRight className="w-4 h-4 text-stone-400 shrink-0" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-stone-400 shrink-0" />
                    )}
                    {isCollapsed ? (
                      <Folder className="w-4 h-4 text-stone-400 dark:text-stone-500 shrink-0" />
                    ) : (
                      <FolderOpen className={`w-4 h-4 shrink-0 ${tokens.accentText}`} />
                    )}
                    <span className="text-[14.5px] font-semibold text-stone-900 dark:text-stone-100 truncate">
                      {folderName}
                    </span>
                    <span className="text-[12px] text-stone-400 dark:text-stone-500 tabular-nums shrink-0">
                      {folderNotes.length}
                    </span>
                  </button>
                  {!shiftMode && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCreate(folderName);
                      }}
                      aria-label={`New note in ${folderName}`}
                      title={`New note in ${folderName}`}
                      className={`p-1.5 ${tokens.subtleBg} text-stone-500 dark:text-stone-400 hover:text-[var(--tf-accent-text)] ${tokens.buttonRadius} transition-colors shrink-0`}
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {!isCollapsed && (
                  folderNotes.length === 0 ? (
                    <div
                      data-shift-folder-drop={folderName}
                      data-shift-folder-pos="end"
                      className={`px-4 py-3 text-[13px] ${
                        shiftMode
                          ? 'text-stone-500 dark:text-stone-400 text-center border-t border-dashed border-stone-200/80 dark:border-stone-800/80'
                          : 'text-stone-400 dark:text-stone-500'
                      }`}
                    >
                      {shiftMode ? 'Drop a note here' : 'No notes in this folder'}
                    </div>
                  ) : (
                    folderNotes.map((note, noteIdx) => {
                      const listHighlight =
                        highlightedNoteId === note.id && Boolean(highlightQuery.trim());
                      const matchedBlock =
                        listHighlight &&
                        note.blocks.find((b) =>
                          b.text.toLowerCase().includes(highlightQuery.trim().toLowerCase())
                        );
                      const previewBlock =
                        matchedBlock ||
                        note.blocks.find((b) => b.type !== 'heading' && b.text.trim()) ||
                        note.blocks.find((b) => b.text.trim());
                      const previewText = previewBlock?.text || 'Empty note';

                      if (shiftMode) {
                        const isBeingDragged = draggingNoteId === note.id;
                        const canShiftUp = noteIdx > 0 || folderIdx > 0;
                        const canShiftDown =
                          noteIdx < folderNotes.length - 1 ||
                          folderIdx < folderOptions.length - 1;
                        return (
                          <div
                            key={note.id}
                            role="listitem"
                            data-shift-note-id={note.id}
                            data-shift-folder={folderName}
                            data-shift-index={noteIdx}
                            onPointerDown={(e) =>
                              handleShiftPointerDown(e, note, folderName, previewText)
                            }
                            className={`w-full flex items-center gap-2.5 text-left ${tokens.rowPadding} border-b last:border-b-0 ${tokens.divider} touch-none select-none cursor-grab active:cursor-grabbing transition-colors ${
                              isBeingDragged
                                ? `${tokens.accentSoftBg} opacity-35 ring-1 ring-inset ring-[var(--tf-accent)]/40`
                                : 'hover:bg-stone-50/80 dark:hover:bg-white/[0.02]'
                            }`}
                          >
                            <GripVertical
                              className={`w-4 h-4 shrink-0 ${
                                isBeingDragged
                                  ? tokens.accentText
                                  : 'text-stone-400 dark:text-stone-500'
                              }`}
                              aria-hidden="true"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <p className="text-[15px] font-semibold text-stone-900 dark:text-stone-100 truncate">
                                  {note.title.trim() || 'Untitled Note'}
                                </p>
                                {note.pinned && (
                                  <Pin className={`w-3.5 h-3.5 shrink-0 ${tokens.accentText}`} />
                                )}
                              </div>
                              <p className="text-[13px] text-stone-500 dark:text-stone-400 truncate mt-0.5">
                                {note.markdownEnabled && previewBlock ? (
                                  <MarkdownPreviewText text={previewText} />
                                ) : (
                                  previewText
                                )}
                              </p>
                            </div>
                            <div
                              data-shift-step="true"
                              className="flex items-center gap-1 shrink-0"
                            >
                              <button
                                type="button"
                                data-shift-step="true"
                                disabled={!canShiftUp}
                                onClick={() =>
                                  handleStepShift(
                                    note.id,
                                    folderName,
                                    noteIdx,
                                    folderNotes.length,
                                    -1,
                                    notesByFolder
                                  )
                                }
                                aria-label={`Move ${note.title.trim() || 'Untitled Note'} up`}
                                title="Move up"
                                className={`p-1.5 ${tokens.subtleBg} ${tokens.buttonRadius} text-stone-600 dark:text-stone-300 hover:text-[var(--tf-accent-text)] disabled:opacity-30 disabled:pointer-events-none transition-colors`}
                              >
                                <ArrowUp className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                data-shift-step="true"
                                disabled={!canShiftDown}
                                onClick={() =>
                                  handleStepShift(
                                    note.id,
                                    folderName,
                                    noteIdx,
                                    folderNotes.length,
                                    1,
                                    notesByFolder
                                  )
                                }
                                aria-label={`Move ${note.title.trim() || 'Untitled Note'} down`}
                                title="Move down"
                                className={`p-1.5 ${tokens.subtleBg} ${tokens.buttonRadius} text-stone-600 dark:text-stone-300 hover:text-[var(--tf-accent-text)] disabled:opacity-30 disabled:pointer-events-none transition-colors`}
                              >
                                <ArrowDown className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        );
                      }

                      return (
                        <button
                          key={note.id}
                          data-note-id={note.id}
                          type="button"
                          onClick={() => {
                            if (activeNote && activeNote.id !== note.id) {
                              finalizeNote(activeNote);
                            }
                            onSelectNoteId(note.id);
                            if (posture === FoldPosture.Cover) onSetCoverEditing(true);
                          }}
                          className={`w-full text-left ${tokens.rowPadding} border-b last:border-b-0 ${tokens.divider} transition-colors hover:bg-stone-50/80 dark:hover:bg-white/[0.02]`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-[15px] font-semibold text-stone-900 dark:text-stone-100 truncate">
                              {note.title.trim() ? (
                                <HighlightedText
                                  text={note.title}
                                  query={highlightQuery}
                                  active={listHighlight}
                                />
                              ) : (
                                'Untitled Note'
                              )}
                            </p>
                            {note.pinned && (
                              <Pin className={`w-3.5 h-3.5 shrink-0 ${tokens.accentText}`} />
                            )}
                          </div>
                          <p className="text-[13px] text-stone-500 dark:text-stone-400 truncate mt-0.5">
                            {note.markdownEnabled && previewBlock ? (
                              <MarkdownPreviewText
                                text={previewText}
                                query={highlightQuery}
                                highlightActive={listHighlight}
                              />
                            ) : (
                              <HighlightedText
                                text={previewText}
                                query={highlightQuery}
                                active={listHighlight}
                              />
                            )}
                          </p>
                        </button>
                      );
                    })
                  )
                )}
              </div>
            );
          })}
        </div>

        {dragGhost &&
          typeof document !== 'undefined' &&
          createPortal(
            <div className={dragGhost.isDark ? 'dark' : ''}>
              <div
                style={{
                  top: dragGhost.top,
                  left: dragGhost.left,
                  width: dragGhost.width,
                }}
                className={`fixed pointer-events-none z-50 flex items-center gap-2.5 ${tokens.rowPadding} ${tokens.cardRadius} bg-white/95 dark:bg-[#1a1f1c]/95 border-2 border-[var(--tf-accent)] shadow-2xl backdrop-blur-sm`}
              >
                <GripVertical className={`w-4 h-4 shrink-0 ${tokens.accentText}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-[15px] font-semibold text-stone-900 dark:text-stone-100 truncate">
                      {dragGhost.title}
                    </p>
                    {dragGhost.pinned && (
                      <Pin className={`w-3.5 h-3.5 shrink-0 ${tokens.accentText}`} />
                    )}
                  </div>
                  <p className="text-[13px] text-stone-500 dark:text-stone-400 truncate mt-0.5">
                    {dragGhost.preview}
                  </p>
                </div>
              </div>
            </div>,
            document.body
          )}
      </div>
    );
  };

  const renderEditor = (showBack = false) => {
    if (!activeNote) {
      return (
        <div className={`h-full flex items-center justify-center p-6 text-[14px] text-stone-400 ${tokens.cardBg} ${tokens.cardRadius}`}>
          Create or select a note to begin editing.
        </div>
      );
    }

    const wordCount = activeNote.blocks
      .map((b) => b.text.trim().split(/\s+/).filter(Boolean).length)
      .reduce((acc, n) => acc + n, 0);

    const trimmedQuery = highlightQuery.trim().toLowerCase();
    const markdownOn = Boolean(activeNote.markdownEnabled);

    return (
      <div className={`h-full min-h-0 flex flex-col ${tokens.cardBg} ${tokens.cardRadius} overflow-hidden`}>
        {/* Editor Header */}
        <div className={`flex items-center justify-between px-3 py-2 border-b ${tokens.divider} shrink-0 gap-2`}>
          <div className="flex items-center gap-2 min-w-0">
            {showBack && (
              <button
                type="button"
                onClick={() => {
                  finalizeNote(activeNote);
                  if (onEditorBack) {
                    onEditorBack();
                  } else {
                    onSetCoverEditing(false);
                  }
                }}
                className="p-1.5 -ml-1 text-stone-500 hover:text-stone-900 dark:hover:text-stone-100"
                aria-label={backAriaLabel}
                title={backAriaLabel}
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
            )}
            <select
              aria-label="Note folder"
              value={folderOptions.includes(activeNote.folder) ? activeNote.folder : folderOptions[0]}
              onChange={(e) =>
                onUpdateNote({ ...activeNote, folder: e.target.value })
              }
              className={`text-[13px] font-medium px-2.5 py-1 ${tokens.subtleBg} text-stone-700 dark:text-stone-200 ${tokens.buttonRadius} focus:outline-none`}
            >
              {folderOptions.map((folderName) => (
                <option key={folderName} value={folderName}>
                  {folderName}
                </option>
              ))}
            </select>
            <span className="text-[12px] text-stone-400 dark:text-stone-500 truncate tabular-nums">
              {wordCount} words
            </span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => onUpdateNote({ ...activeNote, pinned: !activeNote.pinned })}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[12.5px] font-medium ${tokens.buttonRadius} transition-colors ${
                activeNote.pinned
                  ? `${tokens.accentSoftBg} ${tokens.accentText}`
                  : `${tokens.subtleBg} text-stone-500 dark:text-stone-400`
              }`}
            >
              <Pin className="w-3.5 h-3.5" />
              {activeNote.pinned ? 'Pinned' : 'Pin'}
            </button>
            <button
              type="button"
              onClick={() => {
                finalizedDeletedIdRef.current = activeNote.id;
                onDeleteNote(activeNote.id);
                if (onEditorBack) {
                  onEditorBack();
                } else {
                  onSetCoverEditing(false);
                }
              }}
              aria-label="Delete note"
              className="p-1.5 text-stone-400 hover:text-rose-600 dark:hover:text-rose-400 rounded transition-colors"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Rich Text Canvas */}
        <div
          ref={editorScrollRef}
          style={{ overflowAnchor: 'none' }}
          className="flex-1 min-h-0 overflow-y-auto device-scroll p-3.5 flex flex-col"
        >
          <div className="space-y-2.5">
          {isNoteHighlighted && activeNote.title.toLowerCase().includes(trimmedQuery) ? (
            <div
              role="button"
              tabIndex={0}
              onClick={() => onDismissHighlight?.()}
              onKeyDown={(e) => e.key === 'Enter' && onDismissHighlight?.()}
              className="font-display text-[19px] font-semibold text-stone-900 dark:text-stone-100 cursor-text leading-snug"
            >
              <HighlightedText text={activeNote.title} query={highlightQuery} />
            </div>
          ) : (
            <input
              ref={titleInputRef}
              type="text"
              value={activeNote.title}
              placeholder="Title"
              onChange={(e) =>
                onUpdateNote({ ...activeNote, title: e.target.value, updatedAt: 'Edited just now' })
              }
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  const firstBlock = activeNote.blocks[0];
                  if (firstBlock) {
                    const el = blockInputRefs.current[firstBlock.id];
                    el?.focus();
                  } else {
                    handleAppendBlock('paragraph');
                  }
                }
              }}
              className="w-full bg-transparent font-display text-[19px] font-semibold text-stone-900 dark:text-stone-100 placeholder:text-stone-400 leading-snug focus:outline-none"
              aria-label="Note title"
            />
          )}

          <div className="space-y-2">
            {activeNote.blocks.map((block, blockIdx) => {
              const blockMatches =
                isNoteHighlighted &&
                editingBlockId !== block.id &&
                block.text.toLowerCase().includes(trimmedQuery);

              if (block.type === 'heading') {
                return (
                  <div key={block.id}>
                    {blockMatches ? (
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          setEditingBlockId(block.id);
                          onDismissHighlight?.();
                        }}
                        onKeyDown={(e) => e.key === 'Enter' && onDismissHighlight?.()}
                        className="font-display text-[16px] font-semibold text-stone-800 dark:text-stone-200 pt-1 cursor-text"
                      >
                        <HighlightedText text={block.text} query={highlightQuery} />
                      </div>
                    ) : markdownOn ? (
                      <MarkdownLiveField
                        fieldRef={(h) => {
                          blockInputRefs.current[block.id] = h;
                        }}
                        value={block.text}
                        placeholder="Section heading..."
                        multiline={false}
                        allowBlockSyntax={false}
                        className="font-display text-[16px] font-semibold text-stone-800 dark:text-stone-200 pt-1 min-h-[1.5rem]"
                        placeholderClassName="font-display text-[16px] font-semibold pt-1"
                        onCaretChange={(pos) => {
                          activeBlockRef.current = { blockId: block.id, caret: pos };
                        }}
                        onEnsureCaretVisible={scheduleEnsureActiveCaretVisible}
                        onChange={(text) => handleUpdateBlock(block.id, { text })}
                        onEnterSingleLine={() => handleAppendBlock('paragraph', block.id)}
                        onBackspaceEmpty={() => handleRemoveBlock(block.id, true)}
                      />
                    ) : (
                      <input
                        ref={(el) => {
                          blockInputRefs.current[block.id] = wrapNativeInputHandle(el);
                        }}
                        type="text"
                        value={block.text}
                        placeholder="Section heading..."
                        onFocus={(e) => {
                          activeBlockRef.current = {
                            blockId: block.id,
                            caret: e.currentTarget.selectionStart ?? e.currentTarget.value.length,
                          };
                          scheduleEnsureActiveCaretVisible();
                        }}
                        onChange={(e) => {
                          activeBlockRef.current = {
                            blockId: block.id,
                            caret: e.currentTarget.selectionStart ?? e.currentTarget.value.length,
                          };
                          handleUpdateBlock(block.id, { text: e.target.value });
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                            e.preventDefault();
                            handleAppendBlock('paragraph', block.id);
                          } else if (e.key === 'Backspace' && !block.text) {
                            e.preventDefault();
                            handleRemoveBlock(block.id, true);
                          }
                        }}
                        className="w-full bg-transparent font-display text-[16px] font-semibold text-stone-800 dark:text-stone-200 pt-1 focus:outline-none"
                      />
                    )}
                  </div>
                );
              }

              if (block.type === 'checklist') {
                return (
                  <div
                    key={block.id}
                    className="flex items-start gap-2.5 group"
                  >
                    <button
                      type="button"
                      onClick={() => handleUpdateBlock(block.id, { checked: !block.checked })}
                      className={`mt-1 w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                        block.checked
                          ? `${tokens.accentBg} border-transparent`
                          : 'border-stone-300 dark:border-stone-600'
                      }`}
                      aria-label="Toggle checklist item"
                    >
                      {block.checked && <Check className="w-3 h-3" />}
                    </button>
                    {blockMatches ? (
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          setEditingBlockId(block.id);
                          onDismissHighlight?.();
                        }}
                        onKeyDown={(e) => e.key === 'Enter' && onDismissHighlight?.()}
                        className={`flex-1 min-w-0 text-[15px] leading-relaxed cursor-text ${
                          block.checked ? 'line-through text-stone-400' : 'text-stone-700 dark:text-stone-200'
                        }`}
                      >
                        <HighlightedText text={block.text} query={highlightQuery} />
                      </div>
                    ) : markdownOn ? (
                      <div className="flex-1 min-w-0">
                        <MarkdownLiveField
                          fieldRef={(h) => {
                            blockInputRefs.current[block.id] = h;
                          }}
                          value={block.text}
                          placeholder="To-do item..."
                          multiline={false}
                          allowBlockSyntax={false}
                          className={`text-[15px] leading-relaxed min-h-[1.5rem] ${
                            block.checked
                              ? 'line-through text-stone-400'
                              : 'text-stone-700 dark:text-stone-200'
                          }`}
                          placeholderClassName="text-[15px] leading-relaxed"
                          onCaretChange={(pos) => {
                            activeBlockRef.current = { blockId: block.id, caret: pos };
                          }}
                          onEnsureCaretVisible={scheduleEnsureActiveCaretVisible}
                          onChange={(text) => handleUpdateBlock(block.id, { text })}
                          onEnterSingleLine={() => {
                            if (!block.text.trim()) {
                              handleConvertBlockToParagraph(block.id);
                            } else {
                              handleAppendBlock('checklist', block.id);
                            }
                          }}
                          onBackspaceEmpty={() => handleRemoveBlock(block.id, true)}
                        />
                      </div>
                    ) : (
                      <input
                        ref={(el) => {
                          blockInputRefs.current[block.id] = wrapNativeInputHandle(el);
                        }}
                        type="text"
                        enterKeyHint="next"
                        value={block.text}
                        placeholder="To-do item..."
                        onFocus={(e) => {
                          activeBlockRef.current = {
                            blockId: block.id,
                            caret: e.currentTarget.selectionStart ?? e.currentTarget.value.length,
                          };
                          scheduleEnsureActiveCaretVisible();
                        }}
                        onChange={(e) => {
                          activeBlockRef.current = {
                            blockId: block.id,
                            caret: e.currentTarget.selectionStart ?? e.currentTarget.value.length,
                          };
                          handleUpdateBlock(block.id, { text: e.target.value });
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                            e.preventDefault();
                            if (!block.text.trim()) {
                              handleConvertBlockToParagraph(block.id);
                            } else {
                              handleAppendBlock('checklist', block.id);
                            }
                          } else if (e.key === 'Backspace' && !block.text) {
                            e.preventDefault();
                            handleRemoveBlock(block.id, true);
                          }
                        }}
                        className={`flex-1 min-w-0 bg-transparent text-[15px] leading-relaxed focus:outline-none ${
                          block.checked
                            ? 'line-through text-stone-400'
                            : 'text-stone-700 dark:text-stone-200'
                        }`}
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => handleRemoveBlock(block.id)}
                      aria-label="Remove checklist row"
                      title="Remove row"
                      className="p-1 text-stone-400 hover:text-rose-500 dark:text-stone-500 dark:hover:text-rose-400 rounded transition-colors shrink-0"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                );
              }

              if (block.type === 'bullet') {
                return (
                  <div
                    key={block.id}
                    className="flex items-start gap-2.5 pl-1 group"
                  >
                    <span className="mt-2.5 w-1.5 h-1.5 rounded-full bg-stone-400 dark:bg-stone-500 shrink-0" />
                    {blockMatches ? (
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          setEditingBlockId(block.id);
                          onDismissHighlight?.();
                        }}
                        onKeyDown={(e) => e.key === 'Enter' && onDismissHighlight?.()}
                        className="flex-1 min-w-0 text-[15px] leading-relaxed text-stone-700 dark:text-stone-200 cursor-text"
                      >
                        <HighlightedText text={block.text} query={highlightQuery} />
                      </div>
                    ) : markdownOn ? (
                      <div className="flex-1 min-w-0">
                        <MarkdownLiveField
                          fieldRef={(h) => {
                            blockInputRefs.current[block.id] = h;
                          }}
                          value={block.text}
                          placeholder="List item..."
                          multiline={false}
                          allowBlockSyntax={false}
                          className="text-[15px] leading-relaxed text-stone-700 dark:text-stone-200 min-h-[1.5rem]"
                          placeholderClassName="text-[15px] leading-relaxed"
                          onCaretChange={(pos) => {
                            activeBlockRef.current = { blockId: block.id, caret: pos };
                          }}
                          onEnsureCaretVisible={scheduleEnsureActiveCaretVisible}
                          onChange={(text) => handleUpdateBlock(block.id, { text })}
                          onEnterSingleLine={() => {
                            if (!block.text.trim()) {
                              handleConvertBlockToParagraph(block.id);
                            } else {
                              handleAppendBlock('bullet', block.id);
                            }
                          }}
                          onBackspaceEmpty={() => handleRemoveBlock(block.id, true)}
                        />
                      </div>
                    ) : (
                      <input
                        ref={(el) => {
                          blockInputRefs.current[block.id] = wrapNativeInputHandle(el);
                        }}
                        type="text"
                        enterKeyHint="next"
                        value={block.text}
                        placeholder="List item..."
                        onFocus={(e) => {
                          activeBlockRef.current = {
                            blockId: block.id,
                            caret: e.currentTarget.selectionStart ?? e.currentTarget.value.length,
                          };
                          scheduleEnsureActiveCaretVisible();
                        }}
                        onChange={(e) => {
                          activeBlockRef.current = {
                            blockId: block.id,
                            caret: e.currentTarget.selectionStart ?? e.currentTarget.value.length,
                          };
                          handleUpdateBlock(block.id, { text: e.target.value });
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                            e.preventDefault();
                            if (!block.text.trim()) {
                              handleConvertBlockToParagraph(block.id);
                            } else {
                              handleAppendBlock('bullet', block.id);
                            }
                          } else if (e.key === 'Backspace' && !block.text) {
                            e.preventDefault();
                            handleRemoveBlock(block.id, true);
                          }
                        }}
                        className="flex-1 min-w-0 bg-transparent text-[15px] leading-relaxed text-stone-700 dark:text-stone-200 focus:outline-none"
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => handleRemoveBlock(block.id)}
                      aria-label="Remove list row"
                      title="Remove row"
                      className="p-1 text-stone-400 hover:text-rose-500 dark:text-stone-500 dark:hover:text-rose-400 rounded transition-colors shrink-0"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                );
              }

              return (
                <div key={block.id}>
                  {blockMatches ? (
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        setEditingBlockId(block.id);
                        onDismissHighlight?.();
                      }}
                      onKeyDown={(e) => e.key === 'Enter' && onDismissHighlight?.()}
                      className="text-[15px] leading-relaxed text-stone-700 dark:text-stone-300 cursor-text whitespace-pre-wrap break-words"
                    >
                      <HighlightedText text={block.text} query={highlightQuery} />
                    </div>
                  ) : markdownOn ? (
                    <MarkdownLiveField
                      fieldRef={(h) => {
                        blockInputRefs.current[block.id] = h;
                      }}
                      value={block.text}
                      placeholder={
                        blockIdx === 0 && activeNote.blocks.length === 1
                          ? 'Write in Markdown (**bold**, *italic*, # heading)...'
                          : ''
                      }
                      multiline
                      allowBlockSyntax
                      className="text-[15px] leading-relaxed text-stone-700 dark:text-stone-300"
                      placeholderClassName="text-[15px] leading-relaxed"
                      onCaretChange={(pos) => {
                        activeBlockRef.current = { blockId: block.id, caret: pos };
                      }}
                      onEnsureCaretVisible={scheduleEnsureActiveCaretVisible}
                      onChange={(text) => handleUpdateBlock(block.id, { text })}
                      onBackspaceEmpty={() => {
                        if (activeNote.blocks.length > 1) {
                          handleRemoveBlock(block.id, true);
                        }
                      }}
                    />
                  ) : (
                    <AutoGrowParagraph
                      inputRef={(el) => {
                        blockInputRefs.current[block.id] = wrapNativeInputHandle(el);
                      }}
                      value={block.text}
                      placeholder={
                        blockIdx === 0 && activeNote.blocks.length === 1 ? 'Start writing...' : ''
                      }
                      onCaretChange={(pos) => {
                        activeBlockRef.current = { blockId: block.id, caret: pos };
                      }}
                      onCaretActivity={scheduleEnsureActiveCaretVisible}
                      onChange={(text) => handleUpdateBlock(block.id, { text })}
                      onKeyDown={(e) => {
                        if (e.key === 'Backspace' && !block.text && activeNote.blocks.length > 1) {
                          e.preventDefault();
                          handleRemoveBlock(block.id, true);
                        }
                      }}
                    />
                  )}
                </div>
              );
            })}
          </div>
          </div>
          {/* Open writing canvas below blocks — tapping continues typing in a default paragraph */}
          <div
            className="flex-1 min-h-[48px] cursor-text"
            onClick={handleFocusDefaultWritingArea}
            aria-hidden="true"
          />
        </div>

        {/* Formatting Toolbar — always pinned above the mobile keyboard */}
        <div className={`px-1.5 py-1.5 border-t ${tokens.divider} ${tokens.subtleBg} grid grid-cols-4 gap-1 shrink-0`}>
          <button
            type="button"
            onPointerDown={(e) => e.preventDefault()}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => handleStartFormattedBlock('heading')}
            className="flex items-center justify-center gap-1 px-1.5 py-1.5 text-[12px] font-medium text-stone-600 dark:text-stone-300 hover:bg-white dark:hover:bg-stone-700 rounded-lg transition-colors whitespace-nowrap min-w-0"
            title="Add Heading"
          >
            <Heading2 className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">Heading</span>
          </button>
          <button
            type="button"
            onPointerDown={(e) => e.preventDefault()}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => handleStartFormattedBlock('checklist')}
            className="flex items-center justify-center gap-1 px-1.5 py-1.5 text-[12px] font-medium text-stone-600 dark:text-stone-300 hover:bg-white dark:hover:bg-stone-700 rounded-lg transition-colors whitespace-nowrap min-w-0"
            title="Add Checklist"
          >
            <CheckSquare className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">Checklist</span>
          </button>
          <button
            type="button"
            onPointerDown={(e) => e.preventDefault()}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => handleStartFormattedBlock('bullet')}
            className="flex items-center justify-center gap-1 px-1.5 py-1.5 text-[12px] font-medium text-stone-600 dark:text-stone-300 hover:bg-white dark:hover:bg-stone-700 rounded-lg transition-colors whitespace-nowrap min-w-0"
            title="Add Bullet"
          >
            <List className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">List</span>
          </button>
          <button
            type="button"
            onPointerDown={(e) => e.preventDefault()}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() =>
              onUpdateNote({
                ...activeNote,
                markdownEnabled: !markdownOn,
                updatedAt: 'Edited just now',
              })
            }
            aria-pressed={markdownOn}
            className={`flex items-center justify-center gap-1 px-1.5 py-1.5 text-[12px] font-medium rounded-lg transition-colors whitespace-nowrap min-w-0 ${
              markdownOn
                ? `${tokens.accentBg} shadow-xs hover:opacity-90`
                : 'text-stone-600 dark:text-stone-300 hover:bg-white dark:hover:bg-stone-700'
            }`}
            title={markdownOn ? 'Turn off Markdown support' : 'Turn on Markdown support'}
          >
            <Code2 className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">Markdown</span>
          </button>
        </div>
      </div>
    );
  };

  if (posture === FoldPosture.Inner) {
    return (
      <div
        className={`h-full min-h-0 grid grid-cols-2 ${hingeAwareSplit ? 'gap-5' : 'gap-3'} ${
          keyboardOpen ? 'px-3 pt-1.5 pb-1' : 'px-3.5 py-2'
        } overflow-hidden`}
      >
        <div ref={noteListScrollRef} className="h-full min-h-0 overflow-y-auto device-scroll pr-0.5">{renderNoteList()}</div>
        <div className="h-full min-h-0 overflow-hidden pl-0.5">{renderEditor(showReturnBack)}</div>
      </div>
    );
  }

  if (posture === FoldPosture.Flex) {
    return (
      <div className="h-full min-h-0 flex flex-col">
        <div className={keyboardOpen ? 'flex-1 min-h-0 overflow-hidden px-2 pt-1.5 pb-1' : 'h-[48%] min-h-0 overflow-hidden p-2'}>
          {renderEditor(showReturnBack)}
        </div>
        {!keyboardOpen && (
          <>
            <div className="h-3.5 flex items-center justify-center bg-stone-200/60 dark:bg-black/40 border-y border-stone-300/60 dark:border-stone-800 shrink-0">
              <span className="text-[9px] font-mono-tabular text-stone-500 dark:text-stone-400">
                Flex hinge · Note switcher
              </span>
            </div>
            <div ref={noteListScrollRef} className="flex-1 min-h-0 overflow-y-auto device-scroll px-3.5 pt-2 pb-24">
              {renderNoteList()}
            </div>
          </>
        )}
      </div>
    );
  }

  if (coverEditing) {
    return (
      <div
        className={`h-full min-h-0 overflow-hidden flex flex-col ${
          keyboardOpen ? 'px-2 pt-1 pb-0.5' : 'px-3.5 py-2'
        }`}
      >
        {renderEditor(true)}
      </div>
    );
  }

  return (
    <div ref={noteListScrollRef} className="h-full min-h-0 overflow-y-auto device-scroll px-3.5 pt-2.5 pb-24">
      {renderNoteList()}
    </div>
  );
};
