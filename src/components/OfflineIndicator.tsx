import React from 'react';
import { Check, CloudUpload, RefreshCw, WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

interface OfflineIndicatorProps {
  pendingSyncCount?: number;
  isSyncingQueue?: boolean;
  syncNotice?: string | null;
  needsReconnectToSync?: boolean;
  onSyncPending?: () => void;
}

export const OfflineIndicator: React.FC<OfflineIndicatorProps> = ({
  pendingSyncCount = 0,
  isSyncingQueue = false,
  syncNotice = null,
  needsReconnectToSync = false,
  onSyncPending,
}) => {
  const isOnline = useOnlineStatus();

  if (!isOnline) {
    return (
      <div
        role="status"
        className="fixed bottom-3 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-xl bg-stone-900/95 dark:bg-stone-100/95 px-3 py-1.5 text-[11px] font-medium text-white dark:text-stone-900 shadow-lg border border-stone-700/60 dark:border-stone-300/60 whitespace-nowrap"
      >
        <WifiOff className="w-3.5 h-3.5 text-amber-400 dark:text-amber-600 shrink-0" />
        <span>
          {pendingSyncCount > 0
            ? `Offline · ${pendingSyncCount} change${pendingSyncCount === 1 ? '' : 's'} queued to sync`
            : 'Offline · Tasks & notes saved locally'}
        </span>
      </div>
    );
  }

  if (isSyncingQueue) {
    return (
      <div
        role="status"
        className="fixed bottom-3 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-xl bg-stone-900/95 dark:bg-stone-100/95 px-3 py-1.5 text-[11px] font-medium text-white dark:text-stone-900 shadow-lg border border-stone-700/60 dark:border-stone-300/60 whitespace-nowrap"
      >
        <RefreshCw className="w-3.5 h-3.5 animate-spin shrink-0" />
        <span>
          Back online · Syncing {pendingSyncCount > 0 ? pendingSyncCount : ''} offline change
          {pendingSyncCount === 1 ? '' : 's'}...
        </span>
      </div>
    );
  }

  if (pendingSyncCount > 0 && needsReconnectToSync && onSyncPending) {
    return (
      <button
        type="button"
        onClick={onSyncPending}
        className="fixed bottom-3 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-xl bg-stone-900/95 dark:bg-stone-100/95 px-3 py-1.5 text-[11px] font-medium text-white dark:text-stone-900 shadow-lg border border-stone-700/60 dark:border-stone-300/60 hover:opacity-95 transition-opacity whitespace-nowrap"
      >
        <CloudUpload className="w-3.5 h-3.5 shrink-0" />
        <span>
          Back online · Tap to sync {pendingSyncCount} offline change
          {pendingSyncCount === 1 ? '' : 's'}
        </span>
      </button>
    );
  }

  if (syncNotice) {
    return (
      <div
        role="status"
        className="fixed bottom-3 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-xl bg-stone-900/95 dark:bg-stone-100/95 px-3 py-1.5 text-[11px] font-medium text-white dark:text-stone-900 shadow-lg border border-stone-700/60 dark:border-stone-300/60 whitespace-nowrap"
      >
        <Check className="w-3.5 h-3.5 text-emerald-400 dark:text-emerald-600 shrink-0" />
        <span>{syncNotice}</span>
      </div>
    );
  }

  return null;
};
