import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  Unsubscribe,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  AppSettingsState,
  CalendarEvent,
  DefaultHome,
  DesignDecisions,
  NavMode,
  QuickCaptureMode,
  RecurrenceFrequency,
  RecurrenceRule,
  SubTask,
  TaskItem,
  TaskPriority,
  TaskReminder,
  TimeFormat,
  VisualStyle,
} from '../types/taskflow';
import { sanitizeCloudId, sanitizeFoldersForCloud } from './cloudNotesSync';
import type {
  QuickCheckEntry,
  QuickCheckMedia,
  QuickCheckSource,
} from '../components/screens/QuickCheckScreen';

// Blueprint-synchronized constants (verbatim match with firebase-blueprint.json & firestore.rules)
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const MAX_TITLE_LEN = 300;
const MAX_TIME_LABEL_LEN = 40;
const MAX_DATE_KEY_LEN = 20;
const MAX_CATEGORY_LEN = 100;
const MAX_NOTES_LEN = 10000;
const MAX_SUBTASKS = 100;
const MAX_REMINDERS = 20;
const MAX_RECENT_COLORS = 12;
const MAX_LOCATION_LEN = 300;
const MAX_CLOCK_LEN = 10;
const MAX_LOOKUP_PROMPT_LEN = 2000;
const MAX_LOOKUP_ANSWER_LEN = 40000;
const MAX_LOOKUP_SOURCES = 30;
const MAX_LOOKUP_MEDIA = 20;
const MAX_LOOKUP_QUERIES = 20;
const MAX_LOOKUP_URL_LEN = 2000;
const MAX_LOOKUP_TIMESTAMP_LEN = 60;
const MAX_LOOKUP_SOURCE_NAME_LEN = 200;
const MAX_LOOKUP_MIME_LEN = 100;

const VALID_PRIORITIES = new Set<TaskPriority>(['High', 'Normal', 'Low']);
const VALID_FREQUENCIES = new Set<RecurrenceFrequency>(['daily', 'weekly', 'monthly', 'yearly']);
const VALID_VISUAL_STYLES = new Set<VisualStyle>([
  VisualStyle.Minimal,
  VisualStyle.Samsung,
  VisualStyle.Professional,
]);
const VALID_NAV_MODES = new Set<NavMode>([NavMode.Five, NavMode.Four]);
const VALID_QUICK_CAPTURE = new Set<QuickCaptureMode>([
  QuickCaptureMode.Fab,
  QuickCaptureMode.Bar,
  QuickCaptureMode.Both,
]);
const VALID_DEFAULT_HOMES = new Set<DefaultHome>([
  DefaultHome.Today,
  DefaultHome.Inbox,
  DefaultHome.Dashboard,
]);

export interface CloudWorkspacePreferencesData {
  taskLists: string[];
  settings: Required<
    Pick<
      AppSettingsState,
      | 'hingeAwareSplit'
      | 'oneHandedCoverReach'
      | 'googleCalendarSync'
      | 'googleTasksSync'
      | 'buhCloudSync'
      | 'nlpQuickParse'
      | 'morningDigestTime'
      | 'taskRemindersEnabled'
      | 'reminderSound'
      | 'completedTaskHistoryYears'
      | 'completedTaskHistoryMonths'
      | 'timeFormat'
    >
  >;
  decisions: DesignDecisions;
  recentColors: string[];
  darkMode: boolean;
}

interface CloudTaskDoc {
  id: string;
  ownerId: string;
  title: string;
  timeLabel: string;
  dateKey: string;
  category: string;
  priority: TaskPriority;
  completed: boolean;
  completedAt?: string;
  isInbox: boolean;
  notes: string;
  subtasks: SubTask[];
  reminders: TaskReminder[];
  recurrence?: RecurrenceRule;
  recurrenceSeriesId?: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

interface CloudEventDoc {
  id: string;
  ownerId: string;
  title: string;
  dateKey: string;
  endDateKey?: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  calendarName: string;
  location?: string;
  linkedTaskId?: string;
  recurrence?: RecurrenceRule;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

function sanitizeHexColor(raw: unknown, fallback = '#C7DFF1'): string {
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (HEX_COLOR_PATTERN.test(trimmed)) return trimmed.toUpperCase();
  }
  return fallback;
}

function sanitizeRecurrenceForCloud(raw: RecurrenceRule | undefined): RecurrenceRule | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const frequency: RecurrenceFrequency = VALID_FREQUENCIES.has(raw.frequency)
    ? raw.frequency
    : 'daily';
  const intervalNum =
    typeof raw.interval === 'number' && Number.isFinite(raw.interval)
      ? Math.max(1, Math.min(365, Math.round(raw.interval)))
      : 1;

  const clean: RecurrenceRule = {
    frequency,
    interval: intervalNum,
  };

  if (Array.isArray(raw.daysOfWeek) && raw.daysOfWeek.length > 0) {
    const days = Array.from(
      new Set(
        raw.daysOfWeek
          .filter((d): d is number => typeof d === 'number' && Number.isInteger(d) && d >= 0 && d <= 6)
      )
    )
      .sort((a, b) => a - b)
      .slice(0, 7);
    if (days.length > 0) {
      clean.daysOfWeek = days;
    }
  }

  if (typeof raw.endDateKey === 'string' && raw.endDateKey.trim().length > 0) {
    clean.endDateKey = raw.endDateKey.trim().slice(0, MAX_DATE_KEY_LEN);
  }

  return clean;
}

function sanitizeSubTaskForCloud(st: SubTask, idx: number): SubTask {
  return {
    id: sanitizeCloudId(st?.id || `st-${idx + 1}`, `st-${idx + 1}`),
    title: (typeof st?.title === 'string' ? st.title : '').slice(0, MAX_TITLE_LEN),
    done: Boolean(st?.done),
  };
}

function sanitizeReminderForCloud(rem: TaskReminder, idx: number): TaskReminder {
  const mode: TaskReminder['mode'] = rem?.mode === 'exact' ? 'exact' : 'relative';
  const clean: TaskReminder = {
    id: sanitizeCloudId(rem?.id || `rem-${idx + 1}`, `rem-${idx + 1}`),
    mode,
  };
  if (typeof rem?.offsetMinutes === 'number' && Number.isFinite(rem.offsetMinutes)) {
    clean.offsetMinutes = Math.max(0, Math.min(525600, Math.round(rem.offsetMinutes)));
  }
  if (typeof rem?.dateKey === 'string' && rem.dateKey.trim().length > 0) {
    clean.dateKey = rem.dateKey.trim().slice(0, MAX_DATE_KEY_LEN);
  }
  if (typeof rem?.time24 === 'string' && rem.time24.trim().length > 0) {
    clean.time24 = rem.time24.trim().slice(0, MAX_CLOCK_LEN);
  }
  if (typeof rem?.firedAt === 'number' && Number.isFinite(rem.firedAt)) {
    clean.firedAt = rem.firedAt;
  }
  return clean;
}

export function sanitizeWorkspacePreferencesForCloud(input: {
  taskLists: string[];
  settings: AppSettingsState;
  decisions: DesignDecisions;
  recentColors: string[];
  darkMode: boolean;
}): CloudWorkspacePreferencesData {
  const taskLists = sanitizeFoldersForCloud(input.taskLists);
  const s = input.settings;
  const d = input.decisions;
  const timeFormat: TimeFormat = s.timeFormat === '12h' ? '12h' : '24h';
  const years =
    typeof s.completedTaskHistoryYears === 'number' && Number.isFinite(s.completedTaskHistoryYears)
      ? Math.max(0, Math.min(100, Math.round(s.completedTaskHistoryYears)))
      : 0;
  const months =
    typeof s.completedTaskHistoryMonths === 'number' && Number.isFinite(s.completedTaskHistoryMonths)
      ? Math.max(0, Math.min(11, Math.round(s.completedTaskHistoryMonths)))
      : 0;

  const recentColors = Array.from(
    new Set(
      (Array.isArray(input.recentColors) ? input.recentColors : [])
        .map((c) => (typeof c === 'string' ? c.trim().toUpperCase() : ''))
        .filter((c) => HEX_COLOR_PATTERN.test(c))
    )
  ).slice(0, MAX_RECENT_COLORS);

  return {
    taskLists,
    settings: {
      hingeAwareSplit: Boolean(s.hingeAwareSplit),
      oneHandedCoverReach: Boolean(s.oneHandedCoverReach),
      googleCalendarSync: Boolean(s.googleCalendarSync),
      googleTasksSync: Boolean(s.googleTasksSync),
      buhCloudSync: s.buhCloudSync !== false,
      nlpQuickParse: Boolean(s.nlpQuickParse),
      morningDigestTime: (typeof s.morningDigestTime === 'string'
        ? s.morningDigestTime.trim()
        : '08:00 AM'
      ).slice(0, 20),
      taskRemindersEnabled: Boolean(s.taskRemindersEnabled),
      reminderSound: Boolean(s.reminderSound),
      completedTaskHistoryYears: years,
      completedTaskHistoryMonths: months,
      timeFormat,
    },
    decisions: {
      visualStyle: VALID_VISUAL_STYLES.has(d.visualStyle) ? d.visualStyle : VisualStyle.Minimal,
      navMode: VALID_NAV_MODES.has(d.navMode) ? d.navMode : NavMode.Five,
      quickCapture: VALID_QUICK_CAPTURE.has(d.quickCapture) ? d.quickCapture : QuickCaptureMode.Fab,
      defaultHome: VALID_DEFAULT_HOMES.has(d.defaultHome) ? d.defaultHome : DefaultHome.Dashboard,
      accentColor: sanitizeHexColor(d.accentColor),
    },
    recentColors,
    darkMode: Boolean(input.darkMode),
  };
}

export function fingerprintWorkspacePreferences(prefs: {
  taskLists: string[];
  settings: AppSettingsState;
  decisions: DesignDecisions;
  recentColors: string[];
  darkMode: boolean;
}): string {
  return JSON.stringify(sanitizeWorkspacePreferencesForCloud(prefs));
}

function sanitizeTaskPayload(
  task: TaskItem,
  ownerId: string
): Omit<CloudTaskDoc, 'createdAt' | 'updatedAt'> {
  const safeId = sanitizeCloudId(task.id, 't');
  const priority: TaskPriority = VALID_PRIORITIES.has(task.priority) ? task.priority : 'Normal';
  const category = (typeof task.category === 'string' ? task.category.trim() : '')
    .slice(0, MAX_CATEGORY_LEN) || 'Personal';

  const base: Omit<CloudTaskDoc, 'createdAt' | 'updatedAt'> = {
    id: safeId,
    ownerId,
    title: (typeof task.title === 'string' ? task.title : '').slice(0, MAX_TITLE_LEN),
    timeLabel: (typeof task.timeLabel === 'string' ? task.timeLabel : 'No time set').slice(
      0,
      MAX_TIME_LABEL_LEN
    ),
    dateKey: (typeof task.dateKey === 'string' ? task.dateKey.trim() : '').slice(
      0,
      MAX_DATE_KEY_LEN
    ),
    category,
    priority,
    completed: Boolean(task.completed),
    isInbox: Boolean(task.isInbox),
    notes: (typeof task.notes === 'string' ? task.notes : '').slice(0, MAX_NOTES_LEN),
    subtasks: (Array.isArray(task.subtasks) ? task.subtasks : [])
      .slice(0, MAX_SUBTASKS)
      .map((st, idx) => sanitizeSubTaskForCloud(st, idx)),
    reminders: (Array.isArray(task.reminders) ? task.reminders : [])
      .slice(0, MAX_REMINDERS)
      .map((r, idx) => sanitizeReminderForCloud(r, idx)),
  };

  if (typeof task.completedAt === 'string' && task.completedAt.trim().length > 0) {
    base.completedAt = task.completedAt.trim().slice(0, 40);
  }
  const recurrence = sanitizeRecurrenceForCloud(task.recurrence);
  if (recurrence) {
    base.recurrence = recurrence;
  }
  if (typeof task.recurrenceSeriesId === 'string' && task.recurrenceSeriesId.trim().length > 0) {
    base.recurrenceSeriesId = sanitizeCloudId(task.recurrenceSeriesId, 'series');
  }

  return base;
}

export function fingerprintCloudTask(task: TaskItem): string {
  const clean = sanitizeTaskPayload(task, 'u');
  const { ownerId: _ignored, ...rest } = clean;
  return JSON.stringify(rest);
}

function mapCloudDocToTaskItem(data: Partial<CloudTaskDoc>, docId: string): TaskItem | null {
  const id = typeof data.id === 'string' && data.id.trim() ? data.id : docId;
  if (!id) return null;
  const priority: TaskPriority =
    data.priority && VALID_PRIORITIES.has(data.priority) ? data.priority : 'Normal';

  return {
    id,
    title: typeof data.title === 'string' ? data.title : '',
    timeLabel: typeof data.timeLabel === 'string' ? data.timeLabel : 'No time set',
    dateKey: typeof data.dateKey === 'string' ? data.dateKey : '',
    category:
      typeof data.category === 'string' && data.category.trim() ? data.category.trim() : 'Personal',
    priority,
    completed: Boolean(data.completed),
    completedAt:
      typeof data.completedAt === 'string' && data.completedAt.trim()
        ? data.completedAt.trim()
        : undefined,
    isInbox: Boolean(data.isInbox),
    notes: typeof data.notes === 'string' ? data.notes : '',
    subtasks: (Array.isArray(data.subtasks) ? data.subtasks : []).map((st, i) =>
      sanitizeSubTaskForCloud(st, i)
    ),
    reminders: (Array.isArray(data.reminders) ? data.reminders : []).map((rem, i) =>
      sanitizeReminderForCloud(rem, i)
    ),
    recurrence: sanitizeRecurrenceForCloud(data.recurrence),
    recurrenceSeriesId:
      typeof data.recurrenceSeriesId === 'string' && data.recurrenceSeriesId.trim()
        ? data.recurrenceSeriesId.trim()
        : undefined,
    source: 'local',
  };
}

function sanitizeEventPayload(
  ev: CalendarEvent,
  ownerId: string
): Omit<CloudEventDoc, 'createdAt' | 'updatedAt'> {
  const safeId = sanitizeCloudId(ev.id, 'ev');
  const durationMinutes =
    typeof ev.durationMinutes === 'number' && Number.isFinite(ev.durationMinutes)
      ? Math.max(1, Math.min(10080, Math.round(ev.durationMinutes)))
      : 60;

  const base: Omit<CloudEventDoc, 'createdAt' | 'updatedAt'> = {
    id: safeId,
    ownerId,
    title: (typeof ev.title === 'string' ? ev.title : '').slice(0, MAX_TITLE_LEN),
    dateKey: (typeof ev.dateKey === 'string' ? ev.dateKey.trim() : '').slice(0, MAX_DATE_KEY_LEN),
    startTime: (typeof ev.startTime === 'string' ? ev.startTime.trim() : '09:00').slice(
      0,
      MAX_CLOCK_LEN
    ),
    endTime: (typeof ev.endTime === 'string' ? ev.endTime.trim() : '10:00').slice(
      0,
      MAX_CLOCK_LEN
    ),
    durationMinutes,
    calendarName:
      (typeof ev.calendarName === 'string' ? ev.calendarName.trim() : '').slice(
        0,
        MAX_CATEGORY_LEN
      ) || 'Work',
  };

  if (typeof ev.endDateKey === 'string' && ev.endDateKey.trim().length > 0) {
    base.endDateKey = ev.endDateKey.trim().slice(0, MAX_DATE_KEY_LEN);
  }
  if (typeof ev.location === 'string' && ev.location.trim().length > 0) {
    base.location = ev.location.trim().slice(0, MAX_LOCATION_LEN);
  }
  if (typeof ev.linkedTaskId === 'string' && ev.linkedTaskId.trim().length > 0) {
    base.linkedTaskId = sanitizeCloudId(ev.linkedTaskId, 't');
  }
  const recurrence = sanitizeRecurrenceForCloud(ev.recurrence);
  if (recurrence) {
    base.recurrence = recurrence;
  }

  return base;
}

export function fingerprintCloudEvent(ev: CalendarEvent): string {
  const clean = sanitizeEventPayload(ev, 'u');
  const { ownerId: _ignored, ...rest } = clean;
  return JSON.stringify(rest);
}

function mapCloudDocToCalendarEvent(
  data: Partial<CloudEventDoc>,
  docId: string
): CalendarEvent | null {
  const id = typeof data.id === 'string' && data.id.trim() ? data.id : docId;
  if (!id) return null;
  const durationMinutes =
    typeof data.durationMinutes === 'number' && Number.isFinite(data.durationMinutes)
      ? Math.max(1, Math.min(10080, Math.round(data.durationMinutes)))
      : 60;

  return {
    id,
    title: typeof data.title === 'string' ? data.title : '',
    dateKey: typeof data.dateKey === 'string' ? data.dateKey : '',
    endDateKey:
      typeof data.endDateKey === 'string' && data.endDateKey.trim()
        ? data.endDateKey.trim()
        : undefined,
    startTime: typeof data.startTime === 'string' ? data.startTime : '09:00',
    endTime: typeof data.endTime === 'string' ? data.endTime : '10:00',
    durationMinutes,
    calendarName:
      typeof data.calendarName === 'string' && data.calendarName.trim()
        ? data.calendarName.trim()
        : 'Work',
    location:
      typeof data.location === 'string' && data.location.trim()
        ? data.location.trim()
        : undefined,
    linkedTaskId:
      typeof data.linkedTaskId === 'string' && data.linkedTaskId.trim()
        ? data.linkedTaskId.trim()
        : undefined,
    recurrence: sanitizeRecurrenceForCloud(data.recurrence),
    source: 'local',
  };
}

export async function saveCloudWorkspacePreferences(
  uid: string,
  prefs: {
    taskLists: string[];
    settings: AppSettingsState;
    decisions: DesignDecisions;
    recentColors: string[];
    darkMode: boolean;
  }
): Promise<void> {
  const safe = sanitizeWorkspacePreferencesForCloud(prefs);
  const path = `users/${uid}/preferences/workspace`;
  const ref = doc(db, 'users', uid, 'preferences', 'workspace');

  try {
    const existingSnap = await getDoc(ref);
    if (existingSnap.exists()) {
      await updateDoc(ref, {
        taskLists: safe.taskLists,
        settings: safe.settings,
        decisions: safe.decisions,
        recentColors: safe.recentColors,
        darkMode: safe.darkMode,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(ref, {
        ownerId: uid,
        ...safe,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export function subscribeCloudWorkspacePreferences(
  uid: string,
  onData: (prefs: CloudWorkspacePreferencesData | null) => void,
  onError: (err: Error) => void
): Unsubscribe {
  const path = `users/${uid}/preferences/workspace`;
  const ref = doc(db, 'users', uid, 'preferences', 'workspace');

  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        onData(null);
        return;
      }
      const data = snap.data() as Partial<CloudWorkspacePreferencesData>;
      const normalized = sanitizeWorkspacePreferencesForCloud({
        taskLists: Array.isArray(data.taskLists) ? data.taskLists : [],
        settings: (data.settings ?? {}) as AppSettingsState,
        decisions: (data.decisions ?? {}) as DesignDecisions,
        recentColors: Array.isArray(data.recentColors) ? data.recentColors : [],
        darkMode: Boolean(data.darkMode),
      });
      onData(normalized);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, path);
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export async function upsertCloudTask(uid: string, task: TaskItem): Promise<void> {
  if (task.source === 'google') return;
  const payload = sanitizeTaskPayload(task, uid);
  const path = `users/${uid}/tasks/${payload.id}`;
  const ref = doc(db, 'users', uid, 'tasks', payload.id);

  try {
    const existingSnap = await getDoc(ref);
    if (existingSnap.exists()) {
      const updatePatch: Record<string, unknown> = {
        title: payload.title,
        timeLabel: payload.timeLabel,
        dateKey: payload.dateKey,
        category: payload.category,
        priority: payload.priority,
        completed: payload.completed,
        completedAt: payload.completedAt !== undefined ? payload.completedAt : deleteField(),
        isInbox: payload.isInbox,
        notes: payload.notes,
        subtasks: payload.subtasks,
        reminders: payload.reminders,
        recurrence: payload.recurrence !== undefined ? payload.recurrence : deleteField(),
        recurrenceSeriesId:
          payload.recurrenceSeriesId !== undefined ? payload.recurrenceSeriesId : deleteField(),
        updatedAt: serverTimestamp(),
      };
      await updateDoc(ref, updatePatch);
    } else {
      await setDoc(ref, {
        ...payload,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteCloudTask(uid: string, taskId: string): Promise<void> {
  const safeId = sanitizeCloudId(taskId, 't');
  const path = `users/${uid}/tasks/${safeId}`;
  const ref = doc(db, 'users', uid, 'tasks', safeId);

  try {
    await deleteDoc(ref);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export function subscribeCloudTasks(
  uid: string,
  onData: (tasks: TaskItem[]) => void,
  onError: (err: Error) => void
): Unsubscribe {
  const path = `users/${uid}/tasks`;
  const tasksQuery = query(collection(db, 'users', uid, 'tasks'), where('ownerId', '==', uid));

  return onSnapshot(
    tasksQuery,
    (snapshot) => {
      const records: { task: TaskItem; sortMs: number }[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data() as Partial<CloudTaskDoc>;
        const mapped = mapCloudDocToTaskItem(data, docSnap.id);
        if (mapped) {
          const ts = data.createdAt ?? data.updatedAt;
          const sortMs = ts && typeof ts.toMillis === 'function' ? ts.toMillis() : 0;
          records.push({ task: mapped, sortMs });
        }
      });
      records.sort((a, b) => b.sortMs - a.sortMs);
      onData(records.map((r) => r.task));
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export async function fetchAllCloudTasksOnce(uid: string): Promise<TaskItem[]> {
  const path = `users/${uid}/tasks`;
  const tasksQuery = query(collection(db, 'users', uid, 'tasks'), where('ownerId', '==', uid));
  try {
    const snapshot = await getDocs(tasksQuery);
    const items: TaskItem[] = [];
    snapshot.forEach((docSnap) => {
      const mapped = mapCloudDocToTaskItem(docSnap.data() as Partial<CloudTaskDoc>, docSnap.id);
      if (mapped) items.push(mapped);
    });
    return items;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function upsertCloudEvent(uid: string, ev: CalendarEvent): Promise<void> {
  if (ev.source === 'google') return;
  const payload = sanitizeEventPayload(ev, uid);
  const path = `users/${uid}/events/${payload.id}`;
  const ref = doc(db, 'users', uid, 'events', payload.id);

  try {
    const existingSnap = await getDoc(ref);
    if (existingSnap.exists()) {
      const updatePatch: Record<string, unknown> = {
        title: payload.title,
        dateKey: payload.dateKey,
        endDateKey: payload.endDateKey !== undefined ? payload.endDateKey : deleteField(),
        startTime: payload.startTime,
        endTime: payload.endTime,
        durationMinutes: payload.durationMinutes,
        calendarName: payload.calendarName,
        location: payload.location !== undefined ? payload.location : deleteField(),
        linkedTaskId: payload.linkedTaskId !== undefined ? payload.linkedTaskId : deleteField(),
        recurrence: payload.recurrence !== undefined ? payload.recurrence : deleteField(),
        updatedAt: serverTimestamp(),
      };
      await updateDoc(ref, updatePatch);
    } else {
      await setDoc(ref, {
        ...payload,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteCloudEvent(uid: string, eventId: string): Promise<void> {
  const safeId = sanitizeCloudId(eventId, 'ev');
  const path = `users/${uid}/events/${safeId}`;
  const ref = doc(db, 'users', uid, 'events', safeId);

  try {
    await deleteDoc(ref);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export function subscribeCloudEvents(
  uid: string,
  onData: (events: CalendarEvent[]) => void,
  onError: (err: Error) => void
): Unsubscribe {
  const path = `users/${uid}/events`;
  const eventsQuery = query(collection(db, 'users', uid, 'events'), where('ownerId', '==', uid));

  return onSnapshot(
    eventsQuery,
    (snapshot) => {
      const items: CalendarEvent[] = [];
      snapshot.forEach((docSnap) => {
        const mapped = mapCloudDocToCalendarEvent(
          docSnap.data() as Partial<CloudEventDoc>,
          docSnap.id
        );
        if (mapped) items.push(mapped);
      });
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export async function fetchAllCloudEventsOnce(uid: string): Promise<CalendarEvent[]> {
  const path = `users/${uid}/events`;
  const eventsQuery = query(collection(db, 'users', uid, 'events'), where('ownerId', '==', uid));
  try {
    const snapshot = await getDocs(eventsQuery);
    const items: CalendarEvent[] = [];
    snapshot.forEach((docSnap) => {
      const mapped = mapCloudDocToCalendarEvent(
        docSnap.data() as Partial<CloudEventDoc>,
        docSnap.id
      );
      if (mapped) items.push(mapped);
    });
    return items;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

interface CloudLookupEntryDoc {
  id: string;
  ownerId: string;
  prompt: string;
  answer: string;
  sources: QuickCheckSource[];
  media: QuickCheckMedia[];
  webSearchQueries: string[];
  timestamp: string;
  usedAgenda: boolean;
  savedTask?: boolean;
  savedTaskId?: string;
  savedNote?: boolean;
  savedNoteId?: string;
  orderMs: number;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

function extractOrderMsFromLookupId(id: string): number {
  const m = id.match(/(\d{12,15})/);
  if (m) {
    const parsed = Number(m[1]);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return Date.now();
}

function sanitizeLookupSource(src: QuickCheckSource): QuickCheckSource | null {
  if (!src || typeof src !== 'object') return null;
  const uri = typeof src.uri === 'string' ? src.uri.trim().slice(0, MAX_LOOKUP_URL_LEN) : '';
  if (!uri) return null;
  const title = (typeof src.title === 'string' ? src.title.trim() : '').slice(0, MAX_TITLE_LEN);
  return { title, uri };
}

function sanitizeLookupMedia(item: QuickCheckMedia, idx: number): QuickCheckMedia | null {
  if (!item || typeof item !== 'object') return null;
  const rawUrl = typeof item.url === 'string' ? item.url.trim() : '';
  if (!rawUrl || rawUrl.length > MAX_LOOKUP_URL_LEN) return null;
  const type: QuickCheckMedia['type'] = item.type === 'video' ? 'video' : 'image';
  const clean: QuickCheckMedia = {
    id: sanitizeCloudId(item.id || `media-${idx + 1}`, `media-${idx + 1}`),
    type,
    title: (typeof item.title === 'string' ? item.title.trim() : '').slice(0, MAX_TITLE_LEN),
    url: rawUrl.slice(0, MAX_LOOKUP_URL_LEN),
  };
  if (typeof item.embedUrl === 'string' && item.embedUrl.trim().length > 0 && item.embedUrl.trim().length <= MAX_LOOKUP_URL_LEN) {
    clean.embedUrl = item.embedUrl.trim();
  }
  if (typeof item.thumbnailUrl === 'string' && item.thumbnailUrl.trim().length > 0 && item.thumbnailUrl.trim().length <= MAX_LOOKUP_URL_LEN) {
    clean.thumbnailUrl = item.thumbnailUrl.trim();
  }
  if (typeof item.sourceName === 'string' && item.sourceName.trim().length > 0) {
    clean.sourceName = item.sourceName.trim().slice(0, MAX_LOOKUP_SOURCE_NAME_LEN);
  }
  if (typeof item.sourceUrl === 'string' && item.sourceUrl.trim().length > 0 && item.sourceUrl.trim().length <= MAX_LOOKUP_URL_LEN) {
    clean.sourceUrl = item.sourceUrl.trim();
  }
  if (typeof item.mimeType === 'string' && item.mimeType.trim().length > 0) {
    clean.mimeType = item.mimeType.trim().slice(0, MAX_LOOKUP_MIME_LEN);
  }
  return clean;
}

function sanitizeLookupEntryPayload(
  entry: QuickCheckEntry,
  ownerId: string,
  orderMsOverride?: number
): Omit<CloudLookupEntryDoc, 'createdAt' | 'updatedAt'> {
  const safeId = sanitizeCloudId(entry.id, 'qc');
  const sources = (Array.isArray(entry.sources) ? entry.sources : [])
    .map(sanitizeLookupSource)
    .filter((s): s is QuickCheckSource => s !== null)
    .slice(0, MAX_LOOKUP_SOURCES);
  const media = (Array.isArray(entry.media) ? entry.media : [])
    .map((m, idx) => sanitizeLookupMedia(m, idx))
    .filter((m): m is QuickCheckMedia => m !== null)
    .slice(0, MAX_LOOKUP_MEDIA);
  const webSearchQueries = (Array.isArray(entry.webSearchQueries) ? entry.webSearchQueries : [])
    .filter((q): q is string => typeof q === 'string' && q.trim().length > 0)
    .map((q) => q.trim().slice(0, MAX_TITLE_LEN))
    .slice(0, MAX_LOOKUP_QUERIES);

  const base: Omit<CloudLookupEntryDoc, 'createdAt' | 'updatedAt'> = {
    id: safeId,
    ownerId,
    prompt: (typeof entry.prompt === 'string' ? entry.prompt : '').slice(0, MAX_LOOKUP_PROMPT_LEN),
    answer: (typeof entry.answer === 'string' ? entry.answer : '').slice(0, MAX_LOOKUP_ANSWER_LEN),
    sources,
    media,
    webSearchQueries,
    timestamp: (typeof entry.timestamp === 'string' ? entry.timestamp.trim() : '').slice(
      0,
      MAX_LOOKUP_TIMESTAMP_LEN
    ),
    usedAgenda: Boolean(entry.usedAgenda),
    orderMs:
      typeof orderMsOverride === 'number' && Number.isFinite(orderMsOverride)
        ? orderMsOverride
        : extractOrderMsFromLookupId(safeId),
  };

  if (typeof entry.savedTask === 'boolean') {
    base.savedTask = entry.savedTask;
  }
  if (typeof entry.savedTaskId === 'string' && entry.savedTaskId.trim().length > 0) {
    base.savedTaskId = sanitizeCloudId(entry.savedTaskId, 't');
  }
  if (typeof entry.savedNote === 'boolean') {
    base.savedNote = entry.savedNote;
  }
  if (typeof entry.savedNoteId === 'string' && entry.savedNoteId.trim().length > 0) {
    base.savedNoteId = sanitizeCloudId(entry.savedNoteId, 'n');
  }

  return base;
}

export function fingerprintCloudLookupEntry(entry: QuickCheckEntry): string {
  const clean = sanitizeLookupEntryPayload(entry, 'u', 0);
  const { ownerId: _ignored, orderMs: _ignoredOrder, ...rest } = clean;
  return JSON.stringify(rest);
}

function mapCloudDocToLookupEntry(
  data: Partial<CloudLookupEntryDoc>,
  docId: string
): { entry: QuickCheckEntry; orderMs: number } | null {
  const id = typeof data.id === 'string' && data.id.trim() ? data.id : docId;
  if (!id) return null;
  const sources = (Array.isArray(data.sources) ? data.sources : [])
    .map(sanitizeLookupSource)
    .filter((s): s is QuickCheckSource => s !== null);
  const media = (Array.isArray(data.media) ? data.media : [])
    .map((m, idx) => sanitizeLookupMedia(m, idx))
    .filter((m): m is QuickCheckMedia => m !== null);
  const webSearchQueries = (Array.isArray(data.webSearchQueries) ? data.webSearchQueries : [])
    .filter((q): q is string => typeof q === 'string' && q.trim().length > 0)
    .map((q) => q.trim());

  const entry: QuickCheckEntry = {
    id,
    prompt: typeof data.prompt === 'string' ? data.prompt : '',
    answer: typeof data.answer === 'string' ? data.answer : '',
    sources,
    media,
    webSearchQueries,
    timestamp: typeof data.timestamp === 'string' ? data.timestamp : '',
    usedAgenda: Boolean(data.usedAgenda),
    ...(typeof data.savedTask === 'boolean' ? { savedTask: data.savedTask } : {}),
    ...(typeof data.savedTaskId === 'string' && data.savedTaskId.trim()
      ? { savedTaskId: data.savedTaskId.trim() }
      : {}),
    ...(typeof data.savedNote === 'boolean' ? { savedNote: data.savedNote } : {}),
    ...(typeof data.savedNoteId === 'string' && data.savedNoteId.trim()
      ? { savedNoteId: data.savedNoteId.trim() }
      : {}),
  };

  const ts = data.createdAt ?? data.updatedAt;
  const fallbackMs =
    ts && typeof ts.toMillis === 'function' ? ts.toMillis() : extractOrderMsFromLookupId(id);
  const orderMs =
    typeof data.orderMs === 'number' && Number.isFinite(data.orderMs) ? data.orderMs : fallbackMs;

  return { entry, orderMs };
}

export async function upsertCloudLookupEntry(
  uid: string,
  entry: QuickCheckEntry,
  orderMsOverride?: number
): Promise<void> {
  const payload = sanitizeLookupEntryPayload(entry, uid, orderMsOverride);
  const path = `users/${uid}/lookupEntries/${payload.id}`;
  const ref = doc(db, 'users', uid, 'lookupEntries', payload.id);

  try {
    const existingSnap = await getDoc(ref);
    if (existingSnap.exists()) {
      const updatePatch: Record<string, unknown> = {
        prompt: payload.prompt,
        answer: payload.answer,
        sources: payload.sources,
        media: payload.media,
        webSearchQueries: payload.webSearchQueries,
        timestamp: payload.timestamp,
        usedAgenda: payload.usedAgenda,
        savedTask: payload.savedTask !== undefined ? payload.savedTask : deleteField(),
        savedTaskId: payload.savedTaskId !== undefined ? payload.savedTaskId : deleteField(),
        savedNote: payload.savedNote !== undefined ? payload.savedNote : deleteField(),
        savedNoteId: payload.savedNoteId !== undefined ? payload.savedNoteId : deleteField(),
        orderMs: payload.orderMs,
        updatedAt: serverTimestamp(),
      };
      await updateDoc(ref, updatePatch);
    } else {
      await setDoc(ref, {
        ...payload,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteCloudLookupEntry(uid: string, entryId: string): Promise<void> {
  const safeId = sanitizeCloudId(entryId, 'qc');
  const path = `users/${uid}/lookupEntries/${safeId}`;
  const ref = doc(db, 'users', uid, 'lookupEntries', safeId);

  try {
    await deleteDoc(ref);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export function subscribeCloudLookupEntries(
  uid: string,
  onData: (entries: QuickCheckEntry[]) => void,
  onError: (err: Error) => void
): Unsubscribe {
  const path = `users/${uid}/lookupEntries`;
  const entriesQuery = query(
    collection(db, 'users', uid, 'lookupEntries'),
    where('ownerId', '==', uid)
  );

  return onSnapshot(
    entriesQuery,
    (snapshot) => {
      const records: { entry: QuickCheckEntry; orderMs: number }[] = [];
      snapshot.forEach((docSnap) => {
        const mapped = mapCloudDocToLookupEntry(
          docSnap.data() as Partial<CloudLookupEntryDoc>,
          docSnap.id
        );
        if (mapped) records.push(mapped);
      });
      records.sort((a, b) => a.orderMs - b.orderMs);
      onData(records.slice(-30).map((r) => r.entry));
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export async function fetchAllCloudLookupEntriesOnce(uid: string): Promise<QuickCheckEntry[]> {
  const path = `users/${uid}/lookupEntries`;
  const entriesQuery = query(
    collection(db, 'users', uid, 'lookupEntries'),
    where('ownerId', '==', uid)
  );
  try {
    const snapshot = await getDocs(entriesQuery);
    const records: { entry: QuickCheckEntry; orderMs: number }[] = [];
    snapshot.forEach((docSnap) => {
      const mapped = mapCloudDocToLookupEntry(
        docSnap.data() as Partial<CloudLookupEntryDoc>,
        docSnap.id
      );
      if (mapped) records.push(mapped);
    });
    records.sort((a, b) => a.orderMs - b.orderMs);
    return records.slice(-30).map((r) => r.entry);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}
