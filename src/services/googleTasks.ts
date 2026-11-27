import { getTodayDateKey } from '../data/initialData';
import {
  GoogleTaskListInfo,
  RecurrenceRule,
  SubTask,
  TaskItem,
  TaskPriority,
  TaskReminder,
} from '../types/taskflow';
import {
  formatRecurrenceLabel,
  parseGoogleRRule,
  toGoogleCalendarRRule,
} from '../utils/recurrence';
import { formatTimeDisplay, getActiveTimeFormat } from '../utils/timeFormat';
import { clearCachedGoogleAccessToken, getCalendarAccessToken } from './googleCalendar';

const TASKS_API_BASE = 'https://tasks.googleapis.com/tasks/v1';

interface GoogleApiTaskList {
  id?: string;
  title?: string;
}

interface GoogleApiTask {
  id?: string;
  title?: string;
  notes?: string;
  status?: 'needsAction' | 'completed';
  due?: string;
  completed?: string;
  parent?: string;
  deleted?: boolean;
  hidden?: boolean;
  position?: string;
}

function getTokenOrThrow(tokenOverride?: string): string {
  const token = tokenOverride || getCalendarAccessToken();
  if (!token) {
    throw new Error('NOT_AUTHENTICATED');
  }
  return token;
}

function handleAuthFailureStatus(status: number): void {
  if (status === 401 || status === 403) {
    clearCachedGoogleAccessToken();
    throw new Error('AUTH_EXPIRED');
  }
}

function mapDueToDateKey(due?: string): { dateKey: string; hasDue: boolean } {
  if (due && /^\d{4}-\d{2}-\d{2}/.test(due)) {
    return { dateKey: due.slice(0, 10), hasDue: true };
  }
  return { dateKey: '', hasDue: false };
}

function formatHoursMinutesTo12h(hours24: number, minutes: number): string {
  const meridiem = hours24 >= 12 ? 'PM' : 'AM';
  const h12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return `${String(h12).padStart(2, '0')}:${String(minutes).padStart(2, '0')} ${meridiem}`;
}

function extractTimeFromGoogleDue(due?: string): string | undefined {
  if (!due) return undefined;
  // Google Tasks REST API normally zeroes time to T00:00:00.000Z; only parse if non-midnight
  if (/T00:00:00(?:\.000)?Z$/i.test(due.trim())) return undefined;
  const parsed = new Date(due);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return formatHoursMinutesTo12h(parsed.getHours(), parsed.getMinutes());
}

const INLINE_TIME_12H_RE =
  /(?:^|[\s(@-])(?:at\s+)?(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(am|pm)(?=$|[\s).,!?-])/i;
const INLINE_TIME_24H_RE =
  /(?:^|[\s(@-])(?:(?:at\s+|@)([01]?\d|2[0-3]):([0-5]\d)|(0\d|1[3-9]|2[0-3]):([0-5]\d))(?=$|[\s).,!?-])/i;

export function extractClockTimeFromText(text?: string): string | undefined {
  if (!text) return undefined;
  const m12 = text.match(INLINE_TIME_12H_RE);
  if (m12) {
    let hours = parseInt(m12[1], 10);
    const minutes = m12[2] ? parseInt(m12[2], 10) : 0;
    const meridiem = m12[3].toUpperCase();
    if (meridiem === 'PM' && hours < 12) hours += 12;
    if (meridiem === 'AM' && hours === 12) hours = 0;
    return formatHoursMinutesTo12h(hours, minutes);
  }
  const m24 = text.match(INLINE_TIME_24H_RE);
  if (m24) {
    const hStr = m24[1] ?? m24[3];
    const minStr = m24[2] ?? m24[4];
    if (hStr !== undefined && minStr !== undefined) {
      return formatHoursMinutesTo12h(parseInt(hStr, 10), parseInt(minStr, 10));
    }
  }
  return undefined;
}

export function buildDefaultGoogleTaskReminders(task: {
  id: string;
  googleTaskId?: string;
  completed: boolean;
  isInbox?: boolean;
  dateKey: string;
  recurrence?: RecurrenceRule;
  reminders?: TaskReminder[];
}): TaskReminder[] | undefined {
  // Respect existing custom reminders or explicit user removal (`[]`)
  if (task.reminders !== undefined) return task.reminders;
  if (task.completed) return undefined;
  if (task.isInbox && !task.recurrence) return undefined;
  // Avoid spamming notifications for undated or old overdue tasks from previous days
  if (!task.dateKey || task.dateKey < getTodayDateKey()) return undefined;

  return [
    {
      id: `gtask-due-${task.googleTaskId || task.id}`,
      mode: 'relative',
      offsetMinutes: 0,
    },
  ];
}

function mapDateKeyToGoogleDue(dateKey?: string): string | undefined {
  if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return undefined;
  return `${dateKey}T00:00:00.000Z`;
}

const META_TIME_LINE_RE = /^(?:⏰\s*)?(?:Due\s+)?Time:\s*(.+)$/i;
const META_REPEAT_LINE_RE = /^(?:↻\s*)?Repeat:\s*(.+)$/i;
const META_NOTIFY_LINE_RE = /^(?:🔔\s*)?Notify:\s*(.+)$/i;

function normalizeParsedTimeLabel(raw: string): string | null {
  const s = raw.trim();
  if (!s || /^no time set$/i.test(s)) return null;
  if (/^full$/i.test(s)) return 'Full';

  const m12 = s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (m12) {
    const h = parseInt(m12[1], 10);
    const min = parseInt(m12[2], 10);
    if (h >= 1 && h <= 12 && min >= 0 && min <= 59) {
      return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')} ${m12[3].toUpperCase()}`;
    }
  }

  const m24 = s.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (m24) {
    const h24 = parseInt(m24[1], 10);
    const min = parseInt(m24[2], 10);
    const meridiem = h24 >= 12 ? 'PM' : 'AM';
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    return `${String(h12).padStart(2, '0')}:${String(min).padStart(2, '0')} ${meridiem}`;
  }

  return null;
}

function formatGoogleTaskReminderToken(rem: TaskReminder): string | null {
  if (rem.mode === 'exact') {
    if (!rem.dateKey || !rem.time24) return null;
    return `${rem.dateKey} ${rem.time24}`;
  }
  const offset = typeof rem.offsetMinutes === 'number' && Number.isFinite(rem.offsetMinutes)
    ? Math.max(0, Math.round(rem.offsetMinutes))
    : 0;
  if (offset <= 0) return 'At time';
  if (offset % 10080 === 0) return `${offset / 10080}w before`;
  if (offset % 1440 === 0) return `${offset / 1440}d before`;
  if (offset % 60 === 0) return `${offset / 60}h before`;
  return `${offset}m before`;
}

function parseGoogleTaskRemindersLine(raw: string, googleTaskId?: string): TaskReminder[] | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (/^(?:none|off)$/i.test(trimmed)) return [];

  const tokens = trimmed
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (tokens.length === 0) return undefined;

  const idPrefix = (googleTaskId || 'task').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48);
  const seen = new Set<string>();
  const parsed: TaskReminder[] = [];

  for (const token of tokens) {
    if (/^at\s+time$/i.test(token)) {
      const key = 'rel:0';
      if (!seen.has(key)) {
        seen.add(key);
        parsed.push({
          id: `gtask-due-${idPrefix}`,
          mode: 'relative',
          offsetMinutes: 0,
        });
      }
      continue;
    }

    const relMatch = token.match(/^(\d+)\s*(m|h|d|w)\s*before$/i);
    if (relMatch) {
      const amt = parseInt(relMatch[1], 10);
      const unit = relMatch[2].toLowerCase();
      const mult = unit === 'w' ? 10080 : unit === 'd' ? 1440 : unit === 'h' ? 60 : 1;
      const offsetMinutes = Math.max(0, Math.min(525600, amt * mult));
      const key = `rel:${offsetMinutes}`;
      if (!seen.has(key)) {
        seen.add(key);
        parsed.push({
          id: `gtask-rem-${idPrefix}-rel-${offsetMinutes}`,
          mode: 'relative',
          offsetMinutes,
        });
      }
      continue;
    }

    const exactMatch = token.match(/^(\d{4}-\d{2}-\d{2})\s+([01]?\d|2[0-3]):([0-5]\d)$/);
    if (exactMatch) {
      const dateKey = exactMatch[1];
      const time24 = `${exactMatch[2].padStart(2, '0')}:${exactMatch[3]}`;
      const key = `exact:${dateKey}:${time24}`;
      if (!seen.has(key)) {
        seen.add(key);
        parsed.push({
          id: `gtask-rem-${idPrefix}-ex-${dateKey.replace(/-/g, '')}-${time24.replace(':', '')}`,
          mode: 'exact',
          dateKey,
          time24,
        });
      }
    }
  }

  return parsed.length > 0 ? parsed : undefined;
}

function extractTaskMetaFromNotes(
  rawNotes?: string,
  googleTaskId?: string
): {
  cleanNotes: string;
  timeLabel?: string;
  recurrence?: RecurrenceRule;
  reminders?: TaskReminder[];
} {
  if (!rawNotes) return { cleanNotes: '' };
  const lines = rawNotes.replace(/\r\n/g, '\n').split('\n');
  let timeLabel: string | undefined;
  let recurrence: RecurrenceRule | undefined;
  let reminders: TaskReminder[] | undefined;
  const keptLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    const timeMatch = trimmed.match(META_TIME_LINE_RE);
    if (timeMatch) {
      const parsed = normalizeParsedTimeLabel(timeMatch[1]);
      if (parsed) {
        timeLabel = parsed;
        continue;
      }
    }

    const repeatMatch = trimmed.match(META_REPEAT_LINE_RE);
    if (repeatMatch) {
      const rruleBracket = repeatMatch[1].match(/\[(RRULE:[^\]]+)\]/i);
      if (rruleBracket) {
        const parsedRule = parseGoogleRRule([rruleBracket[1]]);
        if (parsedRule) {
          recurrence = parsedRule;
          continue;
        }
      }
    }

    const notifyMatch = trimmed.match(META_NOTIFY_LINE_RE);
    if (notifyMatch) {
      const parsedReminders = parseGoogleTaskRemindersLine(notifyMatch[1], googleTaskId);
      if (parsedReminders !== undefined) {
        reminders = parsedReminders;
        continue;
      }
    }

    keptLines.push(line);
  }

  const cleanNotes = keptLines.join('\n').trim();
  return { cleanNotes, timeLabel, recurrence, reminders };
}

function composeGoogleTaskNotes(
  userNotes?: string,
  timeLabel?: string,
  recurrence?: RecurrenceRule,
  reminders?: TaskReminder[]
): string {
  const { cleanNotes } = extractTaskMetaFromNotes(userNotes);
  const metaLines: string[] = [];

  const normalizedTime = timeLabel ? normalizeParsedTimeLabel(timeLabel) : null;
  if (normalizedTime && normalizedTime !== 'Full') {
    metaLines.push(`⏰ Time: ${formatTimeDisplay(normalizedTime, getActiveTimeFormat())}`);
  }

  if (recurrence) {
    const rrule = toGoogleCalendarRRule(recurrence);
    if (rrule) {
      metaLines.push(`↻ Repeat: ${formatRecurrenceLabel(recurrence)} [${rrule}]`);
    }
  }

  if (Array.isArray(reminders)) {
    if (reminders.length > 0) {
      const tokens = Array.from(
        new Set(
          reminders
            .map(formatGoogleTaskReminderToken)
            .filter((tok): tok is string => Boolean(tok))
        )
      );
      if (tokens.length > 0) {
        metaLines.push(`🔔 Notify: ${tokens.join(', ')}`);
      }
    } else {
      // Explicitly persist user removal of all reminders so background sync does not re-add defaults
      metaLines.push('🔔 Notify: None');
    }
  }

  if (metaLines.length === 0) return cleanNotes;
  if (!cleanNotes) return metaLines.join('\n');
  return `${cleanNotes}\n\n${metaLines.join('\n')}`;
}

export function mapSingleGoogleTask(
  item: GoogleApiTask,
  list: GoogleTaskListInfo,
  subtasks: SubTask[] = []
): TaskItem | null {
  if (!item.id || item.deleted) return null;
  const { dateKey: rawDateKey, hasDue } = mapDueToDateKey(item.due);
  const { cleanNotes, timeLabel, recurrence, reminders: parsedReminders } = extractTaskMetaFromNotes(
    item.notes,
    item.id
  );
  const title = item.title?.trim() || '(Untitled task)';
  const inferredTimeLabel =
    timeLabel ||
    extractTimeFromGoogleDue(item.due) ||
    extractClockTimeFromText(title) ||
    extractClockTimeFromText(cleanNotes);
  const id = `gtask-${list.id}-${item.id}`;
  const completed = item.status === 'completed';
  const isInbox = !hasDue && !recurrence;
  const dateKey = hasDue ? rawDateKey : recurrence ? getTodayDateKey() : '';
  const resolvedReminders =
    parsedReminders !== undefined
      ? parsedReminders
      : buildDefaultGoogleTaskReminders({
          id,
          googleTaskId: item.id,
          completed,
          isInbox,
          dateKey,
          recurrence,
        });

  return {
    id,
    title,
    timeLabel: inferredTimeLabel || 'No time set',
    dateKey,
    category: list.title,
    priority: 'Normal',
    completed,
    completedAt: completed ? item.completed || undefined : undefined,
    isInbox,
    notes: cleanNotes,
    subtasks,
    ...(resolvedReminders !== undefined ? { reminders: resolvedReminders } : {}),
    ...(recurrence ? { recurrence } : {}),
    source: 'google',
    googleTaskId: item.id,
    googleTaskListId: list.id,
    googleTaskListTitle: list.title,
  };
}

export async function fetchGoogleTasks(tokenOverride?: string): Promise<{
  tasks: TaskItem[];
  taskLists: GoogleTaskListInfo[];
}> {
  const token = getTokenOrThrow(tokenOverride);

  const listsResp = await fetch(`${TASKS_API_BASE}/users/@me/lists?maxResults=50`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  handleAuthFailureStatus(listsResp.status);

  if (!listsResp.ok) {
    const errText = await listsResp.text().catch(() => '');
    throw new Error(
      `Google Tasks sync failed (${listsResp.status})${errText ? `: ${errText.slice(0, 140)}` : ''}`
    );
  }

  const listsJson = (await listsResp.json()) as { items?: GoogleApiTaskList[] };
  const taskLists: GoogleTaskListInfo[] = (listsJson.items ?? [])
    .filter((l): l is { id: string; title?: string } => Boolean(l.id))
    .map((l) => ({
      id: l.id,
      title: l.title?.trim() || 'My Tasks',
    }));

  const allTasks: TaskItem[] = [];

  await Promise.all(
    taskLists.map(async (list) => {
      const url = new URL(`${TASKS_API_BASE}/lists/${encodeURIComponent(list.id)}/tasks`);
      url.searchParams.set('showCompleted', 'true');
      url.searchParams.set('showHidden', 'true');
      url.searchParams.set('maxResults', '100');

      const resp = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      handleAuthFailureStatus(resp.status);
      if (!resp.ok) return;

      const data = (await resp.json()) as { items?: GoogleApiTask[] };
      const rawItems = (data.items ?? []).filter((t) => Boolean(t.id) && !t.deleted);

      // Group child items (Google Tasks subtasks) under their parent task
      const childrenByParent = new Map<string, SubTask[]>();
      for (const item of rawItems) {
        if (item.parent && item.id) {
          const listForParent = childrenByParent.get(item.parent) ?? [];
          listForParent.push({
            id: `gsub-${item.id}`,
            title: item.title?.trim() || '(Untitled subtask)',
            done: item.status === 'completed',
          });
          childrenByParent.set(item.parent, listForParent);
        }
      }

      for (const item of rawItems) {
        if (item.parent) continue;
        const mapped = mapSingleGoogleTask(
          item,
          list,
          item.id ? childrenByParent.get(item.id) ?? [] : []
        );
        if (mapped) {
          allTasks.push(mapped);
        }
      }
    })
  );

  return { tasks: allTasks, taskLists };
}

export async function createGoogleTask(
  input: {
    title: string;
    notes?: string;
    dateKey?: string;
    timeLabel?: string;
    priority?: TaskPriority;
    taskListId?: string;
    taskListTitle?: string;
    recurrence?: RecurrenceRule;
    reminders?: TaskReminder[];
  },
  tokenOverride?: string
): Promise<TaskItem> {
  const token = getTokenOrThrow(tokenOverride);
  const targetListId = input.taskListId || '@default';
  const targetListTitle = input.taskListTitle || 'My Tasks';

  const body: Record<string, unknown> = {
    title: input.title,
    status: 'needsAction',
  };
  const composedNotes = composeGoogleTaskNotes(
    input.notes,
    input.timeLabel,
    input.recurrence,
    input.reminders
  );
  if (composedNotes) {
    body.notes = composedNotes;
  }
  const due = mapDateKeyToGoogleDue(input.dateKey);
  if (due) {
    body.due = due;
  }

  const resp = await fetch(`${TASKS_API_BASE}/lists/${encodeURIComponent(targetListId)}/tasks`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  handleAuthFailureStatus(resp.status);

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(
      `Could not create Google Task (${resp.status})${errText ? `: ${errText.slice(0, 120)}` : ''}`
    );
  }

  const created = (await resp.json()) as GoogleApiTask;
  const mapped = mapSingleGoogleTask(created, { id: targetListId, title: targetListTitle });
  if (!mapped) {
    throw new Error('Google Tasks returned an invalid task response.');
  }
  return {
    ...mapped,
    timeLabel: input.timeLabel || mapped.timeLabel,
    priority: input.priority || mapped.priority,
    recurrence: input.recurrence ?? mapped.recurrence,
    ...(input.reminders !== undefined ? { reminders: input.reminders } : {}),
  };
}

export async function updateGoogleTask(
  task: TaskItem,
  tokenOverride?: string
): Promise<TaskItem> {
  const token = getTokenOrThrow(tokenOverride);
  if (!task.googleTaskId) {
    throw new Error('Missing Google Task ID.');
  }

  const listId = task.googleTaskListId || '@default';
  const listTitle = task.googleTaskListTitle || task.category || 'My Tasks';

  const body: Record<string, unknown> = {
    title: task.title.trim() || '(Untitled task)',
    notes: composeGoogleTaskNotes(task.notes, task.timeLabel, task.recurrence, task.reminders),
    status: task.completed ? 'completed' : 'needsAction',
    completed: task.completed ? task.completedAt || new Date().toISOString() : null,
  };

  if (!task.isInbox && task.dateKey) {
    const due = mapDateKeyToGoogleDue(task.dateKey);
    if (due) body.due = due;
  } else {
    body.due = null;
  }

  const resp = await fetch(
    `${TASKS_API_BASE}/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(task.googleTaskId)}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }
  );

  handleAuthFailureStatus(resp.status);

  if (resp.status === 404 || resp.status === 410) {
    throw new Error('TASK_NOT_FOUND');
  }

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(
      `Could not update Google Task (${resp.status})${errText ? `: ${errText.slice(0, 120)}` : ''}`
    );
  }

  const updated = (await resp.json()) as GoogleApiTask;
  const mapped = mapSingleGoogleTask(updated, { id: listId, title: listTitle }, task.subtasks);
  if (!mapped) {
    throw new Error('Google Tasks returned an invalid update response.');
  }

  return {
    ...mapped,
    id: task.id,
    timeLabel: task.timeLabel,
    priority: task.priority,
    recurrence: task.recurrence,
    reminders: task.reminders,
  };
}

export async function deleteGoogleTask(
  googleTaskListId: string,
  googleTaskId: string,
  tokenOverride?: string
): Promise<void> {
  const token = getTokenOrThrow(tokenOverride);
  const listId = googleTaskListId || '@default';

  const resp = await fetch(
    `${TASKS_API_BASE}/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(googleTaskId)}`,
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  handleAuthFailureStatus(resp.status);

  if (!resp.ok && resp.status !== 204 && resp.status !== 410) {
    throw new Error(`Could not delete Google Task (${resp.status})`);
  }
}
