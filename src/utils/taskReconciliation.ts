import { RecurrenceRule, SubTask, TaskItem, TaskReminder } from '../types/taskflow';

const CLOUD_TASK_JOURNAL_KEY = 'buh_cloud_task_journal_v1';

export interface DirtyCloudTaskRecord {
  task: TaskItem;
  baseTask?: TaskItem;
  editedAt: number;
}

export interface OfflineCloudTaskJournal {
  upserts: Record<string, DirtyCloudTaskRecord>;
  deletes: Record<string, number>;
}

const EMPTY_JOURNAL: OfflineCloudTaskJournal = {
  upserts: {},
  deletes: {},
};

export function loadCloudTaskJournal(): OfflineCloudTaskJournal {
  try {
    const raw = localStorage.getItem(CLOUD_TASK_JOURNAL_KEY);
    if (!raw) return { upserts: {}, deletes: {} };
    const parsed = JSON.parse(raw) as Partial<OfflineCloudTaskJournal>;
    const upserts =
      parsed.upserts && typeof parsed.upserts === 'object' && !Array.isArray(parsed.upserts)
        ? (parsed.upserts as Record<string, DirtyCloudTaskRecord>)
        : {};
    const deletes =
      parsed.deletes && typeof parsed.deletes === 'object' && !Array.isArray(parsed.deletes)
        ? (parsed.deletes as Record<string, number>)
        : {};
    return { upserts: { ...upserts }, deletes: { ...deletes } };
  } catch {
    return { ...EMPTY_JOURNAL, upserts: {}, deletes: {} };
  }
}

export function saveCloudTaskJournal(journal: OfflineCloudTaskJournal): void {
  try {
    localStorage.setItem(CLOUD_TASK_JOURNAL_KEY, JSON.stringify(journal));
  } catch {
    // Ignore storage quota errors
  }
}

export function clearCloudTaskJournal(): void {
  try {
    localStorage.removeItem(CLOUD_TASK_JOURNAL_KEY);
  } catch {
    // ignore
  }
}

function stableJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function mergeFieldOfflinePriority<T>(
  localVal: T,
  remoteVal: T,
  baseVal: T | undefined,
  hasBase: boolean
): T {
  const localJson = stableJson(localVal);
  const remoteJson = stableJson(remoteVal);
  if (localJson === remoteJson) return localVal;

  if (!hasBase) {
    // No common ancestor: always prioritize the offline/local edit
    return localVal;
  }

  const baseJson = stableJson(baseVal);
  const localChanged = localJson !== baseJson;
  const remoteChanged = remoteJson !== baseJson;

  if (localChanged) {
    // Local edited this field (even if remote also edited it): offline edit wins silently
    return localVal;
  }
  if (remoteChanged) {
    // Only remote changed this field while local left it untouched: merge remote silently
    return remoteVal;
  }
  return localVal;
}

function mergeSubtasksOfflinePriority(
  localSubtasks: SubTask[],
  remoteSubtasks: SubTask[],
  baseSubtasks: SubTask[] | undefined
): SubTask[] {
  if (!baseSubtasks) {
    return localSubtasks;
  }

  const baseById = new Map(baseSubtasks.map((s) => [s.id, s]));
  const localById = new Map(localSubtasks.map((s) => [s.id, s]));
  const remoteById = new Map(remoteSubtasks.map((s) => [s.id, s]));

  const merged: SubTask[] = [];
  const seen = new Set<string>();

  // 1. Keep all local subtasks (preserving local order & prioritizing local edits on conflict)
  for (const localSub of localSubtasks) {
    seen.add(localSub.id);
    const remoteSub = remoteById.get(localSub.id);
    const baseSub = baseById.get(localSub.id);
    if (!remoteSub) {
      // Added locally or deleted remotely while still present locally -> keep if added locally or edited locally
      const deletedRemotely = Boolean(baseSub);
      const editedLocally =
        !baseSub || baseSub.title !== localSub.title || baseSub.done !== localSub.done;
      if (!deletedRemotely || editedLocally) {
        merged.push(localSub);
      }
      continue;
    }

    const hasBase = Boolean(baseSub);
    merged.push({
      id: localSub.id,
      title: mergeFieldOfflinePriority(localSub.title, remoteSub.title, baseSub?.title, hasBase),
      done: mergeFieldOfflinePriority(localSub.done, remoteSub.done, baseSub?.done, hasBase),
    });
  }

  // 2. Append any brand-new subtasks added remotely (not present in base and not already in local)
  for (const remoteSub of remoteSubtasks) {
    if (seen.has(remoteSub.id)) continue;
    const existedInBase = baseById.has(remoteSub.id);
    if (!existedInBase) {
      merged.push(remoteSub);
    }
    // If existedInBase && !localById.has(id), it was intentionally deleted locally -> keep deleted
    void localById;
  }

  return merged;
}

function reminderSemanticKey(rem: TaskReminder): string {
  if (rem.mode === 'exact') {
    return `exact:${rem.dateKey || ''}:${rem.time24 || ''}`;
  }
  return `rel:${typeof rem.offsetMinutes === 'number' ? rem.offsetMinutes : 0}`;
}

function mergeRemindersOfflinePriority(
  localReminders: TaskReminder[] | undefined,
  remoteReminders: TaskReminder[] | undefined,
  baseReminders: TaskReminder[] | undefined,
  hasBase: boolean
): TaskReminder[] | undefined {
  if (localReminders === undefined && remoteReminders === undefined) return undefined;

  const localList = localReminders ?? [];
  const remoteList = remoteReminders ?? [];

  if (!hasBase) {
    if (localReminders === undefined) return remoteReminders;
    // Preserve firedAt timestamps from remote if matching reminder already fired on another device
    const remoteFiredByKey = new Map<string, number>();
    for (const r of remoteList) {
      if (typeof r.firedAt === 'number') {
        remoteFiredByKey.set(reminderSemanticKey(r), r.firedAt);
      }
    }
    return localList.map((r) => {
      const remoteFired = remoteFiredByKey.get(reminderSemanticKey(r));
      if (typeof remoteFired === 'number' && r.firedAt === undefined) {
        return { ...r, firedAt: remoteFired };
      }
      return r;
    });
  }

  const baseList = baseReminders ?? [];
  const stripFired = (list: TaskReminder[]) =>
    list.map(({ firedAt: _f, ...rest }) => ({
      mode: rest.mode,
      offsetMinutes: rest.offsetMinutes,
      dateKey: rest.dateKey,
      time24: rest.time24,
    }));

  const localSpecChanged = stableJson(stripFired(localList)) !== stableJson(stripFired(baseList));
  const remoteSpecChanged = stableJson(stripFired(remoteList)) !== stableJson(stripFired(baseList));

  const chosen = localSpecChanged
    ? localList
    : remoteSpecChanged
      ? remoteList
      : localList;

  // Merge firedAt monotonically across devices when the same reminder spec survived
  const otherList = chosen === localList ? remoteList : localList;
  const otherFiredByKey = new Map<string, number>();
  for (const r of otherList) {
    if (typeof r.firedAt === 'number') {
      const key = reminderSemanticKey(r);
      const prev = otherFiredByKey.get(key);
      if (prev === undefined || r.firedAt > prev) {
        otherFiredByKey.set(key, r.firedAt);
      }
    }
  }

  return chosen.map((r) => {
    const key = reminderSemanticKey(r);
    const otherFired = otherFiredByKey.get(key);
    // Do not restore an old firedAt onto a freshly re-armed reminder if local explicitly cleared firedAt
    const baseMatch = baseList.find((b) => reminderSemanticKey(b) === key);
    const localClearedFired =
      chosen === localList &&
      r.firedAt === undefined &&
      Boolean(baseMatch?.firedAt);
    if (!localClearedFired && typeof otherFired === 'number') {
      if (r.firedAt === undefined || otherFired > r.firedAt) {
        return { ...r, firedAt: otherFired };
      }
    }
    return r;
  });
}

function normalizeRecurrence(r: RecurrenceRule | undefined): RecurrenceRule | undefined {
  return r ? { ...r, ...(r.daysOfWeek ? { daysOfWeek: [...r.daysOfWeek] } : {}) } : undefined;
}

/**
 * Performs a silent, zero-prompt 3-way merge of a local (offline-edited) TaskItem
 * against an incoming remote TaskItem during background reconciliation.
 *
 * Rules:
 * - Non-conflicting edits from both sides are merged cleanly at the field/subtask level.
 * - Whenever both sides modified the same field, the offline/local edit wins silently.
 * - When no common ancestor (baseTask) is known, the offline/local task takes priority.
 */
export function mergeTaskItemOfflinePriority(
  localTask: TaskItem,
  remoteTask: TaskItem,
  baseTask?: TaskItem
): TaskItem {
  const hasBase = Boolean(baseTask);

  const completed = mergeFieldOfflinePriority(
    localTask.completed,
    remoteTask.completed,
    baseTask?.completed,
    hasBase
  );

  let completedAt: string | undefined;
  if (completed) {
    completedAt =
      mergeFieldOfflinePriority(
        localTask.completedAt,
        remoteTask.completedAt,
        baseTask?.completedAt,
        hasBase
      ) ||
      localTask.completedAt ||
      remoteTask.completedAt ||
      new Date().toISOString();
  }

  const isInbox = mergeFieldOfflinePriority(
    localTask.isInbox,
    remoteTask.isInbox,
    baseTask?.isInbox,
    hasBase
  );
  const dateKey = mergeFieldOfflinePriority(
    localTask.dateKey,
    remoteTask.dateKey,
    baseTask?.dateKey,
    hasBase
  );
  const timeLabel = mergeFieldOfflinePriority(
    localTask.timeLabel,
    remoteTask.timeLabel,
    baseTask?.timeLabel,
    hasBase
  );
  const recurrence = normalizeRecurrence(
    mergeFieldOfflinePriority(
      localTask.recurrence,
      remoteTask.recurrence,
      baseTask?.recurrence,
      hasBase
    )
  );
  const recurrenceSeriesId = mergeFieldOfflinePriority(
    localTask.recurrenceSeriesId,
    remoteTask.recurrenceSeriesId,
    baseTask?.recurrenceSeriesId,
    hasBase
  );

  const reminders = mergeRemindersOfflinePriority(
    localTask.reminders,
    remoteTask.reminders,
    baseTask?.reminders,
    hasBase
  );

  return {
    ...remoteTask,
    ...localTask,
    id: localTask.id,
    title: mergeFieldOfflinePriority(localTask.title, remoteTask.title, baseTask?.title, hasBase),
    timeLabel,
    dateKey: isInbox && !recurrence ? '' : dateKey,
    category: mergeFieldOfflinePriority(
      localTask.category,
      remoteTask.category,
      baseTask?.category,
      hasBase
    ),
    priority: mergeFieldOfflinePriority(
      localTask.priority,
      remoteTask.priority,
      baseTask?.priority,
      hasBase
    ),
    completed,
    completedAt,
    isInbox,
    notes: mergeFieldOfflinePriority(localTask.notes, remoteTask.notes, baseTask?.notes, hasBase),
    subtasks: mergeSubtasksOfflinePriority(
      localTask.subtasks ?? [],
      remoteTask.subtasks ?? [],
      baseTask?.subtasks
    ),
    ...(reminders !== undefined ? { reminders } : { reminders: undefined }),
    ...(recurrence ? { recurrence } : { recurrence: undefined }),
    ...(recurrenceSeriesId ? { recurrenceSeriesId } : { recurrenceSeriesId: undefined }),
    source: localTask.source ?? remoteTask.source ?? 'local',
    googleTaskId: localTask.googleTaskId ?? remoteTask.googleTaskId,
    googleTaskListId: localTask.googleTaskListId ?? remoteTask.googleTaskListId,
    googleTaskListTitle: localTask.googleTaskListTitle ?? remoteTask.googleTaskListTitle,
  };
}

/**
 * Silent reconciliation specifically tuned for Google Tasks:
 * preserves local-only buh. metadata (priority, reminders, recurrenceSeriesId)
 * while applying 3-way offline-priority merge on shared Google Tasks fields.
 */
export function mergeGoogleTaskOfflinePriority(
  localTask: TaskItem,
  remoteTask: TaskItem,
  baseTask?: TaskItem
): TaskItem {
  const merged = mergeTaskItemOfflinePriority(localTask, remoteTask, baseTask);
  return {
    ...merged,
    // Priority is buh.-only (Google Tasks REST API does not persist priority)
    priority: localTask.priority,
    // Preserve Google linkage from remote if local was an offline placeholder
    source: 'google',
    googleTaskId: remoteTask.googleTaskId || localTask.googleTaskId,
    googleTaskListId: remoteTask.googleTaskListId || localTask.googleTaskListId,
    googleTaskListTitle: remoteTask.googleTaskListTitle || localTask.googleTaskListTitle,
    category: remoteTask.googleTaskListTitle || merged.category,
  };
}
