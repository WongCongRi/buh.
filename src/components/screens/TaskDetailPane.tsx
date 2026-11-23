import React, { useState } from 'react';
import { Calendar, Check, Clock, Plus, Trash2, X } from 'lucide-react';
import { TODAY_DATE_KEY } from '../../data/initialData';
import { TaskItem, TaskPriority } from '../../types/taskflow';
import { StyleThemeTokens } from '../../utils/themeTokens';
import { HighlightedText } from '../HighlightedText';

interface TaskDetailPaneProps {
  task: TaskItem | null;
  tokens: StyleThemeTokens;
  taskLists: string[];
  isSheet?: boolean;
  highlightQuery?: string;
  onDismissHighlight?: () => void;
  onClose?: () => void;
  onUpdateTask: (updated: TaskItem) => void;
  onDeleteTask: (taskId: string) => void;
  bodyScrollRef?: React.RefObject<HTMLDivElement | null>;
}

const PRIORITIES: TaskPriority[] = ['High', 'Normal', 'Low'];
const QUICK_TIMES = [
  { label: '9a', value: '09:00 AM' },
  { label: '2p', value: '02:00 PM' },
  { label: '6p', value: '06:00 PM' },
];

function formatTaskDateLabel(dateKey: string): string {
  if (dateKey === TODAY_DATE_KEY) return 'Today, Nov 23';
  if (dateKey === '2026-11-24') return 'Tomorrow, Nov 24';
  const [yStr, mStr, dStr] = dateKey.split('-');
  const dt = new Date(Number(yStr) || 2026, (Number(mStr) || 11) - 1, Number(dStr) || 23);
  return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function toTimeInputValue(timeLabel: string): string {
  const m = timeLabel.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return '';
  let hour = parseInt(m[1], 10);
  const min = m[2];
  const meridiem = m[3].toUpperCase();
  if (meridiem === 'PM' && hour < 12) hour += 12;
  if (meridiem === 'AM' && hour === 12) hour = 0;
  return `${String(hour).padStart(2, '0')}:${min}`;
}

function fromTimeInputValue(value: string): string {
  if (!value) return 'No time set';
  const [hhStr, mmStr] = value.split(':');
  const hh = parseInt(hhStr, 10);
  if (Number.isNaN(hh)) return 'No time set';
  const meridiem = hh >= 12 ? 'PM' : 'AM';
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${String(h12).padStart(2, '0')}:${mmStr || '00'} ${meridiem}`;
}

export const TaskDetailPane: React.FC<TaskDetailPaneProps> = ({
  task,
  tokens,
  taskLists,
  isSheet = false,
  highlightQuery = '',
  onDismissHighlight,
  onClose,
  onUpdateTask,
  onDeleteTask,
  bodyScrollRef,
}) => {
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('');

  if (!task) {
    return (
      <div className={`h-full flex flex-col items-center justify-center text-center p-5 ${tokens.cardBg} ${tokens.cardRadius}`}>
        <p className="text-sm font-medium text-stone-700 dark:text-stone-200">Select a task to inspect</p>
        <p className="text-xs text-stone-500 dark:text-stone-400 mt-1 max-w-[220px]">
          Tap any task on the left pane to edit schedule, priority, notes, or subtasks.
        </p>
      </div>
    );
  }

  const handleToggleSubtask = (subId: string) => {
    onUpdateTask({
      ...task,
      subtasks: task.subtasks.map((st) => (st.id === subId ? { ...st, done: !st.done } : st)),
    });
  };

  const handleAddSubtask = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newSubtaskTitle.trim();
    if (!trimmed) return;
    onUpdateTask({
      ...task,
      subtasks: [...task.subtasks, { id: `st-${Date.now()}`, title: trimmed, done: false }],
    });
    setNewSubtaskTitle('');
  };

  const hasHighlight = Boolean(highlightQuery.trim());

  return (
    <div
      className={`flex flex-col h-full ${
        isSheet
          ? 'bg-white dark:bg-[#181B19] rounded-t-3xl border-t border-stone-200 dark:border-stone-800'
          : `${tokens.cardBg} ${tokens.cardRadius}`
      }`}
    >
      {isSheet && (
        <div
          className="pt-2 pb-1 flex justify-center shrink-0 cursor-grab active:cursor-grabbing touch-none"
          title="Swipe down to close"
        >
          <div className="w-9 h-1 rounded-full bg-stone-300 dark:bg-stone-600" />
        </div>
      )}

      {/* Detail Header */}
      <div className={`flex items-center justify-between px-3 py-1.5 border-b ${tokens.divider} shrink-0`}>
        <button
          type="button"
          onClick={() => onUpdateTask({ ...task, completed: !task.completed })}
          className={`inline-flex items-center gap-1.5 text-[11.5px] font-medium px-2.5 py-1 ${tokens.buttonRadius} transition-colors whitespace-nowrap shrink-0 ${
            task.completed
              ? `${tokens.accentSoftBg} ${tokens.accentText}`
              : `${tokens.subtleBg} text-stone-700 dark:text-stone-200 hover:opacity-90`
          }`}
        >
          <Check className="w-3.5 h-3.5" />
          {task.completed ? 'Completed' : 'Mark complete'}
        </button>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => onDeleteTask(task.id)}
            aria-label="Delete task"
            className="p-1.5 text-stone-400 hover:text-rose-600 dark:hover:text-rose-400 transition-colors rounded-lg"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close detail"
              className="p-1.5 text-stone-400 hover:text-stone-800 dark:hover:text-stone-100 transition-colors rounded-lg"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Compact Body */}
      <div
        ref={bodyScrollRef}
        className="flex-1 overflow-y-auto overscroll-contain device-scroll p-2.5 space-y-2"
      >
        <div>
          {hasHighlight ? (
            <div
              role="button"
              tabIndex={0}
              onClick={onDismissHighlight}
              onKeyDown={(e) => e.key === 'Enter' && onDismissHighlight?.()}
              className={`font-display text-sm font-semibold text-stone-900 dark:text-stone-100 cursor-text ${
                task.completed ? 'line-through opacity-60' : ''
              }`}
            >
              <HighlightedText text={task.title} query={highlightQuery} />
            </div>
          ) : (
            <input
              type="text"
              value={task.title}
              onChange={(e) => onUpdateTask({ ...task, title: e.target.value })}
              aria-label="Task title"
              className={`w-full bg-transparent font-display text-sm font-semibold text-stone-900 dark:text-stone-100 focus:outline-none ${
                task.completed ? 'line-through opacity-60' : ''
              }`}
            />
          )}
          <p className="text-[10.5px] text-stone-500 dark:text-stone-400 mt-0.5 tabular-nums">
            {formatTaskDateLabel(task.dateKey)}
            <span aria-hidden="true"> · </span>
            {task.timeLabel}
          </p>
        </div>

        {/* User-friendly Schedule: strictly 1 row for Day + 1 row for Time */}
        <div className={`${tokens.subtleBg} ${tokens.buttonRadius} px-2 py-1.5 space-y-1.5`}>
          <div className="flex items-center justify-between gap-1.5 flex-nowrap">
            <span className="text-[10px] font-medium text-stone-500 dark:text-stone-400 flex items-center gap-1 shrink-0 w-10">
              <Calendar className="w-3 h-3 shrink-0" />
              Day
            </span>
            <div className="flex items-center gap-1 flex-nowrap min-w-0 justify-end">
              <button
                type="button"
                onClick={() => onUpdateTask({ ...task, dateKey: TODAY_DATE_KEY, isInbox: false })}
                className={`px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap shrink-0 ${tokens.buttonRadius} transition-colors ${
                  task.dateKey === TODAY_DATE_KEY
                    ? tokens.accentBg
                    : 'bg-white/80 dark:bg-stone-900/50 text-stone-700 dark:text-stone-300'
                }`}
              >
                Today
              </button>
              <button
                type="button"
                onClick={() => onUpdateTask({ ...task, dateKey: '2026-11-24', isInbox: false })}
                className={`px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap shrink-0 ${tokens.buttonRadius} transition-colors ${
                  task.dateKey === '2026-11-24'
                    ? tokens.accentBg
                    : 'bg-white/80 dark:bg-stone-900/50 text-stone-700 dark:text-stone-300'
                }`}
              >
                Tmrw
              </button>
              <input
                type="date"
                aria-label="Custom task date"
                value={task.dateKey}
                onChange={(e) => {
                  if (e.target.value) {
                    onUpdateTask({ ...task, dateKey: e.target.value, isInbox: false });
                  }
                }}
                className={`w-[98px] min-w-0 shrink text-[10px] font-mono-tabular px-1 py-0.5 bg-white/80 dark:bg-stone-900/50 text-stone-700 dark:text-stone-200 ${tokens.buttonRadius} focus:outline-none`}
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-1.5 flex-nowrap">
            <span className="text-[10px] font-medium text-stone-500 dark:text-stone-400 flex items-center gap-1 shrink-0 w-10">
              <Clock className="w-3 h-3 shrink-0" />
              Time
            </span>
            <div className="flex items-center gap-1 flex-nowrap min-w-0 justify-end">
              <input
                type="time"
                aria-label="Schedule time"
                value={toTimeInputValue(task.timeLabel)}
                onChange={(e) =>
                  onUpdateTask({ ...task, timeLabel: fromTimeInputValue(e.target.value) })
                }
                className={`w-[80px] min-w-0 shrink text-[10px] font-mono-tabular px-1 py-0.5 bg-white/80 dark:bg-stone-900/50 text-stone-800 dark:text-stone-100 ${tokens.buttonRadius} focus:outline-none`}
              />
              {QUICK_TIMES.map((qt) => {
                const active = task.timeLabel === qt.value;
                return (
                  <button
                    key={qt.value}
                    type="button"
                    onClick={() => onUpdateTask({ ...task, timeLabel: qt.value })}
                    className={`px-1.5 py-0.5 text-[10px] font-medium tabular-nums whitespace-nowrap shrink-0 ${tokens.buttonRadius} transition-colors ${
                      active
                        ? tokens.accentBg
                        : 'bg-white/80 dark:bg-stone-900/50 text-stone-600 dark:text-stone-300 hover:opacity-85'
                    }`}
                  >
                    {qt.label}
                  </button>
                );
              })}
              {task.timeLabel !== 'No time set' && (
                <button
                  type="button"
                  onClick={() => onUpdateTask({ ...task, timeLabel: 'No time set' })}
                  aria-label="Clear schedule time"
                  title="Clear time"
                  className="p-0.5 text-stone-400 hover:text-stone-800 dark:hover:text-stone-200 shrink-0"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Category & Priority */}
        <div className="grid grid-cols-2 gap-2.5">
          <div className="space-y-1">
            <span className="block text-[11px] font-medium text-stone-500 dark:text-stone-400">List</span>
            <div className="flex flex-wrap gap-1">
              {Array.from(new Set([...taskLists, 'Inbox', task.category])).map((cat) => {
                const active = task.category === cat;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() =>
                      onUpdateTask({
                        ...task,
                        category: cat,
                        isInbox: cat === 'Inbox',
                      })
                    }
                    className={`px-2 py-0.5 text-[10.5px] font-medium transition-colors whitespace-nowrap ${tokens.buttonRadius} ${
                      active
                        ? `${tokens.accentSoftBg} ${tokens.accentText} border ${tokens.accentBorder}`
                        : `${tokens.subtleBg} text-stone-600 dark:text-stone-300`
                    }`}
                  >
                    {cat}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-1">
            <span className="block text-[11px] font-medium text-stone-500 dark:text-stone-400">Priority</span>
            <div className="flex flex-wrap gap-1">
              {PRIORITIES.map((prio) => {
                const active = task.priority === prio;
                return (
                  <button
                    key={prio}
                    type="button"
                    onClick={() => onUpdateTask({ ...task, priority: prio })}
                    className={`px-2 py-0.5 text-[10.5px] font-medium transition-colors whitespace-nowrap ${tokens.buttonRadius} ${
                      active
                        ? prio === 'High'
                          ? 'bg-amber-600 text-white'
                          : tokens.accentBg
                        : `${tokens.subtleBg} text-stone-600 dark:text-stone-300`
                    }`}
                  >
                    {prio}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Notes */}
        <div className="space-y-1">
          <label className="block text-[11px] font-medium text-stone-500 dark:text-stone-400">Notes</label>
          {hasHighlight && task.notes ? (
            <div
              role="button"
              tabIndex={0}
              onClick={onDismissHighlight}
              onKeyDown={(e) => e.key === 'Enter' && onDismissHighlight?.()}
              className={`w-full text-[11.5px] leading-snug p-2 ${tokens.subtleBg} text-stone-800 dark:text-stone-200 ${tokens.buttonRadius} cursor-text min-h-[46px]`}
            >
              <HighlightedText text={task.notes} query={highlightQuery} />
            </div>
          ) : (
            <textarea
              rows={2}
              value={task.notes}
              onChange={(e) => onUpdateTask({ ...task, notes: e.target.value })}
              placeholder="Add context, links, or reminders..."
              className={`w-full text-[11.5px] leading-snug p-2 ${tokens.subtleBg} text-stone-800 dark:text-stone-200 placeholder:text-stone-400 ${tokens.buttonRadius} focus:outline-none focus:ring-1 focus:ring-[var(--tf-accent)] resize-none`}
            />
          )}
        </div>

        {/* Subtasks */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-stone-500 dark:text-stone-400">Subtasks</span>
            <span className="text-[10.5px] text-stone-400 tabular-nums">
              {task.subtasks.filter((s) => s.done).length}/{task.subtasks.length}
            </span>
          </div>

          {task.subtasks.length > 0 && (
            <div className="space-y-1">
              {task.subtasks.map((st) => (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => handleToggleSubtask(st.id)}
                  className={`w-full flex items-center gap-2 text-left px-2 py-1.5 ${tokens.subtleBg} ${tokens.buttonRadius} transition-opacity`}
                >
                  <span
                    className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0 transition-colors ${
                      st.done
                        ? `${tokens.accentBg} border-transparent`
                        : 'border-stone-300 dark:border-stone-600'
                    }`}
                  >
                    {st.done && <Check className="w-2.5 h-2.5" />}
                  </span>
                  <span
                    className={`text-[11.5px] flex-1 truncate ${
                      st.done ? 'line-through text-stone-400' : 'text-stone-700 dark:text-stone-200'
                    }`}
                  >
                    <HighlightedText text={st.title} query={highlightQuery} active={hasHighlight} />
                  </span>
                </button>
              ))}
            </div>
          )}

          <form onSubmit={handleAddSubtask} className="flex items-center gap-1.5">
            <input
              type="text"
              value={newSubtaskTitle}
              onChange={(e) => setNewSubtaskTitle(e.target.value)}
              placeholder="Add subtask..."
              className={`flex-1 text-[11.5px] px-2.5 py-1.5 ${tokens.subtleBg} text-stone-800 dark:text-stone-200 placeholder:text-stone-400 ${tokens.buttonRadius} focus:outline-none`}
            />
            <button
              type="submit"
              className={`p-1.5 ${tokens.accentBg} ${tokens.buttonRadius} hover:opacity-90 transition-opacity shrink-0`}
              aria-label="Add subtask"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
