import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  CalendarPlus,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Plus,
  RefreshCw,
  Repeat,
  Trash2,
  X,
} from 'lucide-react';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { useTaskCompletionAnimation } from '../../hooks/useTaskCompletionAnimation';
import { useTodayDateKey } from '../../hooks/useTodayDateKey';
import { useBackLayer } from '../../hooks/useAndroidBackNavigation';
import {
  CalendarEvent,
  DefaultHome,
  FoldPosture,
  GoogleCalendarSyncState,
  GoogleTasksSyncState,
  NoteItem,
  RecurrenceFrequency,
  RecurrenceRule,
  ScreenId,
  TaskItem,
} from '../../types/taskflow';
import {
  RECURRENCE_PRESETS,
  WEEKDAY_BUTTONS,
  addDaysToDateKey,
  buildRuleFromPreset,
  doesRuleOccurOnDate,
  eventOccursOnDate,
  formatRecurrenceLabel,
  getPresetIdForRule,
  materializeEventForDate,
  normalizeRecurrenceRule,
  parseDateKeyLocal,
} from '../../utils/recurrence';
import { formatTimeDisplay, useTimeFormat } from '../../utils/timeFormat';
import { compareEventsAscending, compareTasksAscending } from '../../utils/taskSort';
import { StyleThemeTokens } from '../../utils/themeTokens';
import type { PendingCalendarMutation } from '../CalendarConfirmModal';
import { GoogleSignInButton } from '../GoogleSignInButton';
import { TaskCheckbox } from '../TaskCheckbox';
import { TaskMetaRow } from '../TaskMetaRow';
import { TaskDetailPane } from './TaskDetailPane';
import { TaskDetailSheet } from './TaskDetailSheet';

const CalendarConfirmModal = lazy(() =>
  import('../CalendarConfirmModal').then((m) => ({ default: m.CalendarConfirmModal }))
);

interface HomeScreenProps {
  posture: FoldPosture;
  defaultHome: DefaultHome;
  tokens: StyleThemeTokens;
  tasks: TaskItem[];
  taskLists: string[];
  events: CalendarEvent[];
  notes: NoteItem[];
  selectedTaskId: string | null;
  hingeAwareSplit: boolean;
  googleCalendarSync: boolean;
  googleTasksSync: boolean;
  googleCalendar: GoogleCalendarSyncState;
  googleTasks: GoogleTasksSyncState;
  onSelectTask: (taskId: string | null) => void;
  onToggleTask: (taskId: string) => void;
  onUpdateTask: (task: TaskItem) => void;
  onDeleteTask: (taskId: string) => void;
  onSyncGoogleTask: (task: TaskItem) => void;
  onPushLocalTaskToGoogle: (task: TaskItem) => void;
  onAddEvent: (ev: CalendarEvent) => void;
  onDeleteEvent?: (eventId: string) => void;
  onConvertEventToTask: (ev: CalendarEvent) => string | void;
  onNavigateScreen: (screen: ScreenId) => void;
  onOpenNote: (noteId: string) => void;
}

interface DayMeta {
  dateKey: string;
  short: string;
  compactDay: string;
  dayNum: string;
  fullLabel: string;
  compactLabel: string;
}

const SHORT_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const FULL_WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MON_FIRST_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function parseLocalDate(dateKey: string): Date {
  const [yStr, mStr, dStr] = dateKey.split('-');
  const fallback = new Date();
  const y = Number(yStr) || fallback.getFullYear();
  const m = (Number(mStr) || fallback.getMonth() + 1) - 1;
  const d = Number(dStr) || fallback.getDate();
  return new Date(y, m, d);
}

function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function toTimeHHMM(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function combineLocalDateTime(dateKey: string, timeHHMM: string): Date {
  const base = parseLocalDate(dateKey);
  const [hh, mm] = timeHHMM.split(':').map((n) => parseInt(n, 10));
  base.setHours(Number.isNaN(hh) ? 9 : hh, Number.isNaN(mm) ? 0 : mm, 0, 0);
  return base;
}

function addMinutesToDateTime(
  dateKey: string,
  timeHHMM: string,
  minutes: number
): { dateKey: string; time: string } {
  const start = combineLocalDateTime(dateKey, timeHHMM);
  const end = new Date(start.getTime() + minutes * 60_000);
  return { dateKey: toDateKey(end), time: toTimeHHMM(end) };
}

function computeDurationMinutes(
  startDateKey: string,
  startTime: string,
  endDateKey: string,
  endTime: string
): number {
  const start = combineLocalDateTime(startDateKey, startTime);
  const end = combineLocalDateTime(endDateKey, endTime);
  return Math.round((end.getTime() - start.getTime()) / 60_000);
}

function formatDurationLabel(minutes: number): string {
  if (minutes <= 0) return '0m';
  const days = Math.floor(minutes / 1440);
  const remAfterDays = minutes % 1440;
  const hours = Math.floor(remAfterDays / 60);
  const mins = remAfterDays % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (mins > 0) parts.push(`${mins}m`);
  return parts.join(' ');
}

function formatShortDateKey(dateKey: string): string {
  const dt = parseLocalDate(dateKey);
  return `${String(dt.getDate()).padStart(2, '0')} ${SHORT_MONTHS[dt.getMonth()]}`;
}

const DURATION_PRESETS: { label: string; minutes: number }[] = [
  { label: '15m', minutes: 15 },
  { label: '30m', minutes: 30 },
  { label: '1h', minutes: 60 },
  { label: '2h', minutes: 120 },
  { label: '3h', minutes: 180 },
  { label: '12h', minutes: 720 },
  { label: '24h', minutes: 1440 },
];

function getDayMeta(dateKey: string): DayMeta {
  const dt = parseLocalDate(dateKey);
  const dow = dt.getDay();
  const dayNum = String(dt.getDate());
  const paddedDay = dayNum.padStart(2, '0');
  const monthName = MONTH_NAMES[dt.getMonth()];
  const shortMonth = SHORT_MONTHS[dt.getMonth()];
  const shortDay = SHORT_WEEKDAYS[dow];
  return {
    dateKey,
    short: shortDay,
    compactDay: shortDay.slice(0, 1),
    dayNum,
    fullLabel: `${FULL_WEEKDAYS[dow]}, ${paddedDay} ${monthName} ${dt.getFullYear()}`,
    compactLabel: `${shortDay}, ${paddedDay} ${shortMonth}`,
  };
}

function getWeekDaysFor(anchorDateKey: string): DayMeta[] {
  const dt = parseLocalDate(anchorDateKey);
  const dow = dt.getDay();
  const diffToMonday = (dow + 6) % 7;
  const monday = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() - diffToMonday);
  return Array.from({ length: 7 }, (_, i) => {
    const cur = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
    return getDayMeta(toDateKey(cur));
  });
}

function getMonthGridFor(year: number, month: number): {
  monthName: string;
  cells: (DayMeta | null)[];
} {
  const firstDay = new Date(year, month, 1);
  const leadingBlanks = (firstDay.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: (DayMeta | null)[] = [];
  for (let i = 0; i < leadingBlanks; i++) {
    cells.push(null);
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(getDayMeta(toDateKey(new Date(year, month, d))));
  }
  while (cells.length % 7 !== 0) {
    cells.push(null);
  }

  return {
    monthName: MONTH_NAMES[month],
    cells,
  };
}

export const HomeScreen: React.FC<HomeScreenProps> = ({
  posture,
  defaultHome,
  tokens,
  tasks,
  taskLists,
  events,
  notes,
  selectedTaskId,
  hingeAwareSplit,
  googleCalendarSync,
  googleTasksSync,
  googleCalendar,
  googleTasks,
  onSelectTask,
  onToggleTask,
  onUpdateTask,
  onDeleteTask,
  onSyncGoogleTask,
  onPushLocalTaskToGoogle,
  onAddEvent,
  onDeleteEvent,
  onConvertEventToTask,
  onNavigateScreen,
  onOpenNote,
}) => {
  const timeFormat = useTimeFormat();
  const isOnline = useOnlineStatus();
  const { todayDateKey } = useTodayDateKey();
  const prevTodayDateKeyRef = useRef(todayDateKey);
  const todayDate = useMemo(() => parseLocalDate(todayDateKey), [todayDateKey]);
  const todayYear = todayDate.getFullYear();
  const todayMonth = todayDate.getMonth();

  const [selectedDateKey, setSelectedDateKey] = useState(todayDateKey);
  const [calendarExpanded, setCalendarExpanded] = useState(false);
  const [viewYear, setViewYear] = useState(todayYear);
  const [viewMonth, setViewMonth] = useState(todayMonth);
  const [weekSlideDir, setWeekSlideDir] = useState<1 | -1>(1);
  const [monthSlideDir, setMonthSlideDir] = useState<1 | -1>(1);
  const [monthYearPickerOpen, setMonthYearPickerOpen] = useState(false);
  const [yearWindowStart, setYearWindowStart] = useState(todayYear - 2);
  const [yearSlideDir, setYearSlideDir] = useState<1 | -1>(1);
  const [pullOffset, setPullOffset] = useState(0);

  const [showAddBlock, setShowAddBlock] = useState(false);
  const [newBlockTitle, setNewBlockTitle] = useState('');
  const [newBlockStartDate, setNewBlockStartDate] = useState(todayDateKey);
  const [newBlockStartTime, setNewBlockStartTime] = useState('16:00');
  const [newBlockEndDate, setNewBlockEndDate] = useState(todayDateKey);
  const [newBlockEndTime, setNewBlockEndTime] = useState('17:00');
  const [newBlockDurationMinutes, setNewBlockDurationMinutes] = useState(60);
  const [newBlockList, setNewBlockList] = useState(taskLists[0] || 'Work');
  const [newBlockRecurrence, setNewBlockRecurrence] = useState<RecurrenceRule | undefined>(undefined);
  const [showCustomBlockRepeat, setShowCustomBlockRepeat] = useState(false);
  const [newBlockSaveToGoogle, setNewBlockSaveToGoogle] = useState(false);
  const [convertedNotice, setConvertedNotice] = useState<string | null>(null);
  const [pendingMutation, setPendingMutation] = useState<PendingCalendarMutation | null>(null);
  const [mutationBusy, setMutationBusy] = useState(false);
  const noticeTimerRef = useRef<number | null>(null);

  const showConvertedNotice = useCallback((message: string, durationMs = 2600) => {
    setConvertedNotice(message);
    if (noticeTimerRef.current !== null) {
      window.clearTimeout(noticeTimerRef.current);
    }
    noticeTimerRef.current = window.setTimeout(() => {
      setConvertedNotice(null);
      noticeTimerRef.current = null;
    }, durationMs);
  }, []);

  useEffect(() => {
    return () => {
      if (noticeTimerRef.current !== null) {
        window.clearTimeout(noticeTimerRef.current);
      }
    };
  }, []);

  // Automatically roll selectedDateKey forward across local midnight if the user was viewing today
  useEffect(() => {
    const prevToday = prevTodayDateKeyRef.current;
    if (prevToday !== todayDateKey) {
      setSelectedDateKey((cur) => (cur === prevToday ? todayDateKey : cur));
      prevTodayDateKeyRef.current = todayDateKey;
    }
  }, [todayDateKey]);

  useBackLayer(monthYearPickerOpen, () => setMonthYearPickerOpen(false), 12);
  useBackLayer(showAddBlock, () => setShowAddBlock(false), 10);
  useBackLayer(
    calendarExpanded,
    () => {
      setCalendarExpanded(false);
      setMonthYearPickerOpen(false);
    },
    5
  );

  const swipeOriginRef = useRef<{ x: number; y: number } | null>(null);
  const yearSwipeOriginXRef = useRef<number | null>(null);
  const didSwipeRef = useRef(false);
  const calendarContainerRef = useRef<HTMLDivElement | null>(null);
  const calendarExpandedRef = useRef(calendarExpanded);
  const monthYearPickerOpenRef = useRef(monthYearPickerOpen);
  const selectedDateKeyRef = useRef(selectedDateKey);
  const viewYearRef = useRef(viewYear);
  const viewMonthRef = useRef(viewMonth);

  useEffect(() => {
    calendarExpandedRef.current = calendarExpanded;
  }, [calendarExpanded]);
  useEffect(() => {
    monthYearPickerOpenRef.current = monthYearPickerOpen;
  }, [monthYearPickerOpen]);
  useEffect(() => {
    selectedDateKeyRef.current = selectedDateKey;
  }, [selectedDateKey]);
  useEffect(() => {
    viewYearRef.current = viewYear;
    viewMonthRef.current = viewMonth;
  }, [viewYear, viewMonth]);

  // Sync displayed month/year whenever selectedDateKey changes externally or via Today button
  useEffect(() => {
    const dt = parseLocalDate(selectedDateKey);
    setViewYear(dt.getFullYear());
    setViewMonth(dt.getMonth());
    setYearWindowStart(dt.getFullYear() - 2);
  }, [selectedDateKey]);

  const dayMeta = useMemo(() => getDayMeta(selectedDateKey), [selectedDateKey]);
  const weekDays = useMemo(() => getWeekDaysFor(selectedDateKey), [selectedDateKey]);
  const monthGrid = useMemo(() => getMonthGridFor(viewYear, viewMonth), [viewYear, viewMonth]);

  // Precompute event & task indicator blips for every visible day in week strip and month grid
  const dayIndicatorsByKey = useMemo(() => {
    const visibleKeys = new Set<string>();
    for (const d of weekDays) visibleKeys.add(d.dateKey);
    if (calendarExpanded) {
      for (const cell of monthGrid.cells) {
        if (cell) visibleKeys.add(cell.dateKey);
      }
    }

    const map = new Map<
      string,
      { hasEvent: boolean; hasActiveTask: boolean; hasCompletedTask: boolean }
    >();
    const ensureEntry = (key: string) => {
      let entry = map.get(key);
      if (!entry) {
        entry = { hasEvent: false, hasActiveTask: false, hasCompletedTask: false };
        map.set(key, entry);
      }
      return entry;
    };

    // Concrete scheduled tasks (local + synced Google Tasks)
    const recurringActiveTasks: TaskItem[] = [];
    for (const t of tasks) {
      if (t.isInbox || !t.dateKey) continue;
      if (visibleKeys.has(t.dateKey)) {
        const entry = ensureEntry(t.dateKey);
        if (t.completed) {
          entry.hasCompletedTask = true;
        } else {
          entry.hasActiveTask = true;
        }
      }
      if (!t.completed && t.recurrence) {
        recurringActiveTasks.push(t);
      }
    }

    // Events and projected recurring tasks across visible dates
    for (const key of visibleKeys) {
      if (events.some((e) => eventOccursOnDate(e, key))) {
        ensureEntry(key).hasEvent = true;
      }
      const existing = map.get(key);
      if (!existing?.hasActiveTask && recurringActiveTasks.length > 0) {
        for (const rt of recurringActiveTasks) {
          if (rt.dateKey < key && rt.recurrence && doesRuleOccurOnDate(rt.dateKey, rt.recurrence, key)) {
            ensureEntry(key).hasActiveTask = true;
            break;
          }
        }
      }
    }

    return map;
  }, [weekDays, monthGrid.cells, calendarExpanded, tasks, events]);

  // Precompute which months in viewYear have scheduled tasks or events for the Month+Year picker
  const activeMonthsInViewYear = useMemo(() => {
    const map = new Map<number, { hasTask: boolean; hasEvent: boolean }>();
    if (!monthYearPickerOpen) return map;
    const yearPrefix = `${viewYear}-`;
    const ensureMonth = (m: number) => {
      let entry = map.get(m);
      if (!entry) {
        entry = { hasTask: false, hasEvent: false };
        map.set(m, entry);
      }
      return entry;
    };

    for (const t of tasks) {
      if (t.isInbox || !t.dateKey) continue;
      if (t.dateKey.startsWith(yearPrefix)) {
        const m = Number(t.dateKey.slice(5, 7)) - 1;
        if (m >= 0 && m <= 11) ensureMonth(m).hasTask = true;
      }
    }
    for (const ev of events) {
      if (ev.dateKey.startsWith(yearPrefix)) {
        const m = Number(ev.dateKey.slice(5, 7)) - 1;
        if (m >= 0 && m <= 11) ensureMonth(m).hasEvent = true;
      }
      if (ev.endDateKey && ev.endDateKey.startsWith(yearPrefix)) {
        const m = Number(ev.endDateKey.slice(5, 7)) - 1;
        if (m >= 0 && m <= 11) ensureMonth(m).hasEvent = true;
      }
    }
    return map;
  }, [monthYearPickerOpen, viewYear, tasks, events]);

  const dayTasks = useMemo(
    () => tasks.filter((t) => !t.isInbox && t.dateKey === selectedDateKey),
    [tasks, selectedDateKey]
  );
  const inboxTasks = useMemo(() => tasks.filter((t) => t.isInbox), [tasks]);
  const dayEvents = useMemo(
    () =>
      events
        .filter((e) => eventOccursOnDate(e, selectedDateKey))
        .map((e) => materializeEventForDate(e, selectedDateKey))
        .sort(compareEventsAscending),
    [events, selectedDateKey]
  );

  // Project upcoming occurrences of active recurring tasks onto future calendar dates
  const projectedRecurringTasks = useMemo(() => {
    if (defaultHome === DefaultHome.Inbox) return [] as TaskItem[];
    const concreteIds = new Set(dayTasks.map((t) => t.id));
    const concreteSeries = new Set(
      dayTasks
        .filter((t) => t.recurrenceSeriesId || t.recurrence)
        .map((t) => t.recurrenceSeriesId || t.id)
    );
    return tasks
      .filter((t) => {
        if (t.completed || t.isInbox || !t.dateKey || !t.recurrence) return false;
        if (t.dateKey >= selectedDateKey) return false;
        if (concreteIds.has(t.id)) return false;
        const seriesKey = t.recurrenceSeriesId || t.id;
        if (concreteSeries.has(seriesKey)) return false;
        return doesRuleOccurOnDate(t.dateKey, t.recurrence, selectedDateKey);
      })
      .sort(compareTasksAscending);
  }, [defaultHome, tasks, dayTasks, selectedDateKey]);

  const { celebratingIds, justSettledIds, compareWithCompletionHold } =
    useTaskCompletionAnimation(tasks);

  // Checked-off tasks stay visible at the bottom after briefly celebrating in place
  const primaryList = useMemo(
    () =>
      [...(defaultHome === DefaultHome.Inbox ? inboxTasks : dayTasks)].sort(
        compareWithCompletionHold
      ),
    [defaultHome, inboxTasks, dayTasks, compareWithCompletionHold]
  );
  const remainingCount = useMemo(
    () => primaryList.filter((t) => !t.completed).length + projectedRecurringTasks.length,
    [primaryList, projectedRecurringTasks]
  );
  const pinnedNotes = useMemo(() => notes.filter((n) => n.pinned), [notes]);
  const selectedTask = useMemo(
    () => tasks.find((t) => t.id === selectedTaskId) || null,
    [tasks, selectedTaskId]
  );

  const isExpanded = posture === FoldPosture.Inner;
  const isFlex = posture === FoldPosture.Flex;

  const stepWeek = (delta: number) => {
    setWeekSlideDir(delta >= 0 ? 1 : -1);
    setSelectedDateKey((prev) => addDaysToDateKey(prev, delta * 7));
  };

  const stepMonth = (delta: number) => {
    setMonthSlideDir(delta >= 0 ? 1 : -1);
    const next = new Date(viewYear, viewMonth + delta, 1);
    setViewYear(next.getFullYear());
    setViewMonth(next.getMonth());
    setYearWindowStart(next.getFullYear() - 2);
  };

  const stepYearWindow = (delta: number) => {
    setYearSlideDir(delta >= 0 ? 1 : -1);
    setYearWindowStart((prev) => prev + delta * 5);
  };

  const stepSelectedYear = (delta: number) => {
    setYearSlideDir(delta >= 0 ? 1 : -1);
    setViewYear((y) => {
      const next = y + delta;
      setYearWindowStart(next - 2);
      return next;
    });
  };

  const openAddBlockForm = () => {
    const startDate = selectedDateKey;
    const startTime = newBlockStartTime || '16:00';
    const dur = newBlockDurationMinutes > 0 ? newBlockDurationMinutes : 60;
    const end = addMinutesToDateTime(startDate, startTime, dur);
    setNewBlockStartDate(startDate);
    setNewBlockStartTime(startTime);
    setNewBlockEndDate(end.dateKey);
    setNewBlockEndTime(end.time);
    setNewBlockRecurrence(undefined);
    setShowCustomBlockRepeat(false);
    setShowAddBlock(true);
  };

  const handleBlockStartDateChange = (nextDate: string) => {
    if (!nextDate) return;
    setNewBlockStartDate(nextDate);
    const keepDur = newBlockDurationMinutes > 0 ? newBlockDurationMinutes : 60;
    const nextEnd = addMinutesToDateTime(nextDate, newBlockStartTime, keepDur);
    setNewBlockEndDate(nextEnd.dateKey);
    setNewBlockEndTime(nextEnd.time);
  };

  const handleBlockStartTimeChange = (nextTime: string) => {
    if (!nextTime) return;
    setNewBlockStartTime(nextTime);
    const keepDur = newBlockDurationMinutes > 0 ? newBlockDurationMinutes : 60;
    const nextEnd = addMinutesToDateTime(newBlockStartDate, nextTime, keepDur);
    setNewBlockEndDate(nextEnd.dateKey);
    setNewBlockEndTime(nextEnd.time);
  };

  const handleBlockEndDateChange = (nextEndDate: string) => {
    if (!nextEndDate) return;
    setNewBlockEndDate(nextEndDate);
    const mins = computeDurationMinutes(
      newBlockStartDate,
      newBlockStartTime,
      nextEndDate,
      newBlockEndTime
    );
    setNewBlockDurationMinutes(mins);
  };

  const handleBlockEndTimeChange = (nextEndTime: string) => {
    if (!nextEndTime) return;
    setNewBlockEndTime(nextEndTime);
    const mins = computeDurationMinutes(
      newBlockStartDate,
      newBlockStartTime,
      newBlockEndDate,
      nextEndTime
    );
    setNewBlockDurationMinutes(mins);
  };

  const handlePickBlockDuration = (minutes: number) => {
    setNewBlockDurationMinutes(minutes);
    const nextEnd = addMinutesToDateTime(newBlockStartDate, newBlockStartTime, minutes);
    setNewBlockEndDate(nextEnd.dateKey);
    setNewBlockEndTime(nextEnd.time);
  };

  const computedBlockMinutes = computeDurationMinutes(
    newBlockStartDate,
    newBlockStartTime,
    newBlockEndDate,
    newBlockEndTime
  );
  const isBlockRangeValid = computedBlockMinutes > 0;

  const saveLocalBlock = (
    title: string,
    dateKey: string,
    endDateKey: string | undefined,
    startTime: string,
    endTime: string,
    calendarName: string,
    recurrence?: RecurrenceRule
  ) => {
    const resolvedEndKey = endDateKey && endDateKey > dateKey ? endDateKey : undefined;
    const mins = computeDurationMinutes(
      dateKey,
      startTime,
      resolvedEndKey || dateKey,
      endTime
    );
    const normalizedRecurrence = normalizeRecurrenceRule(recurrence);
    const created: CalendarEvent = {
      id: `ev-${Date.now()}`,
      title,
      dateKey,
      endDateKey: resolvedEndKey,
      startTime,
      endTime,
      durationMinutes: mins > 0 ? mins : 60,
      calendarName,
      location: 'Focus block',
      ...(normalizedRecurrence ? { recurrence: normalizedRecurrence } : {}),
      source: 'local',
    };
    onAddEvent(created);
    setNewBlockTitle('');
    setNewBlockRecurrence(undefined);
    setShowCustomBlockRepeat(false);
    setNewBlockSaveToGoogle(false);
    setShowAddBlock(false);
  };

  const handleCreateBlock = (e: React.FormEvent) => {
    e.preventDefault();
    const title = newBlockTitle.trim();
    if (!title || !isBlockRangeValid) return;
    const resolvedEndDate =
      newBlockEndDate && newBlockEndDate !== newBlockStartDate ? newBlockEndDate : undefined;
    const calName = taskLists.includes(newBlockList) ? newBlockList : taskLists[0] || 'Work';
    const normalizedRecurrence = normalizeRecurrenceRule(newBlockRecurrence);

    const canWriteGoogle =
      googleCalendarSync && (googleCalendar.isConnected || Boolean(googleCalendar.userEmail));

    if (newBlockSaveToGoogle && canWriteGoogle) {
      const willSyncLive = isOnline && googleCalendar.isConnected;
      setNewBlockTitle('');
      setNewBlockRecurrence(undefined);
      setShowCustomBlockRepeat(false);
      setNewBlockSaveToGoogle(false);
      setShowAddBlock(false);
      void googleCalendar
        .onCreateGoogleEvent({
          title,
          dateKey: newBlockStartDate,
          endDateKey: resolvedEndDate,
          startTime: newBlockStartTime,
          endTime: newBlockEndTime,
          calendarName: calName,
          recurrence: normalizedRecurrence,
        })
        .then(() => {
          showConvertedNotice(
            willSyncLive
              ? `Added "${title}" to Google Calendar`
              : `Saved "${title}" · queued for Google Calendar`,
            2600
          );
        })
        .catch(() => {
          // Error surfaced via googleCalendar.error
        });
      return;
    }

    saveLocalBlock(
      title,
      newBlockStartDate,
      resolvedEndDate,
      newBlockStartTime,
      newBlockEndTime,
      calName,
      normalizedRecurrence
    );
  };

  const handleConfirmMutation = async () => {
    if (!pendingMutation || mutationBusy) return;
    setMutationBusy(true);
    try {
      if (pendingMutation.action === 'create') {
        await googleCalendar.onCreateGoogleEvent({
          title: pendingMutation.title,
          dateKey: pendingMutation.dateKey,
          endDateKey: pendingMutation.endDateKey,
          startTime: pendingMutation.startTime,
          endTime: pendingMutation.endTime,
          calendarName: pendingMutation.calendarName,
          recurrence: pendingMutation.recurrence,
        });
        setNewBlockTitle('');
        setNewBlockRecurrence(undefined);
        setShowCustomBlockRepeat(false);
        setNewBlockSaveToGoogle(false);
        setShowAddBlock(false);
        showConvertedNotice(
          isOnline && googleCalendar.isConnected
            ? `Added "${pendingMutation.title}" to Google Calendar`
            : `Saved "${pendingMutation.title}" · queued for Google Calendar`,
          2600
        );
      } else {
        await googleCalendar.onDeleteGoogleEvent(
          pendingMutation.eventId,
          pendingMutation.googleEventId
        );
        showConvertedNotice(
          isOnline && googleCalendar.isConnected
            ? `Removed "${pendingMutation.title}" from Google Calendar`
            : `Removed "${pendingMutation.title}" · queued for Google Calendar`,
          2600
        );
      }
      setPendingMutation(null);
    } catch {
      // Error surfaced via googleCalendar.error
      setPendingMutation(null);
    } finally {
      setMutationBusy(false);
    }
  };

  const handleConvert = (ev: CalendarEvent) => {
    const createdTaskId = onConvertEventToTask(ev);
    if (createdTaskId) {
      onSelectTask(createdTaskId);
    }
    showConvertedNotice(`Added "${ev.title}" to tasks`, 2400);
  };

  const resetCalendarGesture = () => {
    swipeOriginRef.current = null;
    setPullOffset(0);
    window.setTimeout(() => {
      didSwipeRef.current = false;
    }, 80);
  };

  // Native non-passive touch listeners so mobile PWA / Android Chrome never hijacks pull-down
  useEffect(() => {
    const calEl = calendarContainerRef.current;
    const cleanups: Array<() => void> = [];

    const expandToMonth = () => {
      const dt = parseLocalDate(selectedDateKeyRef.current);
      setViewYear(dt.getFullYear());
      setViewMonth(dt.getMonth());
      setCalendarExpanded(true);
      didSwipeRef.current = true;
      setPullOffset(0);
    };

    const collapseToWeek = () => {
      setCalendarExpanded(false);
      setMonthYearPickerOpen(false);
      didSwipeRef.current = true;
      setPullOffset(0);
    };

    if (calEl) {
      let origin: { x: number; y: number; handled: boolean } | null = null;

      const onTouchStart = (e: TouchEvent) => {
        if (e.touches.length !== 1) {
          origin = null;
          return;
        }
        const t = e.touches[0];
        origin = { x: t.clientX, y: t.clientY, handled: false };
        didSwipeRef.current = false;
      };

      const onTouchMove = (e: TouchEvent) => {
        if (!origin || origin.handled || e.touches.length !== 1) return;
        const t = e.touches[0];
        const dx = t.clientX - origin.x;
        const dy = t.clientY - origin.y;
        const absX = Math.abs(dx);
        const absY = Math.abs(dy);
        const expanded = calendarExpandedRef.current;

        if (!expanded && dy > 5 && absY >= absX) {
          if (e.cancelable) e.preventDefault();
          setPullOffset(Math.min(18, dy * 0.45));
          if (dy >= 22) {
            origin.handled = true;
            expandToMonth();
          }
          return;
        }

        if (expanded && dy < -5 && absY >= absX) {
          if (e.cancelable) e.preventDefault();
          if (dy <= -22) {
            origin.handled = true;
            collapseToWeek();
          }
          return;
        }

        if (expanded && !monthYearPickerOpenRef.current && absX > 8 && absX > absY * 1.15) {
          if (e.cancelable) e.preventDefault();
          if (absX >= 34) {
            origin.handled = true;
            const delta = dx < 0 ? 1 : -1;
            setMonthSlideDir(delta >= 0 ? 1 : -1);
            const next = new Date(viewYearRef.current, viewMonthRef.current + delta, 1);
            setViewYear(next.getFullYear());
            setViewMonth(next.getMonth());
            setYearWindowStart(next.getFullYear() - 2);
            didSwipeRef.current = true;
            setPullOffset(0);
          }
          return;
        }

        if (!expanded && absX > 8 && absX > absY * 1.15) {
          if (e.cancelable) e.preventDefault();
          if (absX >= 30) {
            origin.handled = true;
            const delta = dx < 0 ? 1 : -1;
            setWeekSlideDir(delta >= 0 ? 1 : -1);
            setSelectedDateKey(addDaysToDateKey(selectedDateKeyRef.current, delta * 7));
            didSwipeRef.current = true;
            setPullOffset(0);
          }
        }
      };

      const onTouchEnd = () => {
        origin = null;
        setPullOffset(0);
        window.setTimeout(() => {
          didSwipeRef.current = false;
        }, 80);
      };

      calEl.addEventListener('touchstart', onTouchStart, { passive: true });
      calEl.addEventListener('touchmove', onTouchMove, { passive: false });
      calEl.addEventListener('touchend', onTouchEnd, { passive: true });
      calEl.addEventListener('touchcancel', onTouchEnd, { passive: true });

      cleanups.push(() => {
        calEl.removeEventListener('touchstart', onTouchStart);
        calEl.removeEventListener('touchmove', onTouchMove);
        calEl.removeEventListener('touchend', onTouchEnd);
        calEl.removeEventListener('touchcancel', onTouchEnd);
      });
    }

    return () => {
      cleanups.forEach((fn) => fn());
    };
  }, [posture, selectedTaskId]);

  // Desktop mouse / pen drag support (touch is handled natively above without pointer capture)
  const handleCalendarPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch') return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    swipeOriginRef.current = { x: e.clientX, y: e.clientY };
    didSwipeRef.current = false;
  };

  const handleCalendarPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch') return;
    if (!swipeOriginRef.current) return;
    if (e.pointerType === 'mouse' && e.buttons === 0) {
      resetCalendarGesture();
      return;
    }

    const dx = e.clientX - swipeOriginRef.current.x;
    const dy = e.clientY - swipeOriginRef.current.y;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);

    if (!calendarExpanded && dy > 0 && absY > absX) {
      setPullOffset(Math.min(16, dy * 0.4));
    }

    if (calendarExpanded && !monthYearPickerOpen && absX > 30 && absX > absY * 1.2) {
      stepMonth(dx < 0 ? 1 : -1);
      swipeOriginRef.current = null;
      didSwipeRef.current = true;
      setPullOffset(0);
      return;
    }

    if (!calendarExpanded && absX > 30 && absX > absY * 1.2) {
      stepWeek(dx < 0 ? 1 : -1);
      swipeOriginRef.current = null;
      didSwipeRef.current = true;
      setPullOffset(0);
      return;
    }

    if (!calendarExpanded && dy > 20 && absY >= absX) {
      const dt = parseLocalDate(selectedDateKey);
      setViewYear(dt.getFullYear());
      setViewMonth(dt.getMonth());
      setCalendarExpanded(true);
      swipeOriginRef.current = null;
      didSwipeRef.current = true;
      setPullOffset(0);
      return;
    }

    if (calendarExpanded && dy < -20 && absY >= absX) {
      setCalendarExpanded(false);
      setMonthYearPickerOpen(false);
      swipeOriginRef.current = null;
      didSwipeRef.current = true;
      setPullOffset(0);
    }
  };

  const handleCalendarPointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch') return;
    resetCalendarGesture();
  };

  const handleYearRibbonMove = (x: number) => {
    if (yearSwipeOriginXRef.current === null) return;
    const dx = x - yearSwipeOriginXRef.current;
    if (Math.abs(dx) > 24) {
      stepYearWindow(dx < 0 ? 1 : -1);
      yearSwipeOriginXRef.current = null;
      didSwipeRef.current = true;
    }
  };

  const handleDaySelect = (dateKey: string, collapseMonth: boolean) => {
    if (didSwipeRef.current) return;
    setSelectedDateKey(dateKey);
    if (collapseMonth) {
      setCalendarExpanded(false);
      setMonthYearPickerOpen(false);
    }
  };

  const yearChoices = Array.from({ length: 5 }, (_, i) => yearWindowStart + i);

  const renderDayBlips = (dateKey: string, active: boolean, isToday: boolean) => {
    if (isToday || active) {
      return (
        <span className="mt-0.5 h-1.5 flex items-center justify-center" aria-hidden="true">
          <span
            className={`w-3 h-1 rounded-full ${
              active ? 'bg-current' : 'bg-[var(--tf-accent)]'
            }`}
          />
        </span>
      );
    }

    const info = dayIndicatorsByKey.get(dateKey);
    const hasEvent = Boolean(info?.hasEvent);
    const hasTask = Boolean(info?.hasActiveTask || info?.hasCompletedTask);

    return (
      <span className="mt-0.5 h-1.5 flex items-center justify-center gap-0.5" aria-hidden="true">
        {hasEvent && (
          <span className="w-1.5 h-1.5 rounded-full bg-black dark:bg-white" />
        )}
        {hasTask && (
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--tf-accent)]" />
        )}
      </span>
    );
  };

  const getDayActivityLabel = (dateKey: string) => {
    const info = dayIndicatorsByKey.get(dateKey);
    const hasEvent = Boolean(info?.hasEvent);
    const hasTask = Boolean(info?.hasActiveTask || info?.hasCompletedTask);
    if (hasEvent && hasTask) return ', has events and tasks';
    if (hasEvent) return ', has events';
    if (hasTask) return ', has tasks';
    return '';
  };

  const renderCalendarSection = (compact = false) => (
    <div
      ref={calendarContainerRef}
      onPointerDown={handleCalendarPointerDown}
      onPointerMove={handleCalendarPointerMove}
      onPointerUp={handleCalendarPointerEnd}
      onPointerCancel={handleCalendarPointerEnd}
      className="select-none touch-none overflow-hidden"
    >
      {calendarExpanded ? (
        <div
          key="month-view"
          className={`${tokens.cardBg} ${tokens.cardRadius} overflow-hidden cal-fade-in`}
        >
          <div className="px-2.5 pt-2 pb-1.5 space-y-1.5">
            {/* Month + Swipeable Year Header */}
            <div className="flex items-center justify-between gap-1 px-0.5">
              <div className="flex items-center gap-1 min-w-0">
                <button
                  type="button"
                  onClick={() => stepMonth(-1)}
                  aria-label="Previous month"
                  className="p-1.5 text-stone-400 hover:text-stone-800 dark:hover:text-stone-100 rounded-lg touch-none"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!didSwipeRef.current) {
                      setMonthYearPickerOpen((v) => !v);
                    }
                  }}
                  title="Select month and year"
                  aria-expanded={monthYearPickerOpen}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 text-[14px] font-semibold whitespace-nowrap ${tokens.buttonRadius} transition-colors ${
                    monthYearPickerOpen
                      ? tokens.accentBg
                      : `${tokens.subtleBg} text-stone-800 dark:text-stone-100 hover:text-[var(--tf-accent-text)]`
                  }`}
                >
                  <span>{monthGrid.monthName}</span>
                  <ChevronDown
                    className={`w-3.5 h-3.5 opacity-65 transition-transform duration-150 ${
                      monthYearPickerOpen ? 'rotate-180' : ''
                    }`}
                  />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!didSwipeRef.current) {
                      setMonthYearPickerOpen((v) => !v);
                    }
                  }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    yearSwipeOriginXRef.current = e.clientX;
                  }}
                  onPointerMove={(e) => {
                    if (yearSwipeOriginXRef.current === null) return;
                    if (e.pointerType === 'mouse' && e.buttons === 0) {
                      yearSwipeOriginXRef.current = null;
                      return;
                    }
                    const dx = e.clientX - yearSwipeOriginXRef.current;
                    if (Math.abs(dx) > 18) {
                      stepSelectedYear(dx < 0 ? 1 : -1);
                      yearSwipeOriginXRef.current = null;
                      didSwipeRef.current = true;
                    }
                  }}
                  onPointerUp={(e) => {
                    e.stopPropagation();
                    yearSwipeOriginXRef.current = null;
                  }}
                  onPointerCancel={(e) => {
                    e.stopPropagation();
                    yearSwipeOriginXRef.current = null;
                  }}
                  title="Tap to pick month & year, or swipe left/right to change year"
                  aria-expanded={monthYearPickerOpen}
                  className={`px-2 py-0.5 text-[13.5px] font-semibold tabular-nums whitespace-nowrap ${tokens.buttonRadius} transition-colors ${
                    monthYearPickerOpen
                      ? tokens.accentBg
                      : `${tokens.subtleBg} text-stone-700 dark:text-stone-200 hover:text-[var(--tf-accent-text)]`
                  }`}
                >
                  {viewYear}
                </button>
                <button
                  type="button"
                  onClick={() => stepMonth(1)}
                  aria-label="Next month"
                  className="p-1.5 text-stone-400 hover:text-stone-800 dark:hover:text-stone-100 rounded-lg touch-none"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {(selectedDateKey !== todayDateKey || viewYear !== todayYear || viewMonth !== todayMonth) && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedDateKey(todayDateKey);
                      setViewYear(todayYear);
                      setViewMonth(todayMonth);
                      setMonthYearPickerOpen(false);
                      setCalendarExpanded(false);
                    }}
                    className={`px-2 py-1 text-[12px] font-semibold whitespace-nowrap ${tokens.accentSoftBg} ${tokens.accentText} ${tokens.buttonRadius}`}
                  >
                    Today
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setCalendarExpanded(false);
                    setMonthYearPickerOpen(false);
                  }}
                  aria-label="Collapse monthly view"
                  className="p-1.5 text-stone-400 hover:text-stone-700 dark:hover:text-stone-200"
                >
                  <ChevronUp className="w-4 h-4" />
                </button>
              </div>
            </div>

            {monthYearPickerOpen ? (
              /* Combined Month + Year Selector */
              <div
                onPointerDown={(e) => {
                  e.stopPropagation();
                  didSwipeRef.current = false;
                }}
                onTouchStart={(e) => e.stopPropagation()}
                className="space-y-2 py-1 cal-fade-in"
              >
                {/* Swipeable Year Strip */}
                <div
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    yearSwipeOriginXRef.current = e.clientX;
                    didSwipeRef.current = false;
                  }}
                  onPointerMove={(e) => {
                    e.stopPropagation();
                    if (e.pointerType === 'mouse' && e.buttons === 0) {
                      yearSwipeOriginXRef.current = null;
                      return;
                    }
                    handleYearRibbonMove(e.clientX);
                  }}
                  onPointerUp={(e) => {
                    e.stopPropagation();
                    yearSwipeOriginXRef.current = null;
                    window.setTimeout(() => {
                      didSwipeRef.current = false;
                    }, 50);
                  }}
                  onPointerCancel={(e) => {
                    e.stopPropagation();
                    yearSwipeOriginXRef.current = null;
                  }}
                  className={`overflow-hidden touch-none ${tokens.subtleBg} ${tokens.buttonRadius} px-1 py-1`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <button
                      type="button"
                      onClick={() => stepYearWindow(-1)}
                      aria-label="Earlier years"
                      className="p-1.5 text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 shrink-0"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <div
                      key={yearWindowStart}
                      className={`flex-1 grid grid-cols-5 gap-1 ${yearSlideDir >= 0 ? 'cal-slide-next' : 'cal-slide-prev'}`}
                    >
                      {yearChoices.map((yr) => {
                        const activeYear = yr === viewYear;
                        const isCurrentYear = yr === todayYear;
                        return (
                          <button
                            key={yr}
                            type="button"
                            onClick={() => {
                              if (didSwipeRef.current) return;
                              setViewYear(yr);
                            }}
                            className={`py-1.5 text-[12.5px] font-semibold tabular-nums ${tokens.buttonRadius} transition-colors ${
                              activeYear
                                ? tokens.accentBg
                                : isCurrentYear
                                  ? `${tokens.accentSoftBg} ${tokens.accentText} ring-1 ring-inset ring-[var(--tf-accent)]`
                                  : 'text-stone-600 dark:text-stone-300 hover:bg-white/70 dark:hover:bg-stone-800'
                            }`}
                          >
                            {yr}
                          </button>
                        );
                      })}
                    </div>
                    <button
                      type="button"
                      onClick={() => stepYearWindow(1)}
                      aria-label="Later years"
                      className="p-1.5 text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 shrink-0"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* 12-Month Grid */}
                <div className="grid grid-cols-4 gap-1.5 px-0.5">
                  {SHORT_MONTHS.map((shortLabel, monthIdx) => {
                    const activeMonth = monthIdx === viewMonth;
                    const isCurrentMonth = viewYear === todayYear && monthIdx === todayMonth;
                    const monthActivity = activeMonthsInViewYear.get(monthIdx);
                    const hasMonthTask = Boolean(monthActivity?.hasTask);
                    const hasMonthEvent = Boolean(monthActivity?.hasEvent);
                    const hasMonthActivity = hasMonthTask || hasMonthEvent;
                    return (
                      <button
                        key={shortLabel}
                        type="button"
                        onClick={() => {
                          if (didSwipeRef.current) return;
                          setMonthSlideDir(monthIdx >= viewMonth ? 1 : -1);
                          setViewMonth(monthIdx);
                          setMonthYearPickerOpen(false);
                        }}
                        aria-label={`${MONTH_NAMES[monthIdx]} ${viewYear}${hasMonthActivity ? ', has scheduled items' : ''}`}
                        className={`relative py-2 flex flex-col items-center justify-center text-[13px] font-semibold ${tokens.buttonRadius} transition-colors ${
                          activeMonth
                            ? tokens.accentBg
                            : isCurrentMonth
                              ? `${tokens.accentSoftBg} ${tokens.accentText} ring-1 ring-inset ring-[var(--tf-accent)]`
                              : `${tokens.subtleBg} text-stone-700 dark:text-stone-200 hover:opacity-85`
                        }`}
                      >
                        <span className="leading-none">{shortLabel}</span>
                        <span
                          aria-hidden="true"
                          className="mt-1 h-1 flex items-center justify-center gap-0.5"
                        >
                          {hasMonthEvent && (
                            <span
                              className={`w-1 h-1 rounded-full ${
                                activeMonth ? 'bg-black ring-1 ring-white/35' : 'bg-black dark:bg-white'
                              }`}
                            />
                          )}
                          {hasMonthTask && (
                            <span
                              className={`w-1 h-1 rounded-full ${
                                activeMonth ? 'bg-white/95 ring-1 ring-black/15' : 'bg-[var(--tf-accent)]'
                              }`}
                            />
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <>
                {/* Weekday Labels */}
                <div className="grid grid-cols-7 gap-1 text-center">
                  {MON_FIRST_LABELS.map((wd) => (
                    <span key={wd} className="text-[11px] font-medium text-stone-400 dark:text-stone-500">
                      {wd}
                    </span>
                  ))}
                </div>

                {/* Horizontally Swipeable Month Grid */}
                <div className="relative overflow-hidden py-0.5 px-0.5">
                  <div
                    key={`${viewYear}-${viewMonth}`}
                    className={`grid grid-cols-7 gap-1 ${monthSlideDir >= 0 ? 'cal-slide-next' : 'cal-slide-prev'}`}
                  >
                    {monthGrid.cells.map((cell, idx) => {
                      if (!cell) {
                        return <div key={`empty-${idx}`} className="h-8" />;
                      }
                      const active = cell.dateKey === selectedDateKey;
                      const isToday = cell.dateKey === todayDateKey;
                      return (
                        <button
                          key={cell.dateKey}
                          type="button"
                          onClick={() => handleDaySelect(cell.dateKey, true)}
                          aria-label={`${cell.fullLabel}${isToday ? ' (Today)' : ''}${getDayActivityLabel(cell.dateKey)}`}
                          className={`relative h-8 flex flex-col items-center justify-center touch-none ${tokens.buttonRadius} transition-colors ${
                            active
                              ? tokens.accentBg
                              : isToday
                                ? `${tokens.accentSoftBg} ${tokens.accentText} ring-1 ring-inset ring-[var(--tf-accent)] font-semibold`
                                : 'text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800/70'
                          }`}
                        >
                          <span className="text-[13px] font-medium tabular-nums leading-none">
                            {cell.dayNum}
                          </span>
                          {renderDayBlips(cell.dateKey, active, isToday)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            )}

            <button
              type="button"
              onClick={() => {
                setCalendarExpanded(false);
                setMonthYearPickerOpen(false);
              }}
              aria-label="Swipe up or tap to minimize calendar"
              className="w-full py-1.5 flex justify-center touch-none"
            >
              <span className="w-10 h-1 rounded-full bg-stone-300 dark:bg-stone-600" />
            </button>
          </div>
        </div>
      ) : (
        <div key="week-view" className="overflow-hidden cal-fade-in">
          <div className="relative overflow-hidden pt-0.5 px-0.5">
            <div
              key={weekDays[0]?.dateKey || selectedDateKey}
              className={`grid grid-cols-7 gap-1.5 ${weekSlideDir >= 0 ? 'cal-slide-next' : 'cal-slide-prev'}`}
            >
              {weekDays.map((day) => {
                const active = day.dateKey === selectedDateKey;
                const isToday = day.dateKey === todayDateKey;
                return (
                  <button
                    key={day.dateKey}
                    type="button"
                    onClick={() => handleDaySelect(day.dateKey, false)}
                    aria-label={`${day.fullLabel}${isToday ? ' (Today)' : ''}${getDayActivityLabel(day.dateKey)}`}
                    className={`relative flex flex-col items-center touch-none ${compact ? 'py-1.5' : 'py-2'} ${tokens.buttonRadius} transition-colors ${
                      active
                        ? `${tokens.accentBg}${isToday ? ' ring-1 ring-inset ring-white/40 dark:ring-black/25' : ''}`
                        : isToday
                          ? `${tokens.accentSoftBg} ${tokens.accentText} ring-1 ring-inset ring-[var(--tf-accent)]`
                          : `${tokens.subtleBg} text-stone-700 dark:text-stone-300 hover:opacity-85`
                    }`}
                  >
                    <span
                      className={`text-[11px] font-medium leading-none ${
                        active ? 'opacity-85' : isToday ? tokens.accentText : 'text-stone-400'
                      }`}
                    >
                      {isToday ? 'Today' : day.short}
                    </span>
                    <span className="text-[14.5px] font-semibold tabular-nums leading-tight mt-0.5">
                      {day.dayNum}
                    </span>
                    {renderDayBlips(day.dateKey, active, isToday)}
                  </button>
                );
              })}
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              if (didSwipeRef.current) return;
              setCalendarExpanded(true);
            }}
            title="Pull down or tap for month view"
            aria-label="Pull down or tap to expand monthly calendar"
            style={
              pullOffset > 0
                ? { transform: `translateY(${pullOffset}px)`, transition: 'none' }
                : { transform: 'translateY(0px)', transition: 'transform 160ms ease-out' }
            }
            className="w-full py-1.5 flex items-center justify-center group touch-none"
          >
            <span className="w-10 h-1 rounded-full bg-stone-300 dark:bg-stone-600 group-hover:bg-[var(--tf-accent)] transition-colors" />
          </button>
        </div>
      )}
    </div>
  );

  const renderScheduleSection = (compact = false) => (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-[13.5px] font-semibold text-stone-700 dark:text-stone-300">
            Schedule
          </span>
          <span className="text-[12px] text-stone-400 dark:text-stone-500 truncate">
            ·{' '}
            {googleCalendarSync && (googleCalendar.isConnected || googleCalendar.userEmail)
              ? 'Cloud & Google'
              : 'buh. Cloud'}
          </span>
          {googleCalendarSync && (googleCalendar.isConnected || googleCalendar.userEmail) && (
            <button
              type="button"
              disabled={googleCalendar.isSyncing || googleCalendar.isSigningIn}
              onClick={() => void googleCalendar.onSyncNow()}
              title={
                googleCalendar.isConnected
                  ? 'Sync Google Calendar'
                  : 'Refresh Google Calendar'
              }
              aria-label={
                googleCalendar.isConnected
                  ? 'Sync Google Calendar'
                  : 'Refresh Google Calendar'
              }
              className="relative p-1 text-stone-400 hover:text-[var(--tf-accent-text)] transition-colors disabled:opacity-50"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${
                  googleCalendar.isSyncing || googleCalendar.isSigningIn ? 'animate-spin' : ''
                }`}
              />
              {!googleCalendar.isConnected && (googleCalendar.pendingSyncCount ?? 0) > 0 && (
                <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-amber-500" />
              )}
            </button>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {googleCalendarSync && !googleCalendar.isConnected && !googleCalendar.userEmail && (
            <GoogleSignInButton
              compact
              onClick={() => googleCalendar.onSignIn()}
              loading={googleCalendar.isSigningIn}
              label="Connect"
            />
          )}
          <button
            type="button"
            onClick={() => {
              if (showAddBlock) {
                setShowAddBlock(false);
              } else {
                openAddBlockForm();
              }
            }}
            className={`inline-flex items-center gap-1 px-2.5 py-1 text-[12.5px] font-medium ${tokens.accentSoftBg} ${tokens.accentText} ${tokens.buttonRadius} whitespace-nowrap shrink-0`}
          >
            <Plus className="w-3.5 h-3.5" />
            Block
          </button>
        </div>
      </div>

      {googleCalendar.error && (
        <div className="px-2.5 py-1.5 text-[12px] text-rose-600 dark:text-rose-400 bg-rose-500/10 rounded-lg">
          {googleCalendar.error}
        </div>
      )}

      {showAddBlock && (
        <form onSubmit={handleCreateBlock} className={`${tokens.cardBg} ${tokens.cardRadius} p-3 space-y-2.5`}>
          <input
            type="text"
            value={newBlockTitle}
            onChange={(e) => setNewBlockTitle(e.target.value)}
            placeholder="Focus block or meeting..."
            className={`w-full text-[14px] px-2.5 py-2 ${tokens.subtleBg} text-stone-800 dark:text-stone-100 placeholder:text-stone-400 ${tokens.buttonRadius} focus:outline-none`}
          />

          {/* Quick Duration Presets + Live Computed Duration */}
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px] font-medium text-stone-500 dark:text-stone-400">
                Duration
              </span>
              <span
                className={`text-[12px] tabular-nums font-medium ${
                  isBlockRangeValid ? tokens.accentText : 'text-rose-500'
                }`}
              >
                {isBlockRangeValid ? formatDurationLabel(computedBlockMinutes) : 'End must be after start'}
              </span>
            </div>
            <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
              {DURATION_PRESETS.map((preset) => {
                const active = computedBlockMinutes === preset.minutes;
                return (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => handlePickBlockDuration(preset.minutes)}
                    className={`px-2 py-1 text-[12px] font-medium tabular-nums whitespace-nowrap shrink-0 ${tokens.buttonRadius} border transition-colors ${
                      active
                        ? `${tokens.accentSoftBg} ${tokens.accentText} ${tokens.accentBorder}`
                        : `${tokens.subtleBg} text-stone-600 dark:text-stone-300 border-transparent hover:opacity-85`
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Start & End Date / Time Pickers */}
          <div className="space-y-1.5">
            <div className="grid grid-cols-[44px_1fr_auto] items-center gap-1.5">
              <span className="text-[12px] font-medium text-stone-500 dark:text-stone-400">
                Starts
              </span>
              <input
                type="date"
                aria-label="Start date"
                value={newBlockStartDate}
                onChange={(e) => handleBlockStartDateChange(e.target.value)}
                className={`min-w-0 text-[12.5px] px-2 py-1.5 tabular-nums ${tokens.subtleBg} text-stone-800 dark:text-stone-100 ${tokens.buttonRadius} focus:outline-none`}
              />
              <input
                type="time"
                aria-label="Start time"
                value={newBlockStartTime}
                onChange={(e) => handleBlockStartTimeChange(e.target.value)}
                className={`text-[12.5px] px-2 py-1.5 tabular-nums ${tokens.subtleBg} text-stone-800 dark:text-stone-100 ${tokens.buttonRadius} focus:outline-none`}
              />
            </div>

            <div className="grid grid-cols-[44px_1fr_auto] items-center gap-1.5">
              <span className="text-[12px] font-medium text-stone-500 dark:text-stone-400">
                Ends
              </span>
              <input
                type="date"
                aria-label="End date"
                min={newBlockStartDate}
                value={newBlockEndDate}
                onChange={(e) => handleBlockEndDateChange(e.target.value)}
                className={`min-w-0 text-[12.5px] px-2 py-1.5 tabular-nums ${tokens.subtleBg} text-stone-800 dark:text-stone-100 ${tokens.buttonRadius} focus:outline-none`}
              />
              <input
                type="time"
                aria-label="End time"
                value={newBlockEndTime}
                onChange={(e) => handleBlockEndTimeChange(e.target.value)}
                className={`text-[12.5px] px-2 py-1.5 tabular-nums ${tokens.subtleBg} text-stone-800 dark:text-stone-100 ${tokens.buttonRadius} focus:outline-none`}
              />
            </div>
          </div>

          {/* Repeat Selector for Recurring Events */}
          <div className="space-y-1.5 pt-0.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px] font-medium text-stone-500 dark:text-stone-400 inline-flex items-center gap-1">
                <Repeat className="w-3 h-3" />
                Repeat
              </span>
              {newBlockRecurrence && (
                <span className={`text-[12px] font-medium ${tokens.accentText} truncate`}>
                  {formatRecurrenceLabel(newBlockRecurrence)}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
              {RECURRENCE_PRESETS.map((preset) => {
                const active = getPresetIdForRule(newBlockRecurrence) === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => {
                      setNewBlockRecurrence(buildRuleFromPreset(preset.id, newBlockStartDate));
                      if (preset.id === 'none') setShowCustomBlockRepeat(false);
                    }}
                    className={`px-2 py-1 text-[12px] font-medium whitespace-nowrap shrink-0 ${tokens.buttonRadius} border transition-colors ${
                      active
                        ? `${tokens.accentSoftBg} ${tokens.accentText} ${tokens.accentBorder}`
                        : `${tokens.subtleBg} text-stone-600 dark:text-stone-300 border-transparent hover:opacity-85`
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => {
                  if (!newBlockRecurrence) {
                    setNewBlockRecurrence({
                      frequency: 'weekly',
                      interval: 1,
                      daysOfWeek: [parseDateKeyLocal(newBlockStartDate).getDay()],
                    });
                  }
                  setShowCustomBlockRepeat((v) => !v);
                }}
                className={`px-2 py-1 text-[12px] font-medium whitespace-nowrap shrink-0 ${tokens.buttonRadius} border transition-colors ${
                  showCustomBlockRepeat || getPresetIdForRule(newBlockRecurrence) === 'custom'
                    ? `${tokens.accentSoftBg} ${tokens.accentText} ${tokens.accentBorder}`
                    : `${tokens.subtleBg} text-stone-600 dark:text-stone-300 border-transparent hover:opacity-85`
                }`}
              >
                Custom
              </button>
            </div>

            {newBlockRecurrence &&
              (showCustomBlockRepeat || getPresetIdForRule(newBlockRecurrence) === 'custom') && (
                <div className={`space-y-1.5 p-2 ${tokens.subtleBg} ${tokens.buttonRadius}`}>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[12px] text-stone-500 dark:text-stone-400">Every</span>
                    <input
                      type="number"
                      min={1}
                      max={365}
                      aria-label="Event repeat interval"
                      value={newBlockRecurrence.interval}
                      onChange={(e) => {
                        const val = Math.max(1, Math.min(365, parseInt(e.target.value, 10) || 1));
                        setNewBlockRecurrence((prev) =>
                          prev ? { ...prev, interval: val } : { frequency: 'weekly', interval: val }
                        );
                      }}
                      className={`w-12 text-center text-[12px] tabular-nums px-1.5 py-1 bg-white dark:bg-stone-900/70 text-stone-800 dark:text-stone-100 ${tokens.buttonRadius} focus:outline-none`}
                    />
                    <select
                      aria-label="Event repeat frequency"
                      value={newBlockRecurrence.frequency}
                      onChange={(e) => {
                        const nextFreq = e.target.value as RecurrenceFrequency;
                        setNewBlockRecurrence((prev) => ({
                          frequency: nextFreq,
                          interval: prev?.interval ?? 1,
                          daysOfWeek:
                            nextFreq === 'weekly'
                              ? prev?.daysOfWeek ?? [parseDateKeyLocal(newBlockStartDate).getDay()]
                              : undefined,
                          endDateKey: prev?.endDateKey,
                        }));
                      }}
                      className={`text-[12px] px-2 py-1 bg-white dark:bg-stone-900/70 text-stone-800 dark:text-stone-100 ${tokens.buttonRadius} focus:outline-none`}
                    >
                      <option value="daily">{newBlockRecurrence.interval === 1 ? 'day' : 'days'}</option>
                      <option value="weekly">{newBlockRecurrence.interval === 1 ? 'week' : 'weeks'}</option>
                      <option value="monthly">{newBlockRecurrence.interval === 1 ? 'month' : 'months'}</option>
                      <option value="yearly">{newBlockRecurrence.interval === 1 ? 'year' : 'years'}</option>
                    </select>
                  </div>

                  {newBlockRecurrence.frequency === 'weekly' && (
                    <div className="flex items-center gap-1">
                      {WEEKDAY_BUTTONS.map((wd) => {
                        const activeDays = newBlockRecurrence.daysOfWeek?.length
                          ? newBlockRecurrence.daysOfWeek
                          : [parseDateKeyLocal(newBlockStartDate).getDay()];
                        const selected = activeDays.includes(wd.day);
                        return (
                          <button
                            key={wd.day}
                            type="button"
                            onClick={() => {
                              const nextDays = selected
                                ? activeDays.filter((d) => d !== wd.day)
                                : [...activeDays, wd.day];
                              if (nextDays.length === 0) return;
                              setNewBlockRecurrence((prev) =>
                                prev ? { ...prev, daysOfWeek: nextDays } : undefined
                              );
                            }}
                            title={wd.short}
                            aria-label={`Repeat event on ${wd.short}`}
                            aria-pressed={selected}
                            className={`flex-1 py-1 text-[11.5px] font-semibold ${tokens.buttonRadius} transition-colors ${
                              selected
                                ? tokens.accentBg
                                : 'bg-white/80 dark:bg-stone-900/50 text-stone-500 dark:text-stone-400'
                            }`}
                          >
                            {wd.letter}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[12px] text-stone-500 dark:text-stone-400">Ends (optional)</span>
                    <div className="flex items-center gap-1">
                      <input
                        type="date"
                        aria-label="Event repeat until date"
                        min={newBlockStartDate}
                        value={newBlockRecurrence.endDateKey || ''}
                        onChange={(e) =>
                          setNewBlockRecurrence((prev) =>
                            prev ? { ...prev, endDateKey: e.target.value || undefined } : undefined
                          )
                        }
                        className={`w-[122px] text-[12px] tabular-nums px-2 py-1 bg-white dark:bg-stone-900/70 text-stone-700 dark:text-stone-200 ${tokens.buttonRadius} focus:outline-none`}
                      />
                      {newBlockRecurrence.endDateKey && (
                        <button
                          type="button"
                          onClick={() =>
                            setNewBlockRecurrence((prev) =>
                              prev ? { ...prev, endDateKey: undefined } : undefined
                            )
                          }
                          aria-label="Clear event repeat end date"
                          className="p-0.5 text-stone-400 hover:text-stone-700 dark:hover:text-stone-200"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}
          </div>

          {googleCalendarSync && (googleCalendar.isConnected || Boolean(googleCalendar.userEmail)) && (
            <label className="flex items-center justify-between gap-2 px-0.5 pt-0.5 cursor-pointer select-none">
              <span className="text-[12px] text-stone-500 dark:text-stone-400">
                Save to Google Calendar instead of buh. Cloud
              </span>
              <input
                type="checkbox"
                checked={newBlockSaveToGoogle}
                onChange={(e) => setNewBlockSaveToGoogle(e.target.checked)}
                className="w-4 h-4 rounded accent-[var(--tf-accent-text)] cursor-pointer"
              />
            </label>
          )}

          <div className="flex items-center justify-between gap-2 pt-0.5">
            <select
              aria-label="Schedule block list"
              value={taskLists.includes(newBlockList) ? newBlockList : taskLists[0] || 'Work'}
              onChange={(e) => setNewBlockList(e.target.value)}
              className={`text-[13px] px-2.5 py-1.5 ${tokens.subtleBg} text-stone-700 dark:text-stone-200 ${tokens.buttonRadius} focus:outline-none`}
            >
              {taskLists.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setNewBlockSaveToGoogle(false);
                  setShowAddBlock(false);
                }}
                className="px-2.5 py-1.5 text-[13px] text-stone-500 hover:text-stone-800 dark:hover:text-stone-200"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!newBlockTitle.trim() || !isBlockRangeValid}
                className={`px-3.5 py-1.5 text-[13px] font-medium ${tokens.accentBg} ${tokens.buttonRadius} disabled:opacity-45`}
              >
                Save
              </button>
            </div>
          </div>
        </form>
      )}

      {convertedNotice && (
        <div
          className={`px-2.5 py-1 text-[12px] font-medium ${tokens.accentSoftBg} ${tokens.accentText} ${tokens.buttonRadius}`}
        >
          {convertedNotice}
        </div>
      )}

      {dayEvents.length === 0 ? (
        <div className={`${tokens.cardBg} ${tokens.cardRadius} px-3.5 py-2.5 text-center`}>
          <p className="text-[13px] text-stone-400">Open day — no scheduled blocks.</p>
        </div>
      ) : (
        <div className={`${tokens.cardBg} ${tokens.cardRadius} overflow-hidden`}>
          {dayEvents.map((ev) => {
            const isMultiDay = Boolean(ev.endDateKey && ev.endDateKey > ev.dateKey);
            const displayStart = formatTimeDisplay(ev.startTime, timeFormat);
            const displayEnd = formatTimeDisplay(ev.endTime, timeFormat);
            const timeRangeMeta =
              ev.startTime === 'Full'
                ? isMultiDay
                  ? `${formatShortDateKey(ev.dateKey)} – ${formatShortDateKey(ev.endDateKey!)}`
                  : 'All day'
                : isMultiDay
                  ? `${formatShortDateKey(ev.dateKey)} ${displayStart} – ${formatShortDateKey(ev.endDateKey!)} ${displayEnd}`
                  : `${displayStart}–${displayEnd}${ev.durationMinutes ? ` (${formatDurationLabel(ev.durationMinutes)})` : ''}`;
            return (
              <div
                key={ev.id}
                className={`flex items-center justify-between gap-2.5 ${
                  compact ? 'px-3.5 py-2.5' : tokens.rowPadding
                } border-b last:border-b-0 ${tokens.divider}`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span
                    className={`tabular-nums text-[12px] text-stone-500 dark:text-stone-400 shrink-0 truncate ${
                      timeFormat === '12h' && ev.startTime !== 'Full' ? 'w-16' : 'w-11'
                    }`}
                  >
                    {displayStart}
                  </span>
                  <div className="min-w-0">
                    <p className="text-[15px] font-medium text-stone-900 dark:text-stone-100 truncate leading-snug">
                      {ev.title}
                    </p>
                    <p className="text-[12px] text-stone-500 dark:text-stone-400 tabular-nums truncate leading-tight mt-0.5 flex items-center gap-1">
                      <span className="truncate">{timeRangeMeta}</span>
                      <span aria-hidden="true" className="shrink-0">·</span>
                      <span className="truncate">{ev.calendarName}</span>
                      {(ev.recurrence || ev.recurringEventId) && (
                        <>
                          <span aria-hidden="true" className="shrink-0">·</span>
                          <span
                            className={`inline-flex items-center gap-0.5 font-medium shrink-0 ${tokens.accentText}`}
                            title={ev.recurrence ? formatRecurrenceLabel(ev.recurrence) : 'Recurring event'}
                          >
                            <Repeat className="w-3 h-3 shrink-0" />
                            <span>
                              {ev.recurrence ? formatRecurrenceLabel(ev.recurrence, true) : 'Repeats'}
                            </span>
                          </span>
                        </>
                      )}
                      {!compact && ev.location && ev.location !== 'Focus block' && (
                        <>
                          <span aria-hidden="true" className="shrink-0">·</span>
                          <span className="truncate">{ev.location}</span>
                        </>
                      )}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleConvert(ev)}
                    title="Add as task"
                    aria-label={`Convert ${ev.title} to task`}
                    className="p-1.5 text-stone-400 hover:text-[var(--tf-accent-text)] shrink-0"
                  >
                    <CalendarPlus className="w-[18px] h-[18px]" />
                  </button>
                  {ev.source === 'google' && ev.googleEventId ? (
                    <button
                      type="button"
                      onClick={() => {
                        setPendingMutation({
                          action: 'delete',
                          eventId: ev.id,
                          googleEventId: ev.googleEventId!,
                          title: ev.title,
                          dateKey: ev.dateKey,
                          startTime: ev.startTime,
                        });
                      }}
                      title="Delete from Google Calendar"
                      aria-label={`Delete ${ev.title} from Google Calendar`}
                      className="p-1.5 text-stone-400 hover:text-rose-500 shrink-0"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  ) : (
                    onDeleteEvent && (
                      <button
                        type="button"
                        onClick={() => onDeleteEvent(ev.id)}
                        title="Delete schedule block"
                        aria-label={`Delete ${ev.title}`}
                        className="p-1.5 text-stone-400 hover:text-rose-500 shrink-0"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  const renderTaskRow = (task: TaskItem, compact = false, isProjected = false) => {
    const isSelected = !isProjected && task.id === selectedTaskId;
    const isCelebrating = !isProjected && celebratingIds.has(task.id);
    const isSettling = !isProjected && justSettledIds.has(task.id);
    return (
      <div
        key={isProjected ? `proj-${task.id}-${selectedDateKey}` : task.id}
        className={`group flex items-center gap-3 ${
          compact ? 'px-3.5 py-2.5' : tokens.rowPadding
        } transition-colors border-b last:border-b-0 ${tokens.divider} ${
          isSelected ? tokens.accentSoftBg : 'hover:bg-stone-50/80 dark:hover:bg-white/[0.02]'
        } ${isProjected ? 'opacity-80' : ''} ${isSettling ? 'task-row-settle' : ''}`}
      >
        <TaskCheckbox
          checked={task.completed}
          celebrating={isCelebrating}
          isProjected={isProjected}
          tokens={tokens}
          ariaLabel={
            isProjected
              ? `Open recurring task ${task.title}`
              : task.completed
                ? `Mark ${task.title} incomplete`
                : `Complete ${task.title}`
          }
          onClick={() => (isProjected ? onSelectTask(task.id) : onToggleTask(task.id))}
        />

        <button
          type="button"
          onClick={() => onSelectTask(task.id)}
          className="flex-1 min-w-0 text-left"
        >
          <p
            className={`text-[15px] font-medium leading-snug truncate transition-colors duration-250 ${
              task.completed
                ? 'text-stone-400 dark:text-stone-500'
                : 'text-stone-900 dark:text-stone-100'
            }`}
          >
            <span
              className={`inline-block max-w-full truncate align-bottom ${
                isCelebrating
                  ? 'task-strike-sweep'
                  : task.completed
                    ? 'line-through'
                    : ''
              }`}
            >
              {task.title}
            </span>
          </p>
          <TaskMetaRow
            task={task}
            tokens={tokens}
            displayDateKey={isProjected ? selectedDateKey : task.dateKey}
            isProjected={isProjected}
            isDirtyGoogle={googleTasks.dirtyTaskIds.includes(task.id)}
          />
        </button>

        <button
          type="button"
          onClick={() => onSelectTask(task.id)}
          aria-label="Inspect task"
          className="p-1 text-stone-300 dark:text-stone-600 group-hover:text-stone-500 dark:group-hover:text-stone-400 transition-colors"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    );
  };

  const renderGreeting = (compact = false) => {
    const titleText =
      defaultHome === DefaultHome.Inbox ? 'Capture first, sort later.' : 'Overview';

    const dateRight = (
      <div className="flex items-center gap-1.5 shrink-0">
        {selectedDateKey !== todayDateKey && (
          <button
            type="button"
            onClick={() => setSelectedDateKey(todayDateKey)}
            className={`px-2 py-0.5 text-[12px] font-semibold ${tokens.accentSoftBg} ${tokens.accentText} ${tokens.buttonRadius}`}
          >
            Today
          </button>
        )}
        <span className="text-[12.5px] font-medium text-stone-400 dark:text-stone-500 tabular-nums">
          {compact ? dayMeta.compactLabel : dayMeta.fullLabel}
        </span>
      </div>
    );

    if (compact) {
      return (
        <div className="flex items-baseline justify-between gap-2">
          <h2 className={`font-display font-semibold text-stone-900 dark:text-stone-100 ${tokens.headingScale} truncate`}>
            {titleText}
          </h2>
          {dateRight}
        </div>
      );
    }

    return (
      <div className="space-y-0.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[12.5px] font-medium text-stone-400 dark:text-stone-500 tabular-nums">
            {dayMeta.fullLabel}
            {selectedDateKey === todayDateKey ? ' · Today' : ''}
            {defaultHome === DefaultHome.Inbox ? ' · Inbox triage' : ''}
          </span>
          {selectedDateKey !== todayDateKey && (
            <button
              type="button"
              onClick={() => setSelectedDateKey(todayDateKey)}
              className={`px-2 py-0.5 text-[12px] font-semibold ${tokens.accentSoftBg} ${tokens.accentText} ${tokens.buttonRadius}`}
            >
              Jump to today
            </button>
          )}
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <h2 className={`font-display font-semibold text-stone-900 dark:text-stone-100 ${tokens.headingScale}`}>
            {titleText}
          </h2>
          <span className="text-[13px] text-stone-500 dark:text-stone-400 tabular-nums shrink-0">
            {remainingCount} tasks · {dayEvents.length} blocks
          </span>
        </div>
      </div>
    );
  };

  const listHeading =
    defaultHome === DefaultHome.Inbox ? 'Captured items' : 'Tasks';

  const confirmModal = pendingMutation ? (
    <Suspense fallback={null}>
      <CalendarConfirmModal
        pending={pendingMutation}
        tokens={tokens}
        busy={mutationBusy}
        onCancel={() => setPendingMutation(null)}
        onConfirm={handleConfirmMutation}
        onSaveLocalOnly={
          pendingMutation.action === 'create'
            ? () => {
                saveLocalBlock(
                  pendingMutation.title,
                  pendingMutation.dateKey,
                  pendingMutation.endDateKey,
                  pendingMutation.startTime,
                  pendingMutation.endTime,
                  pendingMutation.calendarName,
                  pendingMutation.recurrence
                );
                setPendingMutation(null);
              }
            : undefined
        }
      />
    </Suspense>
  ) : null;

  if (isFlex) {
    return (
      <div className="relative h-full flex flex-col">
        <div className="h-[44%] overflow-y-auto overscroll-y-contain device-scroll px-4 py-2 space-y-2">
          {renderGreeting(true)}
          {renderCalendarSection(true)}
        </div>

        <div className="h-4 flex items-center justify-center relative shrink-0 bg-stone-200/60 dark:bg-black/40 border-y border-stone-300/60 dark:border-stone-800">
          <span className="text-[10.5px] font-mono-tabular text-stone-500 dark:text-stone-400">
            Flex hinge · Schedule & tasks
          </span>
        </div>

        <div className="flex-1 overflow-y-auto device-scroll px-4 pt-2 pb-24 space-y-3">
          {renderScheduleSection(true)}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[13.5px] font-semibold text-stone-700 dark:text-stone-300">{listHeading}</span>
              <span className="text-[12px] text-stone-400 tabular-nums">{remainingCount} remaining</span>
            </div>
            <div className={`${tokens.cardBg} ${tokens.cardRadius} overflow-hidden`}>
              {primaryList.length > 0 || projectedRecurringTasks.length > 0 ? (
                <>
                  {primaryList.map((t) => renderTaskRow(t, true))}
                  {projectedRecurringTasks.map((t) => renderTaskRow(t, true, true))}
                </>
              ) : (
                <div className="p-3.5 text-center text-[13px] text-stone-400">No tasks scheduled.</div>
              )}
            </div>
          </div>
        </div>

        <TaskDetailSheet
          task={selectedTask}
          tokens={tokens}
          taskLists={taskLists}
          heightClass="h-[94%]"
          onClose={() => onSelectTask(null)}
          onToggleTask={onToggleTask}
          onUpdateTask={onUpdateTask}
          onDeleteTask={onDeleteTask}
          isDirtyGoogleTask={Boolean(selectedTask && googleTasks.dirtyTaskIds.includes(selectedTask.id))}
          onSyncGoogleTask={onSyncGoogleTask}
          canPushToGoogle={googleTasksSync && (googleTasks.isConnected || Boolean(googleTasks.userEmail))}
          onPushToGoogle={onPushLocalTaskToGoogle}
        />
        {confirmModal}
      </div>
    );
  }

  if (isExpanded) {
    return (
      <div className="relative h-full flex flex-col px-4 pt-2.5 pb-3 gap-2.5 overflow-hidden">
        <div className="shrink-0">{renderGreeting(true)}</div>

        <div className={`flex-1 min-h-0 grid grid-cols-2 ${hingeAwareSplit ? 'gap-6' : 'gap-4'} overflow-hidden`}>
          {/* Left Pane: Calendar & Schedule */}
          <div
            className="h-full overflow-y-auto overscroll-y-contain device-scroll pr-0.5 space-y-2.5"
          >
            {renderCalendarSection(true)}
            {renderScheduleSection(true)}
          </div>

          {/* Right Pane: Tasks & Pinned notes (or Task Inspector) */}
          <div className="h-full flex flex-col overflow-hidden pl-0.5">
            {selectedTask ? (
              <TaskDetailPane
                task={selectedTask}
                tokens={tokens}
                taskLists={taskLists}
                onClose={() => onSelectTask(null)}
                onToggleTask={onToggleTask}
                onUpdateTask={onUpdateTask}
                onDeleteTask={onDeleteTask}
                isDirtyGoogleTask={googleTasks.dirtyTaskIds.includes(selectedTask.id)}
                onSyncGoogleTask={onSyncGoogleTask}
                canPushToGoogle={googleTasksSync && (googleTasks.isConnected || Boolean(googleTasks.userEmail))}
                onPushToGoogle={onPushLocalTaskToGoogle}
              />
            ) : (
              <div className="flex-1 overflow-y-auto device-scroll space-y-2.5">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[13.5px] font-semibold text-stone-700 dark:text-stone-300">
                      {listHeading}
                    </span>
                    <span className="text-[12px] text-stone-400 dark:text-stone-500 tabular-nums">
                      {remainingCount} remaining
                    </span>
                  </div>
                  <div className={`${tokens.cardBg} ${tokens.cardRadius} overflow-hidden`}>
                    {primaryList.length > 0 || projectedRecurringTasks.length > 0 ? (
                      <>
                        {primaryList.map((t) => renderTaskRow(t, true))}
                        {projectedRecurringTasks.map((t) => renderTaskRow(t, true, true))}
                      </>
                    ) : (
                      <div className="p-3.5 text-center text-[13.5px] text-stone-400">
                        No tasks scheduled for {dayMeta.short}.
                      </div>
                    )}
                  </div>
                </div>

                {defaultHome !== DefaultHome.Inbox && pinnedNotes.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[13.5px] font-semibold text-stone-700 dark:text-stone-300">
                        Pinned notes
                      </span>
                      <span className="text-[12px] text-stone-400 dark:text-stone-500 tabular-nums">
                        {pinnedNotes.length} pinned
                      </span>
                    </div>

                    <div className={`${tokens.cardBg} ${tokens.cardRadius} overflow-hidden`}>
                      {pinnedNotes.map((note) => (
                        <button
                          key={note.id}
                          type="button"
                          onClick={() => onOpenNote(note.id)}
                          className={`w-full flex items-center justify-between gap-2.5 px-3.5 py-2.5 border-b last:border-b-0 ${tokens.divider} text-left hover:bg-stone-50/80 dark:hover:bg-white/[0.02] transition-colors`}
                        >
                          <div className="min-w-0">
                            <p className="text-[15px] font-medium text-stone-900 dark:text-stone-100 truncate leading-snug">
                              {note.title}
                            </p>
                            <p className="text-[12.5px] text-stone-500 dark:text-stone-400 truncate leading-tight mt-0.5">
                              {note.folder} · {note.updatedAt}
                            </p>
                          </div>
                          <ChevronRight className="w-4 h-4 text-stone-300 dark:text-stone-600 shrink-0" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {defaultHome === DefaultHome.Inbox && (
                  <button
                    type="button"
                    onClick={() => onNavigateScreen(ScreenId.Tasks)}
                    className={`w-full flex items-center justify-between px-3.5 py-2.5 text-[14px] font-medium ${tokens.cardBg} ${tokens.cardRadius} text-stone-700 dark:text-stone-200 hover:opacity-90`}
                  >
                    <span>View scheduled Today tasks ({dayTasks.length})</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
        {confirmModal}
      </div>
    );
  }

  // Cover Display (10:16) — TickTick-calibrated overview with smooth pull-down calendar expansion
  return (
    <div className="relative h-full overflow-hidden">
      <div
        className="h-full overflow-y-auto overscroll-y-contain device-scroll px-3.5 pt-2.5 pb-24 space-y-2.5"
      >
        {renderGreeting(true)}
        {renderCalendarSection(true)}
        {renderScheduleSection(true)}

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[13.5px] font-semibold text-stone-700 dark:text-stone-300">{listHeading}</span>
            <span className="text-[12px] text-stone-400 dark:text-stone-500 tabular-nums">
              {remainingCount} remaining
            </span>
          </div>

          <div className={`${tokens.cardBg} ${tokens.cardRadius} overflow-hidden`}>
            {primaryList.length > 0 || projectedRecurringTasks.length > 0 ? (
              <>
                {primaryList.map((t) => renderTaskRow(t, true))}
                {projectedRecurringTasks.map((t) => renderTaskRow(t, true, true))}
              </>
            ) : (
              <div className="p-3.5 text-center text-[13.5px] text-stone-400">
                No tasks scheduled for {dayMeta.short}.
              </div>
            )}
          </div>
        </div>

        {defaultHome !== DefaultHome.Inbox && pinnedNotes.length > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[13.5px] font-semibold text-stone-700 dark:text-stone-300">
                Pinned notes
              </span>
              <span className="text-[12px] text-stone-400 dark:text-stone-500 tabular-nums">
                {pinnedNotes.length} pinned
              </span>
            </div>

            <div className={`${tokens.cardBg} ${tokens.cardRadius} overflow-hidden`}>
              {pinnedNotes.map((note) => (
                <button
                  key={note.id}
                  type="button"
                  onClick={() => onOpenNote(note.id)}
                  className={`w-full flex items-center justify-between gap-2.5 px-3.5 py-2.5 border-b last:border-b-0 ${tokens.divider} text-left hover:bg-stone-50/80 dark:hover:bg-white/[0.02] transition-colors`}
                >
                  <div className="min-w-0">
                    <p className="text-[15px] font-medium text-stone-900 dark:text-stone-100 truncate leading-snug">
                      {note.title}
                    </p>
                    <p className="text-[12.5px] text-stone-500 dark:text-stone-400 truncate leading-tight mt-0.5">
                      {note.folder} · {note.updatedAt}
                    </p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-stone-300 dark:text-stone-600 shrink-0" />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <TaskDetailSheet
        task={selectedTask}
        tokens={tokens}
        taskLists={taskLists}
        heightClass="h-[94%]"
        onClose={() => onSelectTask(null)}
        onToggleTask={onToggleTask}
        onUpdateTask={onUpdateTask}
        onDeleteTask={onDeleteTask}
        isDirtyGoogleTask={Boolean(selectedTask && googleTasks.dirtyTaskIds.includes(selectedTask.id))}
        onSyncGoogleTask={onSyncGoogleTask}
        canPushToGoogle={googleTasksSync && (googleTasks.isConnected || Boolean(googleTasks.userEmail))}
        onPushToGoogle={onPushLocalTaskToGoogle}
      />
      {confirmModal}
    </div>
  );
};
