import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, CheckSquare, Heading2, List, Pin, Plus, Trash2, Type } from 'lucide-react';
import { FoldPosture, NoteBlock, NoteItem } from '../../types/taskflow';
import { StyleThemeTokens } from '../../utils/themeTokens';
import { HighlightedText } from '../HighlightedText';

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

  const activeNote = notes.find((n) => n.id === selectedNoteId) || notes[0];
  const isNoteHighlighted =
    Boolean(activeNote && highlightedNoteId === activeNote.id && highlightQuery.trim());

  useEffect(() => {
    setEditingBlockId(null);
    if (isNoteHighlighted && firstMatchRef.current) {
      firstMatchRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [isNoteHighlighted, highlightedNoteId, highlightQuery]);

  const handleCreate = () => {
    const newId = onCreateNote();
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

  const handleRemoveBlock = (blockId: string) => {
    if (!activeNote || activeNote.blocks.length <= 1) return;
    onUpdateNote({
      ...activeNote,
      updatedAt: 'Edited just now',
      blocks: activeNote.blocks.filter((b) => b.id !== blockId),
    });
  };

  const handleAppendBlock = (type: NoteBlock['type'], afterBlockId?: string) => {
    if (!activeNote) return;
    const newBlock: NoteBlock = {
      id: `b-${Date.now()}`,
      type,
      text: type === 'heading' ? 'New section' : type === 'checklist' ? '' : '',
      checked: type === 'checklist' ? false : undefined,
    };
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
                  onSelectNoteId(note.id);
                  if (posture === FoldPosture.Cover) onSetCoverEditing(true);
                }}
                className={`w-full text-left ${tokens.rowPadding} border-b last:border-b-0 ${tokens.divider} transition-colors ${
                  isSelected ? tokens.accentSoftBg : 'hover:bg-stone-50/80 dark:hover:bg-white/[0.02]'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[13px] font-semibold text-stone-900 dark:text-stone-100 truncate">
                    <HighlightedText text={note.title} query={highlightQuery} active={listHighlight} />
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
                onClick={() => onSetCoverEditing(false)}
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
        <div className="flex-1 overflow-y-auto device-scroll p-2.5 space-y-1.5">
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
              type="text"
              value={activeNote.title}
              onChange={(e) =>
                onUpdateNote({ ...activeNote, title: e.target.value, updatedAt: 'Edited just now' })
              }
              className="w-full bg-transparent font-display text-base font-semibold text-stone-900 dark:text-stone-100 focus:outline-none"
              aria-label="Note title"
            />
          )}

          <div className="space-y-1.5">
            {activeNote.blocks.map((block) => {
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
                        type="text"
                        value={block.text}
                        placeholder="Section heading..."
                        onChange={(e) => handleUpdateBlock(block.id, { text: e.target.value })}
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
                        className={`flex-1 text-[11.5px] leading-snug cursor-text ${
                          block.checked ? 'line-through text-stone-400' : 'text-stone-700 dark:text-stone-200'
                        }`}
                      >
                        <HighlightedText text={block.text} query={highlightQuery} />
                      </div>
                    ) : (
                      <input
                        type="text"
                        value={block.text}
                        placeholder="To-do item (Enter for next)..."
                        onChange={(e) => handleUpdateBlock(block.id, { text: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleAppendBlock('checklist', block.id);
                          } else if (e.key === 'Backspace' && !block.text) {
                            e.preventDefault();
                            handleRemoveBlock(block.id);
                          }
                        }}
                        className={`flex-1 bg-transparent text-[11.5px] leading-snug focus:outline-none ${
                          block.checked
                            ? 'line-through text-stone-400'
                            : 'text-stone-700 dark:text-stone-200'
                        }`}
                      />
                    )}
                  </div>
                );
              }

              if (block.type === 'bullet') {
                return (
                  <div
                    key={block.id}
                    ref={assignRef ? firstMatchRef : undefined}
                    className="flex items-start gap-2 pl-1"
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
                        className="flex-1 text-[11.5px] leading-snug text-stone-700 dark:text-stone-200 cursor-text"
                      >
                        <HighlightedText text={block.text} query={highlightQuery} />
                      </div>
                    ) : (
                      <input
                        type="text"
                        value={block.text}
                        placeholder="List item (Enter for next)..."
                        onChange={(e) => handleUpdateBlock(block.id, { text: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleAppendBlock('bullet', block.id);
                          } else if (e.key === 'Backspace' && !block.text) {
                            e.preventDefault();
                            handleRemoveBlock(block.id);
                          }
                        }}
                        className="flex-1 bg-transparent text-[11.5px] leading-snug text-stone-700 dark:text-stone-200 focus:outline-none"
                      />
                    )}
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
                      className="text-[11.5px] leading-snug text-stone-600 dark:text-stone-300 cursor-text"
                    >
                      <HighlightedText text={block.text} query={highlightQuery} />
                    </div>
                  ) : (
                    <textarea
                      rows={2}
                      value={block.text}
                      placeholder="Write paragraph..."
                      onChange={(e) => handleUpdateBlock(block.id, { text: e.target.value })}
                      className="w-full bg-transparent text-[11.5px] leading-snug text-stone-600 dark:text-stone-300 focus:outline-none resize-none"
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Formatting Toolbar */}
        <div className={`px-2.5 py-1.5 border-t ${tokens.divider} ${tokens.subtleBg} flex items-center gap-1 shrink-0 overflow-x-auto`}>
          <button
            type="button"
            onClick={() => handleAppendBlock('heading')}
            className="inline-flex items-center gap-1 px-2 py-1 text-[10.5px] font-medium text-stone-600 dark:text-stone-300 hover:bg-white dark:hover:bg-stone-700 rounded transition-colors whitespace-nowrap"
            title="Add Heading"
          >
            <Heading2 className="w-3 h-3" />
            Heading
          </button>
          <button
            type="button"
            onClick={() => handleAppendBlock('paragraph')}
            className="inline-flex items-center gap-1 px-2 py-1 text-[10.5px] font-medium text-stone-600 dark:text-stone-300 hover:bg-white dark:hover:bg-stone-700 rounded transition-colors whitespace-nowrap"
            title="Add Text"
          >
            <Type className="w-3 h-3" />
            Text
          </button>
          <button
            type="button"
            onClick={() => handleAppendBlock('checklist')}
            className="inline-flex items-center gap-1 px-2 py-1 text-[10.5px] font-medium text-stone-600 dark:text-stone-300 hover:bg-white dark:hover:bg-stone-700 rounded transition-colors whitespace-nowrap"
            title="Add Checklist"
          >
            <CheckSquare className="w-3 h-3" />
            Checklist
          </button>
          <button
            type="button"
            onClick={() => handleAppendBlock('bullet')}
            className="inline-flex items-center gap-1 px-2 py-1 text-[10.5px] font-medium text-stone-600 dark:text-stone-300 hover:bg-white dark:hover:bg-stone-700 rounded transition-colors whitespace-nowrap"
            title="Add Bullet"
          >
            <List className="w-3 h-3" />
            List
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
        <div className="flex-1 overflow-y-auto device-scroll px-3.5 py-2">{renderNoteList()}</div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto device-scroll px-3 pt-1.5 pb-11">
      {coverEditing ? <div className="h-full pb-1">{renderEditor(true)}</div> : renderNoteList()}
    </div>
  );
};
