import {
  AppSettingsState,
  CalendarEvent,
  DefaultHome,
  DesignDecisions,
  NavMode,
  NoteItem,
  QuickCaptureMode,
  TaskItem,
  VisualStyle,
} from '../types/taskflow';

export const INITIAL_DECISIONS: DesignDecisions = {
  visualStyle: VisualStyle.Minimal,
  navMode: NavMode.Five,
  quickCapture: QuickCaptureMode.Fab,
  defaultHome: DefaultHome.Dashboard,
  accentColor: '#7BB6E0',
};

export const INITIAL_RECENT_COLORS: string[] = ['#7BB6E0'];

function formatLocalDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getTodayDateKey(): string {
  return formatLocalDateKey(new Date());
}

export function getTomorrowDateKey(): string {
  const now = new Date();
  return formatLocalDateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
}

export const TODAY_DATE_KEY = getTodayDateKey();
export const TOMORROW_DATE_KEY = getTomorrowDateKey();

export const INITIAL_LISTS: string[] = ['Work', 'Projects', 'Personal'];
export const INITIAL_NOTE_FOLDERS: string[] = ['Work', 'Projects', 'Personal'];

export const INITIAL_SETTINGS: AppSettingsState = {
  hingeAwareSplit: true,
  oneHandedCoverReach: true,
  googleCalendarSync: true,
  googleTasksSync: true,
  buhCloudSync: true,
  nlpQuickParse: true,
  morningDigestTime: '08:00 AM',
  taskRemindersEnabled: true,
  reminderSound: true,
  completedTaskHistoryYears: 0,
  completedTaskHistoryMonths: 0,
};

export const INITIAL_TASKS: TaskItem[] = [];

export const INITIAL_EVENTS: CalendarEvent[] = [];

export const INITIAL_NOTES: NoteItem[] = [];

export const DEMO_SEED_IDS = {
  tasks: new Set(['t-1', 't-2', 't-3', 't-4', 't-5', 't-6', 't-7', 't-8']),
  events: new Set(['ev-1', 'ev-2', 'ev-3', 'ev-4', 'ev-5', 'ev-6']),
  notes: new Set(['n-1', 'n-2', 'n-3']),
};
