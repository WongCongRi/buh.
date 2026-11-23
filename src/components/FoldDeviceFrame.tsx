import React, { useEffect, useState } from 'react';
import {
  Battery,
  Bell,
  Check,
  CheckSquare,
  FileText,
  HelpCircle,
  Home,
  Inbox,
  LayoutDashboard,
  Menu,
  Plus,
  Search,
  Settings as SettingsIcon,
  Wifi,
  X,
} from 'lucide-react';
import { TODAY_DATE_KEY, TOMORROW_DATE_KEY } from '../data/initialData';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import {
  AppSettingsState,
  CalendarEvent,
  DefaultHome,
  DesignDecisions,
  FoldPosture,
  GoogleCalendarSyncState,
  GoogleTasksSyncState,
  NavMode,
  NoteItem,
  QuickCaptureMode,
  ScreenId,
  TaskItem,
} from '../types/taskflow';
import {
  loadCachedLookupEntries,
  saveCachedLookupEntries,
} from '../utils/offlineSync';
import { parseQuickTaskInput } from '../utils/quickAddParser';
import {
  formatReminderLabel,
  getNotificationPermissionState,
  requestAppNotificationPermission,
} from '../utils/taskReminders';
import { getDeviceStyleTokens } from '../utils/themeTokens';
import { GlobalSearchModal, SearchSelection } from './GlobalSearchModal';
import {
  GoogleTaskConfirmModal,
  PendingGoogleTaskMutation,
} from './GoogleTaskConfirmModal';
import { NlpTaskInput } from './NlpTaskInput';
import { PWAInstallButton } from './PWAInstallButton';
import { HomeScreen } from './screens/HomeScreen';
import { NotesScreen } from './screens/NotesScreen';
import { QuickCheckEntry, QuickCheckScreen } from './screens/QuickCheckScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { TasksScreen } from './screens/TasksScreen';

export interface ActiveReminderAlert {
  id: string;
  taskId: string;
  reminderId: string;
  taskTitle: string;
  label: string;
  category: string;
}

function formatPreviewDateKey(dateKey: string): string {
  if (dateKey === TODAY_DATE_KEY) return 'Today';
  if (dateKey === TOMORROW_DATE_KEY) return 'Tomorrow';
  const [yStr, mStr, dStr] = dateKey.split('-');
  const dt = new Date(Number(yStr), Number(mStr) - 1, Number(dStr));
  if (Number.isNaN(dt.getTime())) return dateKey;
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

interface FoldDeviceFrameProps {
  standalone?: boolean;
  onExitStandalone?: () => void;
  posture: FoldPosture;
  decisions: DesignDecisions;
  activeScreen: ScreenId;
  onChangeScreen: (screen: ScreenId) => void;
  isDark: boolean;
  onToggleDark: () => void;
  showHingeGuide: boolean;
  tasks: TaskItem[];
  taskLists: string[];
  events: CalendarEvent[];
  notes: NoteItem[];
  settings: AppSettingsState;
  onAddTask: (task: TaskItem) => void;
  onToggleTask: (taskId: string) => void;
  onUpdateTask: (task: TaskItem) => void;
  onDeleteTask: (taskId: string) => void;
  onAddEvent: (ev: CalendarEvent) => void;
  onConvertEventToTask: (ev: CalendarEvent) => void;
  onUpdateNote: (note: NoteItem) => void;
  onDeleteNote: (noteId: string) => void;
  onCreateNote: (title?: string, body?: string) => string;
  onUpdateSettings: (patch: Partial<AppSettingsState>) => void;
  onAddList: (name: string) => void;
  onRenameList: (oldName: string, newName: string) => void;
  onDeleteList: (name: string) => void;
  onReorderList: (fromIndex: number, toIndex: number) => void;
  recentColors: string[];
  onPreviewAccentColor: (hex: string) => void;
  onSelectAccentColor: (hex: string) => void;
  googleCalendar: GoogleCalendarSyncState;
  googleTasks: GoogleTasksSyncState;
  activeReminderAlerts?: ActiveReminderAlert[];
  onDismissReminderAlert?: (alertId: string) => void;
  onCompleteFromReminderAlert?: (alertId: string, taskId: string) => void;
}

export const FoldDeviceFrame: React.FC<FoldDeviceFrameProps> = ({
  standalone = false,
  onExitStandalone,
  posture,
  decisions,
  activeScreen,
  onChangeScreen,
  isDark,
  onToggleDark,
  showHingeGuide,
  tasks,
  taskLists,
  events,
  notes,
  settings,
  onAddTask,
  onToggleTask,
  onUpdateTask,
  onDeleteTask,
  onAddEvent,
  onConvertEventToTask,
  onUpdateNote,
  onDeleteNote,
  onCreateNote,
  onUpdateSettings,
  onAddList,
  onRenameList,
  onDeleteList,
  onReorderList,
  recentColors,
  onPreviewAccentColor,
  onSelectAccentColor,
  googleCalendar,
  googleTasks,
  activeReminderAlerts = [],
  onDismissReminderAlert,
  onCompleteFromReminderAlert,
}) => {
  const isOnline = useOnlineStatus();
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedNoteId, setSelectedNoteId] = useState<string>(notes[0]?.id || '');
  const [coverNoteEditing, setCoverNoteEditing] = useState(false);
  const [quickBarText, setQuickBarText] = useState('');
  const [fabModalOpen, setFabModalOpen] = useState(false);
  const [fabText, setFabText] = useState('');
  const [fabListChoice, setFabListChoice] = useState<string>('AUTO');
  const [moreDrawerOpen, setMoreDrawerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchHighlight, setSearchHighlight] = useState<SearchSelection | null>(null);
  const [quickCheckEntries, setQuickCheckEntries] = useState<QuickCheckEntry[]>(() =>
    loadCachedLookupEntries()
  );
  const [pendingTaskMutation, setPendingTaskMutation] =
    useState<PendingGoogleTaskMutation | null>(null);
  const [pendingReplaceLocalId, setPendingReplaceLocalId] = useState<string | null>(null);
  const [taskMutationBusy, setTaskMutationBusy] = useState(false);
  const [taskSyncToast, setTaskSyncToast] = useState<string | null>(null);

  useEffect(() => {
    saveCachedLookupEntries(quickCheckEntries);
  }, [quickCheckEntries]);

  const showTaskToast = (msg: string) => {
    setTaskSyncToast(msg);
    window.setTimeout(() => setTaskSyncToast(null), 2600);
  };

  const resolveGoogleTargetList = (category?: string) => {
    const matched =
      (category &&
        googleTasks.taskLists.find((l) => l.title.toLowerCase() === category.toLowerCase())) ||
      googleTasks.taskLists[0];
    return matched || { id: '@default', title: 'My Tasks' };
  };

  const requestAddTask = (created: TaskItem) => {
    const wantsGoogleSync =
      settings.googleTasksSync && (googleTasks.isConnected || Boolean(googleTasks.userEmail));
    if (wantsGoogleSync && isOnline && googleTasks.isConnected) {
      const target = resolveGoogleTargetList(created.category);
      setPendingReplaceLocalId(null);
      setPendingTaskMutation({
        action: 'create',
        task: created,
        targetListId: target.id,
        targetListTitle: target.title,
      });
      return;
    }
    if (wantsGoogleSync && !isOnline) {
      const target = resolveGoogleTargetList(created.category);
      void googleTasks.onCreateGoogleTask({
        title: created.title,
        notes: created.notes,
        dateKey: created.isInbox ? undefined : created.dateKey,
        timeLabel: created.timeLabel,
        priority: created.priority,
        taskListId: target.id,
        category: target.title,
        reminders: created.reminders,
      });
      showTaskToast(`Saved "${created.title}" offline · will sync when online`);
      return;
    }
    onAddTask(created);
    if (!isOnline) {
      showTaskToast(`Saved "${created.title}" offline`);
    }
  };

  const requestPushLocalTaskToGoogle = (task: TaskItem) => {
    if (!settings.googleTasksSync || !googleTasks.isConnected) return;
    const target = resolveGoogleTargetList(task.category);
    setPendingReplaceLocalId(task.id);
    setPendingTaskMutation({
      action: 'create',
      task,
      targetListId: target.id,
      targetListTitle: target.title,
    });
  };

  const requestToggleTask = (taskId: string) => {
    const found = tasks.find((t) => t.id === taskId);
    if (found?.source === 'google') {
      if (!isOnline || !googleTasks.isConnected) {
        void googleTasks.onToggleGoogleTask(found);
        showTaskToast(
          !found.completed
            ? `Completed "${found.title}" offline · will sync when online`
            : `Reopened "${found.title}" offline · will sync when online`
        );
        return;
      }
      setPendingReplaceLocalId(null);
      setPendingTaskMutation({
        action: 'toggle',
        task: found,
        nextCompleted: !found.completed,
      });
      return;
    }
    onToggleTask(taskId);
  };

  const requestDeleteTask = (taskId: string) => {
    const found = tasks.find((t) => t.id === taskId);
    if (found?.source === 'google') {
      if (!isOnline || !googleTasks.isConnected) {
        void googleTasks.onDeleteGoogleTask(found);
        if (selectedTaskId === taskId) setSelectedTaskId(null);
        showTaskToast(`Deleted "${found.title}" offline · will sync when online`);
        return;
      }
      setPendingReplaceLocalId(null);
      setPendingTaskMutation({
        action: 'delete',
        task: found,
      });
      return;
    }
    onDeleteTask(taskId);
    if (selectedTaskId === taskId) setSelectedTaskId(null);
  };

  const requestSyncGoogleTaskUpdate = (task: TaskItem) => {
    if (task.source !== 'google') return;
    if (!isOnline || !googleTasks.isConnected) {
      void googleTasks.onUpdateGoogleTask(task);
      showTaskToast(`Queued "${task.title}" to sync when online`);
      return;
    }
    setPendingReplaceLocalId(null);
    setPendingTaskMutation({
      action: 'update',
      task,
    });
  };

  const handleConfirmTaskMutation = async () => {
    if (!pendingTaskMutation || taskMutationBusy) return;
    setTaskMutationBusy(true);
    try {
      if (pendingTaskMutation.action === 'create') {
        await googleTasks.onCreateGoogleTask({
          title: pendingTaskMutation.task.title,
          notes: pendingTaskMutation.task.notes,
          dateKey: pendingTaskMutation.task.isInbox
            ? undefined
            : pendingTaskMutation.task.dateKey,
          timeLabel: pendingTaskMutation.task.timeLabel,
          priority: pendingTaskMutation.task.priority,
          taskListId: pendingTaskMutation.targetListId,
          category: pendingTaskMutation.targetListTitle,
          reminders: pendingTaskMutation.task.reminders,
        });
        if (pendingReplaceLocalId) {
          onDeleteTask(pendingReplaceLocalId);
          if (selectedTaskId === pendingReplaceLocalId) setSelectedTaskId(null);
        }
        showTaskToast(`Added "${pendingTaskMutation.task.title}" to Google Tasks`);
      } else if (pendingTaskMutation.action === 'toggle') {
        await googleTasks.onToggleGoogleTask(pendingTaskMutation.task);
        showTaskToast(
          pendingTaskMutation.nextCompleted
            ? `Completed "${pendingTaskMutation.task.title}" in Google Tasks`
            : `Reopened "${pendingTaskMutation.task.title}" in Google Tasks`
        );
      } else if (pendingTaskMutation.action === 'update') {
        await googleTasks.onUpdateGoogleTask(pendingTaskMutation.task);
        showTaskToast(`Updated "${pendingTaskMutation.task.title}" in Google Tasks`);
      } else if (pendingTaskMutation.action === 'delete') {
        await googleTasks.onDeleteGoogleTask(pendingTaskMutation.task);
        if (selectedTaskId === pendingTaskMutation.task.id) setSelectedTaskId(null);
        showTaskToast(`Deleted "${pendingTaskMutation.task.title}" from Google Tasks`);
      }
      setPendingTaskMutation(null);
      setPendingReplaceLocalId(null);
    } catch {
      setPendingTaskMutation(null);
      setPendingReplaceLocalId(null);
    } finally {
      setTaskMutationBusy(false);
    }
  };

  useEffect(() => {
    if (!searchHighlight) return;
    const timer = window.setTimeout(() => {
      setSearchHighlight(null);
    }, 3500);
    return () => window.clearTimeout(timer);
  }, [searchHighlight]);

  const handleSelectSearchResult = (selection: SearchSelection) => {
    setMoreDrawerOpen(false);
    setFabModalOpen(false);
    setSearchHighlight(selection);

    if (selection.targetType === 'task') {
      setSelectedTaskId(selection.targetId);
      onChangeScreen(ScreenId.Tasks);
    } else {
      setSelectedNoteId(selection.targetId);
      setCoverNoteEditing(true);
      onChangeScreen(ScreenId.Notes);
    }
  };

  const tokens = getDeviceStyleTokens(decisions.visualStyle);

  const homeLabel =
    decisions.defaultHome === DefaultHome.Inbox
      ? 'Inbox'
      : decisions.defaultHome === DefaultHome.Dashboard
        ? 'Overview'
        : 'Today';

  const HomeIcon =
    decisions.defaultHome === DefaultHome.Inbox
      ? Inbox
      : decisions.defaultHome === DefaultHome.Dashboard
        ? LayoutDashboard
        : Home;

  const submitQuickTask = (rawText: string, clearFn: () => void, explicitList?: string) => {
    const trimmed = rawText.trim();
    if (!trimmed) return;
    const fallbackList =
      explicitList && explicitList !== 'AUTO' ? explicitList : undefined;
    const parsed = parseQuickTaskInput(
      trimmed,
      settings.nlpQuickParse,
      decisions.defaultHome === DefaultHome.Inbox,
      taskLists,
      fallbackList
    );
    const chosenCategory =
      explicitList && explicitList !== 'AUTO' ? explicitList : parsed.category;

    const created: TaskItem = {
      id: `t-${Date.now()}`,
      title: parsed.title,
      timeLabel: parsed.timeLabel,
      dateKey: parsed.dateKey,
      category: chosenCategory,
      priority: parsed.priority,
      completed: false,
      isInbox: chosenCategory === 'Inbox',
      notes: '',
      subtasks: [],
      reminders: parsed.reminders.length > 0 ? parsed.reminders : undefined,
    };
    if (parsed.reminders.length > 0 && getNotificationPermissionState() === 'default') {
      void requestAppNotificationPermission();
    }
    requestAddTask(created);
    clearFn();
  };

  const fabParsedPreview = parseQuickTaskInput(
    fabText,
    settings.nlpQuickParse,
    decisions.defaultHome === DefaultHome.Inbox,
    taskLists,
    fabListChoice !== 'AUTO' ? fabListChoice : undefined
  );

  const fiveTabs = [
    { id: ScreenId.Home, label: homeLabel, icon: HomeIcon },
    { id: ScreenId.Tasks, label: 'Tasks', icon: CheckSquare },
    { id: ScreenId.Agent, label: 'Lookup', icon: HelpCircle },
    { id: ScreenId.Notes, label: 'Notes', icon: FileText },
    { id: ScreenId.Settings, label: 'Settings', icon: SettingsIcon },
  ];

  const fourTabs = [
    { id: 'home' as const, label: homeLabel, icon: HomeIcon, screen: ScreenId.Home },
    { id: 'agent' as const, label: 'Lookup', icon: HelpCircle, screen: ScreenId.Agent },
    { id: 'notes' as const, label: 'Notes', icon: FileText, screen: ScreenId.Notes },
    { id: 'more' as const, label: 'More', icon: Menu, screen: null },
  ];

  const showPersistentBar =
    decisions.quickCapture === QuickCaptureMode.Bar ||
    decisions.quickCapture === QuickCaptureMode.Both;

  const showFab =
    decisions.quickCapture === QuickCaptureMode.Fab ||
    decisions.quickCapture === QuickCaptureMode.Both;

  const showRailFab =
    showFab && posture === FoldPosture.Inner && activeScreen !== ScreenId.Agent;

  const showFloatingFab =
    showFab &&
    posture !== FoldPosture.Inner &&
    activeScreen !== ScreenId.Agent &&
    !(activeScreen === ScreenId.Notes && posture === FoldPosture.Cover && coverNoteEditing) &&
    !(
      Boolean(selectedTaskId) &&
      (activeScreen === ScreenId.Home ||
        (activeScreen === ScreenId.Tasks && posture === FoldPosture.Cover))
    );

  // Chassis width per standard Galaxy Z Fold 8 posture (5.5" 10:16 cover, 7.6" 4:3 inner)
  const chassisWidthClass =
    posture === FoldPosture.Cover
      ? 'w-full max-w-[360px] rounded-[34px]'
      : posture === FoldPosture.Inner
        ? 'w-full max-w-[700px] rounded-[28px]'
        : 'w-full max-w-[660px] rounded-[28px]';

  const screenAspectClass =
    posture === FoldPosture.Cover
      ? 'aspect-[10/16] rounded-[26px]'
      : 'aspect-[4/3] rounded-[20px]';

  const renderScreenBody = () => {
    switch (activeScreen) {
      case ScreenId.Tasks:
        return (
          <TasksScreen
            posture={posture}
            tokens={tokens}
            tasks={tasks}
            taskLists={taskLists}
            selectedTaskId={selectedTaskId}
            hingeAwareSplit={settings.hingeAwareSplit}
            googleTasksSync={settings.googleTasksSync}
            googleTasks={googleTasks}
            highlightedTaskId={
              searchHighlight?.targetType === 'task' ? searchHighlight.targetId : null
            }
            highlightQuery={searchHighlight?.targetType === 'task' ? searchHighlight.query : ''}
            onDismissHighlight={() => setSearchHighlight(null)}
            onSelectTask={setSelectedTaskId}
            onToggleTask={requestToggleTask}
            onUpdateTask={onUpdateTask}
            onDeleteTask={requestDeleteTask}
            onSyncGoogleTask={requestSyncGoogleTaskUpdate}
            onPushLocalTaskToGoogle={requestPushLocalTaskToGoogle}
          />
        );
      case ScreenId.Agent:
        return (
          <QuickCheckScreen
            posture={posture}
            tokens={tokens}
            hingeAwareSplit={settings.hingeAwareSplit}
            tasks={tasks}
            events={events}
            notes={notes}
            entries={quickCheckEntries}
            onAddEntry={(entry) => setQuickCheckEntries((prev) => [...prev, entry])}
            onClearEntries={() => setQuickCheckEntries([])}
            onSaveAsTask={(title, body) =>
              requestAddTask({
                id: `t-qc-${Date.now()}`,
                title,
                timeLabel: 'No time set',
                dateKey: TODAY_DATE_KEY,
                category: 'Inbox',
                priority: 'Normal',
                completed: false,
                isInbox: true,
                notes: body,
                subtasks: [],
              })
            }
            onSaveAsNote={(title, body) => {
              const newId = onCreateNote(title, body);
              setSelectedNoteId(newId);
            }}
          />
        );
      case ScreenId.Notes:
        return (
          <NotesScreen
            posture={posture}
            tokens={tokens}
            notes={notes}
            hingeAwareSplit={settings.hingeAwareSplit}
            selectedNoteId={selectedNoteId}
            onSelectNoteId={setSelectedNoteId}
            coverEditing={coverNoteEditing}
            onSetCoverEditing={setCoverNoteEditing}
            highlightedNoteId={
              searchHighlight?.targetType === 'note' ? searchHighlight.targetId : null
            }
            highlightQuery={searchHighlight?.targetType === 'note' ? searchHighlight.query : ''}
            onDismissHighlight={() => setSearchHighlight(null)}
            onUpdateNote={onUpdateNote}
            onDeleteNote={onDeleteNote}
            onCreateNote={() => onCreateNote()}
          />
        );
      case ScreenId.Settings:
        return (
          <SettingsScreen
            posture={posture}
            tokens={tokens}
            isDark={isDark}
            onToggleDark={onToggleDark}
            accentColor={decisions.accentColor}
            recentColors={recentColors}
            onPreviewAccentColor={onPreviewAccentColor}
            onSelectAccentColor={onSelectAccentColor}
            taskLists={taskLists}
            onAddList={onAddList}
            onRenameList={onRenameList}
            onDeleteList={onDeleteList}
            onReorderList={onReorderList}
            settings={settings}
            onUpdateSettings={onUpdateSettings}
            tasks={tasks}
            googleCalendar={googleCalendar}
            googleTasks={googleTasks}
          />
        );
      case ScreenId.Home:
      default:
        return (
          <HomeScreen
            posture={posture}
            defaultHome={decisions.defaultHome}
            tokens={tokens}
            tasks={tasks}
            taskLists={taskLists}
            events={events}
            notes={notes}
            selectedTaskId={selectedTaskId}
            hingeAwareSplit={settings.hingeAwareSplit}
            googleCalendarSync={settings.googleCalendarSync}
            googleTasksSync={settings.googleTasksSync}
            googleCalendar={googleCalendar}
            googleTasks={googleTasks}
            onSelectTask={setSelectedTaskId}
            onToggleTask={requestToggleTask}
            onUpdateTask={onUpdateTask}
            onDeleteTask={requestDeleteTask}
            onSyncGoogleTask={requestSyncGoogleTaskUpdate}
            onPushLocalTaskToGoogle={requestPushLocalTaskToGoogle}
            onAddEvent={onAddEvent}
            onConvertEventToTask={onConvertEventToTask}
            onUpdateNote={onUpdateNote}
            onNavigateScreen={(s) => {
              setSelectedTaskId(null);
              onChangeScreen(s);
            }}
            onOpenNote={(noteId) => {
              setSelectedTaskId(null);
              setSelectedNoteId(noteId);
              setCoverNoteEditing(true);
              onChangeScreen(ScreenId.Notes);
            }}
          />
        );
    }
  };

  const innerAppContent = (
    <div
      className={
        standalone
          ? `relative w-full h-[100dvh] overflow-hidden ${tokens.surfaceBg} flex flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]`
          : `relative w-full overflow-hidden ${screenAspectClass} ${tokens.surfaceBg} flex flex-col`
      }
    >
      {/* Simulated Android Status Bar (Preview Studio only) */}
      {!standalone && (
        <div className="h-6 px-3.5 flex items-center justify-between text-[10px] font-medium text-stone-700 dark:text-stone-300 shrink-0 select-none">
          <span className="font-mono-tabular">09:41</span>
          {posture === FoldPosture.Cover && (
            <span className="w-2 h-2 rounded-full bg-stone-900 dark:bg-black border border-stone-700" />
          )}
          <div className="flex items-center gap-1">
            <Wifi className="w-2.5 h-2.5" />
            <Battery className="w-3 h-3" />
          </div>
        </div>
      )}

      {/* App Brand Bar */}
      <div
        className={`px-3.5 ${standalone ? 'py-2' : 'py-1'} flex items-center justify-between border-b ${tokens.divider} shrink-0`}
      >
        <span className="font-display text-[14.5px] font-bold tracking-tight text-stone-900 dark:text-stone-100">
          buh.
        </span>
        <div className="flex items-center gap-1.5">
          {standalone && <PWAInstallButton compact />}
          {standalone && onExitStandalone && (
            <button
              type="button"
              onClick={onExitStandalone}
              className={`px-2 py-1 text-[10.5px] font-medium ${tokens.subtleBg} text-stone-600 dark:text-stone-300 ${tokens.buttonRadius} hover:opacity-85 transition-opacity`}
            >
              Studio
            </button>
          )}
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            aria-label="Global search tasks and notes"
            title="Search tasks & notes"
            className={`p-1 ${tokens.subtleBg} text-stone-600 dark:text-stone-300 hover:text-[var(--tf-accent-text)] ${tokens.buttonRadius} transition-colors`}
          >
            <Search className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

          {/* Persistent Quick-Capture Input Bar (if selected) */}
          {showPersistentBar && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submitQuickTask(quickBarText, () => setQuickBarText(''));
              }}
              className={`px-3 py-1.5 border-b ${tokens.divider} flex items-center gap-1.5 shrink-0`}
            >
              <NlpTaskInput
                value={quickBarText}
                onChange={setQuickBarText}
                nlpEnabled={settings.nlpQuickParse}
                availableLists={taskLists}
                placeholder="Quick add (e.g. Memo 3pm remind 10m before #work)..."
                paddingClassName="px-2.5 py-1"
                className={`flex-1 ${tokens.subtleBg} ${tokens.buttonRadius}`}
              />
              <button
                type="submit"
                className={`px-2.5 py-1 text-[11px] font-medium ${tokens.accentBg} ${tokens.buttonRadius} shrink-0`}
              >
                Add
              </button>
            </form>
          )}

          {/* Main App Body: Navigation Rail (Inner) + Active Screen */}
          <div className="relative flex-1 flex overflow-hidden">
            {/* Inner Unfolded Adaptive Navigation Rail */}
            {posture === FoldPosture.Inner && (
              <aside className={`w-[72px] border-r ${tokens.divider} flex flex-col items-center py-3 gap-1.5 shrink-0`}>
                {decisions.navMode === NavMode.Five
                  ? fiveTabs.map((tab) => {
                      const Icon = tab.icon;
                      const active = activeScreen === tab.id;
                      return (
                        <button
                          key={tab.id}
                          type="button"
                          onClick={() => {
                            setFabModalOpen(false);
                            setMoreDrawerOpen(false);
                            setSelectedTaskId(null);
                            onChangeScreen(tab.id);
                          }}
                          className={`w-14 py-2 flex flex-col items-center justify-center gap-1 ${tokens.buttonRadius} transition-colors ${
                            active
                              ? `${tokens.accentSoftBg} ${tokens.accentText}`
                              : 'text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100'
                          }`}
                          aria-label={tab.label}
                          title={tab.label}
                        >
                          <Icon
                            className={tab.id === ScreenId.Agent ? 'w-8 h-8' : 'w-4 h-4'}
                            strokeWidth={tab.id === ScreenId.Agent ? 1.85 : 2}
                          />
                          {tab.id !== ScreenId.Agent && (
                            <span className="text-[10px] font-medium whitespace-nowrap">{tab.label}</span>
                          )}
                        </button>
                      );
                    })
                  : fourTabs.map((tab) => {
                      const Icon = tab.icon;
                      const isMoreActive =
                        tab.id === 'more' &&
                        (activeScreen === ScreenId.Tasks || activeScreen === ScreenId.Settings);
                      const active = tab.screen === activeScreen || isMoreActive;
                      return (
                        <button
                          key={tab.id}
                          type="button"
                          onClick={() => {
                            setFabModalOpen(false);
                            setSelectedTaskId(null);
                            if (tab.screen) {
                              setMoreDrawerOpen(false);
                              onChangeScreen(tab.screen);
                            } else {
                              setMoreDrawerOpen((v) => !v);
                            }
                          }}
                          className={`w-14 py-2 flex flex-col items-center justify-center gap-1 ${tokens.buttonRadius} transition-colors ${
                            active
                              ? `${tokens.accentSoftBg} ${tokens.accentText}`
                              : 'text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100'
                          }`}
                          aria-label={tab.label}
                          title={tab.label}
                        >
                          <Icon
                            className={tab.id === 'agent' ? 'w-8 h-8' : 'w-4 h-4'}
                            strokeWidth={tab.id === 'agent' ? 1.85 : 2}
                          />
                          {tab.id !== 'agent' && (
                            <span className="text-[10px] font-medium whitespace-nowrap">{tab.label}</span>
                          )}
                        </button>
                      );
                    })}
                {showRailFab && (
                  <button
                    type="button"
                    onClick={() => setFabModalOpen(true)}
                    aria-label="Quick add task"
                    title="Quick add task"
                    className={`mt-auto w-10 h-10 ${tokens.accentBg} rounded-full shadow-md shadow-stone-900/15 flex items-center justify-center hover:scale-105 active:scale-95 transition-transform shrink-0`}
                  >
                    <Plus className="w-4.5 h-4.5" />
                  </button>
                )}
              </aside>
            )}

            {/* Active Screen Canvas */}
            <div className="relative flex-1 overflow-hidden">
              {renderScreenBody()}

              {/* Center Hinge Crease Overlay (Inner Unfolded Mode) */}
              {posture === FoldPosture.Inner && (
                <div
                  aria-hidden="true"
                  className={`pointer-events-none absolute inset-y-0 left-1/2 -translate-x-1/2 flex flex-col items-center justify-center transition-opacity ${
                    showHingeGuide ? 'opacity-100' : 'opacity-30'
                  }`}
                >
                  <div
                    className={`h-full ${
                      showHingeGuide
                        ? 'w-5 bg-[var(--tf-accent-soft)] border-x border-dashed border-[var(--tf-accent-border)]'
                        : 'w-[2px] bg-gradient-to-b from-transparent via-stone-400/25 dark:via-white/10 to-transparent'
                    }`}
                  />
                  {showHingeGuide && (
                    <span className="absolute top-2 px-1.5 py-0.5 text-[9px] font-mono-tabular bg-[var(--tf-accent)] text-[var(--tf-accent-fg)] rounded">
                      Hinge 24dp
                    </span>
                  )}
                </div>
              )}

              {/* Floating + Capture Button (Cover/Flex only; docked in rail on Inner, hidden on Lookup/Note Editor/Task Sheet) */}
              {showFloatingFab && (
                <button
                  type="button"
                  onClick={() => setFabModalOpen(true)}
                  aria-label="Quick add task"
                  className={`absolute right-3 bottom-3 z-20 w-10 h-10 ${tokens.accentBg} rounded-full shadow-lg shadow-stone-900/20 flex items-center justify-center hover:scale-105 active:scale-95 transition-transform`}
                >
                  <Plus className="w-4.5 h-4.5" />
                </button>
              )}

              {/* Quick Capture Bottom Sheet triggered by FAB */}
              {fabModalOpen && (
                <div
                  className="absolute inset-0 z-40 bg-black/35 backdrop-blur-[1px] flex items-end"
                  onClick={() => setFabModalOpen(false)}
                >
                  <form
                    onClick={(e) => e.stopPropagation()}
                    onSubmit={(e) => {
                      e.preventDefault();
                      submitQuickTask(
                        fabText,
                        () => {
                          setFabText('');
                          setFabListChoice('AUTO');
                          setFabModalOpen(false);
                        },
                        fabListChoice
                      );
                    }}
                    className="w-full bg-white dark:bg-[#181B19] rounded-t-3xl border-t border-stone-200 dark:border-stone-800 p-4 space-y-2.5"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-stone-900 dark:text-stone-100">
                        Quick capture
                      </span>
                      <button
                        type="button"
                        onClick={() => setFabModalOpen(false)}
                        className="p-1 text-stone-400 hover:text-stone-700 dark:hover:text-stone-200"
                        aria-label="Close capture"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    <NlpTaskInput
                      autoFocus
                      value={fabText}
                      onChange={setFabText}
                      nlpEnabled={settings.nlpQuickParse}
                      availableLists={taskLists}
                      placeholder="e.g. Dentist tomorrow 2pm remind 1h before #personal"
                      paddingClassName="px-3 py-2.5"
                      className={`w-full ${tokens.subtleBg} ${tokens.buttonRadius}`}
                    />

                    {/* Usable List Picker during Task Creation (matches configured list order) */}
                    <div className="flex items-center gap-1 overflow-x-auto">
                      <span className="text-[10.5px] text-stone-400 shrink-0 mr-1">List:</span>
                      {['AUTO', ...taskLists, 'Inbox'].map((opt) => {
                        const active = fabListChoice === opt;
                        const label = opt === 'AUTO' ? 'Auto' : opt;
                        return (
                          <button
                            key={opt}
                            type="button"
                            onClick={() => setFabListChoice(opt)}
                            className={`px-2 py-0.5 text-[10.5px] font-medium whitespace-nowrap shrink-0 transition-colors ${tokens.buttonRadius} ${
                              active
                                ? `${tokens.accentSoftBg} ${tokens.accentText} border ${tokens.accentBorder}`
                                : `${tokens.subtleBg} text-stone-600 dark:text-stone-300 border border-transparent`
                            }`}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>

                    {settings.nlpQuickParse && fabParsedPreview.reminders.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1">
                        {fabParsedPreview.reminders.map((rem) => (
                          <span
                            key={rem.id}
                            className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium tabular-nums ${tokens.accentSoftBg} ${tokens.accentText} border ${tokens.accentBorder} ${tokens.buttonRadius}`}
                          >
                            <Bell className="w-2.5 h-2.5 shrink-0" />
                            {formatReminderLabel(rem)}
                          </span>
                        ))}
                      </div>
                    )}

                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10.5px] text-stone-400 truncate tabular-nums">
                        {settings.nlpQuickParse && fabText.trim()
                          ? `${fabParsedPreview.category} · ${formatPreviewDateKey(
                              fabParsedPreview.dateKey
                            )} · ${fabParsedPreview.timeLabel}${
                              fabParsedPreview.priority !== 'Normal'
                                ? ` · ${fabParsedPreview.priority}`
                                : ''
                            }`
                          : !settings.nlpQuickParse
                            ? 'Plain capture'
                            : ''}
                      </span>
                      <button
                        type="submit"
                        className={`px-3.5 py-1.5 text-xs font-medium ${tokens.accentBg} ${tokens.buttonRadius} shrink-0`}
                      >
                        Save task
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {/* 4-Tab "More" Drawer */}
              {moreDrawerOpen && (
                <div
                  className="absolute inset-0 z-40 bg-black/35 backdrop-blur-[1px] flex items-end"
                  onClick={() => setMoreDrawerOpen(false)}
                >
                  <div
                    className="w-full bg-white dark:bg-[#181B19] rounded-t-3xl border-t border-stone-200 dark:border-stone-800 p-4 space-y-2"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex items-center justify-between pb-1">
                      <span className="text-xs font-semibold text-stone-800 dark:text-stone-200">
                        More workspace views
                      </span>
                      <button
                        type="button"
                        onClick={() => setMoreDrawerOpen(false)}
                        className="p-1 text-stone-400"
                        aria-label="Close menu"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        onChangeScreen(ScreenId.Tasks);
                        setMoreDrawerOpen(false);
                      }}
                      className={`w-full flex items-center justify-between px-3 py-2.5 text-xs font-medium ${tokens.subtleBg} text-stone-800 dark:text-stone-100 ${tokens.buttonRadius}`}
                    >
                      <span className="flex items-center gap-2.5">
                        <CheckSquare className="w-4 h-4" />
                        All Tasks & Lists
                      </span>
                      <span className="text-stone-400 tabular-nums">
                        {tasks.filter((t) => !t.completed).length}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onChangeScreen(ScreenId.Settings);
                        setMoreDrawerOpen(false);
                      }}
                      className={`w-full flex items-center justify-between px-3 py-2.5 text-xs font-medium ${tokens.subtleBg} text-stone-800 dark:text-stone-100 ${tokens.buttonRadius}`}
                    >
                      <span className="flex items-center gap-2.5">
                        <SettingsIcon className="w-4 h-4" />
                        Settings & Export
                      </span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Bottom Tab Bar on Cover & Flex Postures */}
          {posture !== FoldPosture.Inner && (
            <nav
              aria-label="App bottom navigation"
              className={`h-11 border-t ${tokens.divider} bg-white/90 dark:bg-[#151816]/90 backdrop-blur-md grid ${
                decisions.navMode === NavMode.Five ? 'grid-cols-5' : 'grid-cols-4'
              } items-center px-1 shrink-0`}
            >
              {decisions.navMode === NavMode.Five
                ? fiveTabs.map((tab) => {
                    const Icon = tab.icon;
                    const active = activeScreen === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => {
                          setFabModalOpen(false);
                          setMoreDrawerOpen(false);
                          setSelectedTaskId(null);
                          onChangeScreen(tab.id);
                        }}
                        className={`flex flex-col items-center justify-center py-0.5 transition-colors ${
                          active
                            ? tokens.accentText
                            : 'text-stone-400 dark:text-stone-500 hover:text-stone-700 dark:hover:text-stone-300'
                        }`}
                        aria-label={tab.label}
                        title={tab.label}
                      >
                        <Icon
                          className={tab.id === ScreenId.Agent ? 'w-[26px] h-[26px]' : 'w-3.5 h-3.5'}
                          strokeWidth={tab.id === ScreenId.Agent ? 2 : 2}
                        />
                        {tab.id !== ScreenId.Agent && (
                          <span className="text-[9.5px] font-medium leading-none mt-0.5 whitespace-nowrap">{tab.label}</span>
                        )}
                      </button>
                    );
                  })
                : fourTabs.map((tab) => {
                    const Icon = tab.icon;
                    const isMoreActive =
                      tab.id === 'more' &&
                      (activeScreen === ScreenId.Tasks || activeScreen === ScreenId.Settings);
                    const active = tab.screen === activeScreen || isMoreActive;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => {
                          setFabModalOpen(false);
                          setSelectedTaskId(null);
                          if (tab.screen) {
                            setMoreDrawerOpen(false);
                            onChangeScreen(tab.screen);
                          } else {
                            setMoreDrawerOpen((v) => !v);
                          }
                        }}
                        className={`flex flex-col items-center justify-center py-0.5 transition-colors ${
                          active
                            ? tokens.accentText
                            : 'text-stone-400 dark:text-stone-500 hover:text-stone-700 dark:hover:text-stone-300'
                        }`}
                        aria-label={tab.label}
                        title={tab.label}
                      >
                        <Icon
                          className={tab.id === 'agent' ? 'w-[26px] h-[26px]' : 'w-3.5 h-3.5'}
                          strokeWidth={tab.id === 'agent' ? 2 : 2}
                        />
                        {tab.id !== 'agent' && (
                          <span className="text-[9.5px] font-medium leading-none mt-0.5 whitespace-nowrap">{tab.label}</span>
                        )}
                      </button>
                    );
                  })}
            </nav>
          )}

          {/* Global Search Overlay */}
          <GlobalSearchModal
            open={searchOpen}
            tokens={tokens}
            tasks={tasks}
            notes={notes}
            onClose={() => setSearchOpen(false)}
            onSelectResult={handleSelectSearchResult}
          />

          {/* Explicit Confirmation Dialog for Google Tasks Mutations */}
          <GoogleTaskConfirmModal
            pending={pendingTaskMutation}
            tokens={tokens}
            busy={taskMutationBusy}
            onCancel={() => {
              setPendingTaskMutation(null);
              setPendingReplaceLocalId(null);
            }}
            onConfirm={handleConfirmTaskMutation}
            onSaveLocalOnly={
              pendingTaskMutation?.action === 'create' && !pendingReplaceLocalId
                ? () => {
                    onAddTask(pendingTaskMutation.task);
                    setPendingTaskMutation(null);
                  }
                : undefined
            }
          />

          {activeReminderAlerts.length > 0 && (
            <div className="absolute top-10 inset-x-3 z-50 flex flex-col gap-1.5 pointer-events-none">
              {activeReminderAlerts.slice(0, 3).map((alert) => (
                <div
                  key={alert.id}
                  role="alert"
                  className={`pointer-events-auto flex items-center gap-2 px-2.5 py-2 bg-white dark:bg-[#1A1E1C] border ${tokens.accentBorder} shadow-lg shadow-stone-900/15 dark:shadow-black/50 ${tokens.cardRadius}`}
                >
                  <span
                    className={`w-6 h-6 rounded-full ${tokens.accentSoftBg} ${tokens.accentText} flex items-center justify-center shrink-0`}
                  >
                    <Bell className="w-3.5 h-3.5" />
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedTaskId(alert.taskId);
                      onChangeScreen(ScreenId.Tasks);
                      onDismissReminderAlert?.(alert.id);
                    }}
                    className="flex-1 min-w-0 text-left"
                  >
                    <p className="text-[11.5px] font-semibold text-stone-900 dark:text-stone-100 truncate leading-tight">
                      {alert.taskTitle}
                    </p>
                    <p className="text-[10px] text-stone-500 dark:text-stone-400 truncate leading-tight mt-0.5 tabular-nums">
                      {alert.label} · {alert.category}
                    </p>
                  </button>
                  {onCompleteFromReminderAlert && (
                    <button
                      type="button"
                      onClick={() => onCompleteFromReminderAlert(alert.id, alert.taskId)}
                      className={`inline-flex items-center gap-1 px-2 py-1 text-[10px] font-medium ${tokens.accentBg} ${tokens.buttonRadius} shrink-0 hover:opacity-90`}
                    >
                      <Check className="w-3 h-3" />
                      Done
                    </button>
                  )}
                  {onDismissReminderAlert && (
                    <button
                      type="button"
                      onClick={() => onDismissReminderAlert(alert.id)}
                      aria-label="Dismiss reminder"
                      className="p-1 text-stone-400 hover:text-stone-800 dark:hover:text-stone-100 shrink-0"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {taskSyncToast && (
            <div className="pointer-events-none absolute top-10 inset-x-3 z-40 flex justify-center">
              <div
                className={`px-2.5 py-1 text-[10.5px] font-medium shadow-md ${tokens.accentSoftBg} ${tokens.accentText} border ${tokens.accentBorder} ${tokens.buttonRadius} max-w-full truncate`}
              >
                {taskSyncToast}
              </div>
            </div>
          )}
    </div>
  );

  if (standalone) {
    return innerAppContent;
  }

  return (
    <div className="flex flex-col items-center justify-center w-full">
      {/* Galaxy Z Fold 8 Hardware Chassis */}
      <div
        className={`relative ${chassisWidthClass} p-[9px] bg-[#1D1F1E] dark:bg-[#080908] shadow-2xl shadow-stone-900/20 dark:shadow-black/60 border border-stone-700/60 transition-[max-width,border-radius] duration-300 ease-out flex flex-col`}
      >
        {/* Left Titanium Hinge Spine on Cover Display */}
        {posture === FoldPosture.Cover && (
          <div
            aria-hidden="true"
            className="absolute -left-[5px] top-10 bottom-10 w-[5px] rounded-l-md bg-gradient-to-b from-stone-600 via-stone-400 to-stone-600 opacity-85"
          />
        )}

        {innerAppContent}
      </div>

      {/* Subtle Device Dimension Caption */}
      <p className="mt-3 text-xs text-stone-500 dark:text-stone-400 tabular-nums text-center">
        {posture === FoldPosture.Cover &&
          'Cover display · 10:16 (1248 × 1972) passport layout · Bottom tab navigation'}
        {posture === FoldPosture.Inner &&
          'Inner main display · 4:3 (2448 × 1848) unfolded workspace · Left navigation rail'}
        {posture === FoldPosture.Flex &&
          'Flex mode · 4:3 half-folded posture · Top context view · Bottom ergonomic controls'}
      </p>
    </div>
  );
};
