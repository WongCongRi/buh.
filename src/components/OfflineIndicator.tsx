import React from 'react';
import { Check, CloudUpload, RefreshCw, WifiOff, X } from 'lucide-react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

interface OfflineIndicatorProps {
  pendingSyncCount?: number;
  isSyncingQueue?: boolean;
  isRefreshingGoogle?: boolean;
  syncNotice?: string | null;
  needsReconnectToSync?: boolean;
  showQuietGoogleRefresh?: boolean;
  reconnectDismissed?: boolean;
  onSyncPending?: () => void;
  onDismissQuietRefresh?: () => void;
}

export const OfflineIndicator: React.FC<OfflineIndicatorProps> = ({
  pendingSyncCount = 0,
  isSyncingQueue = false,
  isRefreshingGoogle = false,
  syncNotice = null,
  needsReconnectToSync = false,
  showQuietGoogleRefresh = false,
  reconnectDismissed = false,
  onSyncPending,
  onDismissQuietRefresh,
}) => {
  const isOnline = useOnlineStatus();

  if (!isOnline) {
    return (
      <div
        role="status"
        className="shrink-0 w-full border-t border-stone-200/80 dark:border-stone-800/80 bg-stone-100/95 dark:bg-[#171A18] px-3 py-1.5 flex items-center justify-center gap-2 text-[12px] font-medium text-stone-700 dark:text-stone-200"
      >
        <WifiOff className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
        <span className="truncate">
          {pendingSyncCount > 0
            ? `Offline · ${pendingSyncCount} Google change${pendingSyncCount === 1 ? '' : 's'} queued`
            : 'Offline · Saved locally'}
        </span>
      </div>
    );
  }

  if (isSyncingQueue || isRefreshingGoogle) {
    return (
      <div
        role="status"
        className="shrink-0 w-full border-t border-stone-200/80 dark:border-stone-800/80 bg-stone-100/95 dark:bg-[#171A18] px-3 py-1.5 flex items-center justify-center gap-2 text-[12px] font-medium text-stone-700 dark:text-stone-200"
      >
        <RefreshCw className="w-3.5 h-3.5 animate-spin shrink-0 text-stone-500 dark:text-stone-400" />
        <span className="truncate">
          {pendingSyncCount > 0
            ? `Syncing ${pendingSyncCount} Google change${pendingSyncCount === 1 ? '' : 's'}...`
            : 'Refreshing Google Calendar & Tasks...'}
        </span>
      </div>
    );
  }

  if (pendingSyncCount > 0 && needsReconnectToSync && !reconnectDismissed && onSyncPending) {
    return (
      <div
        role="status"
        className="shrink-0 w-full border-t border-stone-200/80 dark:border-stone-800/80 bg-stone-100/95 dark:bg-[#171A18] px-3 py-1.5 flex items-center justify-between gap-2 text-[12px] font-medium text-stone-800 dark:text-stone-100"
      >
        <button
          type="button"
          onClick={onSyncPending}
          className="flex-1 min-w-0 inline-flex items-center justify-center gap-1.5 hover:opacity-80 transition-opacity"
        >
          <CloudUpload className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
          <span className="truncate">
            Tap to sync {pendingSyncCount} Google change{pendingSyncCount === 1 ? '' : 's'}
          </span>
        </button>
        {onDismissQuietRefresh && (
          <button
            type="button"
            onClick={onDismissQuietRefresh}
            aria-label="Dismiss sync banner"
            className="p-1 rounded-md text-stone-400 hover:text-stone-700 dark:text-stone-500 dark:hover:text-stone-200 transition-colors shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    );
  }

  if (syncNotice) {
    return (
      <div
        role="status"
        className="shrink-0 w-full border-t border-stone-200/80 dark:border-stone-800/80 bg-stone-100/95 dark:bg-[#171A18] px-3 py-1.5 flex items-center justify-center gap-2 text-[12px] font-medium text-stone-700 dark:text-stone-200"
      >
        <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
        <span className="truncate">{syncNotice}</span>
      </div>
    );
  }

  if (showQuietGoogleRefresh && needsReconnectToSync && onSyncPending) {
    return (
      <div
        role="status"
        className="shrink-0 w-full border-t border-stone-200/80 dark:border-stone-800/80 bg-stone-100/95 dark:bg-[#171A18] px-3 py-1.5 flex items-center justify-between gap-2 text-[12px] font-medium text-stone-700 dark:text-stone-200"
      >
        <button
          type="button"
          onClick={onSyncPending}
          className="flex-1 min-w-0 inline-flex items-center justify-center gap-1.5 hover:opacity-80 transition-opacity"
        >
          <RefreshCw className="w-3.5 h-3.5 shrink-0 text-stone-500 dark:text-stone-400" />
          <span className="truncate">Google sync paused · Tap to refresh</span>
        </button>
        {onDismissQuietRefresh && (
          <button
            type="button"
            onClick={onDismissQuietRefresh}
            aria-label="Dismiss Google refresh banner"
            className="p-1 rounded-md text-stone-400 hover:text-stone-700 dark:text-stone-500 dark:hover:text-stone-200 transition-colors shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    );
  }

  return null;
};
