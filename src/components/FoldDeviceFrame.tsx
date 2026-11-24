import React, { useEffect, useRef, useState } from 'react';
import {
  Battery,
  Bell,
  Check,
  CheckSquare,
  Clock,
  FileText,
  HelpCircle,
  Inbox,
  LayoutDashboard,
  Menu,
  Plus,
  RotateCcw,
  Search,
  Settings as SettingsIcon,
  Wifi,
  X,
} from 'lucide-react';
import { TODAY_DATE_KEY, TOMORROW_DATE_KEY } from '../data/initialData';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { useBackLayer } from '../hooks/useAndroidBackNavigation';
import {
  AppSettingsState,
  CalendarEvent,
  CloudNotesSyncState,
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
import { AndroidKeyboardSimulator } from './AndroidKeyboardSimulator';
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
  keyboardOpen?: boolean;
  onDismissKeyboard?: () => void;
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
  noteFolders: string[];
  collapsedNoteFolders: string[];
  events: CalendarEvent[];
  notes: NoteItem[];
  settings: AppSettingsState;
  onAddTask: (task: TaskItem) => void;
  onToggleTask: (taskId: string) => void;
  onUpdateTask: (task: TaskItem) => void;
  onDeleteTask: (taskId: string) => void;
  onRestoreTask?: (task: TaskItem, index?: number) => void;
  onAddEvent: (ev: CalendarEvent) => void;
  onDeleteEvent?: (eventId: string) => void;
  onRestoreEvent?: (ev: CalendarEvent, index?: number) => void;
  onConvertEventToTask: (ev: CalendarEvent) => string | void;
  onUpdateNote: (note: NoteItem) => void;
  onDeleteNote: (noteId: string) => void;
  onRestoreNote?: (note: NoteItem, index?: number) => void;
  onCreateNote: (title?: string, body?: string, folder?: string) => string;
  onReorderNote: (noteId: string, targetFolder: string, targetIndexInFolder: number) => void;
  onUpdateSettings: (patch: Partial<AppSettingsState>) => void;
  onAddList: (name: string) => void;
  onRenameList: (oldName: string, newName: string) => void;
  onDeleteList: (name: string) => void;
  onReorderList: (fromIndex: number, toIndex: number) => void;
  onAddNoteFolder: (name: string) => void;
  onRenameNoteFolder: (oldName: string, newName: string) => void;
  onDeleteNoteFolder: (name: string) => void;
  onReorderNoteFolder: (fromIndex: number, toIndex: number) => void;
  onToggleNoteFolderCollapsed: (folderName: string) => void;
  onExpandNoteFolder: (folderName: string) => void;
  recentColors: string[];
  onPreviewAccentColor: (hex: string) => void;
  onSelectAccentColor: (hex: string) => void;
  googleCalendar: GoogleCalendarSyncState;
  googleTasks: GoogleTasksSyncState;
  cloudNotesSync: CloudNotesSyncState;
  activeReminderAlerts?: ActiveReminderAlert[];
  onDismissReminderAlert?: (alertId: string) => void;
  onSnoozeReminderAlert?: (alertId: string, taskId: string, reminderId: string, minutes?: number) => void;
  onCompleteFromReminderAlert?: (alertId: string, taskId: string) => void;
  externalOpenTask?: { taskId: string; nonce: number } | null;
  onConsumeExternalOpenTask?: () => void;
  externalShortcut?: { action: 'new-task' | 'new-note'; nonce: number } | null;
  onConsumeExternalShortcut?: () => void;
  hiddenCompletedTasksCount?: number;
}

export const FoldDeviceFrame: React.FC<FoldDeviceFrameProps> = ({
  standalone = false,
  keyboardOpen = false,
  onDismissKeyboard,
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
  noteFolders,
  collapsedNoteFolders,
  events,
  notes,
  settings,
  onAddTask,
  onToggleTask,
  onUpdateTask,
  onDeleteTask,
  onRestoreTask,
  onAddEvent,
  onDeleteEvent,
  onRestoreEvent,
  onConvertEventToTask,
  onUpdateNote,
  onDeleteNote,
  onRestoreNote,
  onCreateNote,
  onReorderNote,
  onUpdateSettings,
  onAddList,
  onRenameList,
  onDeleteList,
  onReorderList,
  onAddNoteFolder,
  onRenameNoteFolder,
  onDeleteNoteFolder,
  onReorderNoteFolder,
  onToggleNoteFolderCollapsed,
  onExpandNoteFolder,
  recentColors,
  onPreviewAccentColor,
  onSelectAccentColor,
  googleCalendar,
  googleTasks,
  cloudNotesSync,
  activeReminderAlerts = [],
  onDismissReminderAlert,
  onSnoozeReminderAlert,
  onCompleteFromReminderAlert,
  externalOpenTask = null,
  onConsumeExternalOpenTask,
  externalShortcut = null,
  onConsumeExternalShortcut,
  hiddenCompletedTasksCount = 0,
}) => {
  const isOnline = useOnlineStatus();
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedNoteId, setSelectedNoteId] = useState<string>(notes[0]?.id || '');
  const [coverNoteEditing, setCoverNoteEditing] = useState(false);
  const [noteEditorReturnScreen, setNoteEditorReturnScreen] = useState<ScreenId | null>(null);
  const noteEditorReturnScreenRef = useRef<ScreenId | null>(null);
  const setNoteReturnScreen = (screen: ScreenId | null) => {
    noteEditorReturnScreenRef.current = screen;
    setNoteEditorReturnScreen(screen);
  };
  const [shortcutFocusNoteId, setShortcutFocusNoteId] = useState<string | null>(null);
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
  const [undoDelete, setUndoDelete] = useState<{
    id: number;
    label: string;
    onUndo: () => void;
  } | null>(null);
  const undoTimerRef = useRef<number | null>(null);
  const pendingTaskSavedCallbackRef = useRef<((createdTaskId?: string) => void) | null>(null);

  const showUndoToast = (label: string, onUndo: () => void) => {
    if (undoTimerRef.current !== null) {
      window.clearTimeout(undoTimerRef.current);
    }
    const id = Date.now() + Math.random();
    setUndoDelete({ id, label, onUndo });
    undoTimerRef.current = window.setTimeout(() => {
      undoTimerRef.current = null;
      setUndoDelete((curr) => (curr?.id === id ? null : curr));
    }, 6000);
  };

  const dismissUndoToast = () => {
    if (undoTimerRef.current !== null) {
      window.clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
    setUndoDelete(null);
  };

  useEffect(() => {
    return () => {
      if (undoTimerRef.current !== null) {
        window.clearTimeout(undoTimerRef.current);
      }
    };
  }, []);

  const handleNoteEditorBack = () => {
    const returnTo = noteEditorReturnScreenRef.current ?? noteEditorReturnScreen;
    setNoteReturnScreen(null);
    setCoverNoteEditing(false);
    if (returnTo) {
      onChangeScreen(returnTo);
    }
  };

  useBackLayer(fabModalOpen, () => setFabModalOpen(false), 15);
  useBackLayer(moreDrawerOpen, () => setMoreDrawerOpen(false), 15);
  useBackLayer(
    activeScreen === ScreenId.Notes &&
      ((posture === FoldPosture.Cover && coverNoteEditing) || Boolean(noteEditorReturnScreen)),
    handleNoteEditorBack,
    0
  );

  const prevScreenRef = useRef<ScreenId>(activeScreen);
  useEffect(() => {
    if (prevScreenRef.current === ScreenId.Notes && activeScreen !== ScreenId.Notes) {
      setCoverNoteEditing(false);
      setNoteReturnScreen(null);
    }
    prevScreenRef.current = activeScreen;
  }, [activeScreen]);

  useEffect(() => {
    saveCachedLookupEntries(quickCheckEntries);
  }, [quickCheckEntries]);

  useEffect(() => {
    if (!externalOpenTask) return;
    setSelectedTaskId(externalOpenTask.taskId);
    onConsumeExternalOpenTask?.();
  }, [externalOpenTask, onConsumeExternalOpenTask]);

  const lastHandledShortcutNonceRef = useRef<number | null>(null);
  const onCreateNoteRef = useRef(onCreateNote);
  onCreateNoteRef.current = onCreateNote;
  const onChangeScreenRef = useRef(onChangeScreen);
  onChangeScreenRef.current = onChangeScreen;

  useEffect(() => {
    if (!externalShortcut) return;
    if (lastHandledShortcutNonceRef.current === externalShortcut.nonce) {
      onConsumeExternalShortcut?.();
      return;
    }
    lastHandledShortcutNonceRef.current = externalShortcut.nonce;

    setMoreDrawerOpen(false);
    setSearchOpen(false);
    setSelectedTaskId(null);

    if (externalShortcut.action === 'new-task') {
      setFabText('');
      setFabListChoice('AUTO');
      setFabModalOpen(true);
    } else if (externalShortcut.action === 'new-note') {
      setFabModalOpen(false);
      const newNoteId = onCreateNoteRef.current();
      setSelectedNoteId(newNoteId);
      setNoteReturnScreen(null);
      setCoverNoteEditing(true);
      setShortcutFocusNoteId(newNoteId);
      onChangeScreenRef.current(ScreenId.Notes);
    }

    onConsumeExternalShortcut?.();
  }, [externalShortcut, onConsumeExternalShortcut]);

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

  const requestAddTask = (created: TaskItem, onSaved?: (createdTaskId?: string) => void) => {
    const wantsGoogleSync =
      settings.googleTasksSync && (googleTasks.isConnected || Boolean(googleTasks.userEmail));
    if (wantsGoogleSync && isOnline && googleTasks.isConnected) {
      const target = resolveGoogleTargetList(created.category);
      pendingTaskSavedCallbackRef.current = onSaved || null;
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
      void googleTasks
        .onCreateGoogleTask({
          title: created.title,
          notes: created.notes,
          dateKey: created.isInbox ? undefined : created.dateKey,
          timeLabel: created.timeLabel,
          priority: created.priority,
          taskListId: target.id,
          category: target.title,
          reminders: created.reminders,
        })
        .then((createdId) => {
          onSaved?.(typeof createdId === 'string' ? createdId : undefined);
        });
      showTaskToast(`Saved "${created.title}" offline · will sync when online`);
      return;
    }
    onAddTask(created);
    onSaved?.(created.id);
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

  const restoreGoogleTask = (deleted: TaskItem) => {
    const target = deleted.googleTaskListId
      ? { id: deleted.googleTaskListId, title: deleted.category || 'My Tasks' }
      : resolveGoogleTargetList(deleted.category);
    if (googleTasks.isConnected || Boolean(googleTasks.userEmail)) {
      void googleTasks.onCreateGoogleTask({
        title: deleted.title,
        notes: deleted.notes,
        dateKey: deleted.isInbox ? undefined : deleted.dateKey,
        timeLabel: deleted.timeLabel,
        priority: deleted.priority,
        taskListId: target.id,
        category: target.title,
        reminders: deleted.reminders,
      });
      return;
    }
    onRestoreTask?.(deleted);
  };

  const requestDeleteTask = (taskId: string) => {
    const taskIndex = tasks.findIndex((t) => t.id === taskId);
    const found = taskIndex >= 0 ? tasks[taskIndex] : undefined;
    if (found?.source === 'google') {
      if (!isOnline || !googleTasks.isConnected) {
        void googleTasks.onDeleteGoogleTask(found);
        if (selectedTaskId === taskId) setSelectedTaskId(null);
        showUndoToast(`Deleted "${found.title}"`, () => restoreGoogleTask(found));
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
    if (found) {
      showUndoToast(`Deleted "${found.title}"`, () => {
        if (onRestoreTask) {
          onRestoreTask(found, taskIndex);
        } else {
          onAddTask(found);
        }
      });
    }
  };

  const handleRequestDeleteNote = (noteId: string) => {
    const noteIndex = notes.findIndex((n) => n.id === noteId);
    const deletedNote = noteIndex >= 0 ? notes[noteIndex] : undefined;
    const hasContent = Boolean(
      deletedNote &&
        (deletedNote.title.trim().length > 0 ||
          deletedNote.blocks.some((b) => b.text.trim().length > 0))
    );
    onDeleteNote(noteId);
    if (deletedNote && hasContent) {
      const label = deletedNote.title.trim() || 'Untitled Note';
      showUndoToast(`Deleted "${label}"`, () => {
        onRestoreNote?.(deletedNote, noteIndex);
        setSelectedNoteId(deletedNote.id);
      });
    }
  };

  const handleRequestDeleteEvent = (eventId: string) => {
    const eventIndex = events.findIndex((e) => e.id === eventId);
    const deletedEvent = eventIndex >= 0 ? events[eventIndex] : undefined;
    onDeleteEvent?.(eventId);
    if (deletedEvent) {
      showUndoToast(`Deleted "${deletedEvent.title}"`, () => {
        if (onRestoreEvent) {
          onRestoreEvent(deletedEvent, eventIndex);
        } else {
          onAddEvent(deletedEvent);
        }
      });
    }
  };

  const markQuickCheckEntrySaved = (
    entryId: string,
    kind: 'task' | 'note',
    savedId?: string
  ) => {
    setQuickCheckEntries((prev) =>
      prev.map((e) =>
        e.id === entryId
          ? {
              ...e,
              ...(kind === 'task'
                ? { savedTask: true, savedTaskId: savedId || e.savedTaskId }
                : { savedNote: true, savedNoteId: savedId || e.savedNoteId }),
            }
          : e
      )
    );
  };

  const handleDeleteLookupEntry = (entryId: string) => {
    const entryIndex = quickCheckEntries.findIndex((e) => e.id === entryId);
    const deletedEntry = entryIndex >= 0 ? quickCheckEntries[entryIndex] : undefined;
    setQuickCheckEntries((prev) => prev.filter((e) => e.id !== entryId));
    if (deletedEntry) {
      showUndoToast(`Deleted "${deletedEntry.prompt}"`, () => {
        setQuickCheckEntries((prev) => {
          if (prev.some((e) => e.id === deletedEntry.id)) return prev;
          const next = [...prev];
          const targetIdx =
            entryIndex >= 0 && entryIndex <= next.length ? entryIndex : next.length;
          next.splice(targetIdx, 0, deletedEntry);
          return next;
        });
      });
    }
  };

  const handleClearLookupEntries = () => {
    if (quickCheckEntries.length === 0) return;
    const snapshot = [...quickCheckEntries];
    setQuickCheckEntries([]);
    showUndoToast(
      `Cleared ${snapshot.length === 1 ? '1 Lookup chat' : `${snapshot.length} Lookup chats`}`,
      () => {
        setQuickCheckEntries(snapshot);
      }
    );
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
        const createdGoogleId = await googleTasks.onCreateGoogleTask({
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
        pendingTaskSavedCallbackRef.current?.(
          typeof createdGoogleId === 'string' ? createdGoogleId : undefined
        );
        pendingTaskSavedCallbackRef.current = null;
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
        const deletedTask = pendingTaskMutation.task;
        await googleTasks.onDeleteGoogleTask(deletedTask);
        if (selectedTaskId === deletedTask.id) setSelectedTaskId(null);
        showUndoToast(`Deleted "${deletedTask.title}"`, () => restoreGoogleTask(deletedTask));
      }
      setPendingTaskMutation(null);
      setPendingReplaceLocalId(null);
    } catch {
      pendingTaskSavedCallbackRef.current = null;
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
      setNoteReturnScreen(null);
      setCoverNoteEditing(true);
      onChangeScreen(ScreenId.Notes);
    }
  };

  const tokens = getDeviceStyleTokens(decisions.visualStyle);

  const homeLabel =
    decisions.defaultHome === DefaultHome.Inbox ? 'Inbox' : 'Overview';

  const HomeIcon =
    decisions.defaultHome === DefaultHome.Inbox ? Inbox : LayoutDashboard;

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
    !keyboardOpen &&
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
      ? 'w-full max-w-[400px] rounded-[34px]'
      : posture === FoldPosture.Inner
        ? 'w-full max-w-[760px] rounded-[28px]'
        : 'w-full max-w-[720px] rounded-[28px]';

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
            onDeleteEntry={handleDeleteLookupEntry}
            onClearEntries={handleClearLookupEntries}
            onSaveAsTask={(entryId, title, body) =>
              requestAddTask(
                {
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
                },
                (createdTaskId) => markQuickCheckEntrySaved(entryId, 'task', createdTaskId)
              )
            }
            onRemoveSavedTask={(entryId, taskId) => {
              requestDeleteTask(taskId);
              setQuickCheckEntries((prev) =>
                prev.map((e) =>
                  e.id === entryId && !e.savedTaskId ? { ...e, savedTask: false } : e
                )
              );
            }}
            onSaveAsNote={(entryId, title, body) => {
              const newId = onCreateNote(title, body);
              setSelectedNoteId(newId);
              markQuickCheckEntrySaved(entryId, 'note', newId);
            }}
            onRemoveSavedNote={(entryId, noteId) => {
              handleRequestDeleteNote(noteId);
              setQuickCheckEntries((prev) =>
                prev.map((e) =>
                  e.id === entryId && !e.savedNoteId ? { ...e, savedNote: false } : e
                )
              );
            }}
          />
        );
      case ScreenId.Notes:
        return (
          <NotesScreen
            posture={posture}
            tokens={tokens}
            notes={notes}
            noteFolders={noteFolders}
            collapsedFolders={collapsedNoteFolders}
            onToggleFolderCollapsed={onToggleNoteFolderCollapsed}
            onExpandFolder={onExpandNoteFolder}
            hingeAwareSplit={settings.hingeAwareSplit}
            selectedNoteId={selectedNoteId}
            onSelectNoteId={(id) => {
              setNoteReturnScreen(null);
              setSelectedNoteId(id);
            }}
            coverEditing={coverNoteEditing}
            onSetCoverEditing={(editing) => {
              if (!editing) {
                setNoteReturnScreen(null);
              }
              setCoverNoteEditing(editing);
            }}
            onEditorBack={handleNoteEditorBack}
            showReturnBack={Boolean(noteEditorReturnScreen)}
            backAriaLabel={
              noteEditorReturnScreen === ScreenId.Home ? 'Back to overview' : 'Back to notes'
            }
            highlightedNoteId={
              searchHighlight?.targetType === 'note' ? searchHighlight.targetId : null
            }
            highlightQuery={searchHighlight?.targetType === 'note' ? searchHighlight.query : ''}
            onDismissHighlight={() => setSearchHighlight(null)}
            onUpdateNote={onUpdateNote}
            onDeleteNote={handleRequestDeleteNote}
            onCreateNote={(folder) => {
              setNoteReturnScreen(null);
              return onCreateNote(undefined, undefined, folder);
            }}
            onReorderNote={onReorderNote}
            autoFocusTitleNoteId={shortcutFocusNoteId}
            onConsumeAutoFocusTitle={() => setShortcutFocusNoteId(null)}
            keyboardOpen={keyboardOpen}
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
            noteFolders={noteFolders}
            notes={notes}
            onAddFolder={onAddNoteFolder}
            onRenameFolder={onRenameNoteFolder}
            onDeleteFolder={onDeleteNoteFolder}
            onReorderFolder={onReorderNoteFolder}
            settings={settings}
            onUpdateSettings={onUpdateSettings}
            tasks={tasks}
            hiddenCompletedTasksCount={hiddenCompletedTasksCount}
            googleCalendar={googleCalendar}
            googleTasks={googleTasks}
            cloudNotesSync={cloudNotesSync}
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
            onDeleteEvent={handleRequestDeleteEvent}
            onConvertEventToTask={onConvertEventToTask}
            onNavigateScreen={(s) => {
              setSelectedTaskId(null);
              onChangeScreen(s);
            }}
            onOpenNote={(noteId) => {
              setSelectedTaskId(null);
              setSelectedNoteId(noteId);
              setNoteReturnScreen(ScreenId.Home);
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
          ? `relative w-full h-full overflow-hidden ${tokens.surfaceBg} flex flex-col pt-[env(safe-area-inset-top)] ${
              keyboardOpen ? 'pb-0' : 'pb-[env(safe-area-inset-bottom)]'
            }`
          : `relative w-full overflow-hidden ${screenAspectClass} ${tokens.surfaceBg} flex flex-col`
      }
    >
      <div className="relative flex-1 min-h-0 flex flex-col overflow-hidden">
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
        className={`px-4 ${standalone ? 'py-2.5' : 'py-2'} flex items-center justify-between border-b ${tokens.divider} shrink-0`}
      >
        <span className="font-display text-[19px] font-bold tracking-tight text-stone-900 dark:text-stone-100">
          buh.
        </span>
        <div className="flex items-center gap-2">
          {standalone && <PWAInstallButton compact />}
          {standalone && onExitStandalone && (
            <button
              type="button"
              onClick={onExitStandalone}
              className={`px-2.5 py-1.5 text-[12.5px] font-medium ${tokens.subtleBg} text-stone-600 dark:text-stone-300 ${tokens.buttonRadius} hover:opacity-85 transition-opacity`}
            >
              Studio
            </button>
          )}
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            aria-label="Global search tasks and notes"
            title="Search tasks & notes"
            className={`p-2 ${tokens.subtleBg} text-stone-600 dark:text-stone-300 hover:text-[var(--tf-accent-text)] ${tokens.buttonRadius} transition-colors`}
          >
            <Search className="w-[18px] h-[18px]" />
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
              className={`px-3.5 py-2 border-b ${tokens.divider} flex items-center gap-2 shrink-0`}
            >
              <NlpTaskInput
                value={quickBarText}
                onChange={setQuickBarText}
                nlpEnabled={settings.nlpQuickParse}
                availableLists={taskLists}
                placeholder="Quick add (e.g. Memo 3pm remind 10m before #work)..."
                paddingClassName="px-3 py-2"
                className={`flex-1 ${tokens.subtleBg} ${tokens.buttonRadius}`}
              />
              <button
                type="submit"
                className={`px-3.5 py-2 text-[13.5px] font-medium ${tokens.accentBg} ${tokens.buttonRadius} shrink-0`}
              >
                Add
              </button>
            </form>
          )}

          {/* Main App Body: Navigation Rail (Inner) + Active Screen */}
          <div className="relative flex-1 min-h-0 min-w-0 w-full flex overflow-hidden">
            {/* Inner Unfolded Adaptive Navigation Rail */}
            {posture === FoldPosture.Inner && (
              <aside className={`w-[66px] border-r ${tokens.divider} flex flex-col items-center py-2 gap-1.5 shrink-0`}>
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
                            if (tab.id === ScreenId.Notes && activeScreen === ScreenId.Notes) {
                              setCoverNoteEditing(false);
                              setNoteReturnScreen(null);
                            }
                            onChangeScreen(tab.id);
                          }}
                          className={`w-[54px] py-2 flex flex-col items-center justify-center gap-0.5 ${tokens.buttonRadius} transition-colors ${
                            active
                              ? `${tokens.accentSoftBg} ${tokens.accentText}`
                              : 'text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100'
                          }`}
                          aria-label={tab.label}
                          title={tab.label}
                        >
                          <Icon
                            className={tab.id === ScreenId.Agent ? 'w-[26px] h-[26px]' : 'w-[19px] h-[19px]'}
                            strokeWidth={tab.id === ScreenId.Agent ? 1.85 : 2}
                          />
                          {tab.id !== ScreenId.Agent && (
                            <span className="text-[10px] font-medium leading-tight whitespace-nowrap">{tab.label}</span>
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
                              if (tab.screen === ScreenId.Notes && activeScreen === ScreenId.Notes) {
                                setCoverNoteEditing(false);
                                setNoteReturnScreen(null);
                              }
                              onChangeScreen(tab.screen);
                            } else {
                              setMoreDrawerOpen((v) => !v);
                            }
                          }}
                          className={`w-[54px] py-2 flex flex-col items-center justify-center gap-0.5 ${tokens.buttonRadius} transition-colors ${
                            active
                              ? `${tokens.accentSoftBg} ${tokens.accentText}`
                              : 'text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100'
                          }`}
                          aria-label={tab.label}
                          title={tab.label}
                        >
                          <Icon
                            className={tab.id === 'agent' ? 'w-[26px] h-[26px]' : 'w-[19px] h-[19px]'}
                            strokeWidth={tab.id === 'agent' ? 1.85 : 2}
                          />
                          {tab.id !== 'agent' && (
                            <span className="text-[10px] font-medium leading-tight whitespace-nowrap">{tab.label}</span>
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
                    <Plus className="w-5 h-5" />
                  </button>
                )}
              </aside>
            )}

            {/* Active Screen Canvas */}
            <div className="relative flex-1 min-h-0 min-w-0 max-w-full overflow-hidden">
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
                  className={`absolute right-4 bottom-4 z-20 w-[52px] h-[52px] ${tokens.accentBg} rounded-full shadow-lg shadow-stone-900/20 flex items-center justify-center hover:scale-105 active:scale-95 transition-transform`}
                >
                  <Plus className="w-6 h-6" />
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
                    className="w-full bg-white dark:bg-[#181B19] rounded-t-3xl border-t border-stone-200 dark:border-stone-800 p-4 space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[15px] font-semibold text-stone-900 dark:text-stone-100">
                        Quick capture
                      </span>
                      <button
                        type="button"
                        onClick={() => setFabModalOpen(false)}
                        className="p-1.5 text-stone-400 hover:text-stone-700 dark:hover:text-stone-200"
                        aria-label="Close capture"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                    <NlpTaskInput
                      autoFocus
                      value={fabText}
                      onChange={setFabText}
                      nlpEnabled={settings.nlpQuickParse}
                      availableLists={taskLists}
                      placeholder="e.g. Dentist tomorrow 2pm remind 1h before #personal"
                      paddingClassName="px-3.5 py-3"
                      className={`w-full ${tokens.subtleBg} ${tokens.buttonRadius}`}
                    />

                    {/* Usable List Picker during Task Creation (matches configured list order) */}
                    <div
                      className={`flex items-center gap-1.5 pb-0.5 ${
                        posture === FoldPosture.Inner ? 'flex-wrap' : 'overflow-x-auto'
                      }`}
                    >
                      <span className="text-[12.5px] text-stone-400 shrink-0 mr-1">List:</span>
                      {['AUTO', ...taskLists, 'Inbox'].map((opt) => {
                        const active = fabListChoice === opt;
                        const label = opt === 'AUTO' ? 'Auto' : opt;
                        return (
                          <button
                            key={opt}
                            type="button"
                            onClick={() => setFabListChoice(opt)}
                            className={`px-2.5 py-1 text-[12.5px] font-medium whitespace-nowrap shrink-0 transition-colors ${tokens.buttonRadius} ${
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
                      <div className="flex flex-wrap items-center gap-1.5">
                        {fabParsedPreview.reminders.map((rem) => (
                          <span
                            key={rem.id}
                            className={`inline-flex items-center gap-1 px-2 py-1 text-[12px] font-medium tabular-nums ${tokens.accentSoftBg} ${tokens.accentText} border ${tokens.accentBorder} ${tokens.buttonRadius}`}
                          >
                            <Bell className="w-3.5 h-3.5 shrink-0" />
                            {formatReminderLabel(rem)}
                          </span>
                        ))}
                      </div>
                    )}

                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[12.5px] text-stone-400 truncate tabular-nums">
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
                        className={`px-4 py-2 text-[14px] font-medium ${tokens.accentBg} ${tokens.buttonRadius} shrink-0`}
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
                    className="w-full bg-white dark:bg-[#181B19] rounded-t-3xl border-t border-stone-200 dark:border-stone-800 p-4 space-y-2.5"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex items-center justify-between pb-1">
                      <span className="text-[15px] font-semibold text-stone-800 dark:text-stone-200">
                        More workspace views
                      </span>
                      <button
                        type="button"
                        onClick={() => setMoreDrawerOpen(false)}
                        className="p-1.5 text-stone-400"
                        aria-label="Close menu"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        onChangeScreen(ScreenId.Tasks);
                        setMoreDrawerOpen(false);
                      }}
                      className={`w-full flex items-center justify-between px-3.5 py-3 text-[14.5px] font-medium ${tokens.subtleBg} text-stone-800 dark:text-stone-100 ${tokens.buttonRadius}`}
                    >
                      <span className="flex items-center gap-3">
                        <CheckSquare className="w-5 h-5" />
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
                      className={`w-full flex items-center justify-between px-3.5 py-3 text-[14.5px] font-medium ${tokens.subtleBg} text-stone-800 dark:text-stone-100 ${tokens.buttonRadius}`}
                    >
                      <span className="flex items-center gap-3">
                        <SettingsIcon className="w-5 h-5" />
                        Settings & Export
                      </span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Bottom Tab Bar on Cover & Flex Postures (stays at bottom beneath keyboard, never pushed above it) */}
          {posture !== FoldPosture.Inner && !keyboardOpen && (
            <nav
              aria-label="App bottom navigation"
              className={`h-[58px] border-t ${tokens.divider} ${tokens.surfaceBg} grid ${
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
                          if (tab.id === ScreenId.Notes && activeScreen === ScreenId.Notes) {
                            setCoverNoteEditing(false);
                            setNoteReturnScreen(null);
                          }
                          onChangeScreen(tab.id);
                        }}
                        className={`flex flex-col items-center justify-center py-1.5 transition-colors ${
                          active
                            ? tokens.accentText
                            : 'text-stone-400 dark:text-stone-500 hover:text-stone-700 dark:hover:text-stone-300'
                        }`}
                        aria-label={tab.label}
                        title={tab.label}
                      >
                        <Icon
                          className={tab.id === ScreenId.Agent ? 'w-[30px] h-[30px]' : 'w-[22px] h-[22px]'}
                          strokeWidth={tab.id === ScreenId.Agent ? 1.9 : 2}
                        />
                        {tab.id !== ScreenId.Agent && (
                          <span className="text-[11px] font-medium leading-none mt-1 whitespace-nowrap">{tab.label}</span>
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
                            if (tab.screen === ScreenId.Notes && activeScreen === ScreenId.Notes) {
                              setCoverNoteEditing(false);
                              setNoteReturnScreen(null);
                            }
                            onChangeScreen(tab.screen);
                          } else {
                            setMoreDrawerOpen((v) => !v);
                          }
                        }}
                        className={`flex flex-col items-center justify-center py-1.5 transition-colors ${
                          active
                            ? tokens.accentText
                            : 'text-stone-400 dark:text-stone-500 hover:text-stone-700 dark:hover:text-stone-300'
                        }`}
                        aria-label={tab.label}
                        title={tab.label}
                      >
                        <Icon
                          className={tab.id === 'agent' ? 'w-[30px] h-[30px]' : 'w-[22px] h-[22px]'}
                          strokeWidth={tab.id === 'agent' ? 1.9 : 2}
                        />
                        {tab.id !== 'agent' && (
                          <span className="text-[11px] font-medium leading-none mt-1 whitespace-nowrap">{tab.label}</span>
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
              pendingTaskSavedCallbackRef.current = null;
              setPendingTaskMutation(null);
              setPendingReplaceLocalId(null);
            }}
            onConfirm={handleConfirmTaskMutation}
            onSaveLocalOnly={
              pendingTaskMutation?.action === 'create' && !pendingReplaceLocalId
                ? () => {
                    onAddTask(pendingTaskMutation.task);
                    pendingTaskSavedCallbackRef.current?.(pendingTaskMutation.task.id);
                    pendingTaskSavedCallbackRef.current = null;
                    setPendingTaskMutation(null);
                  }
                : undefined
            }
          />

          {activeReminderAlerts.length > 0 && (
            <div className="absolute top-12 inset-x-3 z-50 flex flex-col gap-2 pointer-events-none">
              {activeReminderAlerts.slice(0, 3).map((alert) => (
                <div
                  key={alert.id}
                  role="alert"
                  className={`pointer-events-auto flex flex-col gap-2 px-3.5 py-2.5 bg-white dark:bg-[#1A1E1C] border ${tokens.accentBorder} shadow-lg shadow-stone-900/15 dark:shadow-black/50 ${tokens.cardRadius}`}
                >
                  <div className="flex items-center gap-2.5">
                    <span
                      className={`w-8 h-8 rounded-full ${tokens.accentSoftBg} ${tokens.accentText} flex items-center justify-center shrink-0`}
                    >
                      <Bell className="w-4 h-4" />
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
                      <p className="text-[14px] font-semibold text-stone-900 dark:text-stone-100 truncate leading-tight">
                        {alert.taskTitle}
                      </p>
                      <p className="text-[12px] text-stone-500 dark:text-stone-400 truncate leading-tight mt-0.5 tabular-nums">
                        {alert.label} · {alert.category}
                      </p>
                    </button>
                  </div>
                  <div className="flex items-center justify-end gap-1.5">
                    {onSnoozeReminderAlert && (
                      <button
                        type="button"
                        onClick={() =>
                          onSnoozeReminderAlert(alert.id, alert.taskId, alert.reminderId, 10)
                        }
                        className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-[12px] font-medium ${tokens.subtleBg} text-stone-700 dark:text-stone-200 ${tokens.buttonRadius} shrink-0 hover:opacity-90`}
                      >
                        <Clock className="w-3.5 h-3.5" />
                        Snooze 10m
                      </button>
                    )}
                    {onDismissReminderAlert && (
                      <button
                        type="button"
                        onClick={() => onDismissReminderAlert(alert.id)}
                        className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-[12px] font-medium ${tokens.subtleBg} text-stone-600 dark:text-stone-300 ${tokens.buttonRadius} shrink-0 hover:opacity-90`}
                      >
                        Clear
                      </button>
                    )}
                    {onCompleteFromReminderAlert && (
                      <button
                        type="button"
                        onClick={() => onCompleteFromReminderAlert(alert.id, alert.taskId)}
                        className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-[12px] font-medium ${tokens.accentBg} ${tokens.buttonRadius} shrink-0 hover:opacity-90`}
                      >
                        <Check className="w-3.5 h-3.5" />
                        Done
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {taskSyncToast && (
            <div className="pointer-events-none absolute top-12 inset-x-3 z-40 flex justify-center">
              <div
                className={`px-3 py-1.5 text-[12.5px] font-medium shadow-md ${tokens.accentSoftBg} ${tokens.accentText} border ${tokens.accentBorder} ${tokens.buttonRadius} max-w-full truncate`}
              >
                {taskSyncToast}
              </div>
            </div>
          )}

          {undoDelete && (
            <div
              className={`pointer-events-none absolute inset-x-3 z-50 flex justify-center ${
                posture !== FoldPosture.Inner && !keyboardOpen
                  ? 'bottom-[70px]'
                  : 'bottom-4'
              }`}
            >
              <div
                role="status"
                aria-live="polite"
                className="pointer-events-auto flex items-center justify-between gap-2.5 max-w-sm w-full px-3.5 py-2.5 rounded-xl bg-stone-900/95 dark:bg-stone-100/95 text-white dark:text-stone-900 shadow-xl border border-stone-700/60 dark:border-stone-300/60"
              >
                <span className="text-[13px] font-medium truncate min-w-0">
                  {undoDelete.label}
                </span>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      const action = undoDelete.onUndo;
                      dismissUndoToast();
                      action();
                    }}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 text-[12.5px] font-semibold rounded-lg ${tokens.accentBg} hover:opacity-90 transition-opacity`}
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Undo
                  </button>
                  <button
                    type="button"
                    onClick={dismissUndoToast}
                    aria-label="Dismiss undo notice"
                    className="p-1 text-stone-400 hover:text-white dark:text-stone-500 dark:hover:text-stone-900 transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          )}
      </div>

      {/* Simulated Android On-Screen Keyboard (Preview Studio only) */}
      {!standalone && keyboardOpen && (
        <AndroidKeyboardSimulator
          posture={posture}
          onDismiss={() => onDismissKeyboard?.()}
        />
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
