import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Bell, Repeat } from 'lucide-react';
import { TaskItem } from '../types/taskflow';
import { formatRelativeTaskDate } from '../utils/dateLabels';
import { formatRecurrenceLabel } from '../utils/recurrence';
import { StyleThemeTokens } from '../utils/themeTokens';
import { formatTimeDisplay, useTimeFormat } from '../utils/timeFormat';

interface TaskMetaRowProps {
  task: TaskItem;
  tokens: StyleThemeTokens;
  displayDateKey?: string;
  isProjected?: boolean;
  isDirtyGoogle?: boolean;
}

const resizeCallbacks = new WeakMap<Element, () => void>();
let sharedResizeObserver: ResizeObserver | null = null;

function observeElementResize(el: Element, callback: () => void): () => void {
  if (typeof ResizeObserver === 'undefined') return () => {};
  if (!sharedResizeObserver) {
    sharedResizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        resizeCallbacks.get(entry.target)?.();
      }
    });
  }
  resizeCallbacks.set(el, callback);
  sharedResizeObserver.observe(el);
  return () => {
    resizeCallbacks.delete(el);
    sharedResizeObserver?.unobserve(el);
  };
}

export const TaskMetaRow: React.FC<TaskMetaRowProps> = ({
  task,
  tokens,
  displayDateKey,
  isProjected = false,
  isDirtyGoogle = false,
}) => {
  const timeFormat = useTimeFormat();
  const rowRef = useRef<HTMLDivElement | null>(null);
  const fullWidthRef = useRef<number>(0);
  const [compact, setCompact] = useState(false);
  const compactRef = useRef(compact);
  compactRef.current = compact;

  const effectiveDateKey = !task.isInbox ? displayDateKey || task.dateKey : '';
  const hasTime = Boolean(task.timeLabel && task.timeLabel !== 'No time set');
  const completedSubtasks = task.subtasks.filter((s) => s.done).length;
  const totalSubtasks = task.subtasks.length;
  const reminderCount = task.reminders?.length ?? 0;
  const recurrenceKey = task.recurrence ? formatRecurrenceLabel(task.recurrence) : '';

  const contentSignature = [
    effectiveDateKey,
    hasTime ? task.timeLabel : '',
    timeFormat,
    task.category,
    totalSubtasks > 0 ? `${completedSubtasks}/${totalSubtasks}` : '',
    task.priority,
    reminderCount,
    recurrenceKey,
    isProjected ? '1' : '0',
    task.source || '',
    isDirtyGoogle ? '1' : '0',
  ].join('|');

  // Re-evaluate full vs compact whenever the task's displayed attributes change
  useLayoutEffect(() => {
    fullWidthRef.current = 0;
    setCompact(false);
  }, [contentSignature]);

  // Synchronously switch to compact short forms before paint ONLY if full labels overflow one line
  useLayoutEffect(() => {
    const el = rowRef.current;
    if (!el || compact || el.clientWidth <= 0) return;
    if (el.scrollWidth > el.clientWidth + 1) {
      fullWidthRef.current = el.scrollWidth;
      setCompact(true);
    }
  }, [compact, contentSignature]);

  // Adapt automatically when the screen resizes (shared single ResizeObserver across all rows)
  useEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    return observeElementResize(el, () => {
      if (el.clientWidth <= 0) return;
      if (!compactRef.current) {
        if (el.scrollWidth > el.clientWidth + 1) {
          fullWidthRef.current = el.scrollWidth;
          setCompact(true);
        }
      } else if (fullWidthRef.current > 0 && el.clientWidth >= fullWidthRef.current) {
        setCompact(false);
      }
    });
  }, []);

  const dateInfo = effectiveDateKey
    ? formatRelativeTaskDate(effectiveDateKey, { compact })
    : null;

  return (
    <div
      ref={rowRef}
      className="flex items-center gap-1 mt-0.5 text-[12px] text-stone-500 dark:text-stone-400 tabular-nums leading-tight whitespace-nowrap overflow-hidden"
    >
      {dateInfo && (
        <>
          <span
            title={dateInfo.fullLabel}
            className={`shrink-0 ${
              !isProjected && dateInfo.isOverdue && !task.completed
                ? 'font-medium text-amber-700/80 dark:text-amber-300/75'
                : dateInfo.isToday && !task.completed
                  ? 'font-medium text-stone-700 dark:text-stone-200'
                  : ''
            }`}
          >
            {dateInfo.label}
          </span>
          <span aria-hidden="true" className="shrink-0">
            ·
          </span>
        </>
      )}

      {hasTime && (
        <>
          <span className="shrink-0">
            {formatTimeDisplay(task.timeLabel, timeFormat, { compact })}
          </span>
          <span aria-hidden="true" className="shrink-0">
            ·
          </span>
        </>
      )}

      <span className={compact ? 'truncate min-w-0' : 'shrink-0'}>{task.category}</span>

      {totalSubtasks > 0 && (
        <>
          <span aria-hidden="true" className="shrink-0">
            ·
          </span>
          <span className="shrink-0" title={`${completedSubtasks}/${totalSubtasks} steps`}>
            {compact
              ? `${completedSubtasks}/${totalSubtasks}`
              : `${completedSubtasks}/${totalSubtasks} steps`}
          </span>
        </>
      )}

      {task.priority === 'High' && (
        <>
          <span aria-hidden="true" className="shrink-0">
            ·
          </span>
          <span className={`font-medium shrink-0 ${tokens.accentText}`}>High</span>
        </>
      )}

      {reminderCount > 0 && (
        <>
          <span aria-hidden="true" className="shrink-0">
            ·
          </span>
          <span
            className={`inline-flex items-center gap-0.5 shrink-0 ${tokens.accentText}`}
            title={`${reminderCount} notification${reminderCount > 1 ? 's' : ''}`}
          >
            <Bell className="w-3 h-3" />
            {reminderCount > 1 && <span>{reminderCount}</span>}
          </span>
        </>
      )}

      {task.recurrence && (
        <>
          <span aria-hidden="true" className="shrink-0">
            ·
          </span>
          <span
            className={`inline-flex items-center gap-0.5 font-medium shrink-0 ${tokens.accentText}`}
            title={formatRecurrenceLabel(task.recurrence)}
          >
            <Repeat className="w-3 h-3 shrink-0" />
            <span>{formatRecurrenceLabel(task.recurrence, compact)}</span>
          </span>
        </>
      )}

      {isProjected && (
        <>
          <span aria-hidden="true" className="shrink-0">
            ·
          </span>
          <span className="text-stone-400 dark:text-stone-500 shrink-0" title="Upcoming recurring task">
            {compact ? 'Next' : 'Upcoming'}
          </span>
        </>
      )}

      {task.source === 'google' && (
        <>
          <span aria-hidden="true" className="shrink-0">
            ·
          </span>
          <span
            title={isDirtyGoogle ? 'Google Tasks (unsynced)' : 'Google Tasks'}
            className={`font-medium shrink-0 ${tokens.accentText}`}
          >
            {compact
              ? isDirtyGoogle
                ? 'G*'
                : 'G'
              : isDirtyGoogle
                ? 'Google · Unsynced'
                : 'Google'}
          </span>
        </>
      )}
    </div>
  );
};
