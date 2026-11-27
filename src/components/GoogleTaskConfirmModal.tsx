import React from 'react';
import { CheckSquare, Loader2, RefreshCw, Repeat, Trash2, X } from 'lucide-react';
import { TaskItem } from '../types/taskflow';
import { formatDDMMYYYY } from '../utils/dateLabels';
import { formatRecurrenceLabel } from '../utils/recurrence';
import { formatTimeDisplay, useTimeFormat } from '../utils/timeFormat';
import { StyleThemeTokens } from '../utils/themeTokens';
import { useBackLayer } from '../hooks/useAndroidBackNavigation';

export type PendingGoogleTaskMutation =
  | {
      action: 'create';
      task: TaskItem;
      targetListId: string;
      targetListTitle: string;
    }
  | {
      action: 'toggle';
      task: TaskItem;
      nextCompleted: boolean;
    }
  | {
      action: 'update';
      task: TaskItem;
    }
  | {
      action: 'delete';
      task: TaskItem;
    };

interface GoogleTaskConfirmModalProps {
  pending: PendingGoogleTaskMutation | null;
  tokens: StyleThemeTokens;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  onSaveLocalOnly?: () => void;
}

export const GoogleTaskConfirmModal: React.FC<GoogleTaskConfirmModalProps> = ({
  pending,
  tokens,
  busy,
  onCancel,
  onConfirm,
  onSaveLocalOnly,
}) => {
  const timeFormat = useTimeFormat();
  useBackLayer(
    Boolean(pending),
    () => {
      if (busy) return false;
      onCancel();
    },
    30
  );

  if (!pending) return null;

  const isDelete = pending.action === 'delete';
  const isCreate = pending.action === 'create';
  const isToggle = pending.action === 'toggle';

  const heading = isDelete
    ? 'Delete from Google Tasks?'
    : isCreate
      ? 'Add to Google Tasks?'
      : isToggle
        ? pending.nextCompleted
          ? 'Mark completed in Google Tasks?'
          : 'Reopen in Google Tasks?'
        : 'Update in Google Tasks?';

  const description = isDelete
    ? 'This will permanently delete this task from your Google Tasks list.'
    : isCreate
      ? `Confirm to create this task directly in your "${pending.targetListTitle}" Google Tasks list.`
      : isToggle
        ? pending.nextCompleted
          ? 'Confirm to mark this task as completed in your Google Tasks account.'
          : 'Confirm to mark this task as active again in your Google Tasks account.'
        : 'Confirm to save your edited title, notes, and due date to Google Tasks.';

  const confirmLabel = isDelete
    ? 'Delete from Google Tasks'
    : isCreate
      ? 'Add to Google Tasks'
      : isToggle
        ? pending.nextCompleted
          ? 'Mark completed'
          : 'Mark incomplete'
        : 'Save to Google Tasks';

  const listLabel = isCreate
    ? pending.targetListTitle
    : pending.task.googleTaskListTitle || pending.task.category;

  return (
    <div
      className="absolute inset-0 z-50 bg-black/45 backdrop-blur-[1px] flex items-center justify-center p-4"
      onClick={() => {
        if (!busy) onCancel();
      }}
    >
      <div
        className={`w-full max-w-xs ${tokens.cardBg} ${tokens.cardRadius} p-4 shadow-2xl space-y-3`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            {isDelete ? (
              <Trash2 className="w-4 h-4 text-rose-500 shrink-0" />
            ) : pending.action === 'update' ? (
              <RefreshCw className={`w-4 h-4 shrink-0 ${tokens.accentText}`} />
            ) : (
              <CheckSquare className={`w-4 h-4 shrink-0 ${tokens.accentText}`} />
            )}
            <h3 className="font-display text-xs font-semibold text-stone-900 dark:text-stone-100">
              {heading}
            </h3>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            aria-label="Cancel Google Tasks action"
            className="p-0.5 text-stone-400 hover:text-stone-700 dark:hover:text-stone-200"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className={`px-2.5 py-2 ${tokens.subtleBg} ${tokens.buttonRadius} space-y-0.5`}>
          <p className="text-xs font-semibold text-stone-900 dark:text-stone-100 break-words">
            {pending.task.title}
          </p>
          <p className="text-[11px] font-mono-tabular text-stone-500 dark:text-stone-400">
            {listLabel}
            {!pending.task.isInbox && pending.task.dateKey
              ? ` · ${formatDDMMYYYY(pending.task.dateKey)}`
              : ''}
            {pending.task.timeLabel && pending.task.timeLabel !== 'No time set'
              ? ` · ${formatTimeDisplay(pending.task.timeLabel, timeFormat)}`
              : ''}
          </p>
          {pending.task.recurrence && (
            <p className={`inline-flex items-center gap-1 text-[11px] font-medium ${tokens.accentText} pt-0.5`}>
              <Repeat className="w-3 h-3 shrink-0" />
              {formatRecurrenceLabel(pending.task.recurrence)}
            </p>
          )}
        </div>

        <p className="text-[11px] text-stone-600 dark:text-stone-300 leading-relaxed">
          {description}
        </p>

        <div className="flex flex-col gap-1.5 pt-1">
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className={`w-full inline-flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium ${tokens.buttonRadius} transition-opacity disabled:opacity-60 ${
              isDelete
                ? 'bg-rose-600 text-white hover:bg-rose-700'
                : `${tokens.accentBg} hover:opacity-90`
            }`}
          >
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {confirmLabel}
          </button>

          {isCreate && onSaveLocalOnly && (
            <button
              type="button"
              disabled={busy}
              onClick={onSaveLocalOnly}
              className={`w-full py-1.5 text-[11px] font-medium ${tokens.subtleBg} text-stone-700 dark:text-stone-200 ${tokens.buttonRadius} hover:opacity-90`}
            >
              Save locally in buh. only
            </button>
          )}

          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="w-full py-1 text-[11px] text-stone-500 hover:text-stone-800 dark:hover:text-stone-200"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};
