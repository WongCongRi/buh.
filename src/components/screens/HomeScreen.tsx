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
  onConvertEventToTask: (ev: CalendarEvent) => void;
  onUpdateNote: (note: NoteItem) => void;
  onNavigateScreen: (screen: ScreenId) => void;
  onOpenNote: (noteId: string) => void;
}

type UnfoldedRightPane = 'calendar' | 'note';

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
  onConvertEventToTask,
  onUpdateNote,
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

  const [rightPaneMode, setRightPaneMode] = useState<UnfoldedRightPane>('calendar');
  const [showAddBlock, setShowAddBlock] = useState(false);
  const [newBlockTitle, setNewBlockTitle] = useState('');
  const [newBlockTime, setNewBlockTime] = useState('16:00');
  const [newBlockList, setNewBlockList] = useState(taskLists[0] || 'Work');
  const [convertedNotice, setConvertedNotice] = useState<string | null>(null);
  const [pendingMutation, setPendingMutation] = useState<PendingCalendarMutation | null>(null);
  const [mutationBusy, setMutationBusy] = useState(false);

  const swipeOriginRef = useRef<{ x: number; y: number } | null>(null);
  const yearSwipeOriginXRef = useRef<number | null>(null);
  const didSwipeRef = useRef(false);

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
    .filter((e) => e.dateKey === selectedDateKey)
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
  const primaryNote = pinnedNotes[0] || notes[0];
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

  const saveLocalBlock = (
    title: string,
    dateKey: string,
    startTime: string,
    endTime: string,
    calendarName: string
  ) => {
    const created: CalendarEvent = {
      id: `ev-${Date.now()}`,
      title,
      dateKey,
      startTime,
      endTime,
      durationMinutes: 60,
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
    if (!title) return;
    const [hh, mm] = newBlockTime.split(':').map((n) => parseInt(n, 10));
    const endHour = (hh + 1) % 24;
    const endTime = `${endHour < 10 ? `0${endHour}` : endHour}:${mm < 10 ? `0${mm}` : mm}`;
    const calName = taskLists.includes(newBlockList) ? newBlockList : taskLists[0] || 'Work';

    if (googleCalendarSync && (googleCalendar.isConnected || (!isOnline && Boolean(googleCalendar.userEmail)))) {
      if (!isOnline) {
        void googleCalendar.onCreateGoogleEvent({
          title,
          dateKey: selectedDateKey,
          startTime: newBlockTime,
          endTime,
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
        dateKey: selectedDateKey,
        startTime: newBlockTime,
        endTime,
        calendarName: calName,
      });
      return;
    }

    saveLocalBlock(title, selectedDateKey, newBlockTime, endTime, calName);
  };

  const handleConfirmMutation = async () => {
    if (!pendingMutation || mutationBusy) return;
    setMutationBusy(true);
    try {
      if (pendingMutation.action === 'create') {
        await googleCalendar.onCreateGoogleEvent({
          title: pendingMutation.title,
          dateKey: pendingMutation.dateKey,
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
    onConvertEventToTask(ev);
    setConvertedNotice(`Added "${ev.title}" to tasks`);
    window.setTimeout(() => setConvertedNotice(null), 2400);
  };

  const resetCalendarGesture = () => {
    swipeOriginRef.current = null;
    setPullOffset(0);
    window.setTimeout(() => {
      didSwipeRef.current = false;
    }, 60);
  };

  const handleCalendarPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Only track primary mouse button or touch/pen
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    swipeOriginRef.current = { x: e.clientX, y: e.clientY };
    didSwipeRef.current = false;
  };

  const handleCalendarPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!swipeOriginRef.current) return;
    // Guard against missed pointerup when mouse button was released outside container
    if (e.pointerType === 'mouse' && e.buttons === 0) {
      resetCalendarGesture();
      return;
    }

    const dx = e.clientX - swipeOriginRef.current.x;
    const dy = e.clientY - swipeOriginRef.current.y;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);

    // Capture pointer only after real drag slop so taps on day buttons always work cleanly
    if (absX > 8 || absY > 8) {
      try {
        if (!e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.setPointerCapture(e.pointerId);
        }
      } catch {
        // Ignore if pointer capture is unavailable
      }
    }

    // Lightweight GPU-only visual pull feedback on the pill handle when collapsed
    if (!calendarExpanded && dy > 0 && absY > absX) {
      setPullOffset(Math.min(10, dy * 0.35));
    }

    // Horizontal swipe in monthly view -> prev / next month
    if (calendarExpanded && absX > 30 && absX > absY * 1.2) {
      stepMonth(dx < 0 ? 1 : -1);
      swipeOriginRef.current = null;
      didSwipeRef.current = true;
      setPullOffset(0);
      return;
    }

    // Vertical swipe down -> expand monthly view
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

    // Vertical swipe up in monthly view -> collapse back to week strip
    if (calendarExpanded && dy < -20 && absY >= absX) {
      setCalendarExpanded(false);
      setYearPickerOpen(false);
      swipeOriginRef.current = null;
      didSwipeRef.current = true;
      setPullOffset(0);
    }
  };

  const handleCalendarPointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Ignore
    }
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
      onPointerDown={handleCalendarPointerDown}
      onPointerMove={handleCalendarPointerMove}
      onPointerUp={handleCalendarPointerEnd}
      onPointerCancel={handleCalendarPointerEnd}
      onLostPointerCapture={resetCalendarGesture}
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
            <div className="px-2 pt-1.5 pb-1 space-y-1">
            {/* Month + Swipeable Year Header */}
            <div className="flex items-center justify-between gap-1 px-0.5">
              <div className="flex items-center gap-0.5 min-w-0">
                <button
                  type="button"
                  onClick={() => stepMonth(-1)}
                  aria-label="Previous month"
                  className="p-0.5 text-stone-400 hover:text-stone-800 dark:hover:text-stone-100 rounded"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <span className="text-[11px] font-semibold text-stone-800 dark:text-stone-200 whitespace-nowrap">
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
                  className={`px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${tokens.buttonRadius} transition-colors ${
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
                  className="p-0.5 text-stone-400 hover:text-stone-800 dark:hover:text-stone-100 rounded"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="flex items-center gap-1 shrink-0">
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
                    className={`px-1.5 py-0.5 text-[9.5px] font-semibold ${tokens.accentSoftBg} ${tokens.accentText} ${tokens.buttonRadius}`}
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
                  className="p-0.5 text-stone-400 hover:text-stone-700 dark:hover:text-stone-200"
                >
                  <ChevronUp className="w-3.5 h-3.5" />
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
                  className={`overflow-hidden ${tokens.subtleBg} ${tokens.buttonRadius} px-1 py-1`}
                >
                  <div className="flex items-center justify-between gap-0.5">
                    <button
                      type="button"
                      onClick={() => stepYearWindow(-1)}
                      aria-label="Earlier years"
                      className="p-0.5 text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 shrink-0"
                    >
                      <ChevronLeft className="w-3 h-3" />
                    </button>
                    <AnimatePresence mode="popLayout" initial={false}>
                      <motion.div
                        key={yearWindowStart}
                        initial={{ opacity: 0, x: yearSlideDir * 18 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: yearSlideDir * -18 }}
                        transition={{ duration: 0.16 }}
                        className="flex-1 grid grid-cols-5 gap-0.5"
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
                              className={`py-0.5 text-[10px] font-semibold tabular-nums ${tokens.buttonRadius} transition-colors ${
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
                      className="p-0.5 text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 shrink-0"
                    >
                      <ChevronRight className="w-3 h-3" />
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Weekday Labels */}
            <div className="grid grid-cols-7 gap-0.5 text-center">
              {MON_FIRST_LABELS.map((wd) => (
                <span key={wd} className="text-[9px] font-medium text-stone-400 dark:text-stone-500">
                  {wd}
                </span>
              ))}
            </div>

            {/* Horizontally Swipeable Month Grid */}
            <div className="relative overflow-hidden">
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.div
                  key={`${viewYear}-${viewMonth}`}
                  initial={{ opacity: 0, x: monthSlideDir * 28 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: monthSlideDir * -28 }}
                  transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                  className="grid grid-cols-7 gap-0.5"
                >
                  {monthGrid.cells.map((cell, idx) => {
                    if (!cell) {
                      return <div key={`empty-${idx}`} className="h-6" />;
                    }
                    const active = cell.dateKey === selectedDateKey;
                    const isToday = cell.dateKey === TODAY_DATE_KEY;
                    const hasEvents = events.some((e) => e.dateKey === cell.dateKey);
                    return (
                      <button
                        key={cell.dateKey}
                        type="button"
                        onClick={() => handleDaySelect(cell.dateKey, true)}
                        aria-label={`${cell.fullLabel}${isToday ? ' (Today)' : ''}`}
                        className={`relative h-6 flex flex-col items-center justify-center ${tokens.buttonRadius} transition-colors ${
                          active
                            ? tokens.accentBg
                            : isToday
                              ? `${tokens.accentSoftBg} ${tokens.accentText} ring-1 ring-[var(--tf-accent)] font-semibold`
                              : 'text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800/70'
                        }`}
                      >
                        <span className="text-[10.5px] font-medium tabular-nums leading-none">
                          {cell.dayNum}
                        </span>
                        <span
                          className={`mt-0.5 w-1 h-1 rounded-full ${
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
              className="w-full py-0.5 flex justify-center"
            >
              <span className="w-7 h-0.5 rounded-full bg-stone-300 dark:bg-stone-600" />
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
            <div className="grid grid-cols-7 gap-1">
              {weekDays.map((day) => {
                const active = day.dateKey === selectedDateKey;
                const isToday = day.dateKey === TODAY_DATE_KEY;
                const hasEvents = events.some((e) => e.dateKey === day.dateKey);
                return (
                  <button
                    key={day.dateKey}
                    type="button"
                    onClick={() => handleDaySelect(day.dateKey, false)}
                    aria-label={`${day.fullLabel}${isToday ? ' (Today)' : ''}`}
                    className={`relative flex flex-col items-center ${compact ? 'py-1' : 'py-1.5'} ${tokens.buttonRadius} transition-colors ${
                      active
                        ? `${tokens.accentBg}${isToday ? ' ring-1 ring-offset-1 ring-[var(--tf-accent)] dark:ring-offset-[#111312]' : ''}`
                        : isToday
                          ? `${tokens.accentSoftBg} ${tokens.accentText} ring-1 ring-[var(--tf-accent)]`
                          : `${tokens.subtleBg} text-stone-700 dark:text-stone-300 hover:opacity-85`
                    }`}
                  >
                    <span
                      className={`text-[8.5px] font-medium leading-none ${
                        active ? 'opacity-85' : isToday ? tokens.accentText : 'text-stone-400'
                      }`}
                    >
                      {isToday ? 'Today' : day.short}
                    </span>
                    <span className="text-[11px] font-semibold tabular-nums leading-tight mt-0.5">
                      {day.dayNum}
                    </span>
                    <span
                      className={`mt-0.5 ${isToday ? 'w-2.5 h-0.5 rounded-full' : 'w-1 h-1 rounded-full'} ${
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
              onClick={() => setCalendarExpanded(true)}
              title="Swipe down or tap for month view"
              aria-label="Swipe down or tap to expand monthly calendar"
              style={
                pullOffset > 0
                  ? { transform: `translateY(${pullOffset}px)`, transition: 'none' }
                  : { transform: 'translateY(0px)', transition: 'transform 160ms ease-out' }
              }
              className="w-full pt-1 pb-0.5 flex items-center justify-center group"
            >
              <span className="w-7 h-0.5 rounded-full bg-stone-300 dark:bg-stone-600 group-hover:bg-[var(--tf-accent)] transition-colors" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );

  const renderScheduleSection = (compact = false) => (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-[11px] font-semibold text-stone-700 dark:text-stone-300">
            Schedule
          </span>
          <span className="text-[10px] text-stone-400 dark:text-stone-500 truncate">
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
              className="p-0.5 text-stone-400 hover:text-[var(--tf-accent-text)] transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-2.5 h-2.5 ${googleCalendar.isSyncing ? 'animate-spin' : ''}`} />
            </button>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
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
            onClick={() => setShowAddBlock((v) => !v)}
            className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium ${tokens.accentSoftBg} ${tokens.accentText} ${tokens.buttonRadius} whitespace-nowrap shrink-0`}
          >
            <Plus className="w-2.5 h-2.5" />
            Block
          </button>
        </div>
      </div>

      {googleCalendar.error && (
        <div className="px-2 py-1 text-[10px] text-rose-600 dark:text-rose-400 bg-rose-500/10 rounded-lg">
          {googleCalendar.error}
        </div>
      )}

      {showAddBlock && (
        <form onSubmit={handleCreateBlock} className={`${tokens.cardBg} ${tokens.cardRadius} p-2 space-y-1.5`}>
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={newBlockTitle}
              onChange={(e) => setNewBlockTitle(e.target.value)}
              placeholder="Focus block or meeting..."
              className={`flex-1 text-xs px-2 py-1 ${tokens.subtleBg} text-stone-800 dark:text-stone-100 placeholder:text-stone-400 ${tokens.buttonRadius} focus:outline-none`}
            />
            <input
              type="time"
              value={newBlockTime}
              onChange={(e) => setNewBlockTime(e.target.value)}
              className={`text-xs px-1.5 py-1 font-mono-tabular ${tokens.subtleBg} text-stone-800 dark:text-stone-100 ${tokens.buttonRadius} focus:outline-none`}
            />
          </div>
          <div className="flex items-center justify-between gap-1.5">
            <select
              aria-label="Schedule block list"
              value={taskLists.includes(newBlockList) ? newBlockList : taskLists[0] || 'Work'}
              onChange={(e) => setNewBlockList(e.target.value)}
              className={`text-[10.5px] px-2 py-0.5 ${tokens.subtleBg} text-stone-700 dark:text-stone-200 ${tokens.buttonRadius} focus:outline-none`}
            >
              {taskLists.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setShowAddBlock(false)}
                className="px-2 py-0.5 text-[10.5px] text-stone-500 hover:text-stone-800 dark:hover:text-stone-200"
              >
                Cancel
              </button>
              <button
                type="submit"
                className={`px-2.5 py-0.5 text-[10.5px] font-medium ${tokens.accentBg} ${tokens.buttonRadius}`}
              >
                Save
              </button>
            </div>
          </div>
        </form>
      )}

      {convertedNotice && (
        <div
          className={`px-2 py-0.5 text-[10px] font-medium ${tokens.accentSoftBg} ${tokens.accentText} ${tokens.buttonRadius}`}
        >
          {convertedNotice}
        </div>
      )}

      {dayEvents.length === 0 ? (
        <div className={`${tokens.cardBg} ${tokens.cardRadius} px-2.5 py-1.5 text-center`}>
          <p className="text-[10.5px] text-stone-400">Open day — no scheduled blocks.</p>
        </div>
      ) : (
        <div className={`${tokens.cardBg} ${tokens.cardRadius} overflow-hidden`}>
          {dayEvents.map((ev) => (
            <div
              key={ev.id}
              className={`flex items-center justify-between gap-2 ${
                compact ? 'px-2.5 py-1' : tokens.rowPadding
              } border-b last:border-b-0 ${tokens.divider}`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-mono-tabular text-[10px] text-stone-500 dark:text-stone-400 shrink-0 w-9 truncate">
                  {ev.startTime}
                </span>
                <div className="min-w-0">
                  <p className="text-[12px] font-medium text-stone-900 dark:text-stone-100 truncate leading-tight">
                    {ev.title}
                  </p>
                  {(!compact || ev.source === 'google') && (
                    <p className="text-[10px] text-stone-500 dark:text-stone-400 truncate leading-tight">
                      {ev.calendarName}
                      {ev.location ? ` · ${ev.location}` : ''}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => handleConvert(ev)}
                  title="Add as task"
                  aria-label={`Convert ${ev.title} to task`}
                  className="p-0.5 text-stone-400 hover:text-[var(--tf-accent-text)] shrink-0"
                >
                  <CalendarPlus className="w-3.5 h-3.5" />
                </button>
                {ev.source === 'google' && ev.googleEventId && (
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
                    className="p-0.5 text-stone-400 hover:text-rose-500 shrink-0"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderTaskRow = (task: TaskItem, compact = false) => {
    const isSelected = task.id === selectedTaskId;
    return (
      <div
        key={task.id}
        className={`group flex items-center gap-2 ${
          compact ? 'px-2.5 py-1' : tokens.rowPadding
        } transition-colors border-b last:border-b-0 ${tokens.divider} ${
          isSelected ? tokens.accentSoftBg : 'hover:bg-stone-50/80 dark:hover:bg-white/[0.02]'
        }`}
      >
        <button
          type="button"
          onClick={() => onToggleTask(task.id)}
          aria-label={task.completed ? `Mark ${task.title} incomplete` : `Complete ${task.title}`}
          className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0 transition-colors ${
            task.completed
              ? `${tokens.accentBg} border-transparent`
              : 'border-stone-300 dark:border-stone-600 hover:border-[var(--tf-accent)]'
          }`}
        >
          {task.completed && <Check className="w-2.5 h-2.5" />}
        </button>

        <button
          type="button"
          onClick={() => onSelectTask(task.id)}
          className="flex-1 min-w-0 text-left"
        >
          <p
            className={`text-[12px] font-medium leading-tight truncate ${
              task.completed
                ? 'line-through text-stone-400 dark:text-stone-500'
                : 'text-stone-900 dark:text-stone-100'
            }`}
          >
            {task.title}
          </p>
          <div className="flex items-center gap-1 text-[10px] text-stone-500 dark:text-stone-400 tabular-nums leading-tight">
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
                  <Bell className="w-2.5 h-2.5" />
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
          className="p-0.5 text-stone-300 dark:text-stone-600 group-hover:text-stone-500 dark:group-hover:text-stone-400 transition-colors"
        >
          <ChevronRight className="w-3 h-3" />
        </button>
      </div>
    );
  };

  const renderGreeting = (compact = false) => {
    const titleText =
      defaultHome === DefaultHome.Inbox
        ? 'Capture first, sort later.'
        : defaultHome === DefaultHome.Dashboard
          ? 'Overview'
          : selectedDateKey === TODAY_DATE_KEY
            ? 'Good morning.'
            : `${dayMeta.short} overview.`;

    const dateRight = (
      <div className="flex items-center gap-1.5 shrink-0">
        {selectedDateKey !== TODAY_DATE_KEY && (
          <button
            type="button"
            onClick={() => setSelectedDateKey(TODAY_DATE_KEY)}
            className={`px-1.5 py-0.5 text-[9.5px] font-semibold ${tokens.accentSoftBg} ${tokens.accentText} ${tokens.buttonRadius}`}
          >
            Today
          </button>
        )}
        <span className="text-[10px] font-medium text-stone-400 dark:text-stone-500 tabular-nums">
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
          <span className="text-[10px] font-medium text-stone-400 dark:text-stone-500 tabular-nums">
            {dayMeta.fullLabel}
            {selectedDateKey === TODAY_DATE_KEY ? ' · Today' : ''}
            {defaultHome === DefaultHome.Inbox ? ' · Inbox triage' : ''}
          </span>
          {selectedDateKey !== TODAY_DATE_KEY && (
            <button
              type="button"
              onClick={() => setSelectedDateKey(TODAY_DATE_KEY)}
              className={`px-1.5 py-0.5 text-[9.5px] font-semibold ${tokens.accentSoftBg} ${tokens.accentText} ${tokens.buttonRadius}`}
            >
              Jump to today
            </button>
          )}
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <h2 className={`font-display font-semibold text-stone-900 dark:text-stone-100 ${tokens.headingScale}`}>
            {titleText}
          </h2>
          <span className="text-[11px] text-stone-500 dark:text-stone-400 tabular-nums shrink-0">
            {remainingCount} tasks · {dayEvents.length} blocks
          </span>
        </div>
      </div>
    );
  };

  const listHeading =
    defaultHome === DefaultHome.Inbox
      ? 'Captured items'
      : defaultHome === DefaultHome.Dashboard
        ? 'Priority queue'
        : 'Tasks';

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
        <div className="h-[44%] overflow-y-auto device-scroll px-3.5 py-1.5 space-y-1.5">
          {renderGreeting(true)}
          {renderCalendarSection(true)}
        </div>

        <div className="h-3.5 flex items-center justify-center relative shrink-0 bg-stone-200/60 dark:bg-black/40 border-y border-stone-300/60 dark:border-stone-800">
          <span className="text-[9px] font-mono-tabular text-stone-500 dark:text-stone-400">
            Flex hinge · Schedule & tasks
          </span>
        </div>

        <div className="flex-1 overflow-y-auto device-scroll px-3.5 pt-1.5 pb-20 space-y-2">
          {renderScheduleSection(true)}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-stone-700 dark:text-stone-300">{listHeading}</span>
              <span className="text-[10px] text-stone-400 tabular-nums">{remainingCount} remaining</span>
            </div>
            <div className={`${tokens.cardBg} ${tokens.cardRadius} overflow-hidden`}>
              {primaryList.length > 0 ? (
                primaryList.map((t) => renderTaskRow(t, true))
              ) : (
                <div className="p-2.5 text-center text-[11px] text-stone-400">No tasks scheduled.</div>
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
      <div className={`relative h-full grid grid-cols-2 ${hingeAwareSplit ? 'gap-5' : 'gap-3'} px-3.5 py-2 overflow-hidden`}>
        {/* Left Pane: Greeting + Tasks for Selected Date */}
        <div className="flex flex-col h-full overflow-y-auto device-scroll pr-0.5 space-y-2">
          {renderGreeting()}

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-stone-700 dark:text-stone-300">{listHeading}</span>
              <span className="text-[10.5px] text-stone-400 dark:text-stone-500 tabular-nums">
                {remainingCount} remaining
              </span>
            </div>
            <div className={`${tokens.cardBg} ${tokens.cardRadius} overflow-hidden`}>
              {primaryList.length > 0 ? (
                primaryList.map((t) => renderTaskRow(t))
              ) : (
                <div className="p-3 text-center text-xs text-stone-500">
                  No tasks scheduled for {dayMeta.short}.
                </div>
              )}
            </div>
          </div>

          {defaultHome === DefaultHome.Inbox && (
            <button
              type="button"
              onClick={() => onNavigateScreen(ScreenId.Tasks)}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 text-xs font-medium ${tokens.cardBg} ${tokens.cardRadius} text-stone-700 dark:text-stone-200 hover:opacity-90`}
            >
              <span>View scheduled Today tasks ({dayTasks.length})</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Right Pane: Integrated Calendar View (default) or Scratchpad / Task Inspector */}
        <div className="h-full flex flex-col overflow-hidden pl-0.5 space-y-1.5">
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
            <>
              <div className={`flex items-center justify-between p-0.5 ${tokens.subtleBg} ${tokens.buttonRadius} shrink-0`}>
                <button
                  type="button"
                  onClick={() => setRightPaneMode('calendar')}
                  className={`flex-1 py-0.5 text-[11px] font-medium ${tokens.buttonRadius} transition-colors ${
                    rightPaneMode === 'calendar'
                      ? 'bg-white dark:bg-[#1E2220] text-stone-900 dark:text-stone-100 shadow-xs'
                      : 'text-stone-500 dark:text-stone-400'
                  }`}
                >
                  Calendar
                </button>
                <button
                  type="button"
                  onClick={() => setRightPaneMode('note')}
                  className={`flex-1 py-0.5 text-[11px] font-medium ${tokens.buttonRadius} transition-colors ${
                    rightPaneMode === 'note'
                      ? 'bg-white dark:bg-[#1E2220] text-stone-900 dark:text-stone-100 shadow-xs'
                      : 'text-stone-500 dark:text-stone-400'
                  }`}
                >
                  Scratchpad
                </button>
              </div>

              <div className="flex-1 overflow-y-auto device-scroll space-y-2">
                {rightPaneMode === 'calendar' && (
                  <>
                    {renderCalendarSection()}
                    {renderScheduleSection()}
                  </>
                )}

                {rightPaneMode === 'note' && !primaryNote && (
                  <div className={`${tokens.cardBg} ${tokens.cardRadius} p-4 text-center space-y-2`}>
                    <p className="text-xs font-medium text-stone-700 dark:text-stone-300">No notes yet</p>
                    <p className="text-[11px] text-stone-400">
                      Create a note to keep checklists or ideas pinned here.
                    </p>
                    <button
                      type="button"
                      onClick={() => onNavigateScreen(ScreenId.Notes)}
                      className={`px-2.5 py-1 text-[11px] font-medium ${tokens.accentBg} ${tokens.buttonRadius}`}
                    >
                      Open Notes
                    </button>
                  </div>
                )}

                {rightPaneMode === 'note' && primaryNote && (
                  <div className={`${tokens.cardBg} ${tokens.cardRadius} p-2.5 space-y-1.5`}>
                    <div className="flex items-center justify-between">
                      <span className="text-[11.5px] font-semibold text-stone-800 dark:text-stone-200 truncate">
                        {primaryNote.title}
                      </span>
                      <button
                        type="button"
                        onClick={() => onOpenNote(primaryNote.id)}
                        className={`text-[11px] font-medium ${tokens.accentText} hover:underline shrink-0`}
                      >
                        Full editor
                      </button>
                    </div>
                    <div className="space-y-1">
                      {primaryNote.blocks.map((block) =>
                        block.type === 'checklist' ? (
                          <button
                            key={block.id}
                            type="button"
                            onClick={() =>
                              onUpdateNote({
                                ...primaryNote,
                                updatedAt: 'Edited just now',
                                blocks: primaryNote.blocks.map((b) =>
                                  b.id === block.id ? { ...b, checked: !b.checked } : b
                                ),
                              })
                            }
                            className="w-full flex items-start gap-2 text-left py-0.5"
                          >
                            <span
                              className={`mt-0.5 w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${
                                block.checked
                                  ? `${tokens.accentBg} border-transparent`
                                  : 'border-stone-300 dark:border-stone-600'
                              }`}
                            >
                              {block.checked && <Check className="w-2.5 h-2.5" />}
                            </span>
                            <span
                              className={`text-[11.5px] leading-snug ${
                                block.checked ? 'line-through text-stone-400' : 'text-stone-700 dark:text-stone-200'
                              }`}
                            >
                              {block.text}
                            </span>
                          </button>
                        ) : (
                          <p
                            key={block.id}
                            className={
                              block.type === 'heading'
                                ? 'text-[11.5px] font-semibold text-stone-800 dark:text-stone-200'
                                : 'text-[11.5px] text-stone-600 dark:text-stone-300 leading-snug'
                            }
                          >
                            {block.text}
                          </p>
                        )
                      )}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
        {confirmModal}
      </div>
    );
  }

  // Cover Display (10:16) — Compact overview maximizing info density on shorter screen height
  return (
    <div className="relative h-full overflow-y-auto device-scroll px-3 pt-1.5 pb-20 space-y-1.5">
      {renderGreeting(true)}
      {renderCalendarSection(true)}
      {renderScheduleSection(true)}

      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold text-stone-700 dark:text-stone-300">{listHeading}</span>
          <span className="text-[10px] text-stone-400 dark:text-stone-500 tabular-nums">
            {remainingCount} remaining
          </span>
        </div>

        <div className={`${tokens.cardBg} ${tokens.cardRadius} overflow-hidden`}>
          {primaryList.length > 0 ? (
            primaryList.map((t) => renderTaskRow(t, true))
          ) : (
            <div className="p-2.5 text-center text-[11px] text-stone-400">
              No tasks scheduled for {dayMeta.short}.
            </div>
          )}
        </div>
      </div>

      {defaultHome === DefaultHome.Dashboard && pinnedNotes.length > 0 && (
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-stone-700 dark:text-stone-300">
              Pinned notes
            </span>
            <span className="text-[10px] text-stone-400 dark:text-stone-500 tabular-nums">
              {pinnedNotes.length} pinned
            </span>
          </div>

          <div className={`${tokens.cardBg} ${tokens.cardRadius} overflow-hidden`}>
            {pinnedNotes.map((note) => (
              <button
                key={note.id}
                type="button"
                onClick={() => onOpenNote(note.id)}
                className={`w-full flex items-center justify-between gap-2 px-2.5 py-1 border-b last:border-b-0 ${tokens.divider} text-left hover:bg-stone-50/80 dark:hover:bg-white/[0.02] transition-colors`}
              >
                <div className="min-w-0">
                  <p className="text-[12px] font-medium text-stone-900 dark:text-stone-100 truncate leading-tight">
                    {note.title}
                  </p>
                  <p className="text-[10px] text-stone-500 dark:text-stone-400 truncate leading-tight">
                    {note.folder} · {note.updatedAt}
                  </p>
                </div>
                <ChevronRight className="w-3 h-3 text-stone-300 dark:text-stone-600 shrink-0" />
              </button>
            ))}
          </div>
        </div>
      )}

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
