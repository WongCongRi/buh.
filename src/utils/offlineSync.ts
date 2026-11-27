import {
  CalendarEvent,
  GoogleTaskListInfo,
  RecurrenceRule,
  TaskItem,
  TaskPriority,
  TaskReminder,
} from '../types/taskflow';
import type { QuickCheckEntry } from '../components/screens/QuickCheckScreen';

const GOOGLE_CACHE_STORAGE_KEY = 'buh_offline_google_cache_v1';
const LOOKUP_HISTORY_STORAGE_KEY = 'buh_lookup_history_v1';

export type OfflineSyncOp =
  | {
      id: string;
      type: 'gtask-create';
      tempId: string;
      payload: {
        title: string;
        notes?: string;
        dateKey?: string;
        timeLabel?: string;
        priority?: TaskPriority;
        taskListId?: string;
        category?: string;
        reminders?: TaskReminder[];
        recurrence?: RecurrenceRule;
        recurrenceSeriesId?: string;
      };
      createdAt: number;
    }
  | {
      id: string;
      type: 'gtask-update';
      taskId: string;
      task: TaskItem;
      baseTask?: TaskItem;
      createdAt: number;
    }
  | {
      id: string;
      type: 'gtask-delete';
      taskId: string;
      googleTaskId: string;
      googleTaskListId: string;
      createdAt: number;
    }
  | {
      id: string;
      type: 'gcal-create';
      tempId: string;
      payload: {
        title: string;
        dateKey: string;
        endDateKey?: string;
        startTime: string;
        endTime: string;
        calendarName: string;
        recurrence?: RecurrenceRule;
      };
      createdAt: number;
    }
  | {
      id: string;
      type: 'gcal-delete';
      eventId: string;
      googleEventId: string;
      createdAt: number;
    };

export interface OfflineGoogleCache {
  googleEvents: CalendarEvent[];
  googleTasks: TaskItem[];
  googleTaskLists: GoogleTaskListInfo[];
  dirtyGoogleTaskIds: string[];
  googleLastSyncedAt: string | null;
  googleTasksLastSyncedAt: string | null;
  lastGoogleUserEmail: string | null;
  pendingSyncQueue: OfflineSyncOp[];
}

const EMPTY_GOOGLE_CACHE: OfflineGoogleCache = {
  googleEvents: [],
  googleTasks: [],
  googleTaskLists: [],
  dirtyGoogleTaskIds: [],
  googleLastSyncedAt: null,
  googleTasksLastSyncedAt: null,
  lastGoogleUserEmail: null,
  pendingSyncQueue: [],
};

export function loadOfflineGoogleCache(): OfflineGoogleCache {
  try {
    const raw = localStorage.getItem(GOOGLE_CACHE_STORAGE_KEY);
    if (!raw) return EMPTY_GOOGLE_CACHE;
    const parsed = JSON.parse(raw) as Partial<OfflineGoogleCache>;
    return {
      googleEvents: Array.isArray(parsed.googleEvents) ? parsed.googleEvents : [],
      googleTasks: Array.isArray(parsed.googleTasks) ? parsed.googleTasks : [],
      googleTaskLists: Array.isArray(parsed.googleTaskLists) ? parsed.googleTaskLists : [],
      dirtyGoogleTaskIds: Array.isArray(parsed.dirtyGoogleTaskIds) ? parsed.dirtyGoogleTaskIds : [],
      googleLastSyncedAt: typeof parsed.googleLastSyncedAt === 'string' ? parsed.googleLastSyncedAt : null,
      googleTasksLastSyncedAt:
        typeof parsed.googleTasksLastSyncedAt === 'string' ? parsed.googleTasksLastSyncedAt : null,
      lastGoogleUserEmail:
        typeof parsed.lastGoogleUserEmail === 'string' ? parsed.lastGoogleUserEmail : null,
      pendingSyncQueue: Array.isArray(parsed.pendingSyncQueue) ? parsed.pendingSyncQueue : [],
    };
  } catch {
    return EMPTY_GOOGLE_CACHE;
  }
}

export function saveOfflineGoogleCache(cache: OfflineGoogleCache): void {
  try {
    localStorage.setItem(GOOGLE_CACHE_STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // Ignore storage quota issues
  }
}

export function clearOfflineGoogleCache(): void {
  try {
    localStorage.removeItem(GOOGLE_CACHE_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function loadCachedLookupEntries(): QuickCheckEntry[] {
  try {
    const raw = localStorage.getItem(LOOKUP_HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as QuickCheckEntry[]).slice(-30) : [];
  } catch {
    return [];
  }
}

export function saveCachedLookupEntries(entries: QuickCheckEntry[]): void {
  try {
    localStorage.setItem(LOOKUP_HISTORY_STORAGE_KEY, JSON.stringify(entries.slice(-30)));
  } catch {
    // Ignore storage quota issues
  }
}

export function makeSyncOpId(): string {
  return `sync-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

export function enqueueSyncOp(queue: OfflineSyncOp[], op: OfflineSyncOp): OfflineSyncOp[] {
  if (op.type === 'gtask-update') {
    // If this task was created offline and not synced yet, merge updates directly into the create op
    const pendingCreateIdx = queue.findIndex(
      (item) => item.type === 'gtask-create' && item.tempId === op.taskId
    );
    if (pendingCreateIdx !== -1) {
      const existing = queue[pendingCreateIdx];
      if (existing.type === 'gtask-create') {
        const next = [...queue];
        next[pendingCreateIdx] = {
          ...existing,
          payload: {
            ...existing.payload,
            title: op.task.title,
            notes: op.task.notes,
            dateKey: op.task.isInbox ? undefined : op.task.dateKey,
            timeLabel: op.task.timeLabel,
            priority: op.task.priority,
            category: op.task.category,
            reminders: op.task.reminders,
            recurrence: op.task.recurrence,
            recurrenceSeriesId: op.task.recurrenceSeriesId,
          },
        };
        // Also keep a follow-up update if the user completed an offline-created task before syncing
        if (op.task.completed) {
          const withoutDup = next.filter(
            (item) => !(item.type === 'gtask-update' && item.taskId === op.taskId)
          );
          return [...withoutDup, op];
        }
        return next;
      }
    }

    // Replace any earlier pending update for the same task, preserving its original pre-edit baseTask
    const earlierUpdate = queue.find(
      (item): item is Extract<OfflineSyncOp, { type: 'gtask-update' }> =>
        item.type === 'gtask-update' && item.taskId === op.taskId
    );
    const mergedOp: OfflineSyncOp = earlierUpdate?.baseTask
      ? { ...op, baseTask: earlierUpdate.baseTask }
      : op;
    const filtered = queue.filter(
      (item) => !(item.type === 'gtask-update' && item.taskId === op.taskId)
    );
    return [...filtered, mergedOp];
  }

  if (op.type === 'gtask-delete') {
    // If created offline and never sent to Google, simply cancel its queued create + updates
    const hadOfflineCreate = queue.some(
      (item) => item.type === 'gtask-create' && item.tempId === op.taskId
    );
    if (hadOfflineCreate) {
      return queue.filter(
        (item) =>
          !(item.type === 'gtask-create' && item.tempId === op.taskId) &&
          !(item.type === 'gtask-update' && item.taskId === op.taskId)
      );
    }

    // Drop any pending updates for this task and deduplicate delete
    const filtered = queue.filter(
      (item) =>
        !(item.type === 'gtask-update' && item.taskId === op.taskId) &&
        !(item.type === 'gtask-delete' && item.taskId === op.taskId)
    );
    return [...filtered, op];
  }

  if (op.type === 'gcal-delete') {
    const hadOfflineCreate = queue.some(
      (item) => item.type === 'gcal-create' && item.tempId === op.eventId
    );
    if (hadOfflineCreate) {
      return queue.filter(
        (item) => !(item.type === 'gcal-create' && item.tempId === op.eventId)
      );
    }
    const filtered = queue.filter(
      (item) => !(item.type === 'gcal-delete' && item.eventId === op.eventId)
    );
    return [...filtered, op];
  }

  return [...queue, op];
}

export function isNetworkOrOfflineError(err: unknown): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return true;
  }
  if (err instanceof TypeError) {
    return true;
  }
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    return (
      msg.includes('failed to fetch') ||
      msg.includes('networkerror') ||
      msg.includes('network request failed') ||
      msg.includes('load failed') ||
      msg.includes('offline')
    );
  }
  return false;
}

export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.storage && typeof navigator.storage.persist === 'function') {
      const already = await navigator.storage.persisted?.();
      if (already) return true;
      return await navigator.storage.persist();
    }
  } catch {
    // Ignore unsupported browsers
  }
  return false;
}
