import React, { useMemo, useState } from 'react';
import { CheckSquare, FileText, Search, X } from 'lucide-react';
import { NoteItem, TaskItem } from '../types/taskflow';
import { StyleThemeTokens } from '../utils/themeTokens';
import { HighlightedText } from './HighlightedText';

export interface SearchSelection {
  targetType: 'task' | 'note';
  targetId: string;
  query: string;
}

interface GlobalSearchModalProps {
  open: boolean;
  tokens: StyleThemeTokens;
  tasks: TaskItem[];
  notes: NoteItem[];
  onClose: () => void;
  onSelectResult: (selection: SearchSelection) => void;
}

interface SearchMatchItem {
  id: string;
  targetType: 'task' | 'note';
  targetId: string;
  title: string;
  meta: string;
  snippet: string;
}

export const GlobalSearchModal: React.FC<GlobalSearchModalProps> = ({
  open,
  tokens,
  tasks,
  notes,
  onClose,
  onSelectResult,
}) => {
  const [query, setQuery] = useState('');

  const results = useMemo<SearchMatchItem[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];

    const matches: SearchMatchItem[] = [];

    for (const task of tasks) {
      const titleHit = task.title.toLowerCase().includes(q);
      const notesHit = task.notes.toLowerCase().includes(q);
      const subtaskHit = task.subtasks.find((s) => s.title.toLowerCase().includes(q));
      const catHit = task.category.toLowerCase().includes(q);

      if (titleHit || notesHit || subtaskHit || catHit) {
        const snippet = titleHit
          ? task.title
          : notesHit
            ? task.notes
            : subtaskHit
              ? `Subtask: ${subtaskHit.title}`
              : task.title;
        matches.push({
          id: `task-${task.id}`,
          targetType: 'task',
          targetId: task.id,
          title: task.title,
          meta: `Task · ${task.category} · ${task.timeLabel}`,
          snippet,
        });
      }
    }

    for (const note of notes) {
      const titleHit = note.title.toLowerCase().includes(q);
      const folderHit = note.folder.toLowerCase().includes(q);
      const blockHit = note.blocks.find((b) => b.text.toLowerCase().includes(q));

      if (titleHit || folderHit || blockHit) {
        const snippet = blockHit ? blockHit.text : note.blocks[0]?.text || note.title;
        matches.push({
          id: `note-${note.id}`,
          targetType: 'note',
          targetId: note.id,
          title: note.title,
          meta: `Note · ${note.folder} · ${note.updatedAt}`,
          snippet,
        });
      }
    }

    return matches;
  }, [query, tasks, notes]);

  if (!open) return null;

  const handleChoose = (item: SearchMatchItem) => {
    const q = query.trim();
    onSelectResult({
      targetType: item.targetType,
      targetId: item.targetId,
      query: q,
    });
    setQuery('');
    onClose();
  };

  return (
    <div
      className="absolute inset-0 z-50 bg-black/40 backdrop-blur-[1px] flex flex-col justify-start p-3"
      onClick={onClose}
    >
      <div
        className={`w-full max-h-[88%] flex flex-col ${tokens.cardBg} ${tokens.cardRadius} shadow-xl overflow-hidden`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Input Header */}
        <div className={`flex items-center gap-2 px-3 py-2.5 border-b ${tokens.divider}`}>
          <Search className="w-3.5 h-3.5 text-stone-400 shrink-0" />
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                onClose();
              } else if (e.key === 'Enter' && results.length > 0) {
                e.preventDefault();
                handleChoose(results[0]);
              }
            }}
            placeholder="Search tasks and notes..."
            aria-label="Global search across tasks and notes"
            className="flex-1 bg-transparent text-xs text-stone-900 dark:text-stone-100 placeholder:text-stone-400 focus:outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="text-[11px] text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 px-1"
            >
              Clear
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close global search"
            className="p-1 text-stone-400 hover:text-stone-800 dark:hover:text-stone-100 rounded"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto device-scroll">
          {!query.trim() ? (
            <div className="p-4 text-center space-y-1">
              <p className="text-xs font-medium text-stone-700 dark:text-stone-200">
                Search across all tasks and notes
              </p>
              <p className="text-[11px] text-stone-400">
                Try keywords like "proposal", "Fold 8", "supplier", or "TickTick".
              </p>
            </div>
          ) : results.length === 0 ? (
            <div className="p-5 text-center space-y-1">
              <p className="text-xs font-medium text-stone-700 dark:text-stone-200">
                No matches for "{query.trim()}"
              </p>
              <p className="text-[11px] text-stone-400">
                Try another keyword from your tasks, subtasks, or notes.
              </p>
            </div>
          ) : (
            <div className={`divide-y ${tokens.divider}`}>
              {results.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleChoose(item)}
                  className="w-full text-left px-3 py-2.5 hover:bg-stone-50 dark:hover:bg-white/[0.03] transition-colors flex items-start gap-2.5"
                >
                  <span className="mt-0.5 text-stone-400 shrink-0">
                    {item.targetType === 'task' ? (
                      <CheckSquare className="w-3.5 h-3.5" />
                    ) : (
                      <FileText className="w-3.5 h-3.5" />
                    )}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-stone-900 dark:text-stone-100 truncate">
                      <HighlightedText text={item.title} query={query} />
                    </p>
                    <p className="text-[11px] text-stone-500 dark:text-stone-400 truncate mt-0.5">
                      <HighlightedText text={item.snippet} query={query} />
                    </p>
                    <p className="text-[10px] text-stone-400 dark:text-stone-500 mt-0.5 tabular-nums">
                      {item.meta}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
