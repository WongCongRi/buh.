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

export interface TaskItem {
  id: string;
  title: string;
  timeLabel: string;
  dateKey: string; // e.g., '2026-11-23'
  category: TaskCategory;
  priority: TaskPriority;
  completed: boolean;
  isInbox: boolean;
  notes: string;
  subtasks: SubTask[];
}

export interface CalendarEvent {
  id: string;
  title: string;
  dateKey: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  calendarName: string;
  location?: string;
  linkedTaskId?: string;
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
  folder: 'Product' | 'Work' | 'Personal';
  updatedAt: string;
  pinned: boolean;
  blocks: NoteBlock[];
}

export interface DesignDecisions {
  visualStyle: VisualStyle;
  navMode: NavMode;
  quickCapture: QuickCaptureMode;
  defaultHome: DefaultHome;
  accentColor: string;
}

export interface AppSettingsState {
  hingeAwareSplit: boolean;
  oneHandedCoverReach: boolean;
  googleCalendarSync: boolean;
  nlpQuickParse: boolean;
  morningDigestTime: string;
}
