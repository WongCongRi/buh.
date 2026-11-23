import React, { useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  Download,
  GripVertical,
  Moon,
  Pencil,
  Plus,
  Sun,
  Trash2,
  X,
} from 'lucide-react';
import { AppSettingsState, FoldPosture, TaskItem } from '../../types/taskflow';
import { normalizeHex } from '../../utils/colorUtils';
import { StyleThemeTokens } from '../../utils/themeTokens';

interface SettingsScreenProps {
  posture: FoldPosture;
  tokens: StyleThemeTokens;
  isDark: boolean;
  onToggleDark: () => void;
  accentColor: string;
  recentColors: string[];
  onPreviewAccentColor: (hex: string) => void;
  onSelectAccentColor: (hex: string) => void;
  taskLists: string[];
  onAddList: (name: string) => void;
  onRenameList: (oldName: string, newName: string) => void;
  onDeleteList: (name: string) => void;
  onReorderList: (fromIndex: number, toIndex: number) => void;
  settings: AppSettingsState;
  onUpdateSettings: (patch: Partial<AppSettingsState>) => void;
  tasks: TaskItem[];
}

export const SettingsScreen: React.FC<SettingsScreenProps> = ({
  posture,
  tokens,
  isDark,
  onToggleDark,
  accentColor,
  recentColors,
  onPreviewAccentColor,
  onSelectAccentColor,
  taskLists,
  onAddList,
  onRenameList,
  onDeleteList,
  onReorderList,
  settings,
  onUpdateSettings,
  tasks,
}) => {
  const [showExportPreview, setShowExportPreview] = useState(false);
  const [newListName, setNewListName] = useState('');
  const [editingList, setEditingList] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState('');
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const debounceRef = useRef<number | null>(null);
  const currentHex = normalizeHex(accentColor);

  const handlePickerChange = (rawHex: string) => {
    const normalized = normalizeHex(rawHex);
    onPreviewAccentColor(normalized);
    if (debounceRef.current) {
      window.clearTimeout(debounceRef.current);
    }
    debounceRef.current = window.setTimeout(() => {
      onSelectAccentColor(normalized);
      debounceRef.current = null;
    }, 450);
  };

  const handlePickerBlur = () => {
    if (debounceRef.current) {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    onSelectAccentColor(currentHex);
  };

  const handleCreateList = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newListName.trim();
    if (!trimmed) return;
    onAddList(trimmed);
    setNewListName('');
  };

  const handleCommitRename = (oldName: string) => {
    const trimmed = editingDraft.trim();
    if (trimmed && trimmed !== oldName) {
      onRenameList(oldName, trimmed);
    }
    setEditingList(null);
    setEditingDraft('');
  };

  const csvPreview = [
    'Folder Name,Title,Priority,Due Date,Status',
    ...tasks.map(
      (t) =>
        `"${t.category}","${t.title.replace(/"/g, '""')}",${
          t.priority === 'High' ? 5 : t.priority === 'Normal' ? 3 : 1
        },${t.dateKey},${t.completed ? 2 : 0}`
    ),
  ].join('\n');

  const renderToggleRow = (
    title: string,
    description: string,
    checked: boolean,
    onChange: () => void
  ) => (
    <div className={`flex items-center justify-between gap-2 px-2.5 py-1.5 border-b last:border-b-0 ${tokens.divider}`}>
      <div className="min-w-0">
        <p className="text-[11.5px] font-medium text-stone-900 dark:text-stone-100 leading-tight">{title}</p>
        <p className="text-[10px] text-stone-500 dark:text-stone-400 truncate leading-tight mt-0.5">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={onChange}
        className={`w-9 h-5 rounded-full p-0.5 transition-colors shrink-0 ${
          checked ? tokens.accentBg : 'bg-stone-300 dark:bg-stone-700'
        }`}
      >
        <span
          className={`block w-4 h-4 rounded-full bg-white shadow-xs transition-transform ${
            checked ? 'translate-x-4' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  );

  const appearanceCard = (
    <div className="space-y-0.5">
      <span className="text-[10px] font-medium text-stone-400 dark:text-stone-500 px-1">Appearance</span>
      <div className={`${tokens.cardBg} ${tokens.cardRadius} overflow-hidden`}>
        <div className={`flex items-center justify-between px-2.5 py-1.5 border-b ${tokens.divider}`}>
          <div className="min-w-0">
            <p className="text-[11.5px] font-medium text-stone-900 dark:text-stone-100 leading-tight">Theme mode</p>
            <p className="text-[10px] text-stone-500 dark:text-stone-400 truncate leading-tight mt-0.5">
              {isDark ? 'Dark low-light focus' : 'Light daylight clarity'}
            </p>
          </div>
          <button
            type="button"
            onClick={onToggleDark}
            className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10.5px] font-medium ${tokens.subtleBg} text-stone-800 dark:text-stone-100 ${tokens.buttonRadius} shrink-0`}
          >
            {isDark ? <Moon className="w-3 h-3" /> : <Sun className="w-3 h-3" />}
            {isDark ? 'Dark' : 'Light'}
          </button>
        </div>

        {/* Accent Colour Picker + 5 Most Recent Colours */}
        <div className="px-2.5 py-1.5 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[12px] font-medium text-stone-900 dark:text-stone-100">Accent colour</p>
              <p className="text-[10.5px] font-mono-tabular text-stone-500 dark:text-stone-400">
                {currentHex}
              </p>
            </div>
            <label
              htmlFor="settings-accent-picker"
              className={`inline-flex items-center gap-1.5 px-2 py-1 ${tokens.subtleBg} ${tokens.buttonRadius} cursor-pointer shrink-0`}
            >
              <input
                id="settings-accent-picker"
                type="color"
                value={currentHex}
                onChange={(e) => handlePickerChange(e.target.value)}
                onBlur={handlePickerBlur}
                aria-label="Choose custom accent colour"
                className="w-5 h-5 rounded border border-stone-300 dark:border-stone-700 bg-transparent cursor-pointer p-0"
              />
              <span className="text-[11px] font-medium text-stone-700 dark:text-stone-200">Pick</span>
            </label>
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="text-[10.5px] text-stone-400 dark:text-stone-500 shrink-0">
              Recent ({recentColors.length}/5)
            </span>
            <div className="flex items-center gap-1.5" role="group" aria-label="Five most recent accent colours">
              {recentColors.slice(0, 5).map((hex) => {
                const isSelected = normalizeHex(hex) === currentHex;
                return (
                  <button
                    key={hex}
                    type="button"
                    title={hex}
                    aria-label={`Use recent colour ${hex}`}
                    onClick={() => onSelectAccentColor(hex)}
                    className={`w-5 h-5 rounded-full transition-transform border ${
                      isSelected
                        ? 'scale-110 ring-2 ring-offset-1 ring-stone-900 dark:ring-stone-100 dark:ring-offset-[#181B19] border-transparent'
                        : 'border-black/10 dark:border-white/15 hover:scale-105'
                    }`}
                  >
                    <span
                      className="block w-full h-full rounded-full"
                      style={{ backgroundColor: hex }}
                    />
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const listsCard = (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between px-1">
        <span className="text-[10px] font-medium text-stone-400 dark:text-stone-500">Lists (drag or arrow to reorder)</span>
        <span className="text-[10px] text-stone-400 tabular-nums">{taskLists.length} custom</span>
      </div>
      <div className={`${tokens.cardBg} ${tokens.cardRadius} overflow-hidden`}>
        {taskLists.map((listName, idx) => {
          const count = tasks.filter((t) => t.category === listName).length;
          const isEditing = editingList === listName;
          const isDragging = dragIndex === idx;
          const isDropTarget = dropIndex === idx && dragIndex !== null && dragIndex !== idx;
          return (
            <div
              key={listName}
              draggable={!isEditing}
              onDragStart={(e) => {
                setDragIndex(idx);
                setDropIndex(idx);
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', String(idx));
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (dropIndex !== idx) setDropIndex(idx);
              }}
              onDrop={(e) => {
                e.preventDefault();
                const from = dragIndex ?? Number(e.dataTransfer.getData('text/plain'));
                if (!Number.isNaN(from) && from !== idx) {
                  onReorderList(from, idx);
                }
                setDragIndex(null);
                setDropIndex(null);
              }}
              onDragEnd={() => {
                setDragIndex(null);
                setDropIndex(null);
              }}
              className={`flex items-center justify-between gap-1.5 px-2.5 py-1 border-b ${tokens.divider} transition-colors ${
                isDragging ? 'opacity-50' : ''
              } ${isDropTarget ? tokens.accentSoftBg : ''}`}
            >
              {isEditing ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleCommitRename(listName);
                  }}
                  className="flex-1 flex items-center gap-1.5"
                >
                  <input
                    type="text"
                    autoFocus
                    value={editingDraft}
                    onChange={(e) => setEditingDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        setEditingList(null);
                        setEditingDraft('');
                      }
                    }}
                    aria-label={`Rename ${listName}`}
                    className={`flex-1 text-xs px-2 py-0.5 ${tokens.subtleBg} text-stone-900 dark:text-stone-100 ${tokens.buttonRadius} focus:outline-none`}
                  />
                  <button
                    type="submit"
                    aria-label="Save list name"
                    className={`p-1 ${tokens.accentBg} ${tokens.buttonRadius}`}
                  >
                    <Check className="w-3 h-3" />
                  </button>
                </form>
              ) : (
                <>
                  <div className="min-w-0 flex items-center gap-1.5">
                    <span
                      className="text-stone-300 dark:text-stone-600 cursor-grab active:cursor-grabbing shrink-0"
                      title="Drag to reorder"
                      aria-hidden="true"
                    >
                      <GripVertical className="w-3 h-3" />
                    </span>
                    <span className="text-[11.5px] font-medium text-stone-900 dark:text-stone-100 truncate">
                      {listName}
                    </span>
                    <span className="text-[10px] text-stone-400 tabular-nums">{count}</span>
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      type="button"
                      disabled={idx === 0}
                      onClick={() => onReorderList(idx, idx - 1)}
                      aria-label={`Move ${listName} up`}
                      className="p-1 text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 disabled:opacity-25 rounded"
                    >
                      <ArrowUp className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      disabled={idx === taskLists.length - 1}
                      onClick={() => onReorderList(idx, idx + 1)}
                      aria-label={`Move ${listName} down`}
                      className="p-1 text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 disabled:opacity-25 rounded"
                    >
                      <ArrowDown className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingList(listName);
                        setEditingDraft(listName);
                      }}
                      aria-label={`Rename ${listName}`}
                      className="p-1 text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 rounded"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                    {taskLists.length > 1 && (
                      <button
                        type="button"
                        onClick={() => onDeleteList(listName)}
                        aria-label={`Delete ${listName}`}
                        className="p-1 text-stone-400 hover:text-rose-500 rounded"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })}

        <form onSubmit={handleCreateList} className="flex items-center gap-1.5 px-2.5 py-1.5">
          <input
            type="text"
            value={newListName}
            onChange={(e) => setNewListName(e.target.value)}
            placeholder="New list name..."
            aria-label="New list name"
            className={`flex-1 text-[11.5px] px-2 py-0.5 ${tokens.subtleBg} text-stone-900 dark:text-stone-100 placeholder:text-stone-400 ${tokens.buttonRadius} focus:outline-none`}
          />
          <button
            type="submit"
            disabled={!newListName.trim()}
            aria-label="Add list"
            className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10.5px] font-medium ${tokens.accentBg} ${tokens.buttonRadius} disabled:opacity-40 shrink-0`}
          >
            <Plus className="w-3 h-3" />
            Add
          </button>
        </form>
      </div>
    </div>
  );

  const adaptiveCard = (
    <div className="space-y-1">
      <span className="text-[10.5px] font-medium text-stone-400 dark:text-stone-500 px-1">Adaptive Layout</span>
      <div className={`${tokens.cardBg} ${tokens.cardRadius} overflow-hidden`}>
        {renderToggleRow(
          'Hinge-aware two-pane split',
          'Add center crease clearance when unfolded',
          settings.hingeAwareSplit,
          () => onUpdateSettings({ hingeAwareSplit: !settings.hingeAwareSplit })
        )}
        {renderToggleRow(
          'One-handed cover reach',
          'Keep primary capture inside lower thumb zone',
          settings.oneHandedCoverReach,
          () => onUpdateSettings({ oneHandedCoverReach: !settings.oneHandedCoverReach })
        )}
      </div>
    </div>
  );

  const integrationsCard = (
    <div className="space-y-1">
      <span className="text-[10.5px] font-medium text-stone-400 dark:text-stone-500 px-1">Calendar & Export</span>
      <div className={`${tokens.cardBg} ${tokens.cardRadius} overflow-hidden`}>
        {renderToggleRow(
          'Google Calendar sync',
          'Mirror scheduled blocks into overview',
          settings.googleCalendarSync,
          () => onUpdateSettings({ googleCalendarSync: !settings.googleCalendarSync })
        )}
        {renderToggleRow(
          'Natural language parse',
          'Highlight and extract times and lists while typing',
          settings.nlpQuickParse,
          () => onUpdateSettings({ nlpQuickParse: !settings.nlpQuickParse })
        )}
        <div className="flex items-center justify-between gap-2 px-3 py-2">
          <div className="min-w-0">
            <p className="text-[12px] font-medium text-stone-900 dark:text-stone-100">TickTick CSV export</p>
            <p className="text-[10.5px] text-stone-500 dark:text-stone-400 truncate">
              Backup format ({tasks.length} tasks)
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowExportPreview(true)}
            className={`inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium ${tokens.accentSoftBg} ${tokens.accentText} ${tokens.buttonRadius} shrink-0`}
          >
            <Download className="w-3 h-3" />
            Export
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className={`h-full overflow-y-auto device-scroll ${posture === FoldPosture.Inner ? 'px-4 py-2' : 'px-3 pt-1.5 pb-12'}`}>
      <div className="flex items-center justify-between mb-1.5">
        <h2 className={`font-display font-semibold text-stone-900 dark:text-stone-100 ${tokens.headingScale}`}>
          Settings
        </h2>
      </div>

      {posture === FoldPosture.Inner ? (
        <div className={`grid grid-cols-2 ${settings.hingeAwareSplit ? 'gap-5' : 'gap-3'} items-start`}>
          <div className="space-y-2">
            {appearanceCard}
            {listsCard}
          </div>
          <div className="space-y-2">
            {adaptiveCard}
            {integrationsCard}
          </div>
        </div>
      ) : (
        <div className="space-y-1.5">
          {appearanceCard}
          {listsCard}
          {adaptiveCard}
          {integrationsCard}
        </div>
      )}

      {showExportPreview && (
        <div className="absolute inset-0 z-30 bg-black/40 backdrop-blur-[1px] flex items-center justify-center p-4">
          <div className={`w-full max-w-sm ${tokens.cardBg} ${tokens.cardRadius} p-4 space-y-3`}>
            <div className="flex items-center justify-between">
              <h3 className="font-display text-sm font-semibold text-stone-900 dark:text-stone-100">
                TickTick Export Preview
              </h3>
              <button
                type="button"
                onClick={() => setShowExportPreview(false)}
                className="p-1 text-stone-400 hover:text-stone-800 dark:hover:text-stone-100"
                aria-label="Close export preview"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <pre className={`text-[10px] font-mono-tabular p-2.5 overflow-x-auto max-h-44 ${tokens.subtleBg} text-stone-700 dark:text-stone-300 ${tokens.buttonRadius}`}>
              {csvPreview}
            </pre>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  const blob = new Blob([csvPreview], { type: 'text/csv;charset=utf-8;' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = 'buh-ticktick-export.csv';
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium ${tokens.subtleBg} text-stone-800 dark:text-stone-100 ${tokens.buttonRadius} hover:opacity-90`}
              >
                <Download className="w-3.5 h-3.5" />
                Download CSV
              </button>
              <button
                type="button"
                onClick={() => setShowExportPreview(false)}
                className={`px-3 py-1.5 text-xs font-medium ${tokens.accentBg} ${tokens.buttonRadius}`}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
