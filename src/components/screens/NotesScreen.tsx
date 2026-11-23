import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, CheckSquare, Heading2, List, Pin, Plus, Trash2, X } from 'lucide-react';
import { FoldPosture, NoteBlock, NoteItem } from '../../types/taskflow';
import { StyleThemeTokens } from '../../utils/themeTokens';
import { HighlightedText } from '../HighlightedText';

interface AutoGrowParagraphProps {
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onCaretChange?: (caret: number) => void;
  inputRef: (el: HTMLTextAreaElement | null) => void;
}

const AutoGrowParagraph: React.FC<AutoGrowParagraphProps> = ({
  value,
  placeholder,
  onChange,
  onKeyDown,
  onCaretChange,
  inputRef,
}) => {
  const localRef = useRef<HTMLTextAreaElement | null>(null);

  const syncHeight = () => {
    const el = localRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };

  useLayoutEffect(() => {
    syncHeight();
  }, [value]);

  useEffect(() => {
    const el = localRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      syncHeight();
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
      onFocus={(e) => reportCaret(e.currentTarget)}
      onClick={(e) => reportCaret(e.currentTarget)}
      onKeyUp={(e) => reportCaret(e.currentTarget)}
      onSelect={(e) => reportCaret(e.currentTarget)}
      onChange={(e) => {
        onChange(e.target.value);
        reportCaret(e.currentTarget);
      }}
      onKeyDown={onKeyDown}
      onInput={syncHeight}
      className="block w-full bg-transparent text-[11.5px] leading-snug text-stone-600 dark:text-stone-300 focus:outline-none resize-none overflow-hidden min-h-[1.5rem]"
    />
  );
};

interface NotesScreenProps {
  posture: FoldPosture;
  tokens: StyleThemeTokens;
  notes: NoteItem[];
  hingeAwareSplit: boolean;
  selectedNoteId: string;
  onSelectNoteId: (id: string) => void;
  coverEditing: boolean;
  onSetCoverEditing: (editing: boolean) => void;
  highlightedNoteId?: string | null;
  highlightQuery?: string;
  onDismissHighlight?: () => void;
  onUpdateNote: (note: NoteItem) => void;
  onDeleteNote: (noteId: string) => void;
  onCreateNote: () => string;
}

const FOLDERS: NoteItem['folder'][] = ['Product', 'Work', 'Personal'];

export const NotesScreen: React.FC<NotesScreenProps> = ({
  posture,
  tokens,
  notes,
  hingeAwareSplit,
  selectedNoteId,
  onSelectNoteId,
  coverEditing,
  onSetCoverEditing,
  highlightedNoteId = null,
  highlightQuery = '',
  onDismissHighlight,
  onUpdateNote,
  onDeleteNote,
  onCreateNote,
}) => {
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  const firstMatchRef = useRef<HTMLDivElement | null>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const pendingFocusTitleNoteIdRef = useRef<string | null>(null);
  const blockInputRefs = useRef<Record<string, HTMLInputElement | HTMLTextAreaElement | null>>({});
  const pendingFocusRef = useRef<{ blockId: string; caret: 'start' | 'end' } | null>(null);
  const activeBlockRef = useRef<{ blockId: string; caret: number } | null>(null);

  const activeNote = notes.find((n) => n.id === selectedNoteId) || notes[0];
  const isNoteHighlighted =
    Boolean(activeNote && highlightedNoteId === activeNote.id && highlightQuery.trim());

  const latestActiveNoteRef = useRef<NoteItem | undefined>(activeNote);
  latestActiveNoteRef.current = activeNote;
  const onDeleteNoteRef = useRef(onDeleteNote);
  onDeleteNoteRef.current = onDeleteNote;
  const onUpdateNoteRef = useRef(onUpdateNote);
  onUpdateNoteRef.current = onUpdateNote;
  const finalizedDeletedIdRef = useRef<string | null>(null);

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
      finalizeNote(latestActiveNoteRef.current);
    };
  }, []);

  useEffect(() => {
    activeBlockRef.current = null;
    if (pendingFocusTitleNoteIdRef.current && pendingFocusTitleNoteIdRef.current === activeNote?.id) {
      pendingFocusTitleNoteIdRef.current = null;
      titleInputRef.current?.focus();
    }
  }, [activeNote?.id, coverEditing]);

  useEffect(() => {
    setEditingBlockId(null);
    if (isNoteHighlighted && firstMatchRef.current) {
      firstMatchRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [isNoteHighlighted, highlightedNoteId, highlightQuery]);

  useEffect(() => {
    const pending = pendingFocusRef.current;
    if (!pending) return;
    const el = blockInputRefs.current[pending.blockId];
    if (!el) return;
    pendingFocusRef.current = null;
    el.focus();
    const pos = pending.caret === 'end' ? el.value.length : 0;
    try {
      el.setSelectionRange(pos, pos);
    } catch {
      // Some input types do not support selection range
    }
    activeBlockRef.current = { blockId: pending.blockId, caret: pos };
    el.scrollIntoView({ block: 'nearest' });
  }, [activeNote?.id, activeNote?.blocks]);

  const handleCreate = () => {
    finalizeNote(activeNote);
    const newId = onCreateNote();
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
      const liveEl = blockInputRefs.current[blocks[targetIdx].id];
      if (liveEl && document.activeElement === liveEl && typeof liveEl.selectionStart === 'number') {
        caret = liveEl.selectionStart;
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
      const el = blockInputRefs.current[last.id];
      if (el) {
        el.focus();
        const pos = el.value.length;
        try {
          el.setSelectionRange(pos, pos);
        } catch {
          // ignore
        }
        return;
      }
    }
    handleAppendBlock('paragraph');
  };

  const renderNoteList = () => (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <h2 className={`font-display font-semibold text-stone-900 dark:text-stone-100 ${tokens.headingScale}`}>
          Notes
        </h2>
        <button
          type="button"
          onClick={handleCreate}
          className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium ${tokens.accentBg} ${tokens.buttonRadius} whitespace-nowrap shrink-0`}
        >
          <Plus className="w-3 h-3" />
          New note
        </button>
      </div>

      <div className={`${tokens.cardBg} ${tokens.cardRadius} overflow-hidden`}>
        {notes.length === 0 ? (
          <div className="p-5 text-center space-y-2">
            <p className="text-xs font-medium text-stone-700 dark:text-stone-300">No notes yet</p>
            <button
              type="button"
              onClick={handleCreate}
              className={`px-3 py-1.5 text-xs font-medium ${tokens.accentBg} ${tokens.buttonRadius}`}
            >
              Create first note
            </button>
          </div>
        ) : (
          notes.map((note) => {
            const isSelected = activeNote?.id === note.id;
            const listHighlight = highlightedNoteId === note.id && Boolean(highlightQuery.trim());
            const matchedBlock =
              listHighlight &&
              note.blocks.find((b) => b.text.toLowerCase().includes(highlightQuery.trim().toLowerCase()));
            const previewText =
              (matchedBlock && matchedBlock.text) ||
              note.blocks.find((b) => b.type !== 'heading')?.text ||
              'Empty note';
            return (
              <button
                key={note.id}
                type="button"
                onClick={() => {
                  if (activeNote && activeNote.id !== note.id) {
                    finalizeNote(activeNote);
                  }
                  onSelectNoteId(note.id);
                  if (posture === FoldPosture.Cover) onSetCoverEditing(true);
                }}
                className={`w-full text-left ${tokens.rowPadding} border-b last:border-b-0 ${tokens.divider} transition-colors ${
                  isSelected ? tokens.accentSoftBg : 'hover:bg-stone-50/80 dark:hover:bg-white/[0.02]'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[13px] font-semibold text-stone-900 dark:text-stone-100 truncate">
                    <HighlightedText
                      text={note.title.trim() || 'Untitled Note'}
                      query={highlightQuery}
                      active={listHighlight}
                    />
                  </p>
                  {note.pinned && <Pin className={`w-3 h-3 shrink-0 ${tokens.accentText}`} />}
                </div>
                <p className="text-[11.5px] text-stone-500 dark:text-stone-400 truncate mt-0.5">
                  <HighlightedText text={previewText} query={highlightQuery} active={listHighlight} />
                </p>
                <p className="text-[10.5px] text-stone-400 dark:text-stone-500 mt-0.5 tabular-nums">
                  {note.folder} · {note.updatedAt}
                </p>
              </button>
            );
          })
        )}
      </div>
    </div>
  );

  const renderEditor = (showBack = false) => {
    if (!activeNote) {
      return (
        <div className={`h-full flex items-center justify-center p-5 text-xs text-stone-400 ${tokens.cardBg} ${tokens.cardRadius}`}>
          Create or select a note to begin editing.
        </div>
      );
    }

    const wordCount = activeNote.blocks
      .map((b) => b.text.trim().split(/\s+/).filter(Boolean).length)
      .reduce((acc, n) => acc + n, 0);

    const trimmedQuery = highlightQuery.trim().toLowerCase();
    let attachedRef = false;

    return (
      <div className={`h-full flex flex-col ${tokens.cardBg} ${tokens.cardRadius} overflow-hidden`}>
        {/* Editor Header */}
        <div className={`flex items-center justify-between px-2.5 py-1.5 border-b ${tokens.divider} shrink-0 gap-2`}>
          <div className="flex items-center gap-2 min-w-0">
            {showBack && (
              <button
                type="button"
                onClick={() => {
                  finalizeNote(activeNote);
                  onSetCoverEditing(false);
                }}
                className="p-1 -ml-1 text-stone-500 hover:text-stone-900 dark:hover:text-stone-100"
                aria-label="Back to notes"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            <select
              aria-label="Note folder"
              value={activeNote.folder}
              onChange={(e) =>
                onUpdateNote({ ...activeNote, folder: e.target.value as NoteItem['folder'] })
              }
              className={`text-[11px] font-medium px-2 py-0.5 ${tokens.subtleBg} text-stone-700 dark:text-stone-200 ${tokens.buttonRadius} focus:outline-none`}
            >
              {FOLDERS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
            <span className="text-[10.5px] text-stone-400 dark:text-stone-500 truncate tabular-nums">
              {wordCount} words
            </span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => onUpdateNote({ ...activeNote, pinned: !activeNote.pinned })}
              className={`inline-flex items-center gap-1 px-2 py-1 text-[10.5px] font-medium ${tokens.buttonRadius} transition-colors ${
                activeNote.pinned
                  ? `${tokens.accentSoftBg} ${tokens.accentText}`
                  : `${tokens.subtleBg} text-stone-500 dark:text-stone-400`
              }`}
            >
              <Pin className="w-3 h-3" />
              {activeNote.pinned ? 'Pinned' : 'Pin'}
            </button>
            <button
              type="button"
              onClick={() => {
                finalizedDeletedIdRef.current = activeNote.id;
                onDeleteNote(activeNote.id);
                onSetCoverEditing(false);
              }}
              aria-label="Delete note"
              className="p-1 text-stone-400 hover:text-rose-600 dark:hover:text-rose-400 rounded transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Rich Text Canvas */}
        <div className="flex-1 overflow-y-auto device-scroll p-2.5 flex flex-col">
          <div className="space-y-1.5">
          {isNoteHighlighted && activeNote.title.toLowerCase().includes(trimmedQuery) ? (
            <div
              role="button"
              tabIndex={0}
              onClick={() => onDismissHighlight?.()}
              onKeyDown={(e) => e.key === 'Enter' && onDismissHighlight?.()}
              className="font-display text-base font-semibold text-stone-900 dark:text-stone-100 cursor-text"
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
              className="w-full bg-transparent font-display text-base font-semibold text-stone-900 dark:text-stone-100 placeholder:text-stone-400 focus:outline-none"
              aria-label="Note title"
            />
          )}

          <div className="space-y-1.5">
            {activeNote.blocks.map((block, blockIdx) => {
              const blockMatches =
                isNoteHighlighted &&
                editingBlockId !== block.id &&
                block.text.toLowerCase().includes(trimmedQuery);

              const assignRef = blockMatches && !attachedRef;
              if (assignRef) attachedRef = true;

              if (block.type === 'heading') {
                return (
                  <div key={block.id} ref={assignRef ? firstMatchRef : undefined}>
                    {blockMatches ? (
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          setEditingBlockId(block.id);
                          onDismissHighlight?.();
                        }}
                        onKeyDown={(e) => e.key === 'Enter' && onDismissHighlight?.()}
                        className="font-display text-xs font-semibold text-stone-800 dark:text-stone-200 pt-0.5 cursor-text"
                      >
                        <HighlightedText text={block.text} query={highlightQuery} />
                      </div>
                    ) : (
                      <input
                        ref={(el) => {
                          blockInputRefs.current[block.id] = el;
                        }}
                        type="text"
                        value={block.text}
                        placeholder="Section heading..."
                        onFocus={(e) => {
                          activeBlockRef.current = {
                            blockId: block.id,
                            caret: e.currentTarget.selectionStart ?? e.currentTarget.value.length,
                          };
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
                        className="w-full bg-transparent font-display text-xs font-semibold text-stone-800 dark:text-stone-200 pt-0.5 focus:outline-none"
                      />
                    )}
                  </div>
                );
              }

              if (block.type === 'checklist') {
                return (
                  <div
                    key={block.id}
                    ref={assignRef ? firstMatchRef : undefined}
                    className="flex items-start gap-2 group"
                  >
                    <button
                      type="button"
                      onClick={() => handleUpdateBlock(block.id, { checked: !block.checked })}
                      className={`mt-0.5 w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 transition-colors ${
                        block.checked
                          ? `${tokens.accentBg} border-transparent`
                          : 'border-stone-300 dark:border-stone-600'
                      }`}
                      aria-label="Toggle checklist item"
                    >
                      {block.checked && <Check className="w-2.5 h-2.5" />}
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
                        className={`flex-1 min-w-0 text-[11.5px] leading-snug cursor-text ${
                          block.checked ? 'line-through text-stone-400' : 'text-stone-700 dark:text-stone-200'
                        }`}
                      >
                        <HighlightedText text={block.text} query={highlightQuery} />
                      </div>
                    ) : (
                      <input
                        ref={(el) => {
                          blockInputRefs.current[block.id] = el;
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
                        className={`flex-1 min-w-0 bg-transparent text-[11.5px] leading-snug focus:outline-none ${
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
                      className="p-0.5 text-stone-400 hover:text-rose-500 dark:text-stone-500 dark:hover:text-rose-400 rounded transition-colors shrink-0"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              }

              if (block.type === 'bullet') {
                return (
                  <div
                    key={block.id}
                    ref={assignRef ? firstMatchRef : undefined}
                    className="flex items-start gap-2 pl-1 group"
                  >
                    <span className="mt-1.5 w-1 h-1 rounded-full bg-stone-400 dark:bg-stone-500 shrink-0" />
                    {blockMatches ? (
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          setEditingBlockId(block.id);
                          onDismissHighlight?.();
                        }}
                        onKeyDown={(e) => e.key === 'Enter' && onDismissHighlight?.()}
                        className="flex-1 min-w-0 text-[11.5px] leading-snug text-stone-700 dark:text-stone-200 cursor-text"
                      >
                        <HighlightedText text={block.text} query={highlightQuery} />
                      </div>
                    ) : (
                      <input
                        ref={(el) => {
                          blockInputRefs.current[block.id] = el;
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
                        className="flex-1 min-w-0 bg-transparent text-[11.5px] leading-snug text-stone-700 dark:text-stone-200 focus:outline-none"
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => handleRemoveBlock(block.id)}
                      aria-label="Remove list row"
                      title="Remove row"
                      className="p-0.5 text-stone-400 hover:text-rose-500 dark:text-stone-500 dark:hover:text-rose-400 rounded transition-colors shrink-0"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              }

              return (
                <div key={block.id} ref={assignRef ? firstMatchRef : undefined}>
                  {blockMatches ? (
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        setEditingBlockId(block.id);
                        onDismissHighlight?.();
                      }}
                      onKeyDown={(e) => e.key === 'Enter' && onDismissHighlight?.()}
                      className="text-[11.5px] leading-snug text-stone-600 dark:text-stone-300 cursor-text whitespace-pre-wrap break-words"
                    >
                      <HighlightedText text={block.text} query={highlightQuery} />
                    </div>
                  ) : (
                    <AutoGrowParagraph
                      inputRef={(el) => {
                        blockInputRefs.current[block.id] = el;
                      }}
                      value={block.text}
                      placeholder={
                        blockIdx === 0 && activeNote.blocks.length === 1 ? 'Start writing...' : ''
                      }
                      onCaretChange={(pos) => {
                        activeBlockRef.current = { blockId: block.id, caret: pos };
                      }}
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

        {/* Formatting Toolbar — paragraphs are default; only explicit block formats shown */}
        <div className={`px-1.5 py-1.5 border-t ${tokens.divider} ${tokens.subtleBg} grid grid-cols-3 gap-1 shrink-0`}>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => handleStartFormattedBlock('heading')}
            className="flex items-center justify-center gap-1 px-1 py-1 text-[10px] font-medium text-stone-600 dark:text-stone-300 hover:bg-white dark:hover:bg-stone-700 rounded transition-colors whitespace-nowrap min-w-0"
            title="Add Heading"
          >
            <Heading2 className="w-3 h-3 shrink-0" />
            <span className="truncate">Heading</span>
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => handleStartFormattedBlock('checklist')}
            className="flex items-center justify-center gap-1 px-1 py-1 text-[10px] font-medium text-stone-600 dark:text-stone-300 hover:bg-white dark:hover:bg-stone-700 rounded transition-colors whitespace-nowrap min-w-0"
            title="Add Checklist"
          >
            <CheckSquare className="w-3 h-3 shrink-0" />
            <span className="truncate">Checklist</span>
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => handleStartFormattedBlock('bullet')}
            className="flex items-center justify-center gap-1 px-1 py-1 text-[10px] font-medium text-stone-600 dark:text-stone-300 hover:bg-white dark:hover:bg-stone-700 rounded transition-colors whitespace-nowrap min-w-0"
            title="Add Bullet"
          >
            <List className="w-3 h-3 shrink-0" />
            <span className="truncate">List</span>
          </button>
        </div>
      </div>
    );
  };

  if (posture === FoldPosture.Inner) {
    return (
      <div className={`h-full grid grid-cols-2 ${hingeAwareSplit ? 'gap-5' : 'gap-3'} px-3.5 py-2 overflow-hidden`}>
        <div className="h-full overflow-y-auto device-scroll pr-0.5">{renderNoteList()}</div>
        <div className="h-full overflow-hidden pl-0.5">{renderEditor(false)}</div>
      </div>
    );
  }

  if (posture === FoldPosture.Flex) {
    return (
      <div className="h-full flex flex-col">
        <div className="h-[48%] overflow-hidden p-2">{renderEditor(false)}</div>
        <div className="h-3.5 flex items-center justify-center bg-stone-200/60 dark:bg-black/40 border-y border-stone-300/60 dark:border-stone-800 shrink-0">
          <span className="text-[9px] font-mono-tabular text-stone-500 dark:text-stone-400">
            Flex hinge · Note switcher
          </span>
        </div>
        <div className="flex-1 overflow-y-auto device-scroll px-3.5 pt-2 pb-20">{renderNoteList()}</div>
      </div>
    );
  }

  if (coverEditing) {
    return (
      <div className="h-full overflow-hidden px-3 py-1.5 flex flex-col">
        {renderEditor(true)}
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto device-scroll px-3 pt-1.5 pb-20">
      {renderNoteList()}
    </div>
  );
};
