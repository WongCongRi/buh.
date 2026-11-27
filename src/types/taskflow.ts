export enum FoldPosture {
  Cover = 'cover',
  Inner = 'inner',
  Flex = 'flex',
}

export enum VisualStyle {
  Minimal = 'minimal',
  Samsung = 'samsung',
  Professional = 'professional',
}

export enum NavMode {
  Five = 'five',
  Four = 'four',
}

export enum QuickCaptureMode {
  Fab = 'fab',
  Bar = 'bar',
  Both = 'both',
}

export enum DefaultHome {
  Today = 'today',
  Inbox = 'inbox',
  Dashboard = 'dashboard',
}

export enum ScreenId {
  Home = 'home',
  Tasks = 'tasks',
  Agent = 'agent',
  Notes = 'notes',
  Settings = 'settings',
}

export type TaskPriority = 'High' | 'Normal' | 'Low';
export type TaskCategory = string;

export interface SubTask {
  id: string;
  title: string;
  done: boolean;
}

export interface TaskReminder {
  id: string;
  mode: 'relative' | 'exact';
  offsetMinutes?: number;
  dateKey?: string; // 'YYYY-MM-DD'
  time24?: string; // 'HH:MM'
  firedAt?: number;
}

export type RecurrenceFrequency = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface RecurrenceRule {
  frequency: RecurrenceFrequency;
  interval: number; // >= 1
  daysOfWeek?: number[]; // 0=Sun..6=Sat (for weekly)
  endDateKey?: string; // optional inclusive 'YYYY-MM-DD'
}

export interface TaskItem {
  id: string;
  title: string;
  timeLabel: string;
  dateKey: string; // e.g., '2026-11-23'
  category: TaskCategory;
  priority: TaskPriority;
  completed: boolean;
  completedAt?: string;
  isInbox: boolean;
  notes: string;
  subtasks: SubTask[];
  reminders?: TaskReminder[];
  recurrence?: RecurrenceRule;
  recurrenceSeriesId?: string;
  source?: 'local' | 'google';
  googleTaskId?: string;
  googleTaskListId?: string;
  googleTaskListTitle?: string;
}

export interface CalendarEvent {
  id: string;
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
  recurringEventId?: string;
  source?: 'local' | 'google';
  googleEventId?: string;
  htmlLink?: string;
}

export interface NoteBlock {
  id: string;
  type: 'heading' | 'paragraph' | 'checklist' | 'bullet';
  text: string;
  checked?: boolean;
}

export interface NoteItem {
  id: string;
  title: string;
  folder: string;
  updatedAt: string;
  pinned: boolean;
  markdownEnabled?: boolean;
  sortOrder?: number;
  blocks: NoteBlock[];
}

export interface DesignDecisions {
  visualStyle: VisualStyle;
  navMode: NavMode;
  quickCapture: QuickCaptureMode;
  defaultHome: DefaultHome;
  accentColor: string;
}

export type TimeFormat = '24h' | '12h';

export interface AppSettingsState {
  hingeAwareSplit: boolean;
  oneHandedCoverReach: boolean;
  googleCalendarSync: boolean;
  googleTasksSync: boolean;
  buhCloudSync?: boolean;
  nlpQuickParse: boolean;
  morningDigestTime: string;
  taskRemindersEnabled: boolean;
  reminderSound: boolean;
  completedTaskHistoryYears?: number;
  completedTaskHistoryMonths?: number;
  timeFormat?: TimeFormat;
}

export interface CloudNotesSyncState {
  isSignedIn: boolean;
  userEmail: string | null;
  isSyncing: boolean;
  lastSyncedAt: string | null;
  syncedNotesCount: number;
  syncedFoldersCount: number;
  syncedTasksCount?: number;
  syncedEventsCount?: number;
  syncedLookupCount?: number;
  error: string | null;
  onSyncNow: () => Promise<void>;
}

export interface GoogleCalendarSyncState {
  isConnected: boolean;
  userEmail: string | null;
  isSigningIn: boolean;
  isSyncing: boolean;
  lastSyncedAt: string | null;
  syncedCount: number;
  pendingSyncCount?: number;
  error: string | null;
  onSignIn: () => Promise<void>;
  onSignOut: () => Promise<void>;
  onSyncNow: () => Promise<void>;
  onSyncPending?: () => void;
  onCreateGoogleEvent: (input: {
    title: string;
    dateKey: string;
    endDateKey?: string;
    startTime: string;
    endTime: string;
    calendarName: string;
    recurrence?: RecurrenceRule;
  }) => Promise<void>;
  onDeleteGoogleEvent: (eventId: string, googleEventId: string) => Promise<void>;
}

export interface GoogleTaskListInfo {
  id: string;
  title: string;
}

export interface GoogleTasksSyncState {
  isConnected: boolean;
  userEmail: string | null;
  isSigningIn: boolean;
  isSyncing: boolean;
  lastSyncedAt: string | null;
  syncedCount: number;
  pendingSyncCount?: number;
  taskLists: GoogleTaskListInfo[];
  dirtyTaskIds: string[];
  error: string | null;
  onSignIn: () => Promise<void>;
  onSignOut: () => Promise<void>;
  onSyncNow: () => Promise<void>;
  onSyncPending?: () => void;
  onCreateGoogleTask: (input: {
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
  }) => Promise<string | void>;
  onUpdateGoogleTask: (task: TaskItem) => Promise<void>;
  onToggleGoogleTask: (task: TaskItem) => Promise<void>;
  onDeleteGoogleTask: (task: TaskItem) => Promise<void>;
}
