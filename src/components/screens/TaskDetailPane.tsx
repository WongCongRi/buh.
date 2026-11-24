import React, { useEffect, useState } from 'react';
import { Bell, Calendar, Check, Clock, CloudUpload, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { TODAY_DATE_KEY, TOMORROW_DATE_KEY } from '../../data/initialData';
import { TaskItem, TaskPriority, TaskReminder } from '../../types/taskflow';
import {
  REMINDER_PRESETS,
  dedupeReminders,
  formatReminderLabel,
  getNotificationPermissionState,
  makeReminderId,
  NotificationSupportState,
  requestAppNotificationPermission,
} from '../../utils/taskReminders';
import { StyleThemeTokens } from '../../utils/themeTokens';
import { HighlightedText } from '../HighlightedText';
import { useBackLayer } from '../../hooks/useAndroidBackNavigation';

interface TaskDetailPaneProps {
  task: TaskItem | null;
  tokens: StyleThemeTokens;
  taskLists: string[];
  isSheet?: boolean;
  highlightQuery?: string;
  onDismissHighlight?: () => void;
  onClose?: () => void;
  onToggleTask?: (taskId: string) => void;
  onUpdateTask: (updated: TaskItem) => void;
  onDeleteTask: (taskId: string) => void;
  isDirtyGoogleTask?: boolean;
  onSyncGoogleTask?: (task: TaskItem) => void;
  canPushToGoogle?: boolean;
  onPushToGoogle?: (task: TaskItem) => void;
  bodyScrollRef?: React.RefObject<HTMLDivElement | null>;
  extraBottomClearance?: boolean;
}

const PRIORITIES: TaskPriority[] = ['High', 'Normal', 'Low'];
const QUICK_TIMES = [
  { label: '9a', value: '09:00 AM' },
  { label: '2p', value: '02:00 PM' },
  { label: '6p', value: '06:00 PM' },
];

function formatTaskDateLabel(dateKey: string): string {
  const [yStr, mStr, dStr] = dateKey.split('-');
  const fallback = new Date();
  const dt = new Date(
    Number(yStr) || fallback.getFullYear(),
    (Number(mStr) || fallback.getMonth() + 1) - 1,
    Number(dStr) || fallback.getDate()
  );
  const shortMonthDay = dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  if (dateKey === TODAY_DATE_KEY) return `Today, ${shortMonthDay}`;
  if (dateKey === TOMORROW_DATE_KEY) return `Tomorrow, ${shortMonthDay}`;
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
  onToggleTask,
  onUpdateTask,
  onDeleteTask,
  isDirtyGoogleTask = false,
  onSyncGoogleTask,
  canPushToGoogle = false,
  onPushToGoogle,
  bodyScrollRef,
  extraBottomClearance = false,
}) => {
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('');
  const [showExactForm, setShowExactForm] = useState(false);
  useBackLayer(showExactForm, () => setShowExactForm(false), 10);
  const [exactDate, setExactDate] = useState(task?.dateKey || TODAY_DATE_KEY);
  const [exactTime, setExactTime] = useState(() => toTimeInputValue(task?.timeLabel || '') || '09:00');
  const [notifPerm, setNotifPerm] = useState<NotificationSupportState>(() =>
    getNotificationPermissionState()
  );

  useEffect(() => {
    setShowExactForm(false);
    if (task) {
      setExactDate(task.dateKey || TODAY_DATE_KEY);
      setExactTime(toTimeInputValue(task.timeLabel) || '09:00');
    }
    setNotifPerm(getNotificationPermissionState());
  }, [task?.id]);

  if (!task) {
    return (
      <div className={`h-full flex flex-col items-center justify-center text-center p-6 ${tokens.cardBg} ${tokens.cardRadius}`}>
        <p className="text-[15px] font-medium text-stone-700 dark:text-stone-200">Select a task to inspect</p>
        <p className="text-[13px] text-stone-500 dark:text-stone-400 mt-1.5 max-w-[240px]">
          Tap any task on the left pane to edit schedule, priority, notes, or subtasks.
        </p>
      </div>
    );
  }

  const reminders = task.reminders ?? [];

  const maybeRequestPermission = () => {
    const current = getNotificationPermissionState();
    setNotifPerm(current);
    if (current === 'default') {
      void requestAppNotificationPermission().then((next) => setNotifPerm(next));
    }
  };

  const handleToggleRelativeReminder = (offsetMinutes: number) => {
    const exists = reminders.some(
      (r) => r.mode === 'relative' && (r.offsetMinutes ?? 0) === offsetMinutes
    );
    const nextReminders: TaskReminder[] = exists
      ? reminders.filter(
          (r) => !(r.mode === 'relative' && (r.offsetMinutes ?? 0) === offsetMinutes)
        )
      : dedupeReminders([
          ...reminders,
          { id: makeReminderId(), mode: 'relative', offsetMinutes },
        ]);
    if (!exists) {
      maybeRequestPermission();
    }
    onUpdateTask({ ...task, reminders: nextReminders });
  };

  const handleAddExactReminder = () => {
    if (!exactDate || !exactTime) return;
    const nextReminders = dedupeReminders([
      ...reminders,
      {
        id: makeReminderId(),
        mode: 'exact',
        dateKey: exactDate,
        time24: exactTime,
      },
    ]);
    maybeRequestPermission();
    onUpdateTask({ ...task, reminders: nextReminders });
    setShowExactForm(false);
  };

  const handleRemoveReminder = (reminderId: string) => {
    onUpdateTask({
      ...task,
      reminders: reminders.filter((r) => r.id !== reminderId),
    });
  };

  const handleToggleSubtask = (subId: string) => {
    onUpdateTask({
      ...task,
      subtasks: task.subtasks.map((st) => (st.id === subId ? { ...st, done: !st.done } : st)),
    });
  };

  const handleUpdateSubtaskTitle = (subId: string, title: string) => {
    onUpdateTask({
      ...task,
      subtasks: task.subtasks.map((st) => (st.id === subId ? { ...st, title } : st)),
    });
  };

  const handleDeleteSubtask = (subId: string) => {
    onUpdateTask({
      ...task,
      subtasks: task.subtasks.filter((st) => st.id !== subId),
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
          className="pt-2.5 pb-1.5 flex justify-center shrink-0 cursor-grab active:cursor-grabbing touch-none"
          title="Swipe down to close"
        >
          <div className="w-10 h-1 rounded-full bg-stone-300 dark:bg-stone-600" />
        </div>
      )}

      {/* Detail Header */}
      <div className={`flex items-center justify-between px-3.5 py-2.5 border-b ${tokens.divider} shrink-0`}>
        <button
          type="button"
          onClick={() => {
            if (onToggleTask) {
              onToggleTask(task.id);
            } else {
              onUpdateTask({ ...task, completed: !task.completed });
            }
          }}
          className={`inline-flex items-center gap-1.5 text-[13.5px] font-medium px-3 py-1.5 ${tokens.buttonRadius} transition-colors whitespace-nowrap shrink-0 ${
            task.completed
              ? `${tokens.accentSoftBg} ${tokens.accentText}`
              : `${tokens.subtleBg} text-stone-700 dark:text-stone-200 hover:opacity-90`
          }`}
        >
          <Check className="w-4 h-4" />
          {task.completed ? 'Completed' : 'Mark complete'}
        </button>

        <div className="flex items-center gap-1 shrink-0">
          {task.source !== 'google' && canPushToGoogle && onPushToGoogle && (
            <button
              type="button"
              onClick={() => onPushToGoogle(task)}
              title="Add to Google Tasks"
              aria-label="Add task to Google Tasks"
              className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-[12.5px] font-medium ${tokens.accentSoftBg} ${tokens.accentText} ${tokens.buttonRadius} hover:opacity-90 transition-opacity`}
            >
              <CloudUpload className="w-3.5 h-3.5" />
              Google
            </button>
          )}
          <button
            type="button"
            onClick={() => onDeleteTask(task.id)}
            aria-label="Delete task"
            className="p-2 text-stone-400 hover:text-rose-600 dark:hover:text-rose-400 transition-colors rounded-lg"
          >
            <Trash2 className="w-4 h-4" />
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close detail"
              className="p-2 text-stone-400 hover:text-stone-800 dark:hover:text-stone-100 transition-colors rounded-lg"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Explicit Sync Bar for Edited Google Tasks */}
      {task.source === 'google' && isDirtyGoogleTask && onSyncGoogleTask && (
        <div
          className={`flex items-center justify-between gap-2 px-3.5 py-2 border-b ${tokens.divider} ${tokens.accentSoftBg} shrink-0`}
        >
          <span className={`text-[12.5px] font-medium ${tokens.accentText} truncate`}>
            Unsaved edits to Google Task
          </span>
          <button
            type="button"
            onClick={() => onSyncGoogleTask(task)}
            className={`inline-flex items-center gap-1 px-2.5 py-1 text-[12.5px] font-medium ${tokens.accentBg} ${tokens.buttonRadius} shrink-0 hover:opacity-90`}
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Sync now
          </button>
        </div>
      )}

      {/* Body */}
      <div
        ref={bodyScrollRef}
        className={`flex-1 overflow-y-auto overscroll-contain device-scroll p-3.5 space-y-3.5 ${
          extraBottomClearance ? 'pb-20' : ''
        }`}
      >
        <div>
          {hasHighlight ? (
            <div
              role="button"
              tabIndex={0}
              onClick={onDismissHighlight}
              onKeyDown={(e) => e.key === 'Enter' && onDismissHighlight?.()}
              className={`font-display text-[17px] font-semibold text-stone-900 dark:text-stone-100 cursor-text leading-snug ${
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
              className={`w-full bg-transparent font-display text-[17px] font-semibold text-stone-900 dark:text-stone-100 leading-snug focus:outline-none ${
                task.completed ? 'line-through opacity-60' : ''
              }`}
            />
          )}
          <p className="text-[13px] text-stone-500 dark:text-stone-400 mt-1 tabular-nums">
            {formatTaskDateLabel(task.dateKey)}
            <span aria-hidden="true"> · </span>
            {task.timeLabel}
            {task.source === 'google' && (
              <>
                <span aria-hidden="true"> · </span>
                <span className={`font-medium ${tokens.accentText}`}>Google Tasks</span>
              </>
            )}
          </p>
        </div>

        {/* User-friendly Schedule: Day + Time + Notify */}
        <div className={`${tokens.subtleBg} ${tokens.buttonRadius} px-3 py-2.5 space-y-2.5`}>
          <div className="flex items-center justify-between gap-2 flex-nowrap">
            <span className="text-[12.5px] font-medium text-stone-500 dark:text-stone-400 flex items-center gap-1.5 shrink-0 w-14">
              <Calendar className="w-3.5 h-3.5 shrink-0" />
              Day
            </span>
            <div className="flex items-center gap-1.5 flex-nowrap min-w-0 justify-end">
              <button
                type="button"
                onClick={() => onUpdateTask({ ...task, dateKey: TODAY_DATE_KEY, isInbox: false })}
                className={`px-2.5 py-1 text-[12.5px] font-medium whitespace-nowrap shrink-0 ${tokens.buttonRadius} transition-colors ${
                  task.dateKey === TODAY_DATE_KEY
                    ? tokens.accentBg
                    : 'bg-white/80 dark:bg-stone-900/50 text-stone-700 dark:text-stone-300'
                }`}
              >
                Today
              </button>
              <button
                type="button"
                onClick={() => onUpdateTask({ ...task, dateKey: TOMORROW_DATE_KEY, isInbox: false })}
                className={`px-2.5 py-1 text-[12.5px] font-medium whitespace-nowrap shrink-0 ${tokens.buttonRadius} transition-colors ${
                  task.dateKey === TOMORROW_DATE_KEY
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
                className={`w-[122px] min-w-0 shrink text-[12px] font-mono-tabular px-2 py-1 bg-white/80 dark:bg-stone-900/50 text-stone-700 dark:text-stone-200 ${tokens.buttonRadius} focus:outline-none`}
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 flex-nowrap">
            <span className="text-[12.5px] font-medium text-stone-500 dark:text-stone-400 flex items-center gap-1.5 shrink-0 w-14">
              <Clock className="w-3.5 h-3.5 shrink-0" />
              Time
            </span>
            <div className="flex items-center gap-1.5 flex-nowrap min-w-0 justify-end">
              <input
                type="time"
                aria-label="Schedule time"
                value={toTimeInputValue(task.timeLabel)}
                onChange={(e) =>
                  onUpdateTask({ ...task, timeLabel: fromTimeInputValue(e.target.value) })
                }
                className={`w-[94px] min-w-0 shrink text-[12px] font-mono-tabular px-2 py-1 bg-white/80 dark:bg-stone-900/50 text-stone-800 dark:text-stone-100 ${tokens.buttonRadius} focus:outline-none`}
              />
              {QUICK_TIMES.map((qt) => {
                const active = task.timeLabel === qt.value;
                return (
                  <button
                    key={qt.value}
                    type="button"
                    onClick={() => onUpdateTask({ ...task, timeLabel: qt.value })}
                    className={`px-2 py-1 text-[12px] font-medium tabular-nums whitespace-nowrap shrink-0 ${tokens.buttonRadius} transition-colors ${
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
                  className="p-1 text-stone-400 hover:text-stone-800 dark:hover:text-stone-200 shrink-0"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Notify row: relative presets + custom exact date/time */}
          <div className={`border-t ${tokens.divider} pt-2.5 space-y-2`}>
            <div className="flex items-center justify-between gap-2 flex-nowrap">
              <span className="text-[12.5px] font-medium text-stone-500 dark:text-stone-400 flex items-center gap-1.5 shrink-0 w-14">
                <Bell className="w-3.5 h-3.5 shrink-0" />
                Notify
              </span>
              <div className="flex items-center gap-1.5 flex-wrap justify-end min-w-0">
                {REMINDER_PRESETS.map((preset) => {
                  const active = reminders.some(
                    (r) => r.mode === 'relative' && (r.offsetMinutes ?? 0) === preset.offsetMinutes
                  );
                  return (
                    <button
                      key={preset.offsetMinutes}
                      type="button"
                      onClick={() => handleToggleRelativeReminder(preset.offsetMinutes)}
                      title={preset.label}
                      className={`px-2 py-1 text-[12px] font-medium tabular-nums whitespace-nowrap shrink-0 ${tokens.buttonRadius} transition-colors ${
                        active
                          ? tokens.accentBg
                          : 'bg-white/80 dark:bg-stone-900/50 text-stone-600 dark:text-stone-300 hover:opacity-85'
                      }`}
                    >
                      {preset.shortLabel}
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => {
                    if (!showExactForm) {
                      setExactDate(task.dateKey || TODAY_DATE_KEY);
                      setExactTime(toTimeInputValue(task.timeLabel) || '09:00');
                    }
                    setShowExactForm((v) => !v);
                  }}
                  className={`inline-flex items-center gap-1 px-2 py-1 text-[12px] font-medium whitespace-nowrap shrink-0 ${tokens.buttonRadius} transition-colors ${
                    showExactForm
                      ? `${tokens.accentSoftBg} ${tokens.accentText} border ${tokens.accentBorder}`
                      : 'bg-white/80 dark:bg-stone-900/50 text-stone-700 dark:text-stone-200 hover:opacity-85'
                  }`}
                >
                  <Plus className="w-3.5 h-3.5" />
                  Exact
                </button>
              </div>
            </div>

            {showExactForm && (
              <div className="flex items-center gap-1.5 pt-0.5">
                <input
                  type="date"
                  aria-label="Exact notification date"
                  value={exactDate}
                  onChange={(e) => setExactDate(e.target.value)}
                  className={`flex-1 min-w-0 text-[12.5px] font-mono-tabular px-2 py-1.5 bg-white dark:bg-stone-900/70 text-stone-700 dark:text-stone-200 ${tokens.buttonRadius} focus:outline-none`}
                />
                <input
                  type="time"
                  aria-label="Exact notification time"
                  value={exactTime}
                  onChange={(e) => setExactTime(e.target.value)}
                  className={`w-[104px] shrink-0 text-[12.5px] font-mono-tabular px-2 py-1.5 bg-white dark:bg-stone-900/70 text-stone-800 dark:text-stone-100 ${tokens.buttonRadius} focus:outline-none`}
                />
                <button
                  type="button"
                  onClick={handleAddExactReminder}
                  className={`px-3 py-1.5 text-[12.5px] font-medium ${tokens.accentBg} ${tokens.buttonRadius} shrink-0 hover:opacity-90`}
                >
                  Add
                </button>
              </div>
            )}

            {reminders.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                {reminders.map((rem) => (
                  <span
                    key={rem.id}
                    className={`inline-flex items-center gap-1.5 px-2 py-1 text-[12px] font-medium tabular-nums ${tokens.buttonRadius} ${
                      rem.firedAt
                        ? 'bg-stone-200/70 dark:bg-stone-800/70 text-stone-500 dark:text-stone-400'
                        : `${tokens.accentSoftBg} ${tokens.accentText} border ${tokens.accentBorder}`
                    }`}
                  >
                    <Bell className="w-3.5 h-3.5 shrink-0" />
                    <span>{formatReminderLabel(rem)}</span>
                    {rem.firedAt && <span className="text-[11px] opacity-75">sent</span>}
                    <button
                      type="button"
                      onClick={() => handleRemoveReminder(rem.id)}
                      aria-label={`Remove reminder ${formatReminderLabel(rem)}`}
                      className="ml-0.5 opacity-70 hover:opacity-100 transition-opacity"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            {reminders.length > 0 && notifPerm === 'default' && (
              <div className="flex items-center justify-between gap-2 text-[12px] text-stone-500 dark:text-stone-400">
                <span>Allow alerts to receive system notifications.</span>
                <button
                  type="button"
                  onClick={() => void requestAppNotificationPermission().then(setNotifPerm)}
                  className={`px-2.5 py-1 text-[12px] font-medium ${tokens.accentSoftBg} ${tokens.accentText} ${tokens.buttonRadius} shrink-0`}
                >
                  Enable
                </button>
              </div>
            )}

            {reminders.length > 0 && notifPerm === 'denied' && (
              <p className="text-[12px] text-stone-400 dark:text-stone-500">
                Browser notifications blocked — in-app alerts will still appear.
              </p>
            )}
          </div>
        </div>

        {/* Category & Priority */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <span className="block text-[12.5px] font-medium text-stone-500 dark:text-stone-400">List</span>
            <div className="flex flex-wrap gap-1.5">
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
                    className={`px-2.5 py-1 text-[12.5px] font-medium transition-colors whitespace-nowrap ${tokens.buttonRadius} ${
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

          <div className="space-y-1.5">
            <span className="block text-[12.5px] font-medium text-stone-500 dark:text-stone-400">Priority</span>
            <div className="flex flex-wrap gap-1.5">
              {PRIORITIES.map((prio) => {
                const active = task.priority === prio;
                return (
                  <button
                    key={prio}
                    type="button"
                    onClick={() => onUpdateTask({ ...task, priority: prio })}
                    className={`px-2.5 py-1 text-[12.5px] font-medium transition-colors whitespace-nowrap ${tokens.buttonRadius} ${
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
        <div className="space-y-1.5">
          <label className="block text-[12.5px] font-medium text-stone-500 dark:text-stone-400">Notes</label>
          {hasHighlight && task.notes ? (
            <div
              role="button"
              tabIndex={0}
              onClick={onDismissHighlight}
              onKeyDown={(e) => e.key === 'Enter' && onDismissHighlight?.()}
              className={`w-full text-[14.5px] leading-relaxed p-2.5 ${tokens.subtleBg} text-stone-800 dark:text-stone-200 ${tokens.buttonRadius} cursor-text min-h-[116px] whitespace-pre-wrap break-words`}
            >
              <HighlightedText text={task.notes} query={highlightQuery} />
            </div>
          ) : (
            <textarea
              rows={4}
              value={task.notes}
              onChange={(e) => onUpdateTask({ ...task, notes: e.target.value })}
              placeholder="Add context, links, or reminders..."
              className={`w-full text-[14.5px] leading-relaxed p-2.5 min-h-[116px] ${tokens.subtleBg} text-stone-800 dark:text-stone-200 placeholder:text-stone-400 ${tokens.buttonRadius} focus:outline-none focus:ring-1 focus:ring-[var(--tf-accent)] resize-y`}
            />
          )}
        </div>

        {/* Subtasks */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[12.5px] font-medium text-stone-500 dark:text-stone-400">Subtasks</span>
            <span className="text-[12px] text-stone-400 tabular-nums">
              {task.subtasks.filter((s) => s.done).length}/{task.subtasks.length}
            </span>
          </div>

          {task.subtasks.length > 0 && (
            <div className="space-y-1.5">
              {task.subtasks.map((st) => (
                <div
                  key={st.id}
                  className={`w-full flex items-center gap-2.5 px-2.5 py-2 ${tokens.subtleBg} ${tokens.buttonRadius}`}
                >
                  <button
                    type="button"
                    onClick={() => handleToggleSubtask(st.id)}
                    aria-label={st.done ? `Mark "${st.title}" incomplete` : `Mark "${st.title}" complete`}
                    className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
                      st.done
                        ? `${tokens.accentBg} border-transparent`
                        : 'border-stone-300 dark:border-stone-600'
                    }`}
                  >
                    {st.done && <Check className="w-3 h-3" />}
                  </button>
                  {hasHighlight && st.title.toLowerCase().includes(highlightQuery.trim().toLowerCase()) ? (
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={onDismissHighlight}
                      onKeyDown={(e) => e.key === 'Enter' && onDismissHighlight?.()}
                      className={`text-[14.5px] flex-1 min-w-0 truncate cursor-text ${
                        st.done ? 'line-through text-stone-400' : 'text-stone-700 dark:text-stone-200'
                      }`}
                    >
                      <HighlightedText text={st.title} query={highlightQuery} active={hasHighlight} />
                    </div>
                  ) : (
                    <input
                      type="text"
                      value={st.title}
                      onChange={(e) => handleUpdateSubtaskTitle(st.id, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Backspace' && !st.title) {
                          e.preventDefault();
                          handleDeleteSubtask(st.id);
                        }
                      }}
                      placeholder="Subtask..."
                      aria-label="Edit subtask"
                      className={`flex-1 min-w-0 bg-transparent text-[14.5px] leading-snug focus:outline-none ${
                        st.done ? 'line-through text-stone-400' : 'text-stone-700 dark:text-stone-200'
                      }`}
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => handleDeleteSubtask(st.id)}
                    aria-label={`Delete subtask ${st.title || ''}`.trim()}
                    title="Delete subtask"
                    className="p-1 text-stone-400 hover:text-rose-500 dark:text-stone-500 dark:hover:text-rose-400 rounded transition-colors shrink-0"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <form onSubmit={handleAddSubtask} className="flex items-center gap-2">
            <input
              type="text"
              value={newSubtaskTitle}
              onChange={(e) => setNewSubtaskTitle(e.target.value)}
              placeholder="Add subtask..."
              className={`flex-1 text-[14px] px-3 py-2 ${tokens.subtleBg} text-stone-800 dark:text-stone-200 placeholder:text-stone-400 ${tokens.buttonRadius} focus:outline-none`}
            />
            <button
              type="submit"
              className={`p-2 ${tokens.accentBg} ${tokens.buttonRadius} hover:opacity-90 transition-opacity shrink-0`}
              aria-label="Add subtask"
            >
              <Plus className="w-4 h-4" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
