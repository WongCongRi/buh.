import { useEffect, useState } from 'react';
import {
  Columns2,
  Download,
  Loader2,
  Moon,
  RotateCcw,
  Smartphone,
  SplitSquareVertical,
  Sun,
  Tablet,
} from 'lucide-react';
import { ApprovalModal } from './components/ApprovalModal';
import { DesignDecisionsPanel } from './components/DesignDecisionsPanel';
import { FoldDeviceFrame } from './components/FoldDeviceFrame';
import { StudioHeader } from './components/StudioHeader';
import {
  INITIAL_DECISIONS,
  INITIAL_EVENTS,
  INITIAL_LISTS,
  INITIAL_NOTES,
  INITIAL_RECENT_COLORS,
  INITIAL_SETTINGS,
  INITIAL_TASKS,
} from './data/initialData';
import {
  AppSettingsState,
  CalendarEvent,
  DefaultHome,
  DesignDecisions,
  FoldPosture,
  NoteItem,
  ScreenId,
  TaskItem,
} from './types/taskflow';
import { applyAccentCssVars, normalizeHex } from './utils/colorUtils';

const STORAGE_KEY = 'buh_fold8_review_v1';
const LEGACY_STORAGE_KEY = 'taskflow_fold8_review_v1';

interface PersistedReviewState {
  posture: FoldPosture;
  activeScreen: ScreenId;
  decisions: DesignDecisions;
  recentColors: string[];
  isDark: boolean;
  tasks: TaskItem[];
  taskLists: string[];
  events: CalendarEvent[];
  notes: NoteItem[];
  settings: AppSettingsState;
  reviewNote: string;
  approved: boolean;
}

function recordRecentColorList(prev: string[], hex: string): string[] {
  const normalized = normalizeHex(hex);
  const filtered = prev.map(normalizeHex).filter((c) => c !== normalized);
  return [normalized, ...filtered].slice(0, 5);
}

function loadInitialState(): PersistedReviewState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Omit<Partial<PersistedReviewState>, 'activeScreen'> & {
        activeScreen?: string;
      };
      const rawScreen = parsed.activeScreen;
      const migratedScreen =
        rawScreen === 'calendar' || !rawScreen
          ? ScreenId.Home
          : Object.values(ScreenId).includes(rawScreen as ScreenId)
            ? (rawScreen as ScreenId)
            : ScreenId.Home;

      const accent = normalizeHex(parsed.decisions?.accentColor ?? INITIAL_DECISIONS.accentColor);
      const parsedRecent = Array.isArray(parsed.recentColors)
        ? parsed.recentColors.map(normalizeHex).filter((c, i, arr) => arr.indexOf(c) === i).slice(0, 5)
        : INITIAL_RECENT_COLORS;
      const recentColors = parsedRecent.length > 0 ? parsedRecent : [accent];

      const parsedLists = Array.isArray(parsed.taskLists)
        ? Array.from(
            new Set(
              parsed.taskLists
                .map((s) => (typeof s === 'string' ? s.trim() : ''))
                .filter((s) => s.length > 0 && s.toLowerCase() !== 'inbox')
            )
          )
        : INITIAL_LISTS;
      const taskLists = parsedLists.length > 0 ? parsedLists : INITIAL_LISTS;

      return {
        posture: parsed.posture ?? FoldPosture.Cover,
        activeScreen: migratedScreen,
        decisions: {
          ...INITIAL_DECISIONS,
          ...(parsed.decisions ?? {}),
          accentColor: accent,
        },
        recentColors,
        isDark: parsed.isDark ?? false,
        tasks: parsed.tasks ?? INITIAL_TASKS,
        taskLists,
        events: parsed.events ?? INITIAL_EVENTS,
        notes: parsed.notes ?? INITIAL_NOTES,
        settings: parsed.settings ?? INITIAL_SETTINGS,
        reviewNote: parsed.reviewNote ?? '',
        approved: parsed.approved ?? false,
      };
    }
  } catch {
    // Fall back to clean defaults
  }
  return {
    posture: FoldPosture.Cover,
    activeScreen: ScreenId.Home,
    decisions: INITIAL_DECISIONS,
    recentColors: INITIAL_RECENT_COLORS,
    isDark: false,
    tasks: INITIAL_TASKS,
    taskLists: INITIAL_LISTS,
    events: INITIAL_EVENTS,
    notes: INITIAL_NOTES,
    settings: INITIAL_SETTINGS,
    reviewNote: '',
    approved: false,
  };
}

export default function App() {
  const initial = loadInitialState();

  const [posture, setPosture] = useState<FoldPosture>(initial.posture);
  const [activeScreen, setActiveScreen] = useState<ScreenId>(initial.activeScreen);
  const [decisions, setDecisions] = useState<DesignDecisions>(initial.decisions);
  const [recentColors, setRecentColors] = useState<string[]>(initial.recentColors);
  const [isDark, setIsDark] = useState<boolean>(initial.isDark);
  const [showHingeGuide, setShowHingeGuide] = useState<boolean>(false);

  const [tasks, setTasks] = useState<TaskItem[]>(initial.tasks);
  const [taskLists, setTaskLists] = useState<string[]>(initial.taskLists);
  const [events, setEvents] = useState<CalendarEvent[]>(initial.events);
  const [notes, setNotes] = useState<NoteItem[]>(initial.notes);
  const [settings, setSettings] = useState<AppSettingsState>(initial.settings);

  const [reviewNote, setReviewNote] = useState<string>(initial.reviewNote);
  const [approvalOpen, setApprovalOpen] = useState<boolean>(false);
  const [approved, setApproved] = useState<boolean>(initial.approved);
  const [exportingSource, setExportingSource] = useState<boolean>(false);

  const handleDownloadSource = async () => {
    if (exportingSource) return;
    setExportingSource(true);
    try {
      const resp = await fetch('/api/export/source');
      if (!resp.ok) throw new Error('Export failed');
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'buh-source.zip';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    } catch (err) {
      console.error('Failed to download source archive:', err);
    } finally {
      setExportingSource(false);
    }
  };

  useEffect(() => {
    const root = document.documentElement;
    if (isDark) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    applyAccentCssVars(decisions.accentColor, isDark);
  }, [isDark, decisions.accentColor]);

  useEffect(() => {
    try {
      const payload: PersistedReviewState = {
        posture,
        activeScreen,
        decisions,
        recentColors,
        isDark,
        tasks,
        taskLists,
        events,
        notes,
        settings,
        reviewNote,
        approved,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Ignore storage quota issues
    }
  }, [posture, activeScreen, decisions, recentColors, isDark, tasks, taskLists, events, notes, settings, reviewNote, approved]);

  const handlePreviewAccentColor = (hex: string) => {
    const normalized = normalizeHex(hex);
    setDecisions((prev) => ({ ...prev, accentColor: normalized }));
    setApproved(false);
  };

  const handleSelectAccentColor = (hex: string) => {
    const normalized = normalizeHex(hex);
    setDecisions((prev) => ({ ...prev, accentColor: normalized }));
    setRecentColors((prev) => recordRecentColorList(prev, normalized));
    setApproved(false);
  };

  const handleToggleTask = (taskId: string) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, completed: !t.completed } : t))
    );
  };

  const handleAddTask = (newTask: TaskItem) => {
    setTasks((prev) => [newTask, ...prev]);
  };

  const handleUpdateTask = (updated: TaskItem) => {
    setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
  };

  const handleDeleteTask = (taskId: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
  };

  const handleAddList = (name: string) => {
    const clean = name.trim();
    if (!clean || clean.toLowerCase() === 'inbox') return;
    setTaskLists((prev) =>
      prev.some((l) => l.toLowerCase() === clean.toLowerCase()) ? prev : [...prev, clean]
    );
  };

  const handleRenameList = (oldName: string, newName: string) => {
    const clean = newName.trim();
    if (!clean || clean.toLowerCase() === 'inbox') return;
    setTaskLists((prev) => {
      if (prev.some((l) => l.toLowerCase() === clean.toLowerCase() && l !== oldName)) {
        return prev;
      }
      return prev.map((l) => (l === oldName ? clean : l));
    });
    setTasks((prev) =>
      prev.map((t) => (t.category === oldName ? { ...t, category: clean } : t))
    );
    setEvents((prev) =>
      prev.map((ev) => (ev.calendarName === oldName ? { ...ev, calendarName: clean } : ev))
    );
  };

  const handleDeleteList = (name: string) => {
    const remaining = taskLists.filter((l) => l !== name);
    if (remaining.length === 0) return;
    setTaskLists(remaining);
    setTasks((prev) =>
      prev.map((t) => (t.category === name ? { ...t, category: 'Inbox', isInbox: true } : t))
    );
    setEvents((prev) =>
      prev.map((ev) => (ev.calendarName === name ? { ...ev, calendarName: remaining[0] } : ev))
    );
  };

  const handleReorderList = (fromIndex: number, toIndex: number) => {
    setTaskLists((prev) => {
      if (
        fromIndex === toIndex ||
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= prev.length ||
        toIndex >= prev.length
      ) {
        return prev;
      }
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  };

  const handleAddEvent = (ev: CalendarEvent) => {
    setEvents((prev) => [...prev, ev]);
  };

  const handleConvertEventToTask = (ev: CalendarEvent) => {
    const hourNum = parseInt(ev.startTime.split(':')[0], 10);
    const minStr = ev.startTime.split(':')[1] || '00';
    const meridiem = hourNum >= 12 ? 'PM' : 'AM';
    const h12 = hourNum % 12 === 0 ? 12 : hourNum % 12;
    const formattedTime = `${h12 < 10 ? `0${h12}` : h12}:${minStr} ${meridiem}`;

    const created: TaskItem = {
      id: `t-ev-${Date.now()}`,
      title: ev.title,
      timeLabel: formattedTime,
      dateKey: ev.dateKey,
      category: ev.calendarName,
      priority: 'Normal',
      completed: false,
      isInbox: false,
      notes: ev.location ? `Calendar location: ${ev.location}` : '',
      subtasks: [],
    };
    setTasks((prev) => [created, ...prev]);
  };

  const handleUpdateNote = (updated: NoteItem) => {
    setNotes((prev) => prev.map((n) => (n.id === updated.id ? updated : n)));
  };

  const handleDeleteNote = (noteId: string) => {
    setNotes((prev) => prev.filter((n) => n.id !== noteId));
  };

  const handleCreateNote = (customTitle?: string, customBody?: string): string => {
    const id = `n-${Date.now()}`;
    const created: NoteItem = {
      id,
      title: customTitle?.trim() || 'Untitled Note',
      folder: 'Product',
      updatedAt: 'Created just now',
      pinned: false,
      blocks: customBody?.trim()
        ? [{ id: `b-${Date.now()}-1`, type: 'paragraph', text: customBody.trim() }]
        : [
            { id: `b-${Date.now()}-1`, type: 'paragraph', text: 'Start capturing thoughts or action items...' },
            { id: `b-${Date.now()}-2`, type: 'checklist', text: 'First action item', checked: false },
          ],
    };
    setNotes((prev) => [created, ...prev]);
    return id;
  };

  const handleResetDemo = () => {
    setTasks(INITIAL_TASKS);
    setTaskLists(INITIAL_LISTS);
    setEvents(INITIAL_EVENTS);
    setNotes(INITIAL_NOTES);
    setSettings(INITIAL_SETTINGS);
    setDecisions(INITIAL_DECISIONS);
    setRecentColors(INITIAL_RECENT_COLORS);
    setActiveScreen(ScreenId.Home);
    setReviewNote('');
    setApproved(false);
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      // ignore
    }
  };

  const homeTabTitle =
    decisions.defaultHome === DefaultHome.Inbox
      ? 'Inbox'
      : decisions.defaultHome === DefaultHome.Dashboard
        ? 'Overview'
        : 'Today';

  const screenTabs: { id: ScreenId; label: string }[] = [
    { id: ScreenId.Home, label: homeTabTitle },
    { id: ScreenId.Tasks, label: 'Tasks' },
    { id: ScreenId.Agent, label: 'Lookup' },
    { id: ScreenId.Notes, label: 'Notes' },
    { id: ScreenId.Settings, label: 'Settings' },
  ];

  return (
    <div className="min-h-screen bg-[#F6F7F5] dark:bg-[#0D100E] text-stone-900 dark:text-stone-100 transition-colors">
      <StudioHeader onApproveClick={() => setApprovalOpen(true)} approved={approved} />

      <main className="max-w-[1440px] mx-auto px-6 py-4 space-y-4">
        {/* Compact Workspace Title + Quick Actions */}
        <section id="preview" className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-xl sm:text-2xl font-semibold tracking-tight text-stone-900 dark:text-stone-100">
              Galaxy Z Fold 8 UI Review
            </h1>
            <p className="text-xs text-stone-500 dark:text-stone-400">
              Switch postures, test live screens, and lock in your design preferences.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleDownloadSource}
              disabled={exportingSource}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-white dark:bg-[#161917] border border-stone-200 dark:border-stone-800 text-stone-700 dark:text-stone-200 hover:bg-stone-50 dark:hover:bg-stone-800 transition-colors whitespace-nowrap disabled:opacity-60"
            >
              {exportingSource ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Download className="w-3.5 h-3.5" />
              )}
              {exportingSource ? 'Exporting...' : 'Download source (.zip)'}
            </button>
            <button
              type="button"
              onClick={() => setIsDark((d) => !d)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-white dark:bg-[#161917] border border-stone-200 dark:border-stone-800 text-stone-700 dark:text-stone-200 hover:bg-stone-50 dark:hover:bg-stone-800 transition-colors whitespace-nowrap"
            >
              {isDark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
              {isDark ? 'Light' : 'Dark'}
            </button>
            <button
              type="button"
              onClick={handleResetDemo}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-white dark:bg-[#161917] border border-stone-200 dark:border-stone-800 text-stone-700 dark:text-stone-200 hover:bg-stone-50 dark:hover:bg-stone-800 transition-colors whitespace-nowrap"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset data
            </button>
          </div>
        </section>

        {/* Single-Viewport Workspace: Simulator Stage (Left) + Design Decisions Inspector (Right) */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Left Stage: Galaxy Z Fold 8 Simulator */}
          <div className="lg:col-span-7 xl:col-span-8 space-y-3">
            {/* Unified Posture & Screen Toolbar */}
            <div
              id="screen-bar"
              className="flex flex-wrap items-center justify-between gap-2 bg-white dark:bg-[#161917] border border-stone-200/80 dark:border-stone-800 rounded-2xl p-2"
            >
              {/* Posture Switcher */}
              <div className="flex items-center gap-1 p-0.5 bg-stone-100 dark:bg-stone-800/80 rounded-xl">
                <button
                  type="button"
                  onClick={() => setPosture(FoldPosture.Cover)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                    posture === FoldPosture.Cover
                      ? 'bg-white dark:bg-[#1E2220] text-stone-900 dark:text-stone-100 shadow-xs'
                      : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100'
                  }`}
                >
                  <Smartphone className="w-3.5 h-3.5" />
                  Cover 10:16
                </button>
                <button
                  type="button"
                  onClick={() => setPosture(FoldPosture.Inner)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                    posture === FoldPosture.Inner
                      ? 'bg-white dark:bg-[#1E2220] text-stone-900 dark:text-stone-100 shadow-xs'
                      : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100'
                  }`}
                >
                  <Tablet className="w-3.5 h-3.5" />
                  Inner 4:3
                </button>
                <button
                  type="button"
                  onClick={() => setPosture(FoldPosture.Flex)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                    posture === FoldPosture.Flex
                      ? 'bg-white dark:bg-[#1E2220] text-stone-900 dark:text-stone-100 shadow-xs'
                      : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100'
                  }`}
                >
                  <SplitSquareVertical className="w-3.5 h-3.5" />
                  Flex
                </button>
              </div>

              {/* Screen Quick-Jump Tabs + Optional Hinge Guide */}
              <div className="flex flex-wrap items-center gap-1.5">
                {posture === FoldPosture.Inner && (
                  <button
                    type="button"
                    onClick={() => setShowHingeGuide((v) => !v)}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap ${
                      showHingeGuide
                        ? 'bg-[var(--tf-accent-soft)] border-[var(--tf-accent-border)] text-[var(--tf-accent-text)]'
                        : 'border-stone-200 dark:border-stone-700 text-stone-600 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-stone-800'
                    }`}
                  >
                    <Columns2 className="w-3 h-3" />
                    Hinge
                  </button>
                )}

                <div className="flex items-center gap-0.5 p-0.5 bg-stone-100 dark:bg-stone-800/80 rounded-xl">
                  {screenTabs.map((tab) => {
                    const active = activeScreen === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setActiveScreen(tab.id)}
                        className={`px-2.5 py-1 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                          active
                            ? 'bg-[var(--tf-accent-soft)] text-[var(--tf-accent-text)]'
                            : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100'
                        }`}
                      >
                        {tab.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Interactive Device Canvas */}
            <div className="bg-[#ECEEE9] dark:bg-[#131614] border border-stone-200/80 dark:border-stone-800 rounded-3xl p-4 sm:p-5 flex items-center justify-center">
              <FoldDeviceFrame
                posture={posture}
                decisions={decisions}
                activeScreen={activeScreen}
                onChangeScreen={setActiveScreen}
                isDark={isDark}
                onToggleDark={() => setIsDark((d) => !d)}
                showHingeGuide={showHingeGuide}
                tasks={tasks}
                taskLists={taskLists}
                events={events}
                notes={notes}
                settings={settings}
                onAddTask={handleAddTask}
                onToggleTask={handleToggleTask}
                onUpdateTask={handleUpdateTask}
                onDeleteTask={handleDeleteTask}
                onAddEvent={handleAddEvent}
                onConvertEventToTask={handleConvertEventToTask}
                onUpdateNote={handleUpdateNote}
                onDeleteNote={handleDeleteNote}
                onCreateNote={handleCreateNote}
                onUpdateSettings={(patch) => setSettings((s) => ({ ...s, ...patch }))}
                onAddList={handleAddList}
                onRenameList={handleRenameList}
                onDeleteList={handleDeleteList}
                onReorderList={handleReorderList}
                recentColors={recentColors}
                onPreviewAccentColor={handlePreviewAccentColor}
                onSelectAccentColor={handleSelectAccentColor}
              />
            </div>
          </div>

          {/* Right Rail: Compact Design Decisions & Notes */}
          <aside className="lg:col-span-5 xl:col-span-4 bg-white dark:bg-[#161917] border border-stone-200/80 dark:border-stone-800 rounded-2xl p-4 sm:p-5">
            <DesignDecisionsPanel
              decisions={decisions}
              onChangeDecisions={(patch) => {
                setDecisions((prev) => ({ ...prev, ...patch }));
                setApproved(false);
              }}
              onSelectAccentColor={handleSelectAccentColor}
              reviewNote={reviewNote}
              onChangeReviewNote={setReviewNote}
            />
          </aside>
        </section>
      </main>

      <ApprovalModal
        open={approvalOpen}
        decisions={decisions}
        reviewNote={reviewNote}
        onClose={() => setApprovalOpen(false)}
        onConfirmApprove={() => {
          setApproved(true);
          setApprovalOpen(false);
        }}
      />
    </div>
  );
}
