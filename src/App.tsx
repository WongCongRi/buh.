import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Columns2,
  Download,
  Loader2,
  Maximize2,
  Moon,
  RotateCcw,
  Smartphone,
  SplitSquareVertical,
  Sun,
  Tablet,
} from 'lucide-react';
import { ApprovalModal } from './components/ApprovalModal';
import { DesignDecisionsPanel } from './components/DesignDecisionsPanel';
import { ActiveReminderAlert, FoldDeviceFrame } from './components/FoldDeviceFrame';
import { OfflineIndicator } from './components/OfflineIndicator';
import { PWAInstallButton } from './components/PWAInstallButton';
import { StudioHeader } from './components/StudioHeader';
import {
  DEMO_SEED_IDS,
  INITIAL_DECISIONS,
  INITIAL_EVENTS,
  INITIAL_LISTS,
  INITIAL_NOTES,
  INITIAL_RECENT_COLORS,
  INITIAL_SETTINGS,
  INITIAL_TASKS,
} from './data/initialData';
import {
  createGoogleCalendarEvent,
  deleteGoogleCalendarEvent,
  fetchGoogleCalendarEvents,
  initGoogleAuth,
  signInWithGoogleCalendar,
  signOutGoogleCalendar,
} from './services/googleCalendar';
import {
  createGoogleTask,
  deleteGoogleTask,
  fetchGoogleTasks,
  updateGoogleTask,
} from './services/googleTasks';
import {
  AppSettingsState,
  CalendarEvent,
  DefaultHome,
  DesignDecisions,
  FoldPosture,
  GoogleCalendarSyncState,
  GoogleTaskListInfo,
  GoogleTasksSyncState,
  NoteItem,
  ScreenId,
  TaskItem,
  TaskPriority,
  TaskReminder,
} from './types/taskflow';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import { applyAccentCssVars, normalizeHex } from './utils/colorUtils';
import {
  clearOfflineGoogleCache,
  enqueueSyncOp,
  isNetworkOrOfflineError,
  loadOfflineGoogleCache,
  makeSyncOpId,
  OfflineSyncOp,
  requestPersistentStorage,
  saveOfflineGoogleCache,
} from './utils/offlineSync';
import {
  computeReminderTriggerMs,
  dispatchSystemTaskNotification,
  formatReminderLabel,
  playSoftReminderChime,
} from './utils/taskReminders';

const STORAGE_KEY = 'buh_fold8_review_v2';
const PREV_STORAGE_KEY = 'buh_fold8_review_v1';
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
    const v2Raw = localStorage.getItem(STORAGE_KEY);
    const isLegacyMigration = !v2Raw;
    const raw =
      v2Raw || localStorage.getItem(PREV_STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
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

      const rawTasks = Array.isArray(parsed.tasks) ? parsed.tasks : INITIAL_TASKS;
      const rawEvents = Array.isArray(parsed.events) ? parsed.events : INITIAL_EVENTS;
      const rawNotes = Array.isArray(parsed.notes) ? parsed.notes : INITIAL_NOTES;

      const tasks = isLegacyMigration
        ? rawTasks.filter((t) => !DEMO_SEED_IDS.tasks.has(t.id))
        : rawTasks;
      const events = isLegacyMigration
        ? rawEvents.filter((e) => !DEMO_SEED_IDS.events.has(e.id))
        : rawEvents;
      const migratedNotes = isLegacyMigration
        ? rawNotes.filter((n) => !DEMO_SEED_IDS.notes.has(n.id))
        : rawNotes;
      const notes = migratedNotes
        .filter((n) => n.title.trim().length > 0 || n.blocks.some((b) => b.text.trim().length > 0))
        .map((n) => (n.title.trim().length > 0 ? n : { ...n, title: 'Untitled Note' }));

      if (isLegacyMigration) {
        try {
          localStorage.removeItem(PREV_STORAGE_KEY);
          localStorage.removeItem(LEGACY_STORAGE_KEY);
        } catch {
          // ignore
        }
      }

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
        tasks,
        taskLists,
        events,
        notes,
        settings: { ...INITIAL_SETTINGS, ...(parsed.settings ?? {}) },
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
  const [activeReminderAlerts, setActiveReminderAlerts] = useState<ActiveReminderAlert[]>([]);
  const dispatchedReminderKeysRef = useRef<Set<string>>(new Set());
  const [isInstalledPwa, setIsInstalledPwa] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true
    );
  });
  const [manualFullScreen, setManualFullScreen] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('mode') === 'app';
  });
  const [viewportWidth, setViewportWidth] = useState<number>(() =>
    typeof window !== 'undefined' ? window.innerWidth : 1280
  );
  const [isCoarseTouch, setIsCoarseTouch] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.matchMedia('(pointer: coarse)').matches : false
  );

  useEffect(() => {
    const standaloneMedia = window.matchMedia('(display-mode: standalone)');
    const coarseMedia = window.matchMedia('(pointer: coarse)');
    const syncViewport = () => {
      setViewportWidth(window.innerWidth);
      setIsCoarseTouch(coarseMedia.matches);
      setIsInstalledPwa(
        standaloneMedia.matches ||
          (window.navigator as unknown as { standalone?: boolean }).standalone === true
      );
    };
    syncViewport();
    window.addEventListener('resize', syncViewport);
    standaloneMedia.addEventListener?.('change', syncViewport);
    coarseMedia.addEventListener?.('change', syncViewport);
    return () => {
      window.removeEventListener('resize', syncViewport);
      standaloneMedia.removeEventListener?.('change', syncViewport);
      coarseMedia.removeEventListener?.('change', syncViewport);
    };
  }, []);

  const isOnline = useOnlineStatus();
  const initialGoogleCache = useMemo(() => loadOfflineGoogleCache(), []);

  const [googleConnected, setGoogleConnected] = useState<boolean>(false);
  const [googleUserEmail, setGoogleUserEmail] = useState<string | null>(
    initialGoogleCache.lastGoogleUserEmail
  );
  const [googleSigningIn, setGoogleSigningIn] = useState<boolean>(false);
  const [googleSyncing, setGoogleSyncing] = useState<boolean>(false);
  const [googleEvents, setGoogleEvents] = useState<CalendarEvent[]>(
    initialGoogleCache.googleEvents
  );
  const [googleLastSyncedAt, setGoogleLastSyncedAt] = useState<string | null>(
    initialGoogleCache.googleLastSyncedAt
  );
  const [googleError, setGoogleError] = useState<string | null>(null);

  const [googleTasksSyncing, setGoogleTasksSyncing] = useState<boolean>(false);
  const [googleTasks, setGoogleTasks] = useState<TaskItem[]>(initialGoogleCache.googleTasks);
  const [googleTaskLists, setGoogleTaskLists] = useState<GoogleTaskListInfo[]>(
    initialGoogleCache.googleTaskLists
  );
  const [googleTasksLastSyncedAt, setGoogleTasksLastSyncedAt] = useState<string | null>(
    initialGoogleCache.googleTasksLastSyncedAt
  );
  const [googleTasksError, setGoogleTasksError] = useState<string | null>(null);
  const [dirtyGoogleTaskIds, setDirtyGoogleTaskIds] = useState<string[]>(
    initialGoogleCache.dirtyGoogleTaskIds
  );

  const [pendingSyncQueue, setPendingSyncQueue] = useState<OfflineSyncOp[]>(
    initialGoogleCache.pendingSyncQueue
  );
  const [isSyncingOfflineQueue, setIsSyncingOfflineQueue] = useState<boolean>(false);
  const [offlineSyncNotice, setOfflineSyncNotice] = useState<string | null>(null);

  const pendingSyncQueueRef = useRef<OfflineSyncOp[]>(pendingSyncQueue);
  const flushingQueueRef = useRef<boolean>(false);
  const googleConnectedRef = useRef<boolean>(googleConnected);

  useEffect(() => {
    pendingSyncQueueRef.current = pendingSyncQueue;
  }, [pendingSyncQueue]);

  useEffect(() => {
    googleConnectedRef.current = googleConnected;
  }, [googleConnected]);

  // Ask browser/OS to protect local tasks, notes, and offline sync queue from storage eviction
  useEffect(() => {
    void requestPersistentStorage();
  }, []);

  // Persist Google cache + offline sync queue so tasks & calendar stay fully usable offline
  useEffect(() => {
    saveOfflineGoogleCache({
      googleEvents,
      googleTasks,
      googleTaskLists,
      dirtyGoogleTaskIds,
      googleLastSyncedAt,
      googleTasksLastSyncedAt,
      lastGoogleUserEmail: googleUserEmail,
      pendingSyncQueue,
    });
  }, [
    googleEvents,
    googleTasks,
    googleTaskLists,
    dirtyGoogleTaskIds,
    googleLastSyncedAt,
    googleTasksLastSyncedAt,
    googleUserEmail,
    pendingSyncQueue,
  ]);

  const showOfflineSyncNotice = useCallback((msg: string) => {
    setOfflineSyncNotice(msg);
    window.setTimeout(() => {
      setOfflineSyncNotice((curr) => (curr === msg ? null : curr));
    }, 3400);
  }, []);

  const syncGoogleCalendarEvents = useCallback(async (tokenOverride?: string) => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    setGoogleSyncing(true);
    setGoogleError(null);
    try {
      const fetched = await fetchGoogleCalendarEvents(tokenOverride);
      setGoogleEvents(fetched);
      setGoogleLastSyncedAt(
        new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      );
    } catch (err: unknown) {
      if (isNetworkOrOfflineError(err)) return;
      const msg = err instanceof Error ? err.message : 'Unable to sync Google Calendar.';
      if (msg === 'NOT_AUTHENTICATED' || msg === 'AUTH_EXPIRED') {
        setGoogleConnected(false);
        setGoogleError('Session expired — please sign in with Google again.');
      } else {
        setGoogleError(msg);
      }
    } finally {
      setGoogleSyncing(false);
    }
  }, []);

  const syncGoogleTasksList = useCallback(async (tokenOverride?: string) => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    setGoogleTasksSyncing(true);
    setGoogleTasksError(null);
    try {
      const { tasks: fetchedTasks, taskLists: fetchedLists } = await fetchGoogleTasks(tokenOverride);
      // Preserve local reminders, timeLabel, and priority attached to Google Tasks
      setGoogleTasks((prev) => {
        const byGoogleId = new Map<string, TaskItem>();
        for (const existing of prev) {
          if (existing.googleTaskId) byGoogleId.set(existing.googleTaskId, existing);
        }
        return fetchedTasks.map((incoming) => {
          const prevMatch = incoming.googleTaskId ? byGoogleId.get(incoming.googleTaskId) : undefined;
          if (!prevMatch) return incoming;
          return {
            ...incoming,
            reminders: prevMatch.reminders ?? incoming.reminders,
            timeLabel:
              prevMatch.timeLabel && prevMatch.timeLabel !== 'No time set'
                ? prevMatch.timeLabel
                : incoming.timeLabel,
            priority: prevMatch.priority !== 'Normal' ? prevMatch.priority : incoming.priority,
          };
        });
      });
      setGoogleTaskLists(fetchedLists);
      setDirtyGoogleTaskIds([]);
      setGoogleTasksLastSyncedAt(
        new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      );
    } catch (err: unknown) {
      if (isNetworkOrOfflineError(err)) return;
      const msg = err instanceof Error ? err.message : 'Unable to sync Google Tasks.';
      if (msg === 'NOT_AUTHENTICATED' || msg === 'AUTH_EXPIRED') {
        setGoogleConnected(false);
        setGoogleTasksError('Session expired — please sign in with Google again.');
      } else {
        setGoogleTasksError(msg);
      }
    } finally {
      setGoogleTasksSyncing(false);
    }
  }, []);

  const flushPendingSyncQueue = useCallback(
    async (tokenOverride?: string): Promise<number> => {
      if (flushingQueueRef.current) return 0;
      if (typeof navigator !== 'undefined' && !navigator.onLine) return 0;
      const snapshot = pendingSyncQueueRef.current;
      if (snapshot.length === 0) return 0;

      flushingQueueRef.current = true;
      setIsSyncingOfflineQueue(true);
      let syncedOps = 0;
      let touchedTasks = false;
      let touchedEvents = false;
      const tempToCreatedTask = new Map<string, TaskItem>();
      let remaining: OfflineSyncOp[] = [...snapshot];

      try {
        for (let i = 0; i < snapshot.length; i += 1) {
          const op = snapshot[i];
          if (typeof navigator !== 'undefined' && !navigator.onLine) break;

          if (op.type === 'gtask-create') {
            const created = await createGoogleTask(
              {
                title: op.payload.title,
                notes: op.payload.notes,
                dateKey: op.payload.dateKey,
                timeLabel: op.payload.timeLabel,
                priority: op.payload.priority,
                taskListId: op.payload.taskListId || '@default',
                taskListTitle: op.payload.category || 'My Tasks',
              },
              tokenOverride
            );
            const withMeta: TaskItem = {
              ...created,
              reminders: op.payload.reminders,
            };
            tempToCreatedTask.set(op.tempId, withMeta);
            setGoogleTasks((prev) =>
              prev.map((t) => (t.id === op.tempId ? withMeta : t))
            );
            setDirtyGoogleTaskIds((prev) => prev.filter((id) => id !== op.tempId));
            touchedTasks = true;
          } else if (op.type === 'gtask-update') {
            const mapped = tempToCreatedTask.get(op.taskId);
            const targetTask: TaskItem = mapped
              ? {
                  ...op.task,
                  id: mapped.id,
                  googleTaskId: mapped.googleTaskId,
                  googleTaskListId: mapped.googleTaskListId,
                  googleTaskListTitle: mapped.googleTaskListTitle,
                }
              : op.task;
            if (targetTask.googleTaskId && !targetTask.googleTaskId.startsWith('offline-')) {
              const updated = await updateGoogleTask(targetTask, tokenOverride);
              setGoogleTasks((prev) =>
                prev.map((t) =>
                  t.id === targetTask.id || t.id === op.taskId
                    ? { ...updated, reminders: targetTask.reminders }
                    : t
                )
              );
              setDirtyGoogleTaskIds((prev) =>
                prev.filter((id) => id !== op.taskId && id !== targetTask.id)
              );
              touchedTasks = true;
            }
          } else if (op.type === 'gtask-delete') {
            if (op.googleTaskId && !op.googleTaskId.startsWith('offline-')) {
              await deleteGoogleTask(op.googleTaskListId, op.googleTaskId, tokenOverride);
              touchedTasks = true;
            }
          } else if (op.type === 'gcal-create') {
            const created = await createGoogleCalendarEvent(op.payload, tokenOverride);
            setGoogleEvents((prev) =>
              prev.map((ev) => (ev.id === op.tempId ? created : ev))
            );
            touchedEvents = true;
          } else if (op.type === 'gcal-delete') {
            if (op.googleEventId && !op.googleEventId.startsWith('offline-')) {
              await deleteGoogleCalendarEvent(op.googleEventId, tokenOverride);
              touchedEvents = true;
            }
          }

          syncedOps += 1;
          remaining = snapshot.slice(i + 1);
          setPendingSyncQueue(remaining);
        }

        if (syncedOps > 0) {
          showOfflineSyncNotice(
            `Synced ${syncedOps} offline change${syncedOps === 1 ? '' : 's'}`
          );
          await Promise.allSettled([
            touchedEvents ? syncGoogleCalendarEvents(tokenOverride) : Promise.resolve(),
            touchedTasks ? syncGoogleTasksList(tokenOverride) : Promise.resolve(),
          ]);
        }
      } catch (err: unknown) {
        if (!isNetworkOrOfflineError(err)) {
          const msg = err instanceof Error ? err.message : '';
          if (msg === 'NOT_AUTHENTICATED' || msg === 'AUTH_EXPIRED') {
            setGoogleConnected(false);
          }
        }
      } finally {
        flushingQueueRef.current = false;
        setIsSyncingOfflineQueue(false);
      }
      return syncedOps;
    },
    [showOfflineSyncNotice, syncGoogleCalendarEvents, syncGoogleTasksList]
  );

  useEffect(() => {
    const unsubscribe = initGoogleAuth(
      (user, token) => {
        setGoogleConnected(true);
        setGoogleUserEmail(user.email || user.displayName || 'Google Account');
        void (async () => {
          await flushPendingSyncQueue(token);
          await Promise.allSettled([
            syncGoogleCalendarEvents(token),
            syncGoogleTasksList(token),
          ]);
        })();
      },
      () => {
        setGoogleConnected(false);
        // Never wipe cached Google events/tasks while offline so offline access stays intact
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
          return;
        }
        setGoogleUserEmail(null);
      },
      (user) => {
        // Firebase remembers the signed-in user across exits & offline sessions.
        // Keep cached Google Calendar events and Tasks visible and editable offline!
        setGoogleConnected(false);
        setGoogleUserEmail(user.email || user.displayName || 'Google Account');
      }
    );
    return () => unsubscribe();
  }, [flushPendingSyncQueue, syncGoogleCalendarEvents, syncGoogleTasksList]);

  // Automatically flush queued offline changes & refresh when returning online
  useEffect(() => {
    if (!isOnline || !googleConnected) return;
    void (async () => {
      if (pendingSyncQueueRef.current.length > 0) {
        await flushPendingSyncQueue();
      } else {
        await Promise.allSettled([syncGoogleCalendarEvents(), syncGoogleTasksList()]);
      }
    })();
  }, [isOnline, googleConnected, flushPendingSyncQueue, syncGoogleCalendarEvents, syncGoogleTasksList]);

  const handleGoogleSignIn = useCallback(async () => {
    if (googleSigningIn) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      const msg = 'You are offline — reconnect to sync with Google.';
      setGoogleError(msg);
      setGoogleTasksError(msg);
      return;
    }
    setGoogleSigningIn(true);
    setGoogleError(null);
    setGoogleTasksError(null);
    try {
      const hint = googleUserEmail && googleUserEmail.includes('@') ? googleUserEmail : null;
      const { user, accessToken } = await signInWithGoogleCalendar(hint);
      setGoogleConnected(true);
      setGoogleUserEmail(user.email || user.displayName || 'Google Account');
      setSettings((s) => ({ ...s, googleCalendarSync: true, googleTasksSync: true }));
      const flushed = await flushPendingSyncQueue(accessToken);
      if (flushed === 0) {
        await Promise.allSettled([
          syncGoogleCalendarEvents(accessToken),
          syncGoogleTasksList(accessToken),
        ]);
      }
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code !== 'auth/popup-closed-by-user' && code !== 'auth/cancelled-popup-request') {
        const msg = err instanceof Error ? err.message : 'Google sign-in failed.';
        setGoogleError(msg);
        setGoogleTasksError(msg);
      }
    } finally {
      setGoogleSigningIn(false);
    }
  }, [
    googleSigningIn,
    googleUserEmail,
    flushPendingSyncQueue,
    syncGoogleCalendarEvents,
    syncGoogleTasksList,
  ]);

  const handleTriggerPendingSync = useCallback(() => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    if (googleConnectedRef.current) {
      void flushPendingSyncQueue();
    } else {
      void handleGoogleSignIn();
    }
  }, [flushPendingSyncQueue, handleGoogleSignIn]);

  const handleGoogleSignOut = useCallback(async () => {
    setGoogleError(null);
    setGoogleTasksError(null);
    try {
      await signOutGoogleCalendar();
    } finally {
      setGoogleConnected(false);
      setGoogleUserEmail(null);
      setGoogleEvents([]);
      setGoogleLastSyncedAt(null);
      setGoogleTasks([]);
      setGoogleTaskLists([]);
      setGoogleTasksLastSyncedAt(null);
      setDirtyGoogleTaskIds([]);
      setPendingSyncQueue([]);
      clearOfflineGoogleCache();
    }
  }, []);

  const handleCreateGoogleEvent = useCallback(
    async (input: {
      title: string;
      dateKey: string;
      startTime: string;
      endTime: string;
      calendarName: string;
    }) => {
      setGoogleError(null);
      const queueOfflineEvent = () => {
        const tempId = `gcal-offline-${Date.now()}`;
        const optimistic: CalendarEvent = {
          id: tempId,
          googleEventId: `offline-${Date.now()}`,
          title: input.title,
          dateKey: input.dateKey,
          startTime: input.startTime,
          endTime: input.endTime,
          durationMinutes: 60,
          calendarName: input.calendarName || 'Google Calendar',
          source: 'google',
        };
        setGoogleEvents((prev) => [...prev, optimistic]);
        setPendingSyncQueue((prev) =>
          enqueueSyncOp(prev, {
            id: makeSyncOpId(),
            type: 'gcal-create',
            tempId,
            payload: input,
            createdAt: Date.now(),
          })
        );
      };

      if ((typeof navigator !== 'undefined' && !navigator.onLine) || !googleConnectedRef.current) {
        queueOfflineEvent();
        return;
      }

      try {
        const created = await createGoogleCalendarEvent(input);
        setGoogleEvents((prev) => [...prev, created]);
        setGoogleLastSyncedAt(
          new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        );
      } catch (err: unknown) {
        if (isNetworkOrOfflineError(err)) {
          queueOfflineEvent();
          return;
        }
        const msg = err instanceof Error ? err.message : 'Failed to add event to Google Calendar.';
        if (msg === 'NOT_AUTHENTICATED' || msg === 'AUTH_EXPIRED') {
          setGoogleConnected(false);
          queueOfflineEvent();
          return;
        }
        setGoogleError(msg);
        throw err;
      }
    },
    []
  );

  const handleDeleteGoogleEvent = useCallback(async (eventId: string, googleEventId: string) => {
    setGoogleError(null);
    const queueOfflineDelete = () => {
      setGoogleEvents((prev) => prev.filter((e) => e.id !== eventId));
      setPendingSyncQueue((prev) =>
        enqueueSyncOp(prev, {
          id: makeSyncOpId(),
          type: 'gcal-delete',
          eventId,
          googleEventId,
          createdAt: Date.now(),
        })
      );
    };

    if (
      (typeof navigator !== 'undefined' && !navigator.onLine) ||
      !googleConnectedRef.current ||
      googleEventId.startsWith('offline-')
    ) {
      queueOfflineDelete();
      return;
    }

    try {
      await deleteGoogleCalendarEvent(googleEventId);
      setGoogleEvents((prev) => prev.filter((e) => e.id !== eventId));
    } catch (err: unknown) {
      if (isNetworkOrOfflineError(err)) {
        queueOfflineDelete();
        return;
      }
      const msg = err instanceof Error ? err.message : 'Failed to remove event from Google Calendar.';
      if (msg === 'NOT_AUTHENTICATED' || msg === 'AUTH_EXPIRED') {
        setGoogleConnected(false);
        queueOfflineDelete();
        return;
      }
      setGoogleError(msg);
      throw err;
    }
  }, []);

  const handleCreateGoogleTask = useCallback(
    async (input: {
      title: string;
      notes?: string;
      dateKey?: string;
      timeLabel?: string;
      priority?: TaskPriority;
      taskListId?: string;
      category?: string;
      reminders?: TaskReminder[];
    }) => {
      setGoogleTasksError(null);
      const matchedList =
        (input.taskListId && googleTaskLists.find((l) => l.id === input.taskListId)) ||
        (input.category &&
          googleTaskLists.find(
            (l) => l.title.toLowerCase() === input.category!.toLowerCase()
          )) ||
        googleTaskLists[0];
      const targetListId = matchedList?.id || '@default';
      const targetListTitle = matchedList?.title || input.category || 'My Tasks';

      const queueOfflineTask = () => {
        const stamp = Date.now();
        const tempId = `gtask-offline-${stamp}`;
        const optimistic: TaskItem = {
          id: tempId,
          title: input.title,
          timeLabel: input.timeLabel || 'No time set',
          dateKey: input.dateKey || new Date().toISOString().slice(0, 10),
          category: targetListTitle,
          priority: input.priority || 'Normal',
          completed: false,
          isInbox: !input.dateKey,
          notes: input.notes || '',
          subtasks: [],
          reminders: input.reminders,
          source: 'google',
          googleTaskId: `offline-${stamp}`,
          googleTaskListId: targetListId,
          googleTaskListTitle: targetListTitle,
        };
        setGoogleTasks((prev) => [optimistic, ...prev]);
        setDirtyGoogleTaskIds((prev) => (prev.includes(tempId) ? prev : [...prev, tempId]));
        setPendingSyncQueue((prev) =>
          enqueueSyncOp(prev, {
            id: makeSyncOpId(),
            type: 'gtask-create',
            tempId,
            payload: {
              ...input,
              taskListId: targetListId,
              category: targetListTitle,
            },
            createdAt: stamp,
          })
        );
      };

      if ((typeof navigator !== 'undefined' && !navigator.onLine) || !googleConnectedRef.current) {
        queueOfflineTask();
        return;
      }

      try {
        const created = await createGoogleTask({
          title: input.title,
          notes: input.notes,
          dateKey: input.dateKey,
          timeLabel: input.timeLabel,
          priority: input.priority,
          taskListId: targetListId,
          taskListTitle: targetListTitle,
        });

        const withReminders: TaskItem =
          input.reminders && input.reminders.length > 0
            ? { ...created, reminders: input.reminders }
            : created;

        setGoogleTasks((prev) => [withReminders, ...prev]);
        setGoogleTasksLastSyncedAt(
          new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        );
      } catch (err: unknown) {
        if (isNetworkOrOfflineError(err)) {
          queueOfflineTask();
          return;
        }
        const msg = err instanceof Error ? err.message : 'Failed to create Google Task.';
        if (msg === 'NOT_AUTHENTICATED' || msg === 'AUTH_EXPIRED') {
          setGoogleConnected(false);
          queueOfflineTask();
          return;
        }
        setGoogleTasksError(msg);
        throw err;
      }
    },
    [googleTaskLists]
  );

  const handleUpdateGoogleTask = useCallback(async (task: TaskItem) => {
    setGoogleTasksError(null);
    const queueOfflineUpdate = () => {
      setGoogleTasks((prev) => prev.map((t) => (t.id === task.id ? task : t)));
      setDirtyGoogleTaskIds((prev) => (prev.includes(task.id) ? prev : [...prev, task.id]));
      setPendingSyncQueue((prev) =>
        enqueueSyncOp(prev, {
          id: makeSyncOpId(),
          type: 'gtask-update',
          taskId: task.id,
          task,
          createdAt: Date.now(),
        })
      );
    };

    if (
      (typeof navigator !== 'undefined' && !navigator.onLine) ||
      !googleConnectedRef.current ||
      task.googleTaskId?.startsWith('offline-')
    ) {
      queueOfflineUpdate();
      return;
    }

    try {
      const updated = await updateGoogleTask(task);
      setGoogleTasks((prev) =>
        prev.map((t) => (t.id === task.id ? { ...updated, reminders: task.reminders } : t))
      );
      setDirtyGoogleTaskIds((prev) => prev.filter((id) => id !== task.id));
      setGoogleTasksLastSyncedAt(
        new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      );
    } catch (err: unknown) {
      if (isNetworkOrOfflineError(err)) {
        queueOfflineUpdate();
        return;
      }
      const msg = err instanceof Error ? err.message : 'Failed to update Google Task.';
      if (msg === 'NOT_AUTHENTICATED' || msg === 'AUTH_EXPIRED') {
        setGoogleConnected(false);
        queueOfflineUpdate();
        return;
      }
      setGoogleTasksError(msg);
      throw err;
    }
  }, []);

  const handleToggleGoogleTask = useCallback(async (task: TaskItem) => {
    setGoogleTasksError(null);
    const toggled: TaskItem = { ...task, completed: !task.completed };
    const queueOfflineToggle = () => {
      setGoogleTasks((prev) => prev.map((t) => (t.id === task.id ? toggled : t)));
      setDirtyGoogleTaskIds((prev) => (prev.includes(task.id) ? prev : [...prev, task.id]));
      setPendingSyncQueue((prev) =>
        enqueueSyncOp(prev, {
          id: makeSyncOpId(),
          type: 'gtask-update',
          taskId: task.id,
          task: toggled,
          createdAt: Date.now(),
        })
      );
    };

    if (
      (typeof navigator !== 'undefined' && !navigator.onLine) ||
      !googleConnectedRef.current ||
      task.googleTaskId?.startsWith('offline-')
    ) {
      queueOfflineToggle();
      return;
    }

    try {
      const updated = await updateGoogleTask(toggled);
      setGoogleTasks((prev) =>
        prev.map((t) => (t.id === task.id ? { ...updated, reminders: task.reminders } : t))
      );
      setDirtyGoogleTaskIds((prev) => prev.filter((id) => id !== task.id));
      setGoogleTasksLastSyncedAt(
        new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      );
    } catch (err: unknown) {
      if (isNetworkOrOfflineError(err)) {
        queueOfflineToggle();
        return;
      }
      const msg = err instanceof Error ? err.message : 'Failed to update Google Task status.';
      if (msg === 'NOT_AUTHENTICATED' || msg === 'AUTH_EXPIRED') {
        setGoogleConnected(false);
        queueOfflineToggle();
        return;
      }
      setGoogleTasksError(msg);
      throw err;
    }
  }, []);

  const handleDeleteGoogleTask = useCallback(async (task: TaskItem) => {
    setGoogleTasksError(null);
    const queueOfflineDelete = () => {
      setGoogleTasks((prev) => prev.filter((t) => t.id !== task.id));
      setDirtyGoogleTaskIds((prev) => prev.filter((id) => id !== task.id));
      if (task.googleTaskId) {
        setPendingSyncQueue((prev) =>
          enqueueSyncOp(prev, {
            id: makeSyncOpId(),
            type: 'gtask-delete',
            taskId: task.id,
            googleTaskId: task.googleTaskId!,
            googleTaskListId: task.googleTaskListId || '@default',
            createdAt: Date.now(),
          })
        );
      }
    };

    if (
      (typeof navigator !== 'undefined' && !navigator.onLine) ||
      !googleConnectedRef.current ||
      task.googleTaskId?.startsWith('offline-')
    ) {
      queueOfflineDelete();
      return;
    }

    try {
      if (!task.googleTaskId) return;
      await deleteGoogleTask(task.googleTaskListId || '@default', task.googleTaskId);
      setGoogleTasks((prev) => prev.filter((t) => t.id !== task.id));
      setDirtyGoogleTaskIds((prev) => prev.filter((id) => id !== task.id));
      setGoogleTasksLastSyncedAt(
        new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      );
    } catch (err: unknown) {
      if (isNetworkOrOfflineError(err)) {
        queueOfflineDelete();
        return;
      }
      const msg = err instanceof Error ? err.message : 'Failed to delete Google Task.';
      if (msg === 'NOT_AUTHENTICATED' || msg === 'AUTH_EXPIRED') {
        setGoogleConnected(false);
        queueOfflineDelete();
        return;
      }
      setGoogleTasksError(msg);
      throw err;
    }
  }, []);

  // Show cached Google Calendar events even while offline or awaiting reconnect
  const visibleEvents = useMemo(() => {
    const merged =
      settings.googleCalendarSync && googleEvents.length > 0
        ? [...events, ...googleEvents]
        : events;
    return [...merged].sort((a, b) => {
      const d = a.dateKey.localeCompare(b.dateKey);
      if (d !== 0) return d;
      const aFull = a.startTime === 'Full';
      const bFull = b.startTime === 'Full';
      if (aFull !== bFull) return aFull ? -1 : 1;
      return a.startTime.localeCompare(b.startTime);
    });
  }, [events, googleEvents, settings.googleCalendarSync]);

  // Show cached Google Tasks even while offline or awaiting reconnect
  const visibleTasks = useMemo(() => {
    if (settings.googleTasksSync && googleTasks.length > 0) {
      return [...tasks, ...googleTasks];
    }
    return tasks;
  }, [tasks, googleTasks, settings.googleTasksSync]);

  const googleCalendarState: GoogleCalendarSyncState = useMemo(
    () => ({
      isConnected: googleConnected,
      userEmail: googleUserEmail,
      isSigningIn: googleSigningIn,
      isSyncing: googleSyncing || isSyncingOfflineQueue,
      lastSyncedAt: googleLastSyncedAt,
      syncedCount: googleEvents.length,
      pendingSyncCount: pendingSyncQueue.length,
      error: googleError,
      onSignIn: handleGoogleSignIn,
      onSignOut: handleGoogleSignOut,
      onSyncNow: () => syncGoogleCalendarEvents(),
      onSyncPending: handleTriggerPendingSync,
      onCreateGoogleEvent: handleCreateGoogleEvent,
      onDeleteGoogleEvent: handleDeleteGoogleEvent,
    }),
    [
      googleConnected,
      googleUserEmail,
      googleSigningIn,
      googleSyncing,
      isSyncingOfflineQueue,
      googleLastSyncedAt,
      googleEvents.length,
      pendingSyncQueue.length,
      googleError,
      handleGoogleSignIn,
      handleGoogleSignOut,
      syncGoogleCalendarEvents,
      handleTriggerPendingSync,
      handleCreateGoogleEvent,
      handleDeleteGoogleEvent,
    ]
  );

  const googleTasksState: GoogleTasksSyncState = useMemo(
    () => ({
      isConnected: googleConnected,
      userEmail: googleUserEmail,
      isSigningIn: googleSigningIn,
      isSyncing: googleTasksSyncing || isSyncingOfflineQueue,
      lastSyncedAt: googleTasksLastSyncedAt,
      syncedCount: googleTasks.length,
      pendingSyncCount: pendingSyncQueue.length,
      taskLists: googleTaskLists,
      dirtyTaskIds: dirtyGoogleTaskIds,
      error: googleTasksError,
      onSignIn: handleGoogleSignIn,
      onSignOut: handleGoogleSignOut,
      onSyncNow: () => syncGoogleTasksList(),
      onSyncPending: handleTriggerPendingSync,
      onCreateGoogleTask: handleCreateGoogleTask,
      onUpdateGoogleTask: handleUpdateGoogleTask,
      onToggleGoogleTask: handleToggleGoogleTask,
      onDeleteGoogleTask: handleDeleteGoogleTask,
    }),
    [
      googleConnected,
      googleUserEmail,
      googleSigningIn,
      googleTasksSyncing,
      isSyncingOfflineQueue,
      googleTasksLastSyncedAt,
      googleTasks.length,
      pendingSyncQueue.length,
      googleTaskLists,
      dirtyGoogleTaskIds,
      googleTasksError,
      handleGoogleSignIn,
      handleGoogleSignOut,
      syncGoogleTasksList,
      handleTriggerPendingSync,
      handleCreateGoogleTask,
      handleUpdateGoogleTask,
      handleToggleGoogleTask,
      handleDeleteGoogleTask,
    ]
  );

  const isStandaloneAppMode =
    isInstalledPwa || manualFullScreen || (isCoarseTouch && viewportWidth < 1024);

  const adaptiveNativePosture =
    viewportWidth >= 640 ? FoldPosture.Inner : FoldPosture.Cover;

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
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) {
      themeMeta.setAttribute('content', isDark ? '#121513' : '#F8F9F7');
    }
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

  const tasksRef = useRef<TaskItem[]>(tasks);
  const googleTasksRef = useRef<TaskItem[]>(googleTasks);
  const settingsRef = useRef<AppSettingsState>(settings);
  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);
  useEffect(() => {
    googleTasksRef.current = googleTasks;
  }, [googleTasks]);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const checkDueReminders = useCallback(() => {
    if (!settingsRef.current.taskRemindersEnabled) return;
    const now = Date.now();
    const CATCH_UP_WINDOW_MS = 15 * 60_000;

    const scanList = (list: TaskItem[]) => {
      const firedByTask = new Map<string, Set<string>>();
      const triggered: { task: TaskItem; reminder: TaskReminder }[] = [];

      for (const task of list) {
        if (task.completed || !task.reminders || task.reminders.length === 0) continue;
        for (const rem of task.reminders) {
          if (rem.firedAt) continue;
          const triggerMs = computeReminderTriggerMs(task, rem);
          if (triggerMs === null) continue;
          if (triggerMs <= now && now - triggerMs <= CATCH_UP_WINDOW_MS) {
            const dedupeKey = `${task.id}:${rem.id}:${triggerMs}`;
            if (dispatchedReminderKeysRef.current.has(dedupeKey)) continue;
            dispatchedReminderKeysRef.current.add(dedupeKey);

            let set = firedByTask.get(task.id);
            if (!set) {
              set = new Set<string>();
              firedByTask.set(task.id, set);
            }
            set.add(rem.id);
            triggered.push({ task, reminder: rem });
          }
        }
      }

      return { firedByTask, triggered };
    };

    const localScan = scanList(tasksRef.current);
    const googleScan = scanList(googleTasksRef.current);

    if (localScan.firedByTask.size > 0) {
      setTasks((prev) =>
        prev.map((t) => {
          const firedIds = localScan.firedByTask.get(t.id);
          if (!firedIds || !t.reminders) return t;
          return {
            ...t,
            reminders: t.reminders.map((r) => (firedIds.has(r.id) ? { ...r, firedAt: now } : r)),
          };
        })
      );
    }

    if (googleScan.firedByTask.size > 0) {
      setGoogleTasks((prev) =>
        prev.map((t) => {
          const firedIds = googleScan.firedByTask.get(t.id);
          if (!firedIds || !t.reminders) return t;
          return {
            ...t,
            reminders: t.reminders.map((r) => (firedIds.has(r.id) ? { ...r, firedAt: now } : r)),
          };
        })
      );
    }

    const allTriggered = [...localScan.triggered, ...googleScan.triggered];
    if (allTriggered.length > 0) {
      const playSound = settingsRef.current.reminderSound !== false;
      if (playSound) {
        playSoftReminderChime();
      }
      for (const { task, reminder } of allTriggered) {
        void dispatchSystemTaskNotification(task, reminder, { silent: !playSound });
      }
      setActiveReminderAlerts((prev) => {
        const next = [...prev];
        for (const { task, reminder } of allTriggered) {
          const alertId = `${task.id}:${reminder.id}`;
          if (!next.some((a) => a.id === alertId)) {
            next.unshift({
              id: alertId,
              taskId: task.id,
              reminderId: reminder.id,
              taskTitle: task.title || 'Task reminder',
              label: formatReminderLabel(reminder),
              category: task.category,
            });
          }
        }
        return next.slice(0, 5);
      });
    }
  }, []);

  useEffect(() => {
    checkDueReminders();
    const intervalId = window.setInterval(checkDueReminders, 5000);
    const handleResume = () => {
      if (document.visibilityState !== 'hidden') {
        checkDueReminders();
      }
    };
    window.addEventListener('focus', handleResume);
    document.addEventListener('visibilitychange', handleResume);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', handleResume);
      document.removeEventListener('visibilitychange', handleResume);
    };
  }, [checkDueReminders]);

  useEffect(() => {
    checkDueReminders();
  }, [tasks, googleTasks, checkDueReminders]);

  const handleDismissReminderAlert = useCallback((alertId: string) => {
    setActiveReminderAlerts((prev) => prev.filter((a) => a.id !== alertId));
  }, []);

  const handleCompleteFromReminderAlert = useCallback(
    (alertId: string, taskId: string) => {
      setActiveReminderAlerts((prev) => prev.filter((a) => a.id !== alertId && a.taskId !== taskId));
      const localMatch = tasksRef.current.find((t) => t.id === taskId);
      if (localMatch && !localMatch.completed) {
        setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, completed: true } : t)));
        return;
      }
      const googleMatch = googleTasksRef.current.find((t) => t.id === taskId);
      if (googleMatch && !googleMatch.completed) {
        void handleToggleGoogleTask(googleMatch);
      }
    },
    [handleToggleGoogleTask]
  );

  const rearmRelativeReminders = (prevTask: TaskItem | undefined, updated: TaskItem): TaskItem => {
    if (
      !prevTask ||
      !updated.reminders ||
      updated.reminders.length === 0 ||
      (prevTask.dateKey === updated.dateKey && prevTask.timeLabel === updated.timeLabel)
    ) {
      return updated;
    }
    const now = Date.now();
    return {
      ...updated,
      reminders: updated.reminders.map((r) => {
        if (r.mode === 'relative' && r.firedAt) {
          const nextTrigger = computeReminderTriggerMs(updated, r);
          if (nextTrigger !== null && nextTrigger > now) {
            return { ...r, firedAt: undefined };
          }
        }
        return r;
      }),
    };
  };

  const handleToggleTask = (taskId: string) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, completed: !t.completed } : t))
    );
    setActiveReminderAlerts((prev) => prev.filter((a) => a.taskId !== taskId));
  };

  const handleAddTask = (newTask: TaskItem) => {
    setTasks((prev) => [newTask, ...prev]);
  };

  const handleUpdateTask = (updated: TaskItem) => {
    if (updated.completed) {
      setActiveReminderAlerts((prev) => prev.filter((a) => a.taskId !== updated.id));
    }
    if (updated.source === 'google') {
      const nextTask = rearmRelativeReminders(
        googleTasksRef.current.find((t) => t.id === updated.id),
        updated
      );
      setGoogleTasks((prev) => prev.map((t) => (t.id === updated.id ? nextTask : t)));
      setDirtyGoogleTaskIds((prev) => (prev.includes(updated.id) ? prev : [...prev, updated.id]));
      // Automatically queue offline edits to Google Tasks so they sync once back online
      if ((typeof navigator !== 'undefined' && !navigator.onLine) || !googleConnectedRef.current) {
        setPendingSyncQueue((prev) =>
          enqueueSyncOp(prev, {
            id: makeSyncOpId(),
            type: 'gtask-update',
            taskId: nextTask.id,
            task: nextTask,
            createdAt: Date.now(),
          })
        );
      }
      return;
    }
    setTasks((prev) =>
      prev.map((t) => (t.id === updated.id ? rearmRelativeReminders(t, updated) : t))
    );
  };

  const handleDeleteTask = (taskId: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
    setActiveReminderAlerts((prev) => prev.filter((a) => a.taskId !== taskId));
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
    let formattedTime = 'No time set';
    if (ev.startTime === 'Full') {
      formattedTime = 'Full';
    } else if (/^\d{1,2}:\d{2}/.test(ev.startTime)) {
      const hourNum = parseInt(ev.startTime.split(':')[0], 10);
      const minStr = ev.startTime.split(':')[1] || '00';
      const meridiem = hourNum >= 12 ? 'PM' : 'AM';
      const h12 = hourNum % 12 === 0 ? 12 : hourNum % 12;
      formattedTime = `${h12 < 10 ? `0${h12}` : h12}:${minStr} ${meridiem}`;
    }

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
    const trimmedBody = customBody?.trim() || '';
    const trimmedTitle = customTitle?.trim() || (trimmedBody ? 'Untitled Note' : '');
    const created: NoteItem = {
      id,
      title: trimmedTitle,
      folder: 'Product',
      updatedAt: 'Created just now',
      pinned: false,
      blocks: [{ id: `b-${Date.now()}-1`, type: 'paragraph', text: trimmedBody }],
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
      localStorage.removeItem(PREV_STORAGE_KEY);
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

  if (isStandaloneAppMode) {
    return (
      <div className="min-h-[100dvh] w-full bg-[#F8F9F7] dark:bg-[#121513] text-stone-900 dark:text-stone-100 overflow-hidden">
        <FoldDeviceFrame
          standalone
          onExitStandalone={
            manualFullScreen && !isInstalledPwa ? () => setManualFullScreen(false) : undefined
          }
          posture={adaptiveNativePosture}
          decisions={decisions}
          activeScreen={activeScreen}
          onChangeScreen={setActiveScreen}
          isDark={isDark}
          onToggleDark={() => setIsDark((d) => !d)}
          showHingeGuide={false}
          tasks={visibleTasks}
          taskLists={taskLists}
          events={visibleEvents}
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
          googleCalendar={googleCalendarState}
          googleTasks={googleTasksState}
          activeReminderAlerts={activeReminderAlerts}
          onDismissReminderAlert={handleDismissReminderAlert}
          onCompleteFromReminderAlert={handleCompleteFromReminderAlert}
        />
        <OfflineIndicator
          pendingSyncCount={pendingSyncQueue.length}
          isSyncingQueue={isSyncingOfflineQueue}
          syncNotice={offlineSyncNotice}
          needsReconnectToSync={!googleConnected}
          onSyncPending={handleTriggerPendingSync}
        />
      </div>
    );
  }

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

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <PWAInstallButton />
            <button
              type="button"
              onClick={() => setManualFullScreen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-white dark:bg-[#161917] border border-stone-200 dark:border-stone-800 text-stone-700 dark:text-stone-200 hover:bg-stone-50 dark:hover:bg-stone-800 transition-colors whitespace-nowrap"
            >
              <Maximize2 className="w-3.5 h-3.5" />
              App mode
            </button>
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
                tasks={visibleTasks}
                taskLists={taskLists}
                events={visibleEvents}
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
                googleCalendar={googleCalendarState}
                googleTasks={googleTasksState}
                activeReminderAlerts={activeReminderAlerts}
                onDismissReminderAlert={handleDismissReminderAlert}
                onCompleteFromReminderAlert={handleCompleteFromReminderAlert}
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
      <OfflineIndicator
        pendingSyncCount={pendingSyncQueue.length}
        isSyncingQueue={isSyncingOfflineQueue}
        syncNotice={offlineSyncNotice}
        needsReconnectToSync={!googleConnected}
        onSyncPending={handleTriggerPendingSync}
      />
    </div>
  );
}
