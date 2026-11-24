import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Bell,
  CalendarPlus,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { TODAY_DATE_KEY } from '../../data/initialData';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { useBackLayer } from '../../hooks/useAndroidBackNavigation';
import {
  CalendarEvent,
  DefaultHome,
  FoldPosture,
  GoogleCalendarSyncState,
  GoogleTasksSyncState,
  NoteItem,
  ScreenId,
  TaskItem,
} from '../../types/taskflow';
import { StyleThemeTokens } from '../../utils/themeTokens';
import { CalendarConfirmModal, PendingCalendarMutation } from '../CalendarConfirmModal';
import { GoogleSignInButton } from '../GoogleSignInButton';
import { TaskDetailPane } from './TaskDetailPane';
import { TaskDetailSheet } from './TaskDetailSheet';

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
  return `${SHORT_MONTHS[dt.getMonth()]} ${dt.getDate()}`;
}

function eventSpansDate(ev: CalendarEvent, dateKey: string): boolean {
  const endKey = ev.endDateKey && ev.endDateKey >= ev.dateKey ? ev.endDateKey : ev.dateKey;
  return ev.dateKey <= dateKey && endKey >= dateKey;
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
  const monthName = MONTH_NAMES[dt.getMonth()];
  const shortMonth = SHORT_MONTHS[dt.getMonth()];
  const shortDay = SHORT_WEEKDAYS[dow];
  return {
    dateKey,
    short: shortDay,
    compactDay: shortDay.slice(0, 1),
    dayNum,
    fullLabel: `${FULL_WEEKDAYS[dow]}, ${dayNum} ${monthName} ${dt.getFullYear()}`,
    compactLabel: `${shortDay}, ${shortMonth} ${dayNum}`,
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
  const isOnline = useOnlineStatus();
  const todayDate = useMemo(() => parseLocalDate(TODAY_DATE_KEY), []);
  const todayYear = todayDate.getFullYear();
  const todayMonth = todayDate.getMonth();

  const [selectedDateKey, setSelectedDateKey] = useState(TODAY_DATE_KEY);
  const [calendarExpanded, setCalendarExpanded] = useState(false);
  const [viewYear, setViewYear] = useState(todayYear);
  const [viewMonth, setViewMonth] = useState(todayMonth);
  const [monthSlideDir, setMonthSlideDir] = useState<1 | -1>(1);
  const [yearPickerOpen, setYearPickerOpen] = useState(false);
  const [yearWindowStart, setYearWindowStart] = useState(todayYear - 2);
  const [yearSlideDir, setYearSlideDir] = useState<1 | -1>(1);
  const [pullOffset, setPullOffset] = useState(0);

  const [showAddBlock, setShowAddBlock] = useState(false);
  const [newBlockTitle, setNewBlockTitle] = useState('');
  const [newBlockStartDate, setNewBlockStartDate] = useState(TODAY_DATE_KEY);
  const [newBlockStartTime, setNewBlockStartTime] = useState('16:00');
  const [newBlockEndDate, setNewBlockEndDate] = useState(TODAY_DATE_KEY);
  const [newBlockEndTime, setNewBlockEndTime] = useState('17:00');
  const [newBlockDurationMinutes, setNewBlockDurationMinutes] = useState(60);
  const [newBlockList, setNewBlockList] = useState(taskLists[0] || 'Work');
  const [convertedNotice, setConvertedNotice] = useState<string | null>(null);
  const [pendingMutation, setPendingMutation] = useState<PendingCalendarMutation | null>(null);
  const [mutationBusy, setMutationBusy] = useState(false);

  useBackLayer(yearPickerOpen, () => setYearPickerOpen(false), 12);
  useBackLayer(showAddBlock, () => setShowAddBlock(false), 10);
  useBackLayer(
    calendarExpanded,
    () => {
      setCalendarExpanded(false);
      setYearPickerOpen(false);
    },
    5
  );

  const swipeOriginRef = useRef<{ x: number; y: number } | null>(null);
  const yearSwipeOriginXRef = useRef<number | null>(null);
  const didSwipeRef = useRef(false);
  const calendarContainerRef = useRef<HTMLDivElement | null>(null);
  const scrollPullRef = useRef<HTMLDivElement | null>(null);
  const calendarExpandedRef = useRef(calendarExpanded);
  const selectedDateKeyRef = useRef(selectedDateKey);
  const viewYearRef = useRef(viewYear);
  const viewMonthRef = useRef(viewMonth);

  useEffect(() => {
    calendarExpandedRef.current = calendarExpanded;
  }, [calendarExpanded]);
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

  const dayTasks = tasks.filter((t) => !t.isInbox && t.dateKey === selectedDateKey);
  const inboxTasks = tasks.filter((t) => t.isInbox);
  const dayEvents = events
    .filter((e) => eventSpansDate(e, selectedDateKey))
    .sort((a, b) => {
      const aFull = a.startTime === 'Full';
      const bFull = b.startTime === 'Full';
      if (aFull !== bFull) return aFull ? -1 : 1;
      return a.startTime.localeCompare(b.startTime);
    });

  // Checked-off tasks stay visible and shift cleanly to the bottom
  const primaryList = [...(defaultHome === DefaultHome.Inbox ? inboxTasks : dayTasks)].sort(
    (a, b) => Number(a.completed) - Number(b.completed)
  );
  const remainingCount = primaryList.filter((t) => !t.completed).length;
  const pinnedNotes = notes.filter((n) => n.pinned);
  const selectedTask = tasks.find((t) => t.id === selectedTaskId) || null;

  const isExpanded = posture === FoldPosture.Inner;
  const isFlex = posture === FoldPosture.Flex;

  const stepMonth = (delta: number) => {
    setMonthSlideDir(delta >= 0 ? 1 : -1);
    const next = new Date(viewYear, viewMonth + delta, 1);
    setViewYear(next.getFullYear());
    setViewMonth(next.getMonth());
    setYearWindowStart(next.getFullYear() - 2);
  };

  const stepYearWindow = (delta: number) => {
    setYearSlideDir(delta >= 0 ? 1 : -1);
    setYearWindowStart((prev) => prev + delta * 3);
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
    calendarName: string
  ) => {
    const resolvedEndKey = endDateKey && endDateKey > dateKey ? endDateKey : undefined;
    const mins = computeDurationMinutes(
      dateKey,
      startTime,
      resolvedEndKey || dateKey,
      endTime
    );
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
      source: 'local',
    };
    onAddEvent(created);
    setNewBlockTitle('');
    setShowAddBlock(false);
  };

  const handleCreateBlock = (e: React.FormEvent) => {
    e.preventDefault();
    const title = newBlockTitle.trim();
    if (!title || !isBlockRangeValid) return;
    const resolvedEndDate =
      newBlockEndDate && newBlockEndDate !== newBlockStartDate ? newBlockEndDate : undefined;
    const calName = taskLists.includes(newBlockList) ? newBlockList : taskLists[0] || 'Work';

    if (googleCalendarSync && (googleCalendar.isConnected || (!isOnline && Boolean(googleCalendar.userEmail)))) {
      if (!isOnline) {
        void googleCalendar.onCreateGoogleEvent({
          title,
          dateKey: newBlockStartDate,
          endDateKey: resolvedEndDate,
          startTime: newBlockStartTime,
          endTime: newBlockEndTime,
          calendarName: calName,
        });
        setNewBlockTitle('');
        setShowAddBlock(false);
        setConvertedNotice(`Saved "${title}" offline · will sync when online`);
        window.setTimeout(() => setConvertedNotice(null), 2600);
        return;
      }
      // Explicit user confirmation required before writing to Google Calendar
      setPendingMutation({
        action: 'create',
        title,
        dateKey: newBlockStartDate,
        endDateKey: resolvedEndDate,
        startTime: newBlockStartTime,
        endTime: newBlockEndTime,
        calendarName: calName,
      });
      return;
    }

    saveLocalBlock(
      title,
      newBlockStartDate,
      resolvedEndDate,
      newBlockStartTime,
      newBlockEndTime,
      calName
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
        });
        setNewBlockTitle('');
        setShowAddBlock(false);
        setConvertedNotice(
          isOnline
            ? `Added "${pendingMutation.title}" to Google Calendar`
            : `Saved "${pendingMutation.title}" offline · will sync when online`
        );
        window.setTimeout(() => setConvertedNotice(null), 2600);
      } else {
        await googleCalendar.onDeleteGoogleEvent(
          pendingMutation.eventId,
          pendingMutation.googleEventId
        );
        setConvertedNotice(
          isOnline
            ? `Removed "${pendingMutation.title}" from Google Calendar`
            : `Removed "${pendingMutation.title}" offline · will sync when online`
        );
        window.setTimeout(() => setConvertedNotice(null), 2600);
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
    setConvertedNotice(`Added "${ev.title}" to tasks`);
    window.setTimeout(() => setConvertedNotice(null), 2400);
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
    const scrollEl = scrollPullRef.current;
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
      setYearPickerOpen(false);
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

        if (expanded && absX > 8 && absX > absY * 1.15) {
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

    // TickTick-style pull-down anywhere from the top of the Today feed when scrollTop === 0
    if (scrollEl) {
      let pullOrigin: { x: number; y: number; handled: boolean } | null = null;

      const onScrollTouchStart = (e: TouchEvent) => {
        if (e.touches.length !== 1 || calendarExpandedRef.current) {
          pullOrigin = null;
          return;
        }
        const target = e.target as HTMLElement | null;
        if (calEl && target && calEl.contains(target)) {
          pullOrigin = null;
          return;
        }
        if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) {
          pullOrigin = null;
          return;
        }
        if (scrollEl.scrollTop <= 2) {
          const t = e.touches[0];
          pullOrigin = { x: t.clientX, y: t.clientY, handled: false };
        } else {
          pullOrigin = null;
        }
      };

      const onScrollTouchMove = (e: TouchEvent) => {
        if (!pullOrigin || pullOrigin.handled || calendarExpandedRef.current || e.touches.length !== 1) {
          return;
        }
        if (scrollEl.scrollTop > 2) {
          pullOrigin = null;
          setPullOffset(0);
          return;
        }
        const t = e.touches[0];
        const dx = t.clientX - pullOrigin.x;
        const dy = t.clientY - pullOrigin.y;
        const absX = Math.abs(dx);
        const absY = Math.abs(dy);

        if (dy > 8 && absY > absX * 1.2) {
          if (e.cancelable) e.preventDefault();
          setPullOffset(Math.min(20, (dy - 8) * 0.42));
          if (dy >= 38) {
            pullOrigin.handled = true;
            expandToMonth();
          }
        } else if (dy < -4) {
          pullOrigin = null;
          setPullOffset(0);
        }
      };

      const onScrollTouchEnd = () => {
        if (pullOrigin) {
          pullOrigin = null;
          setPullOffset(0);
          window.setTimeout(() => {
            didSwipeRef.current = false;
          }, 80);
        }
      };

      scrollEl.addEventListener('touchstart', onScrollTouchStart, { passive: true });
      scrollEl.addEventListener('touchmove', onScrollTouchMove, { passive: false });
      scrollEl.addEventListener('touchend', onScrollTouchEnd, { passive: true });
      scrollEl.addEventListener('touchcancel', onScrollTouchEnd, { passive: true });

      cleanups.push(() => {
        scrollEl.removeEventListener('touchstart', onScrollTouchStart);
        scrollEl.removeEventListener('touchmove', onScrollTouchMove);
        scrollEl.removeEventListener('touchend', onScrollTouchEnd);
        scrollEl.removeEventListener('touchcancel', onScrollTouchEnd);
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

    if (calendarExpanded && absX > 30 && absX > absY * 1.2) {
      stepMonth(dx < 0 ? 1 : -1);
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
      setYearPickerOpen(false);
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
      setYearPickerOpen(false);
    }
  };

  const yearChoices = Array.from({ length: 5 }, (_, i) => yearWindowStart + i);

  const renderCalendarSection = (compact = false) => (
    <div
      ref={calendarContainerRef}
      onPointerDown={handleCalendarPointerDown}
      onPointerMove={handleCalendarPointerMove}
      onPointerUp={handleCalendarPointerEnd}
      onPointerCancel={handleCalendarPointerEnd}
      className="select-none touch-none overflow-hidden"
    >
      <AnimatePresence initial={false}>
        {calendarExpanded ? (
          <motion.div
            key="month-view"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className={`${tokens.cardBg} ${tokens.cardRadius} overflow-hidden`}
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
                <span className="text-[14.5px] font-semibold text-stone-800 dark:text-stone-200 whitespace-nowrap">
                  {monthGrid.monthName}
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!didSwipeRef.current) {
                      setYearPickerOpen((v) => !v);
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
                  title="Tap or swipe left/right to change year"
                  className={`px-2 py-0.5 text-[13.5px] font-semibold tabular-nums ${tokens.buttonRadius} transition-colors ${
                    yearPickerOpen
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
                {(selectedDateKey !== TODAY_DATE_KEY || viewYear !== todayYear || viewMonth !== todayMonth) && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedDateKey(TODAY_DATE_KEY);
                      setViewYear(todayYear);
                      setViewMonth(todayMonth);
                      setYearPickerOpen(false);
                      setCalendarExpanded(false);
                    }}
                    className={`px-2 py-1 text-[12px] font-semibold ${tokens.accentSoftBg} ${tokens.accentText} ${tokens.buttonRadius}`}
                  >
                    Today
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setCalendarExpanded(false);
                    setYearPickerOpen(false);
                  }}
                  aria-label="Collapse monthly view"
                  className="p-1.5 text-stone-400 hover:text-stone-700 dark:hover:text-stone-200"
                >
                  <ChevronUp className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Swipeable Year Selector Strip */}
            <AnimatePresence initial={false}>
              {yearPickerOpen && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
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
                  className={`overflow-hidden ${tokens.subtleBg} ${tokens.buttonRadius} px-1.5 py-1.5`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <button
                      type="button"
                      onClick={() => stepYearWindow(-1)}
                      aria-label="Earlier years"
                      className="p-1 text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 shrink-0"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <AnimatePresence mode="popLayout" initial={false}>
                      <motion.div
                        key={yearWindowStart}
                        initial={{ opacity: 0, x: yearSlideDir * 18 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: yearSlideDir * -18 }}
                        transition={{ duration: 0.16 }}
                        className="flex-1 grid grid-cols-5 gap-1"
                      >
                        {yearChoices.map((yr) => {
                          const activeYear = yr === viewYear;
                          return (
                            <button
                              key={yr}
                              type="button"
                              onClick={() => {
                                if (didSwipeRef.current) return;
                                setViewYear(yr);
                                setYearPickerOpen(false);
                              }}
                              className={`py-1 text-[12.5px] font-semibold tabular-nums ${tokens.buttonRadius} transition-colors ${
                                activeYear
                                  ? tokens.accentBg
                                  : 'text-stone-600 dark:text-stone-300 hover:bg-white/70 dark:hover:bg-stone-800'
                              }`}
                            >
                              {yr}
                            </button>
                          );
                        })}
                      </motion.div>
                    </AnimatePresence>
                    <button
                      type="button"
                      onClick={() => stepYearWindow(1)}
                      aria-label="Later years"
                      className="p-1 text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 shrink-0"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

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
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.div
                  key={`${viewYear}-${viewMonth}`}
                  initial={{ opacity: 0, x: monthSlideDir * 28 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: monthSlideDir * -28 }}
                  transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                  className="grid grid-cols-7 gap-1"
                >
                  {monthGrid.cells.map((cell, idx) => {
                    if (!cell) {
                      return <div key={`empty-${idx}`} className="h-8" />;
                    }
                    const active = cell.dateKey === selectedDateKey;
                    const isToday = cell.dateKey === TODAY_DATE_KEY;
                    const hasEvents = events.some((e) => eventSpansDate(e, cell.dateKey));
                    return (
                      <button
                        key={cell.dateKey}
                        type="button"
                        onClick={() => handleDaySelect(cell.dateKey, true)}
                        aria-label={`${cell.fullLabel}${isToday ? ' (Today)' : ''}`}
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
                        <span
                          className={`mt-0.5 w-1.5 h-1.5 rounded-full ${
                            isToday
                              ? active
                                ? 'bg-current'
                                : 'bg-[var(--tf-accent)]'
                              : hasEvents
                                ? active
                                  ? 'bg-current opacity-80'
                                  : 'bg-[var(--tf-accent)] opacity-75'
                                : 'bg-transparent'
                          }`}
                        />
                      </button>
                    );
                  })}
                </motion.div>
              </AnimatePresence>
            </div>

            <button
              type="button"
              onClick={() => {
                setCalendarExpanded(false);
                setYearPickerOpen(false);
              }}
              aria-label="Swipe up or tap to minimize calendar"
              className="w-full py-1.5 flex justify-center touch-none"
            >
              <span className="w-10 h-1 rounded-full bg-stone-300 dark:bg-stone-600" />
            </button>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="week-view"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="grid grid-cols-7 gap-1.5 pt-0.5 px-0.5">
              {weekDays.map((day) => {
                const active = day.dateKey === selectedDateKey;
                const isToday = day.dateKey === TODAY_DATE_KEY;
                const hasEvents = events.some((e) => eventSpansDate(e, day.dateKey));
                return (
                  <button
                    key={day.dateKey}
                    type="button"
                    onClick={() => handleDaySelect(day.dateKey, false)}
                    aria-label={`${day.fullLabel}${isToday ? ' (Today)' : ''}`}
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
                    <span
                      className={`mt-0.5 ${isToday ? 'w-3 h-1 rounded-full' : 'w-1.5 h-1.5 rounded-full'} ${
                        isToday
                          ? active
                            ? 'bg-current'
                            : 'bg-[var(--tf-accent)]'
                          : hasEvents
                            ? active
                              ? 'bg-current'
                              : 'bg-[var(--tf-accent)]'
                            : 'bg-transparent'
                      }`}
                    />
                  </button>
                );
              })}
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
          </motion.div>
        )}
      </AnimatePresence>
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
            {googleCalendarSync
              ? googleCalendar.isConnected
                ? 'Google'
                : 'Local'
              : 'Local'}
          </span>
          {googleCalendarSync && googleCalendar.isConnected && (
            <button
              type="button"
              disabled={googleCalendar.isSyncing}
              onClick={() => googleCalendar.onSyncNow()}
              title="Sync Google Calendar"
              aria-label="Sync Google Calendar"
              className="p-1 text-stone-400 hover:text-[var(--tf-accent-text)] transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${googleCalendar.isSyncing ? 'animate-spin' : ''}`} />
            </button>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {googleCalendarSync && !googleCalendar.isConnected && (
            <GoogleSignInButton
              compact
              onClick={() => googleCalendar.onSignIn()}
              loading={googleCalendar.isSigningIn}
              label={googleCalendar.userEmail ? 'Reconnect' : 'Connect'}
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
              <span className="text-[11.5px] font-medium text-stone-500 dark:text-stone-400">
                Duration
              </span>
              <span
                className={`text-[11.5px] font-mono-tabular font-medium ${
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
                    className={`px-2 py-1 text-[12px] font-medium font-mono-tabular whitespace-nowrap shrink-0 ${tokens.buttonRadius} border transition-colors ${
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
              <span className="text-[11.5px] font-medium text-stone-500 dark:text-stone-400">
                Starts
              </span>
              <input
                type="date"
                aria-label="Start date"
                value={newBlockStartDate}
                onChange={(e) => handleBlockStartDateChange(e.target.value)}
                className={`min-w-0 text-[12.5px] px-2 py-1.5 font-mono-tabular ${tokens.subtleBg} text-stone-800 dark:text-stone-100 ${tokens.buttonRadius} focus:outline-none`}
              />
              <input
                type="time"
                aria-label="Start time"
                value={newBlockStartTime}
                onChange={(e) => handleBlockStartTimeChange(e.target.value)}
                className={`text-[12.5px] px-2 py-1.5 font-mono-tabular ${tokens.subtleBg} text-stone-800 dark:text-stone-100 ${tokens.buttonRadius} focus:outline-none`}
              />
            </div>

            <div className="grid grid-cols-[44px_1fr_auto] items-center gap-1.5">
              <span className="text-[11.5px] font-medium text-stone-500 dark:text-stone-400">
                Ends
              </span>
              <input
                type="date"
                aria-label="End date"
                min={newBlockStartDate}
                value={newBlockEndDate}
                onChange={(e) => handleBlockEndDateChange(e.target.value)}
                className={`min-w-0 text-[12.5px] px-2 py-1.5 font-mono-tabular ${tokens.subtleBg} text-stone-800 dark:text-stone-100 ${tokens.buttonRadius} focus:outline-none`}
              />
              <input
                type="time"
                aria-label="End time"
                value={newBlockEndTime}
                onChange={(e) => handleBlockEndTimeChange(e.target.value)}
                className={`text-[12.5px] px-2 py-1.5 font-mono-tabular ${tokens.subtleBg} text-stone-800 dark:text-stone-100 ${tokens.buttonRadius} focus:outline-none`}
              />
            </div>
          </div>

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
                onClick={() => setShowAddBlock(false)}
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
            const timeRangeMeta =
              ev.startTime === 'Full'
                ? isMultiDay
                  ? `${formatShortDateKey(ev.dateKey)} – ${formatShortDateKey(ev.endDateKey!)}`
                  : 'All day'
                : isMultiDay
                  ? `${formatShortDateKey(ev.dateKey)} ${ev.startTime} – ${formatShortDateKey(ev.endDateKey!)} ${ev.endTime}`
                  : `${ev.startTime}–${ev.endTime}${ev.durationMinutes ? ` (${formatDurationLabel(ev.durationMinutes)})` : ''}`;
            return (
              <div
                key={ev.id}
                className={`flex items-center justify-between gap-2.5 ${
                  compact ? 'px-3.5 py-2.5' : tokens.rowPadding
                } border-b last:border-b-0 ${tokens.divider}`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="font-mono-tabular text-[12.5px] text-stone-500 dark:text-stone-400 shrink-0 w-11 truncate">
                    {ev.startTime}
                  </span>
                  <div className="min-w-0">
                    <p className="text-[15px] font-medium text-stone-900 dark:text-stone-100 truncate leading-snug">
                      {ev.title}
                    </p>
                    <p className="text-[12.5px] text-stone-500 dark:text-stone-400 truncate leading-tight mt-0.5">
                      <span className="font-mono-tabular">{timeRangeMeta}</span>
                      {' · '}
                      {ev.calendarName}
                      {!compact && ev.location && ev.location !== 'Focus block' ? ` · ${ev.location}` : ''}
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
                        if (!isOnline || !googleCalendar.isConnected) {
                          void googleCalendar.onDeleteGoogleEvent(ev.id, ev.googleEventId!);
                          setConvertedNotice(`Removed "${ev.title}" offline · will sync when online`);
                          window.setTimeout(() => setConvertedNotice(null), 2600);
                          return;
                        }
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

  const renderTaskRow = (task: TaskItem, compact = false) => {
    const isSelected = task.id === selectedTaskId;
    return (
      <div
        key={task.id}
        className={`group flex items-center gap-3 ${
          compact ? 'px-3.5 py-2.5' : tokens.rowPadding
        } transition-colors border-b last:border-b-0 ${tokens.divider} ${
          isSelected ? tokens.accentSoftBg : 'hover:bg-stone-50/80 dark:hover:bg-white/[0.02]'
        }`}
      >
        <button
          type="button"
          onClick={() => onToggleTask(task.id)}
          aria-label={task.completed ? `Mark ${task.title} incomplete` : `Complete ${task.title}`}
          className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
            task.completed
              ? `${tokens.accentBg} border-transparent`
              : 'border-stone-300 dark:border-stone-600 hover:border-[var(--tf-accent)]'
          }`}
        >
          {task.completed && <Check className="w-3 h-3" strokeWidth={2.5} />}
        </button>

        <button
          type="button"
          onClick={() => onSelectTask(task.id)}
          className="flex-1 min-w-0 text-left"
        >
          <p
            className={`text-[15px] font-medium leading-snug truncate ${
              task.completed
                ? 'line-through text-stone-400 dark:text-stone-500'
                : 'text-stone-900 dark:text-stone-100'
            }`}
          >
            {task.title}
          </p>
          <div className="flex items-center gap-1.5 text-[12.5px] text-stone-500 dark:text-stone-400 tabular-nums leading-tight mt-0.5">
            <span>{task.timeLabel}</span>
            <span aria-hidden="true">·</span>
            <span>{task.category}</span>
            {task.priority === 'High' && (
              <>
                <span aria-hidden="true">·</span>
                <span className={`font-medium ${tokens.accentText}`}>High</span>
              </>
            )}
            {(task.reminders?.length ?? 0) > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span
                  className={`inline-flex items-center gap-0.5 ${tokens.accentText}`}
                  title={`${task.reminders!.length} notification${task.reminders!.length > 1 ? 's' : ''}`}
                >
                  <Bell className="w-3.5 h-3.5" />
                  {task.reminders!.length > 1 && <span>{task.reminders!.length}</span>}
                </span>
              </>
            )}
            {task.source === 'google' && (
              <>
                <span aria-hidden="true">·</span>
                <span className={`font-medium ${tokens.accentText}`}>Google</span>
              </>
            )}
          </div>
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
        {selectedDateKey !== TODAY_DATE_KEY && (
          <button
            type="button"
            onClick={() => setSelectedDateKey(TODAY_DATE_KEY)}
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
            {selectedDateKey === TODAY_DATE_KEY ? ' · Today' : ''}
            {defaultHome === DefaultHome.Inbox ? ' · Inbox triage' : ''}
          </span>
          {selectedDateKey !== TODAY_DATE_KEY && (
            <button
              type="button"
              onClick={() => setSelectedDateKey(TODAY_DATE_KEY)}
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

  const confirmModal = (
    <CalendarConfirmModal
      pending={pendingMutation}
      tokens={tokens}
      busy={mutationBusy}
      onCancel={() => setPendingMutation(null)}
      onConfirm={handleConfirmMutation}
      onSaveLocalOnly={
        pendingMutation?.action === 'create'
          ? () => {
              saveLocalBlock(
                pendingMutation.title,
                pendingMutation.dateKey,
                pendingMutation.endDateKey,
                pendingMutation.startTime,
                pendingMutation.endTime,
                pendingMutation.calendarName
              );
              setPendingMutation(null);
            }
          : undefined
      }
    />
  );

  if (isFlex) {
    return (
      <div className="relative h-full flex flex-col">
        <div ref={scrollPullRef} className="h-[44%] overflow-y-auto overscroll-y-contain device-scroll px-4 py-2 space-y-2">
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
              {primaryList.length > 0 ? (
                primaryList.map((t) => renderTaskRow(t, true))
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
          canPushToGoogle={googleTasksSync && googleTasks.isConnected}
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
            ref={scrollPullRef}
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
                canPushToGoogle={googleTasksSync && googleTasks.isConnected}
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
                    {primaryList.length > 0 ? (
                      primaryList.map((t) => renderTaskRow(t, true))
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
        ref={scrollPullRef}
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
            {primaryList.length > 0 ? (
              primaryList.map((t) => renderTaskRow(t, true))
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
        canPushToGoogle={googleTasksSync && googleTasks.isConnected}
        onPushToGoogle={onPushLocalTaskToGoogle}
      />
      {confirmModal}
    </div>
  );
};
