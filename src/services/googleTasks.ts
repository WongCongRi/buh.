import { getTodayDateKey } from '../data/initialData';
import { GoogleTaskListInfo, SubTask, TaskItem, TaskPriority } from '../types/taskflow';
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
  return { dateKey: getTodayDateKey(), hasDue: false };
}

function mapDateKeyToGoogleDue(dateKey?: string): string | undefined {
  if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return undefined;
  return `${dateKey}T00:00:00.000Z`;
}

function mapSingleGoogleTask(
  item: GoogleApiTask,
  list: GoogleTaskListInfo,
  subtasks: SubTask[] = []
): TaskItem | null {
  if (!item.id || item.deleted) return null;
  const { dateKey, hasDue } = mapDueToDateKey(item.due);

  return {
    id: `gtask-${list.id}-${item.id}`,
    title: item.title?.trim() || '(Untitled task)',
    timeLabel: 'No time set',
    dateKey,
    category: list.title,
    priority: 'Normal',
    completed: item.status === 'completed',
    completedAt: item.status === 'completed' ? item.completed || undefined : undefined,
    isInbox: !hasDue,
    notes: item.notes?.trim() || '',
    subtasks,
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
  if (input.notes?.trim()) {
    body.notes = input.notes.trim();
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
    notes: task.notes || '',
    status: task.completed ? 'completed' : 'needsAction',
    completed: task.completed ? new Date().toISOString() : null,
  };

  if (!task.isInbox) {
    const due = mapDateKeyToGoogleDue(task.dateKey);
    if (due) body.due = due;
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
