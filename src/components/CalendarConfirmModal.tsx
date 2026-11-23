import React from 'react';
import { Calendar, Loader2, Trash2, X } from 'lucide-react';
import { StyleThemeTokens } from '../utils/themeTokens';

export type PendingCalendarMutation =
  | {
      action: 'create';
      title: string;
      dateKey: string;
      startTime: string;
      endTime: string;
      calendarName: string;
    }
  | {
      action: 'delete';
      eventId: string;
      googleEventId: string;
      title: string;
      dateKey: string;
      startTime: string;
    };

interface CalendarConfirmModalProps {
  pending: PendingCalendarMutation | null;
  tokens: StyleThemeTokens;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  onSaveLocalOnly?: () => void;
}

export const CalendarConfirmModal: React.FC<CalendarConfirmModalProps> = ({
  pending,
  tokens,
  busy,
  onCancel,
  onConfirm,
  onSaveLocalOnly,
}) => {
  if (!pending) return null;

  const isDelete = pending.action === 'delete';

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
            ) : (
              <Calendar className={`w-4 h-4 shrink-0 ${tokens.accentText}`} />
            )}
            <h3 className="font-display text-xs font-semibold text-stone-900 dark:text-stone-100">
              {isDelete ? 'Delete from Google Calendar?' : 'Add to Google Calendar?'}
            </h3>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            aria-label="Cancel calendar action"
            className="p-0.5 text-stone-400 hover:text-stone-700 dark:hover:text-stone-200"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className={`px-2.5 py-2 ${tokens.subtleBg} ${tokens.buttonRadius} space-y-0.5`}>
          <p className="text-xs font-semibold text-stone-900 dark:text-stone-100 break-words">
            {pending.title}
          </p>
          <p className="text-[11px] font-mono-tabular text-stone-500 dark:text-stone-400">
            {pending.dateKey} · {pending.startTime}
            {!isDelete ? ` – ${pending.endTime}` : ''}
          </p>
        </div>

        <p className="text-[11px] text-stone-600 dark:text-stone-300 leading-relaxed">
          {isDelete
            ? 'This will permanently remove this event from your primary Google Calendar.'
            : 'Confirm to create this scheduled block directly on your primary Google Calendar.'}
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
            {isDelete ? 'Delete from Google Calendar' : 'Add to Google Calendar'}
          </button>

          {!isDelete && onSaveLocalOnly && (
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
