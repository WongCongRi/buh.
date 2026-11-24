import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Columns2,
  Download,
  Keyboard,
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
import { useAndroidBackController } from './hooks/useAndroidBackNavigation';
import {
  DEMO_SEED_IDS,
  INITIAL_DECISIONS,
  INITIAL_EVENTS,
  INITIAL_LISTS,
  INITIAL_NOTE_FOLDERS,
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
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from './firebase';
import {
  deleteCloudNote,
  ensureUserWorkspace,
  fetchAllCloudNotesOnce,
  formatFriendlyCloudSyncError,
  isNoteNonEmpty,
  saveCloudNotePreferences,
  subscribeCloudNotePreferences,
  subscribeCloudNotes,
  upsertCloudNote,
} from './services/cloudNotesSync';
import {
  AppSettingsState,
  CalendarEvent,
  CloudNotesSyncState,
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
  getDeviceStyleTokens,
  getDeviceSurfaceHex,
} from './utils/themeTokens';
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
  consumePendingSwReminderActions,
  createSnoozedReminder,
  dispatchSystemTaskNotification,
  formatReminderLabel,
  getNotificationPermissionState,
  playSoftReminderChime,
  syncScheduledRemindersToPushServer,
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
  noteFolders: string[];
  collapsedNoteFolders: string[];
  events: CalendarEvent[];
  notes: NoteItem[];
  settings: AppSettingsState;
  reviewNote: string;
  approved: boolean;
}

type PwaShortcutAction = 'new-task' | 'new-note';

interface LaunchParamsLike {
  targetURL?: string;
}

interface LaunchQueueLike {
  setConsumer: (consumer: (launchParams: LaunchParamsLike) => void) => void;
}

function parsePwaShortcutFromUrl(urlString: string): PwaShortcutAction | null {
  try {
    const parsed = new URL(urlString, window.location.origin);
    const param = parsed.searchParams.get('shortcut')?.trim().toLowerCase();
    if (param === 'new-task' || param === 'new-note') {
      return param;
    }
  } catch {
    // Ignore malformed URLs
  }
  return null;
}

function stripShortcutQueryParam(): void {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('shortcut')) return;
    url.searchParams.delete('shortcut');
    const cleanSearch = url.searchParams.toString();
    const nextUrl = `${url.pathname}${cleanSearch ? `?${cleanSearch}` : ''}${url.hash}`;
    window.history.replaceState(window.history.state, '', nextUrl);
  } catch {
    // Ignore history API issues
  }
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

      const parsedNoteFolders = Array.isArray(parsed.noteFolders)
        ? Array.from(
            new Set(
              parsed.noteFolders
                .map((s) => (typeof s === 'string' ? s.trim() : ''))
                .filter((s) => s.length > 0)
            )
          )
        : Array.from(
            new Set([
              ...INITIAL_NOTE_FOLDERS,
              ...migratedNotes
                .map((n) => (typeof n.folder === 'string' ? n.folder.trim() : ''))
                .filter((s) => s.length > 0),
            ])
          );
      const noteFolders =
        parsedNoteFolders.length > 0 ? parsedNoteFolders : INITIAL_NOTE_FOLDERS;

      const collapsedNoteFolders = Array.isArray(parsed.collapsedNoteFolders)
        ? Array.from(
            new Set(
              parsed.collapsedNoteFolders
                .map((s) => (typeof s === 'string' ? s.trim() : ''))
                .filter((s) => noteFolders.includes(s))
            )
          )
        : [];

      const notes = migratedNotes
        .filter((n) => n.title.trim().length > 0 || n.blocks.some((b) => b.text.trim().length > 0))
        .map((n) => {
          const matchedFolder =
            noteFolders.find((f) => f.toLowerCase() === (n.folder || '').toLowerCase()) ||
            noteFolders[0] ||
            'Work';
          return {
            ...n,
            title: n.title.trim().length > 0 ? n.title : 'Untitled Note',
            folder: matchedFolder,
          };
        });

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
          defaultHome:
            parsed.decisions?.defaultHome === DefaultHome.Inbox
              ? DefaultHome.Inbox
              : DefaultHome.Dashboard,
          accentColor: accent,
        },
        recentColors,
        isDark: parsed.isDark ?? false,
        tasks,
        taskLists,
        noteFolders,
        collapsedNoteFolders,
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
    noteFolders: INITIAL_NOTE_FOLDERS,
    collapsedNoteFolders: [],
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
  const [simulatedKeyboardOpen, setSimulatedKeyboardOpen] = useState<boolean>(false);

  const [tasks, setTasks] = useState<TaskItem[]>(initial.tasks);
  const [taskLists, setTaskLists] = useState<string[]>(initial.taskLists);
  const [noteFolders, setNoteFolders] = useState<string[]>(initial.noteFolders);
  const [collapsedNoteFolders, setCollapsedNoteFolders] = useState<string[]>(
    initial.collapsedNoteFolders
  );
  const [events, setEvents] = useState<CalendarEvent[]>(initial.events);
  const [notes, setNotes] = useState<NoteItem[]>(initial.notes);
  const [settings, setSettings] = useState<AppSettingsState>(initial.settings);

  const [reviewNote, setReviewNote] = useState<string>(initial.reviewNote);
  const [approvalOpen, setApprovalOpen] = useState<boolean>(false);
  const [approved, setApproved] = useState<boolean>(initial.approved);
  const [exportingSource, setExportingSource] = useState<boolean>(false);
  const [activeReminderAlerts, setActiveReminderAlerts] = useState<ActiveReminderAlert[]>([]);
  const [externalOpenTask, setExternalOpenTask] = useState<{ taskId: string; nonce: number } | null>(null);
  const [externalShortcut, setExternalShortcut] = useState<{
    action: PwaShortcutAction;
    nonce: number;
  } | null>(null);
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
  const [viewportWidth, setViewportWidth] = useState<number>(() => {
    if (typeof window === 'undefined') return 1280;
    const docWidth = document.documentElement.clientWidth;
    const winWidth = window.innerWidth;
    const rawWidth = docWidth > 0 && winWidth > 0 ? Math.min(docWidth, winWidth) : docWidth || winWidth;
    const isMobile =
      window.matchMedia('(display-mode: standalone)').matches ||
      window.matchMedia('(pointer: coarse)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    const screenWidth = isMobile ? Math.round(window.screen?.width || 0) : 0;
    const vv = window.visualViewport;
    const vvScaledWidth =
      isMobile && vv?.width && vv?.scale ? Math.round(vv.width * vv.scale) : 0;
    const candidates = [rawWidth];
    if (vvScaledWidth > 0) candidates.push(vvScaledWidth);
    if (screenWidth > 0 && screenWidth < rawWidth) candidates.push(screenWidth);
    return Math.round(Math.min(...candidates));
  });
  const [isCoarseTouch, setIsCoarseTouch] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.matchMedia('(pointer: coarse)').matches : false
  );
  const [isVirtualKeyboardOpen, setIsVirtualKeyboardOpen] = useState<boolean>(false);
  const maxViewportHeightRef = useRef<Record<string, number>>({});
  const lastSyncedWidthRef = useRef<number>(viewportWidth);

  useEffect(() => {
    const INNER_POSTURE_BREAKPOINT = 560;
    const BASE_VIEWPORT_CONTENT =
      'width=device-width, initial-scale=1.0, viewport-fit=cover, interactive-widget=resizes-content';
    const RESET_VIEWPORT_CONTENT =
      'width=device-width, initial-scale=1.0, maximum-scale=1.0, viewport-fit=cover, interactive-widget=resizes-content';

    const standaloneMedia = window.matchMedia('(display-mode: standalone)');
    const coarseMedia = window.matchMedia('(pointer: coarse)');
    const innerPostureMedia = window.matchMedia(`(min-width: ${INNER_POSTURE_BREAKPOINT}px)`);
    const vv = window.visualViewport;
    const devicePosture = (
      navigator as Navigator & { devicePosture?: EventTarget }
    ).devicePosture;
    const screenOrientation = window.screen?.orientation;
    const settleTimers = new Set<number>();
    let rafId: number | null = null;
    let viewportResetRafId: number | null = null;
    let lastViewportResetAt = 0;

    const clearPendingSettles = () => {
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
        rafId = null;
      }
      settleTimers.forEach((id) => window.clearTimeout(id));
      settleTimers.clear();
    };

    const isMobileContext = () =>
      standaloneMedia.matches ||
      coarseMedia.matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;

    const readRawLayoutWidth = () => {
      const docWidth = document.documentElement.clientWidth;
      const winWidth = window.innerWidth;
      if (docWidth > 0 && winWidth > 0) {
        return Math.round(Math.min(docWidth, winWidth));
      }
      return Math.round(docWidth || winWidth);
    };

    const resetMobileViewportScale = () => {
      const now = Date.now();
      if (now - lastViewportResetAt < 500) return;
      const viewportMeta = document.querySelector('meta[name="viewport"]');
      if (!viewportMeta) return;
      lastViewportResetAt = now;
      viewportMeta.setAttribute('content', RESET_VIEWPORT_CONTENT);
      if (viewportResetRafId !== null) {
        window.cancelAnimationFrame(viewportResetRafId);
      }
      viewportResetRafId = window.requestAnimationFrame(() => {
        viewportResetRafId = null;
        viewportMeta.setAttribute('content', BASE_VIEWPORT_CONTENT);
      });
    };

    const readEffectiveWidth = () => {
      const rawLayoutWidth = readRawLayoutWidth();
      const mobile = isMobileContext();
      if (!mobile) {
        return { effectiveWidth: rawLayoutWidth, rawLayoutWidth, screenWidth: 0, vvScaledWidth: 0, vvScale: 1 };
      }

      const screenWidth = Math.round(window.screen?.width || 0);
      const vvScale = vv?.scale || 1;
      const vvScaledWidth = vv?.width ? Math.round(vv.width * vvScale) : 0;

      // On Galaxy Z Fold, launching unfolded (Inner) then closing to Cover can leave
      // Chrome's layout viewport (innerWidth/clientWidth) stuck at ~717px while
      // screen.width and visualViewport.width * scale drop to the ~344-412px Cover width.
      let effectiveWidth = rawLayoutWidth;
      if (vvScaledWidth > 0 && vvScaledWidth < effectiveWidth) {
        effectiveWidth = vvScaledWidth;
      }
      if (screenWidth > 0 && screenWidth < effectiveWidth) {
        effectiveWidth = screenWidth;
      }
      // Reverse case: launched on Cover then unfolded to Inner while Chrome stayed zoomed in
      if (vvScaledWidth >= INNER_POSTURE_BREAKPOINT && vvScale > 1.25 && rawLayoutWidth < INNER_POSTURE_BREAKPOINT) {
        effectiveWidth = vvScaledWidth;
      }

      return { effectiveWidth, rawLayoutWidth, screenWidth, vvScaledWidth, vvScale };
    };

    const syncViewport = () => {
      const { effectiveWidth, rawLayoutWidth, screenWidth, vvScaledWidth, vvScale } =
        readEffectiveWidth();
      const mobile = isMobileContext();
      const activeEl = document.activeElement;
      const inputFocused =
        activeEl instanceof HTMLElement &&
        (activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'TEXTAREA' ||
          activeEl.isContentEditable);

      // If Chrome kept a stale layout viewport width across an Inner <-> Cover display switch,
      // nudge <meta name="viewport"> so Chrome recalculates device-width and snaps scale to 1.0.
      if (mobile && !inputFocused) {
        const stuckInnerOnCover =
          rawLayoutWidth >= INNER_POSTURE_BREAKPOINT &&
          effectiveWidth < INNER_POSTURE_BREAKPOINT;
        const stuckCoverOnInner =
          rawLayoutWidth < INNER_POSTURE_BREAKPOINT &&
          vvScale > 1.25 &&
          vvScaledWidth >= INNER_POSTURE_BREAKPOINT;
        const stuckZoomedOutOnCover =
          screenWidth > 0 &&
          screenWidth < INNER_POSTURE_BREAKPOINT &&
          vvScale < 0.92 &&
          rawLayoutWidth > screenWidth + 24;
        if (stuckInnerOnCover || stuckCoverOnInner || stuckZoomedOutOnCover) {
          resetMobileViewportScale();
        }
      }

      const vvHeight = vv?.height ? Math.round(vv.height) : 0;
      const winHeight = Math.round(window.innerHeight);
      // Avoid stale visualViewport.height after an inner<->cover display switch while unfocused
      const visibleHeight =
        inputFocused && vvHeight > 0
          ? vvHeight
          : vvHeight > 0 && Math.abs(vvHeight - winHeight) <= 80
            ? vvHeight
            : winHeight;
      const offsetTop = inputFocused ? Math.max(0, Math.round(vv?.offsetTop ?? 0)) : 0;

      document.documentElement.style.setProperty('--buh-vh', `${visibleHeight}px`);
      document.documentElement.style.setProperty('--buh-vv-top', `${offsetTop}px`);

      const widthBucket = String(Math.round(effectiveWidth / 40));
      const prevMax = maxViewportHeightRef.current[widthBucket] ?? 0;
      if (visibleHeight > prevMax || (!inputFocused && visibleHeight >= winHeight - 24)) {
        maxViewportHeightRef.current[widthBucket] = Math.max(visibleHeight, winHeight);
      }
      const baseline = maxViewportHeightRef.current[widthBucket] ?? visibleHeight;
      const keyboardVisible = inputFocused && baseline - visibleHeight > 130;

      lastSyncedWidthRef.current = effectiveWidth;
      setIsVirtualKeyboardOpen(keyboardVisible);
      setViewportWidth(effectiveWidth);
      setIsCoarseTouch(coarseMedia.matches);
      setIsInstalledPwa(
        standaloneMedia.matches ||
          (window.navigator as unknown as { standalone?: boolean }).standalone === true
      );

      if (
        document.documentElement.classList.contains('buh-standalone') &&
        (window.scrollY !== 0 || offsetTop !== 0)
      ) {
        window.scrollTo(0, 0);
      }
    };

    const scheduleSync = (delays: number[] = [80]) => {
      syncViewport();
      clearPendingSettles();
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        syncViewport();
      });
      for (const delay of delays) {
        const id = window.setTimeout(() => {
          settleTimers.delete(id);
          syncViewport();
        }, delay);
        settleTimers.add(id);
      }
    };

    // Always process resize/orientation/posture events even if fired while screen is briefly hidden/locked.
    const handleDisplayChange = () => {
      scheduleSync([50, 180, 400, 800, 1400]);
    };

    // Folding/unfolding across a lock screen on Galaxy Z Fold can finish switching
    // displays 100-1000ms after visibility/focus resumes, so re-check across settle windows.
    const handleVisibilityResume = () => {
      if (document.visibilityState === 'hidden') return;
      scheduleSync([50, 180, 400, 800, 1400]);
    };

    const handleFocusToggle = () => scheduleSync([80, 200]);

    const handlePointerDriftCheck = () => {
      const { effectiveWidth } = readEffectiveWidth();
      if (Math.abs(effectiveWidth - lastSyncedWidthRef.current) > 4) {
        scheduleSync([60, 220, 500]);
      }
    };

    const resizeObserver =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            syncViewport();
          })
        : null;
    resizeObserver?.observe(document.documentElement);

    syncViewport();
    window.addEventListener('resize', handleDisplayChange);
    window.addEventListener('orientationchange', handleDisplayChange);
    window.addEventListener('focus', handleDisplayChange);
    window.addEventListener('pageshow', handleDisplayChange);
    document.addEventListener('visibilitychange', handleVisibilityResume);
    window.addEventListener('focusin', handleFocusToggle);
    window.addEventListener('focusout', handleFocusToggle);
    window.addEventListener('pointerdown', handlePointerDriftCheck, { passive: true });
    window.addEventListener('touchstart', handlePointerDriftCheck, { passive: true });
    vv?.addEventListener('resize', handleDisplayChange);
    vv?.addEventListener('scroll', syncViewport);
    screenOrientation?.addEventListener?.('change', handleDisplayChange);
    devicePosture?.addEventListener?.('change', handleDisplayChange);
    innerPostureMedia.addEventListener?.('change', handleDisplayChange);
    standaloneMedia.addEventListener?.('change', syncViewport);
    coarseMedia.addEventListener?.('change', syncViewport);

    return () => {
      clearPendingSettles();
      if (viewportResetRafId !== null) {
        window.cancelAnimationFrame(viewportResetRafId);
      }
      resizeObserver?.disconnect();
      window.removeEventListener('resize', handleDisplayChange);
      window.removeEventListener('orientationchange', handleDisplayChange);
      window.removeEventListener('focus', handleDisplayChange);
      window.removeEventListener('pageshow', handleDisplayChange);
      document.removeEventListener('visibilitychange', handleVisibilityResume);
      window.removeEventListener('focusin', handleFocusToggle);
      window.removeEventListener('focusout', handleFocusToggle);
      window.removeEventListener('pointerdown', handlePointerDriftCheck);
      window.removeEventListener('touchstart', handlePointerDriftCheck);
      vv?.removeEventListener('resize', handleDisplayChange);
      vv?.removeEventListener('scroll', syncViewport);
      screenOrientation?.removeEventListener?.('change', handleDisplayChange);
      devicePosture?.removeEventListener?.('change', handleDisplayChange);
      innerPostureMedia.removeEventListener?.('change', handleDisplayChange);
      standaloneMedia.removeEventListener?.('change', syncViewport);
      coarseMedia.removeEventListener?.('change', syncViewport);
    };
  }, []);

  // Handle PWA launcher shortcuts & OS note_taking triggers (cold URL launch + warm launchQueue)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const triggerShortcut = (action: PwaShortcutAction) => {
      setExternalShortcut({ action, nonce: Date.now() + Math.random() });
    };

    const initialAction = parsePwaShortcutFromUrl(window.location.href);
    if (initialAction) {
      triggerShortcut(initialAction);
      stripShortcutQueryParam();
    }

    const launchQueue = (window as unknown as { launchQueue?: LaunchQueueLike }).launchQueue;
    if (launchQueue && typeof launchQueue.setConsumer === 'function') {
      launchQueue.setConsumer((launchParams) => {
        if (!launchParams?.targetURL) return;
        const warmAction = parsePwaShortcutFromUrl(launchParams.targetURL);
        if (warmAction) {
          triggerShortcut(warmAction);
          stripShortcutQueryParam();
        }
      });
    }
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

  // --- buh. Cloud Sync (Firestore real-time sync for notes, folders & collapse state) ---
  const [firebaseUid, setFirebaseUid] = useState<string | null>(null);
  const [firebaseEmail, setFirebaseEmail] = useState<string | null>(null);
  const [firebaseEmailVerified, setFirebaseEmailVerified] = useState<boolean>(false);
  const [cloudNotesSyncing, setCloudNotesSyncing] = useState<boolean>(false);
  const [cloudNotesLastSyncedAt, setCloudNotesLastSyncedAt] = useState<string | null>(null);
  const [cloudNotesSyncedCount, setCloudNotesSyncedCount] = useState<number>(0);
  const [cloudNotesError, setCloudNotesError] = useState<string | null>(null);

  const notesRef = useRef<NoteItem[]>(notes);
  const noteFoldersRef = useRef<string[]>(noteFolders);
  const collapsedNoteFoldersRef = useRef<string[]>(collapsedNoteFolders);
  useEffect(() => {
    notesRef.current = notes;
  }, [notes]);
  useEffect(() => {
    noteFoldersRef.current = noteFolders;
  }, [noteFolders]);
  useEffect(() => {
    collapsedNoteFoldersRef.current = collapsedNoteFolders;
  }, [collapsedNoteFolders]);

  const pendingNoteSaveTimersRef = useRef<Map<string, number>>(new Map());
  const cloudSyncReadyRef = useRef<{ uid: string | null; enabled: boolean }>({
    uid: null,
    enabled: false,
  });

  useEffect(() => {
    cloudSyncReadyRef.current = {
      uid: firebaseUid && firebaseEmailVerified ? firebaseUid : null,
      enabled: settings.buhCloudSync !== false,
    };
  }, [firebaseUid, firebaseEmailVerified, settings.buhCloudSync]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        setFirebaseUid(user.uid);
        setFirebaseEmail(user.email || user.displayName || 'Google Account');
        setFirebaseEmailVerified(Boolean(user.emailVerified));
      } else {
        setFirebaseUid(null);
        setFirebaseEmail(null);
        setFirebaseEmailVerified(false);
        setCloudNotesSyncedCount(0);
        setCloudNotesLastSyncedAt(null);
        setCloudNotesError(null);
      }
    });
    return () => unsubscribe();
  }, []);

  const markCloudNotesSyncedNow = useCallback(() => {
    setCloudNotesLastSyncedAt(
      new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    );
  }, []);

  const scheduleCloudNoteUpsert = useCallback(
    (note: NoteItem, immediate = false) => {
      const { uid, enabled } = cloudSyncReadyRef.current;
      if (!uid || !enabled || !isNoteNonEmpty(note)) return;

      const existingTimer = pendingNoteSaveTimersRef.current.get(note.id);
      if (existingTimer !== undefined) {
        window.clearTimeout(existingTimer);
        pendingNoteSaveTimersRef.current.delete(note.id);
      }

      const run = () => {
        const latest = cloudSyncReadyRef.current;
        if (!latest.uid || !latest.enabled) return;
        void upsertCloudNote(latest.uid, note, noteFoldersRef.current[0] || 'Work')
          .then(() => {
            setCloudNotesError(null);
            markCloudNotesSyncedNow();
          })
          .catch((err) => {
            setCloudNotesError(formatFriendlyCloudSyncError(err));
          })
          .finally(() => {
            pendingNoteSaveTimersRef.current.delete(note.id);
          });
      };

      if (immediate) {
        run();
      } else {
        const timerId = window.setTimeout(run, 450);
        pendingNoteSaveTimersRef.current.set(note.id, timerId);
      }
    },
    [markCloudNotesSyncedNow]
  );

  const pushCloudNoteDelete = useCallback(
    (noteId: string) => {
      const existingTimer = pendingNoteSaveTimersRef.current.get(noteId);
      if (existingTimer !== undefined) {
        window.clearTimeout(existingTimer);
        pendingNoteSaveTimersRef.current.delete(noteId);
      }
      const { uid, enabled } = cloudSyncReadyRef.current;
      if (!uid || !enabled) return;
      void deleteCloudNote(uid, noteId)
        .then(() => {
          setCloudNotesError(null);
          markCloudNotesSyncedNow();
        })
        .catch((err) => {
          setCloudNotesError(formatFriendlyCloudSyncError(err));
        });
    },
    [markCloudNotesSyncedNow]
  );

  const pushCloudNotePreferences = useCallback(
    (nextFolders: string[], nextCollapsed: string[]) => {
      const { uid, enabled } = cloudSyncReadyRef.current;
      if (!uid || !enabled) return;
      void saveCloudNotePreferences(uid, nextFolders, nextCollapsed)
        .then(() => {
          setCloudNotesError(null);
          markCloudNotesSyncedNow();
        })
        .catch((err) => {
          setCloudNotesError(formatFriendlyCloudSyncError(err));
        });
    },
    [markCloudNotesSyncedNow]
  );

  // Real-time Firestore subscriptions for notes & note folder preferences
  useEffect(() => {
    if (!firebaseUid || !firebaseEmailVerified || settings.buhCloudSync === false) {
      return;
    }

    let cancelled = false;
    let unsubPrefs: (() => void) | null = null;
    let unsubNotes: (() => void) | null = null;
    let hydratedNotes = false;

    setCloudNotesSyncing(true);
    setCloudNotesError(null);

    void (async () => {
      try {
        await ensureUserWorkspace(firebaseUid);
        if (cancelled) return;

        unsubPrefs = subscribeCloudNotePreferences(
          firebaseUid,
          (prefs) => {
            if (cancelled) return;
            if (!prefs) {
              // Seed cloud with local folders and collapse state on first sync
              void saveCloudNotePreferences(
                firebaseUid,
                noteFoldersRef.current,
                collapsedNoteFoldersRef.current
              ).catch((err) => {
                if (!cancelled) setCloudNotesError(formatFriendlyCloudSyncError(err));
              });
              return;
            }
            setNoteFolders(prefs.folders);
            setCollapsedNoteFolders(prefs.collapsedFolders);
            setCloudNotesError(null);
            markCloudNotesSyncedNow();
          },
          (err) => {
            if (!cancelled) {
              setCloudNotesError(formatFriendlyCloudSyncError(err));
              setCloudNotesSyncing(false);
            }
          }
        );

        unsubNotes = subscribeCloudNotes(
          firebaseUid,
          (cloudNotes) => {
            if (cancelled) return;
            setCloudNotesSyncedCount(cloudNotes.length);
            setCloudNotesSyncing(false);
            setCloudNotesError(null);
            markCloudNotesSyncedNow();

            const cloudIds = new Set(cloudNotes.map((n) => n.id));

            if (!hydratedNotes) {
              hydratedNotes = true;
              const localOnlyToUpload = notesRef.current.filter(
                (n) => !cloudIds.has(n.id) && isNoteNonEmpty(n)
              );
              if (localOnlyToUpload.length > 0) {
                const fallbackFolder = noteFoldersRef.current[0] || 'Work';
                void Promise.allSettled(
                  localOnlyToUpload.map((n) => upsertCloudNote(firebaseUid, n, fallbackFolder))
                );
              }
            }

            setNotes((prev) => {
              const pendingIds = pendingNoteSaveTimersRef.current;
              const prevById = new Map(prev.map((n) => [n.id, n]));
              const mergedCloud = cloudNotes.map((cn) =>
                pendingIds.has(cn.id) && prevById.has(cn.id) ? prevById.get(cn.id)! : cn
              );
              // Keep any local unsaved drafts or pending local creations not yet acknowledged by cloud
              const localExtra = prev.filter(
                (ln) =>
                  !cloudIds.has(ln.id) &&
                  (pendingIds.has(ln.id) || !isNoteNonEmpty(ln))
              );
              return [...localExtra, ...mergedCloud];
            });
          },
          (err) => {
            if (!cancelled) {
              setCloudNotesError(formatFriendlyCloudSyncError(err));
              setCloudNotesSyncing(false);
            }
          }
        );
      } catch (err) {
        if (!cancelled) {
          setCloudNotesError(formatFriendlyCloudSyncError(err));
          setCloudNotesSyncing(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      unsubPrefs?.();
      unsubNotes?.();
      pendingNoteSaveTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
      pendingNoteSaveTimersRef.current.clear();
    };
  }, [firebaseUid, firebaseEmailVerified, settings.buhCloudSync, markCloudNotesSyncedNow]);

  const handleSyncCloudNotesNow = useCallback(async () => {
    if (!firebaseUid || !firebaseEmailVerified) return;
    if (settings.buhCloudSync === false) return;
    setCloudNotesSyncing(true);
    setCloudNotesError(null);
    try {
      await ensureUserWorkspace(firebaseUid);
      await saveCloudNotePreferences(
        firebaseUid,
        noteFoldersRef.current,
        collapsedNoteFoldersRef.current
      );
      const fallbackFolder = noteFoldersRef.current[0] || 'Work';
      const localToPush = notesRef.current.filter(isNoteNonEmpty);
      if (localToPush.length > 0) {
        await Promise.all(
          localToPush.map((n) => upsertCloudNote(firebaseUid, n, fallbackFolder))
        );
      }
      const remoteNotes = await fetchAllCloudNotesOnce(firebaseUid);
      setCloudNotesSyncedCount(remoteNotes.length);
      markCloudNotesSyncedNow();
    } catch (err) {
      setCloudNotesError(formatFriendlyCloudSyncError(err));
    } finally {
      setCloudNotesSyncing(false);
    }
  }, [firebaseUid, firebaseEmailVerified, settings.buhCloudSync, markCloudNotesSyncedNow]);

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
      endDateKey?: string;
      startTime: string;
      endTime: string;
      calendarName: string;
    }) => {
      setGoogleError(null);
      const computeMins = () => {
        const [sy, sm, sd] = input.dateKey.split('-').map((n) => parseInt(n, 10));
        const [ey, em, ed] = (input.endDateKey || input.dateKey)
          .split('-')
          .map((n) => parseInt(n, 10));
        const [sh, smin] = input.startTime.split(':').map((n) => parseInt(n, 10));
        const [eh, emin] = input.endTime.split(':').map((n) => parseInt(n, 10));
        const startDt = new Date(sy, (sm || 1) - 1, sd || 1, sh || 0, smin || 0);
        const endDt = new Date(ey || sy, ((em || sm) || 1) - 1, ed || sd || 1, eh || 0, emin || 0);
        const diff = Math.round((endDt.getTime() - startDt.getTime()) / 60_000);
        return diff > 0 ? diff : 60;
      };

      const queueOfflineEvent = () => {
        const tempId = `gcal-offline-${Date.now()}`;
        const optimistic: CalendarEvent = {
          id: tempId,
          googleEventId: `offline-${Date.now()}`,
          title: input.title,
          dateKey: input.dateKey,
          endDateKey: input.endDateKey && input.endDateKey !== input.dateKey ? input.endDateKey : undefined,
          startTime: input.startTime,
          endTime: input.endTime,
          durationMinutes: computeMins(),
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
        return tempId;
      };

      if ((typeof navigator !== 'undefined' && !navigator.onLine) || !googleConnectedRef.current) {
        return queueOfflineTask();
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
        return withReminders.id;
      } catch (err: unknown) {
        if (isNetworkOrOfflineError(err)) {
          return queueOfflineTask();
        }
        const msg = err instanceof Error ? err.message : 'Failed to create Google Task.';
        if (msg === 'NOT_AUTHENTICATED' || msg === 'AUTH_EXPIRED') {
          setGoogleConnected(false);
          return queueOfflineTask();
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
    const nextCompleted = !task.completed;
    const toggled: TaskItem = {
      ...task,
      completed: nextCompleted,
      completedAt: nextCompleted ? new Date().toISOString() : undefined,
    };
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

  // Show cached Google Tasks even while offline or awaiting reconnect,
  // and filter older completed tasks by the configured years/months history window.
  const { visibleTasks, hiddenCompletedTasksCount } = useMemo(() => {
    const merged =
      settings.googleTasksSync && googleTasks.length > 0 ? [...tasks, ...googleTasks] : tasks;

    const years = Math.max(0, Math.floor(settings.completedTaskHistoryYears ?? 0));
    const months = Math.max(0, Math.floor(settings.completedTaskHistoryMonths ?? 0));
    if (years === 0 && months === 0) {
      return { visibleTasks: merged, hiddenCompletedTasksCount: 0 };
    }

    const now = new Date();
    const cutoffMs = new Date(
      now.getFullYear() - years,
      now.getMonth() - months,
      now.getDate(),
      0,
      0,
      0,
      0
    ).getTime();

    let hiddenCount = 0;
    const filtered = merged.filter((t) => {
      if (!t.completed) return true;
      let taskTimeMs: number | null = null;
      if (t.completedAt) {
        const parsed = Date.parse(t.completedAt);
        if (!Number.isNaN(parsed)) taskTimeMs = parsed;
      }
      if (taskTimeMs === null && t.dateKey) {
        const m = t.dateKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (m) {
          taskTimeMs = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59).getTime();
        }
      }
      if (taskTimeMs !== null && taskTimeMs < cutoffMs) {
        hiddenCount += 1;
        return false;
      }
      return true;
    });

    return { visibleTasks: filtered, hiddenCompletedTasksCount: hiddenCount };
  }, [
    tasks,
    googleTasks,
    settings.googleTasksSync,
    settings.completedTaskHistoryYears,
    settings.completedTaskHistoryMonths,
  ]);

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

  const cloudNotesSyncState: CloudNotesSyncState = useMemo(
    () => ({
      isSignedIn: Boolean(firebaseUid && firebaseEmailVerified),
      userEmail: firebaseEmail || googleUserEmail,
      isSyncing: cloudNotesSyncing,
      lastSyncedAt: cloudNotesLastSyncedAt,
      syncedNotesCount: cloudNotesSyncedCount,
      syncedFoldersCount: noteFolders.length,
      error: cloudNotesError,
      onSyncNow: handleSyncCloudNotesNow,
    }),
    [
      firebaseUid,
      firebaseEmailVerified,
      firebaseEmail,
      googleUserEmail,
      cloudNotesSyncing,
      cloudNotesLastSyncedAt,
      cloudNotesSyncedCount,
      noteFolders.length,
      cloudNotesError,
      handleSyncCloudNotesNow,
    ]
  );

  const isStandaloneAppMode =
    isInstalledPwa || manualFullScreen || (isCoarseTouch && viewportWidth < 1024);

  const { showExitToast } = useAndroidBackController(isStandaloneAppMode || isCoarseTouch);

  const adaptiveNativePosture =
    viewportWidth >= 560 ? FoldPosture.Inner : FoldPosture.Cover;

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
    if (isStandaloneAppMode) {
      root.classList.add('buh-standalone');
    } else {
      root.classList.remove('buh-standalone');
    }
    applyAccentCssVars(decisions.accentColor, isDark);
    const surfaceHex = getDeviceSurfaceHex(decisions.visualStyle, isDark);
    root.style.backgroundColor = surfaceHex;
    root.style.colorScheme = isDark ? 'dark' : 'light';
    document.body.style.backgroundColor = surfaceHex;
    let themeMeta = document.querySelector('meta[name="theme-color"]');
    if (!themeMeta) {
      themeMeta = document.createElement('meta');
      themeMeta.setAttribute('name', 'theme-color');
      document.head.appendChild(themeMeta);
    }
    themeMeta.setAttribute('content', surfaceHex);
  }, [isDark, decisions.accentColor, decisions.visualStyle, isStandaloneAppMode]);

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
        noteFolders,
        collapsedNoteFolders,
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
  }, [
    posture,
    activeScreen,
    decisions,
    recentColors,
    isDark,
    tasks,
    taskLists,
    noteFolders,
    collapsedNoteFolders,
    events,
    notes,
    settings,
    reviewNote,
    approved,
  ]);

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

  const handleClearReminder = useCallback((taskId?: string, reminderId?: string) => {
    setActiveReminderAlerts((prev) =>
      prev.filter((a) => {
        if (taskId && reminderId) {
          return !(a.taskId === taskId && a.reminderId === reminderId);
        }
        if (taskId) return a.taskId !== taskId;
        return true;
      })
    );
    if (!taskId || !reminderId) return;
    const now = Date.now();
    const markFired = (list: TaskItem[]) =>
      list.map((t) =>
        t.id === taskId && t.reminders
          ? {
              ...t,
              reminders: t.reminders.map((r) =>
                r.id === reminderId ? { ...r, firedAt: r.firedAt ?? now } : r
              ),
            }
          : t
      );
    setTasks(markFired);
    setGoogleTasks(markFired);
  }, []);

  const handleSnoozeReminder = useCallback(
    (taskId: string, reminderId?: string, snoozeMinutes = 10) => {
      const now = Date.now();
      const snoozed = createSnoozedReminder(snoozeMinutes);

      setActiveReminderAlerts((prev) =>
        prev.filter((a) =>
          reminderId
            ? !(a.taskId === taskId && a.reminderId === reminderId)
            : a.taskId !== taskId
        )
      );

      let matchedTitle: string | null = null;
      const localMatch = tasksRef.current.find((t) => t.id === taskId);
      if (localMatch) {
        matchedTitle = localMatch.title;
        setTasks((prev) =>
          prev.map((t) => {
            if (t.id !== taskId) return t;
            const existing = (t.reminders ?? []).map((r) =>
              reminderId && r.id === reminderId ? { ...r, firedAt: r.firedAt ?? now } : r
            );
            return { ...t, reminders: [...existing, snoozed] };
          })
        );
      } else {
        const googleMatch = googleTasksRef.current.find((t) => t.id === taskId);
        if (googleMatch) {
          matchedTitle = googleMatch.title;
          setGoogleTasks((prev) =>
            prev.map((t) => {
              if (t.id !== taskId) return t;
              const existing = (t.reminders ?? []).map((r) =>
                reminderId && r.id === reminderId ? { ...r, firedAt: r.firedAt ?? now } : r
              );
              return { ...t, reminders: [...existing, snoozed] };
            })
          );
        }
      }

      if (matchedTitle) {
        showOfflineSyncNotice(`Snoozed "${matchedTitle}" for ${snoozeMinutes}m`);
      }
    },
    [showOfflineSyncNotice]
  );

  const handleSnoozeReminderAlert = useCallback(
    (alertId: string, taskId: string, reminderId: string, minutes = 10) => {
      setActiveReminderAlerts((prev) => prev.filter((a) => a.id !== alertId));
      handleSnoozeReminder(taskId, reminderId, minutes);
    },
    [handleSnoozeReminder]
  );

  // Handle Snooze, Clear, and Tap-to-Open events coming from Android Service Worker notifications
  useEffect(() => {
    const processPendingActions = async () => {
      const pending = await consumePendingSwReminderActions();
      for (const item of pending) {
        if (item.action === 'snooze' && item.taskId) {
          handleSnoozeReminder(item.taskId, item.reminderId, item.snoozeMinutes ?? 10);
        } else if (item.action === 'clear') {
          handleClearReminder(item.taskId, item.reminderId);
        }
      }
    };

    void processPendingActions();

    const handleSwMessage = (event: MessageEvent) => {
      const data = event.data as
        | {
            type?: string;
            action?: 'snooze' | 'clear';
            taskId?: string;
            reminderId?: string;
            snoozeMinutes?: number;
          }
        | null;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'REMINDER_ACTION') {
        if (data.action === 'snooze' && data.taskId) {
          handleSnoozeReminder(data.taskId, data.reminderId, data.snoozeMinutes ?? 10);
        } else if (data.action === 'clear') {
          handleClearReminder(data.taskId, data.reminderId);
        }
      } else if (data.type === 'REMINDER_OPEN' && data.taskId) {
        setActiveScreen(ScreenId.Tasks);
        setExternalOpenTask({ taskId: data.taskId, nonce: Date.now() });
      } else if (data.type === 'REMINDER_PUSH_DELIVERED' && data.taskId && data.reminderId) {
        handleClearReminder(data.taskId, data.reminderId);
      } else if (data.type === 'PUSH_SUBSCRIPTION_CHANGED') {
        window.dispatchEvent(new CustomEvent('buh:push-ready'));
      }
    };

    const handleWake = () => {
      if (document.visibilityState !== 'hidden') {
        void processPendingActions();
      }
    };

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', handleSwMessage);
    }
    window.addEventListener('focus', handleWake);
    document.addEventListener('visibilitychange', handleWake);

    return () => {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('message', handleSwMessage);
      }
      window.removeEventListener('focus', handleWake);
      document.removeEventListener('visibilitychange', handleWake);
    };
  }, [handleSnoozeReminder, handleClearReminder]);

  const [pushReadyNonce, setPushReadyNonce] = useState(0);

  useEffect(() => {
    const onPushReady = () => setPushReadyNonce((n) => n + 1);
    window.addEventListener('buh:push-ready', onPushReady);
    return () => window.removeEventListener('buh:push-ready', onPushReady);
  }, []);

  // Sync upcoming task reminders to the server Web Push scheduler so alerts fire even when the app is completely closed
  useEffect(() => {
    if (!isOnline) return;
    if (getNotificationPermissionState() !== 'granted') return;

    const timer = window.setTimeout(() => {
      void syncScheduledRemindersToPushServer(visibleTasks, {
        enabled: settings.taskRemindersEnabled !== false,
        silent: settings.reminderSound === false,
      });
    }, 350);

    return () => window.clearTimeout(timer);
  }, [
    visibleTasks,
    settings.taskRemindersEnabled,
    settings.reminderSound,
    isOnline,
    pushReadyNonce,
  ]);

  const handleCompleteFromReminderAlert = useCallback(
    (alertId: string, taskId: string) => {
      setActiveReminderAlerts((prev) => prev.filter((a) => a.id !== alertId && a.taskId !== taskId));
      const localMatch = tasksRef.current.find((t) => t.id === taskId);
      if (localMatch && !localMatch.completed) {
        setTasks((prev) =>
          prev.map((t) =>
            t.id === taskId
              ? { ...t, completed: true, completedAt: new Date().toISOString() }
              : t
          )
        );
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
      prev.map((t) => {
        if (t.id !== taskId) return t;
        const nextCompleted = !t.completed;
        return {
          ...t,
          completed: nextCompleted,
          completedAt: nextCompleted ? new Date().toISOString() : undefined,
        };
      })
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

  const handleRestoreTask = (task: TaskItem, index?: number) => {
    setTasks((prev) => {
      if (prev.some((t) => t.id === task.id)) return prev;
      const next = [...prev];
      const targetIdx =
        typeof index === 'number' && index >= 0 && index <= next.length ? index : 0;
      next.splice(targetIdx, 0, task);
      return next;
    });
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

  const handleAddNoteFolder = (name: string) => {
    const clean = name.trim();
    if (!clean) return;
    if (noteFoldersRef.current.some((f) => f.toLowerCase() === clean.toLowerCase())) return;
    const nextFolders = [...noteFoldersRef.current, clean];
    setNoteFolders(nextFolders);
    pushCloudNotePreferences(nextFolders, collapsedNoteFoldersRef.current);
  };

  const handleRenameNoteFolder = (oldName: string, newName: string) => {
    const clean = newName.trim();
    if (!clean) return;
    if (
      noteFoldersRef.current.some(
        (f) => f.toLowerCase() === clean.toLowerCase() && f !== oldName
      )
    ) {
      return;
    }
    const nextFolders = noteFoldersRef.current.map((f) => (f === oldName ? clean : f));
    const nextCollapsed = collapsedNoteFoldersRef.current.map((f) =>
      f === oldName ? clean : f
    );
    const affectedNotes = notesRef.current
      .filter((n) => n.folder === oldName)
      .map((n) => ({ ...n, folder: clean }));

    setNoteFolders(nextFolders);
    setNotes((prev) =>
      prev.map((n) => (n.folder === oldName ? { ...n, folder: clean } : n))
    );
    setCollapsedNoteFolders(nextCollapsed);
    pushCloudNotePreferences(nextFolders, nextCollapsed);
    for (const updatedNote of affectedNotes) {
      scheduleCloudNoteUpsert(updatedNote, true);
    }
  };

  const handleDeleteNoteFolder = (name: string) => {
    const remaining = noteFoldersRef.current.filter((f) => f !== name);
    if (remaining.length === 0) return;
    const nextCollapsed = collapsedNoteFoldersRef.current.filter((f) => f !== name);
    const affectedNotes = notesRef.current
      .filter((n) => n.folder === name)
      .map((n) => ({ ...n, folder: remaining[0] }));

    setNoteFolders(remaining);
    setNotes((prev) =>
      prev.map((n) => (n.folder === name ? { ...n, folder: remaining[0] } : n))
    );
    setCollapsedNoteFolders(nextCollapsed);
    pushCloudNotePreferences(remaining, nextCollapsed);
    for (const updatedNote of affectedNotes) {
      scheduleCloudNoteUpsert(updatedNote, true);
    }
  };

  const handleReorderNoteFolder = (fromIndex: number, toIndex: number) => {
    const prev = noteFoldersRef.current;
    if (
      fromIndex === toIndex ||
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= prev.length ||
      toIndex >= prev.length
    ) {
      return;
    }
    const nextFolders = [...prev];
    const [moved] = nextFolders.splice(fromIndex, 1);
    nextFolders.splice(toIndex, 0, moved);
    setNoteFolders(nextFolders);
    pushCloudNotePreferences(nextFolders, collapsedNoteFoldersRef.current);
  };

  const handleToggleNoteFolderCollapsed = (folderName: string) => {
    const prev = collapsedNoteFoldersRef.current;
    const nextCollapsed = prev.includes(folderName)
      ? prev.filter((f) => f !== folderName)
      : [...prev, folderName];
    setCollapsedNoteFolders(nextCollapsed);
    pushCloudNotePreferences(noteFoldersRef.current, nextCollapsed);
  };

  const handleExpandNoteFolder = (folderName: string) => {
    const prev = collapsedNoteFoldersRef.current;
    if (!prev.includes(folderName)) return;
    const nextCollapsed = prev.filter((f) => f !== folderName);
    setCollapsedNoteFolders(nextCollapsed);
    pushCloudNotePreferences(noteFoldersRef.current, nextCollapsed);
  };

  const handleAddEvent = (ev: CalendarEvent) => {
    setEvents((prev) => [...prev, ev]);
  };

  const handleDeleteEvent = (eventId: string) => {
    setEvents((prev) => prev.filter((e) => e.id !== eventId));
  };

  const handleRestoreEvent = (ev: CalendarEvent, index?: number) => {
    setEvents((prev) => {
      if (prev.some((e) => e.id === ev.id)) return prev;
      if (typeof index === 'number' && index >= 0 && index <= prev.length) {
        const next = [...prev];
        next.splice(index, 0, ev);
        return next;
      }
      return [...prev, ev];
    });
  };

  const handleConvertEventToTask = (ev: CalendarEvent): string => {
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
    return created.id;
  };

  const handleUpdateNote = (updated: NoteItem) => {
    const previous = notesRef.current.find((n) => n.id === updated.id);
    const immediate =
      Boolean(previous) &&
      (previous!.folder !== updated.folder ||
        previous!.pinned !== updated.pinned ||
        previous!.markdownEnabled !== updated.markdownEnabled);
    setNotes((prev) => prev.map((n) => (n.id === updated.id ? updated : n)));
    scheduleCloudNoteUpsert(updated, immediate);
  };

  const handleDeleteNote = (noteId: string) => {
    setNotes((prev) => prev.filter((n) => n.id !== noteId));
    pushCloudNoteDelete(noteId);
  };

  const handleRestoreNote = (note: NoteItem, index?: number) => {
    setNotes((prev) => {
      if (prev.some((n) => n.id === note.id)) return prev;
      const next = [...prev];
      const targetIdx =
        typeof index === 'number' && index >= 0 && index <= next.length ? index : 0;
      next.splice(targetIdx, 0, note);
      return next;
    });
    if (isNoteNonEmpty(note)) {
      scheduleCloudNoteUpsert(note, true);
    }
  };

  const handleCreateNote = (
    customTitle?: string,
    customBody?: string,
    folder?: string
  ): string => {
    const id = `n-${Date.now()}`;
    const trimmedBody = customBody?.trim() || '';
    const trimmedTitle = customTitle?.trim() || (trimmedBody ? 'Untitled Note' : '');
    const targetFolder =
      folder && noteFolders.includes(folder) ? folder : noteFolders[0] || 'Work';
    let minExistingSortOrder: number | null = null;
    for (const existing of notesRef.current) {
      if (typeof existing.sortOrder === 'number' && Number.isFinite(existing.sortOrder)) {
        minExistingSortOrder =
          minExistingSortOrder === null
            ? existing.sortOrder
            : Math.min(minExistingSortOrder, existing.sortOrder);
      }
    }
    const created: NoteItem = {
      id,
      title: trimmedTitle,
      folder: targetFolder,
      updatedAt: 'Created just now',
      pinned: false,
      sortOrder: minExistingSortOrder !== null ? minExistingSortOrder - 1000 : 1000,
      blocks: [{ id: `b-${Date.now()}-1`, type: 'paragraph', text: trimmedBody }],
    };
    const nextNotes = [created, ...notesRef.current];
    notesRef.current = nextNotes;
    setNotes(nextNotes);
    if (isNoteNonEmpty(created)) {
      scheduleCloudNoteUpsert(created, true);
    }
    return id;
  };

  const handleReorderNote = (
    draggedNoteId: string,
    targetFolder: string,
    targetIndexInFolder: number
  ) => {
    const prev = notesRef.current;
    const draggedIndex = prev.findIndex((n) => n.id === draggedNoteId);
    if (draggedIndex === -1) return;

    const folders = noteFoldersRef.current.length > 0 ? noteFoldersRef.current : ['Work'];
    const fallbackFolder = folders[0];
    const resolveFolder = (n: NoteItem) =>
      folders.includes(n.folder) ? n.folder : fallbackFolder;
    const resolvedTargetFolder = folders.includes(targetFolder)
      ? targetFolder
      : fallbackFolder;

    const draggedNote = prev[draggedIndex];
    const currentFolder = resolveFolder(draggedNote);

    if (currentFolder === resolvedTargetFolder) {
      const folderNotes = prev.filter((n) => resolveFolder(n) === resolvedTargetFolder);
      const currentIdxInFolder = folderNotes.findIndex((n) => n.id === draggedNoteId);
      const clampedCurrentTarget = Math.max(
        0,
        Math.min(targetIndexInFolder, folderNotes.length - 1)
      );
      if (currentIdxInFolder === clampedCurrentTarget) return;
    }

    const remaining = prev.filter((n) => n.id !== draggedNoteId);
    const targetFolderIndices: number[] = [];
    for (let i = 0; i < remaining.length; i += 1) {
      if (resolveFolder(remaining[i]) === resolvedTargetFolder) {
        targetFolderIndices.push(i);
      }
    }

    const clampedInsertIdx = Math.max(
      0,
      Math.min(targetIndexInFolder, targetFolderIndices.length)
    );
    let insertPos: number;
    if (targetFolderIndices.length === 0) {
      insertPos = 0;
    } else if (clampedInsertIdx < targetFolderIndices.length) {
      insertPos = targetFolderIndices[clampedInsertIdx];
    } else {
      insertPos = targetFolderIndices[targetFolderIndices.length - 1] + 1;
    }

    const movedBase: NoteItem = {
      ...draggedNote,
      folder: resolvedTargetFolder,
    };

    const next = [...remaining];
    next.splice(insertPos, 0, movedBase);

    const allOthersOrdered = remaining.every(
      (n, idx) =>
        typeof n.sortOrder === 'number' &&
        Number.isFinite(n.sortOrder) &&
        (idx === 0 || n.sortOrder > (remaining[idx - 1].sortOrder as number))
    );

    let finalNext: NoteItem[] = next;
    const changedToSync: NoteItem[] = [];

    if (allOthersOrdered) {
      const prevOrder =
        insertPos > 0 ? (next[insertPos - 1].sortOrder as number) : undefined;
      const nextOrder =
        insertPos < next.length - 1 ? (next[insertPos + 1].sortOrder as number) : undefined;

      let candidate: number | null = null;
      if (prevOrder === undefined && nextOrder === undefined) {
        candidate = 1000;
      } else if (prevOrder === undefined) {
        candidate = nextOrder! - 1000;
      } else if (nextOrder === undefined) {
        candidate = prevOrder + 1000;
      } else if (nextOrder - prevOrder > 1) {
        candidate = (prevOrder + nextOrder) / 2;
      }

      if (candidate !== null) {
        const updatedMoved: NoteItem = { ...movedBase, sortOrder: candidate };
        finalNext = [...next];
        finalNext[insertPos] = updatedMoved;
        if (isNoteNonEmpty(updatedMoved)) {
          changedToSync.push(updatedMoved);
        }
      } else {
        const prevById = new Map(prev.map((n) => [n.id, n]));
        finalNext = next.map((n, idx) => ({ ...n, sortOrder: (idx + 1) * 1000 }));
        for (const n of finalNext) {
          const before = prevById.get(n.id);
          if (
            isNoteNonEmpty(n) &&
            (!before || before.sortOrder !== n.sortOrder || before.folder !== n.folder)
          ) {
            changedToSync.push(n);
          }
        }
      }
    } else {
      const prevById = new Map(prev.map((n) => [n.id, n]));
      finalNext = next.map((n, idx) => ({ ...n, sortOrder: (idx + 1) * 1000 }));
      for (const n of finalNext) {
        const before = prevById.get(n.id);
        if (
          isNoteNonEmpty(n) &&
          (!before || before.sortOrder !== n.sortOrder || before.folder !== n.folder)
        ) {
          changedToSync.push(n);
        }
      }
    }

    notesRef.current = finalNext;
    setNotes(finalNext);
    for (const noteToSync of changedToSync) {
      scheduleCloudNoteUpsert(noteToSync, false);
    }
  };

  const handleResetDemo = () => {
    setTasks(INITIAL_TASKS);
    setTaskLists(INITIAL_LISTS);
    setNoteFolders(INITIAL_NOTE_FOLDERS);
    setCollapsedNoteFolders([]);
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
    decisions.defaultHome === DefaultHome.Inbox ? 'Inbox' : 'Overview';

  const screenTabs: { id: ScreenId; label: string }[] = [
    { id: ScreenId.Home, label: homeTabTitle },
    { id: ScreenId.Tasks, label: 'Tasks' },
    { id: ScreenId.Agent, label: 'Lookup' },
    { id: ScreenId.Notes, label: 'Notes' },
    { id: ScreenId.Settings, label: 'Settings' },
  ];

  if (isStandaloneAppMode) {
    const standaloneTokens = getDeviceStyleTokens(decisions.visualStyle);
    return (
      <div
        className={`fixed inset-x-0 top-[var(--buh-vv-top,0px)] h-[var(--buh-vh,100dvh)] w-full ${standaloneTokens.surfaceBg} text-stone-900 dark:text-stone-100 overflow-hidden`}
      >
        <FoldDeviceFrame
          standalone
          keyboardOpen={isVirtualKeyboardOpen}
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
          noteFolders={noteFolders}
          collapsedNoteFolders={collapsedNoteFolders}
          events={visibleEvents}
          notes={notes}
          settings={settings}
          onAddTask={handleAddTask}
          onToggleTask={handleToggleTask}
          onUpdateTask={handleUpdateTask}
          onDeleteTask={handleDeleteTask}
          onRestoreTask={handleRestoreTask}
          onAddEvent={handleAddEvent}
          onDeleteEvent={handleDeleteEvent}
          onRestoreEvent={handleRestoreEvent}
          onConvertEventToTask={handleConvertEventToTask}
          onUpdateNote={handleUpdateNote}
          onDeleteNote={handleDeleteNote}
          onRestoreNote={handleRestoreNote}
          onCreateNote={handleCreateNote}
          onReorderNote={handleReorderNote}
          onUpdateSettings={(patch) => setSettings((s) => ({ ...s, ...patch }))}
          onAddList={handleAddList}
          onRenameList={handleRenameList}
          onDeleteList={handleDeleteList}
          onReorderList={handleReorderList}
          onAddNoteFolder={handleAddNoteFolder}
          onRenameNoteFolder={handleRenameNoteFolder}
          onDeleteNoteFolder={handleDeleteNoteFolder}
          onReorderNoteFolder={handleReorderNoteFolder}
          onToggleNoteFolderCollapsed={handleToggleNoteFolderCollapsed}
          onExpandNoteFolder={handleExpandNoteFolder}
          recentColors={recentColors}
          onPreviewAccentColor={handlePreviewAccentColor}
          onSelectAccentColor={handleSelectAccentColor}
          googleCalendar={googleCalendarState}
          googleTasks={googleTasksState}
          cloudNotesSync={cloudNotesSyncState}
          activeReminderAlerts={activeReminderAlerts}
          onDismissReminderAlert={handleDismissReminderAlert}
          onSnoozeReminderAlert={handleSnoozeReminderAlert}
          onCompleteFromReminderAlert={handleCompleteFromReminderAlert}
          externalOpenTask={externalOpenTask}
          onConsumeExternalOpenTask={() => setExternalOpenTask(null)}
          externalShortcut={externalShortcut}
          onConsumeExternalShortcut={() => setExternalShortcut(null)}
          hiddenCompletedTasksCount={hiddenCompletedTasksCount}
        />
        <OfflineIndicator
          pendingSyncCount={pendingSyncQueue.length}
          isSyncingQueue={isSyncingOfflineQueue}
          syncNotice={offlineSyncNotice}
          needsReconnectToSync={!googleConnected}
          onSyncPending={handleTriggerPendingSync}
        />
        {showExitToast && (
          <div
            role="status"
            aria-live="polite"
            className="pointer-events-none fixed bottom-20 left-1/2 -translate-x-1/2 z-[60] rounded-xl bg-stone-900/95 dark:bg-stone-100/95 px-4 py-2.5 text-[13px] font-medium text-white dark:text-stone-900 shadow-xl border border-stone-700/60 dark:border-stone-300/60 whitespace-nowrap"
          >
            Press back again to exit
          </div>
        )}
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

                <button
                  type="button"
                  onClick={() => setSimulatedKeyboardOpen((v) => !v)}
                  aria-pressed={simulatedKeyboardOpen}
                  title="Toggle simulated Android on-screen keyboard inside the device preview"
                  className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap ${
                    simulatedKeyboardOpen
                      ? 'bg-[var(--tf-accent-soft)] border-[var(--tf-accent-border)] text-[var(--tf-accent-text)]'
                      : 'border-stone-200 dark:border-stone-700 text-stone-600 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-stone-800'
                  }`}
                >
                  <Keyboard className="w-3.5 h-3.5" />
                  Android KB
                </button>

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
                keyboardOpen={simulatedKeyboardOpen}
                onDismissKeyboard={() => setSimulatedKeyboardOpen(false)}
                decisions={decisions}
                activeScreen={activeScreen}
                onChangeScreen={setActiveScreen}
                isDark={isDark}
                onToggleDark={() => setIsDark((d) => !d)}
                showHingeGuide={showHingeGuide}
                tasks={visibleTasks}
                taskLists={taskLists}
                noteFolders={noteFolders}
                collapsedNoteFolders={collapsedNoteFolders}
                events={visibleEvents}
                notes={notes}
                settings={settings}
                onAddTask={handleAddTask}
                onToggleTask={handleToggleTask}
                onUpdateTask={handleUpdateTask}
                onDeleteTask={handleDeleteTask}
                onRestoreTask={handleRestoreTask}
                onAddEvent={handleAddEvent}
                onDeleteEvent={handleDeleteEvent}
                onRestoreEvent={handleRestoreEvent}
                onConvertEventToTask={handleConvertEventToTask}
                onUpdateNote={handleUpdateNote}
                onDeleteNote={handleDeleteNote}
                onRestoreNote={handleRestoreNote}
                onCreateNote={handleCreateNote}
                onReorderNote={handleReorderNote}
                onUpdateSettings={(patch) => setSettings((s) => ({ ...s, ...patch }))}
                onAddList={handleAddList}
                onRenameList={handleRenameList}
                onDeleteList={handleDeleteList}
                onReorderList={handleReorderList}
                onAddNoteFolder={handleAddNoteFolder}
                onRenameNoteFolder={handleRenameNoteFolder}
                onDeleteNoteFolder={handleDeleteNoteFolder}
                onReorderNoteFolder={handleReorderNoteFolder}
                onToggleNoteFolderCollapsed={handleToggleNoteFolderCollapsed}
                onExpandNoteFolder={handleExpandNoteFolder}
                recentColors={recentColors}
                onPreviewAccentColor={handlePreviewAccentColor}
                onSelectAccentColor={handleSelectAccentColor}
                googleCalendar={googleCalendarState}
                googleTasks={googleTasksState}
                cloudNotesSync={cloudNotesSyncState}
                activeReminderAlerts={activeReminderAlerts}
                onDismissReminderAlert={handleDismissReminderAlert}
                onSnoozeReminderAlert={handleSnoozeReminderAlert}
                onCompleteFromReminderAlert={handleCompleteFromReminderAlert}
                externalOpenTask={externalOpenTask}
                onConsumeExternalOpenTask={() => setExternalOpenTask(null)}
                externalShortcut={externalShortcut}
                onConsumeExternalShortcut={() => setExternalShortcut(null)}
                hiddenCompletedTasksCount={hiddenCompletedTasksCount}
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
      {showExitToast && (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] rounded-xl bg-stone-900/95 dark:bg-stone-100/95 px-4 py-2.5 text-[13px] font-medium text-white dark:text-stone-900 shadow-xl border border-stone-700/60 dark:border-stone-300/60 whitespace-nowrap"
        >
          Press back again to exit
        </div>
      )}
    </div>
  );
}
