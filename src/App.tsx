import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActiveReminderAlert, FoldDeviceFrame } from './components/FoldDeviceFrame';
import { OfflineIndicator } from './components/OfflineIndicator';
import { useAndroidBackController } from './hooks/useAndroidBackNavigation';

const StudioPreviewShell = lazy(() =>
  import('./components/StudioPreviewShell').then((m) => ({ default: m.StudioPreviewShell }))
);
import {
  DEMO_SEED_IDS,
  getTodayDateKey,
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
  isCalendarAccessTokenFresh,
  signInWithGoogleCalendar,
  signOutGoogleCalendar,
} from './services/googleCalendar';
import {
  buildDefaultGoogleTaskReminders,
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
  deleteCloudEvent,
  deleteCloudLookupEntry,
  deleteCloudTask,
  fetchAllCloudEventsOnce,
  fetchAllCloudLookupEntriesOnce,
  fetchAllCloudTasksOnce,
  fingerprintCloudEvent,
  fingerprintCloudLookupEntry,
  fingerprintCloudTask,
  fingerprintWorkspacePreferences,
  saveCloudWorkspacePreferences,
  subscribeCloudEvents,
  subscribeCloudLookupEntries,
  subscribeCloudTasks,
  subscribeCloudWorkspacePreferences,
  upsertCloudEvent,
  upsertCloudLookupEntry,
  upsertCloudTask,
} from './services/cloudWorkspaceSync';
import type { QuickCheckEntry } from './components/screens/QuickCheckScreen';
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
  RecurrenceRule,
  ScreenId,
  TaskItem,
  TaskPriority,
  TaskReminder,
} from './types/taskflow';
import { formatRelativeTaskDate } from './utils/dateLabels';
import { buildNextRecurringTaskInstance } from './utils/recurrence';
import { compareEventsAscending, compareTasksAscending } from './utils/taskSort';
import { TimeFormatProvider, formatClockDate } from './utils/timeFormat';
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
  loadCachedLookupEntries,
  loadOfflineGoogleCache,
  makeSyncOpId,
  OfflineSyncOp,
  requestPersistentStorage,
  saveCachedLookupEntries,
  saveOfflineGoogleCache,
} from './utils/offlineSync';
import {
  clearCloudTaskJournal,
  loadCloudTaskJournal,
  mergeGoogleTaskOfflinePriority,
  mergeTaskItemOfflinePriority,
  OfflineCloudTaskJournal,
  saveCloudTaskJournal,
} from './utils/taskReconciliation';
import {
  clearReminderFiredInServiceWorker,
  computeReminderTriggerMs,
  consumePendingSwReminderActions,
  createSnoozedReminder,
  dispatchSystemTaskNotification,
  formatReminderLabel,
  getNotificationPermissionState,
  getSwFiredReminderKeys,
  loadPersistedFiredReminderKeys,
  makeRearmedReminderId,
  markReminderFiredInServiceWorker,
  playSoftReminderChime,
  syncRemindersToServiceWorker,
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

      const rawAccent = normalizeHex(parsed.decisions?.accentColor ?? INITIAL_DECISIONS.accentColor);
      const parsedRecent = Array.isArray(parsed.recentColors)
        ? parsed.recentColors.map(normalizeHex).filter((c, i, arr) => arr.indexOf(c) === i).slice(0, 5)
        : INITIAL_RECENT_COLORS;
      const accentMigrationKey = 'buh-accent-default-migrated-c7dff1';
      let migratedUntouchedDefault = false;
      try {
        if (!localStorage.getItem(accentMigrationKey)) {
          if (
            rawAccent === '#7BB6E0' &&
            parsedRecent.length <= 1 &&
            parsedRecent.every((c) => c === '#7BB6E0')
          ) {
            migratedUntouchedDefault = true;
          }
          localStorage.setItem(accentMigrationKey, '1');
        }
      } catch {
        // Ignore storage errors
      }
      const accent = migratedUntouchedDefault ? INITIAL_DECISIONS.accentColor : rawAccent;
      const recentColors = migratedUntouchedDefault
        ? INITIAL_RECENT_COLORS
        : parsedRecent.length > 0
          ? parsedRecent
          : [accent];

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
  const dispatchedReminderKeysRef = useRef<Set<string>>(
    new Set(Object.keys(loadPersistedFiredReminderKeys()))
  );
  const swActionsHydratedRef = useRef<boolean>(false);
  const swWakePendingRef = useRef<boolean>(false);
  const processedSwActionIdsRef = useRef<Set<string>>(new Set());
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
  const [dpiCompensationZoom, setDpiCompensationZoom] = useState<number>(1);
  const maxViewportHeightRef = useRef<Record<string, number>>({});
  const lastSyncedWidthRef = useRef<number>(viewportWidth);
  const lastVhCssRef = useRef<string>('');
  const lastVvTopCssRef = useRef<string>('');

  useEffect(() => {
    const INNER_POSTURE_BREAKPOINT = 560;
    const BASE_VIEWPORT_CONTENT =
      'width=device-width, initial-scale=1.0, minimum-scale=1.0, viewport-fit=cover, interactive-widget=resizes-content';
    const buildLockedViewportContent = (widthPx: number) =>
      `width=${widthPx}, initial-scale=1.0, minimum-scale=1.0, maximum-scale=1.0, viewport-fit=cover, interactive-widget=resizes-content`;

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
    let innerReleaseTimerId: number | null = null;
    let lockedCoverWidth: number | null = null;
    let lockedCoverSince = 0;
    let currentDprMedia: MediaQueryList | null = null;

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

    const applyViewportMeta = (content: string) => {
      const viewportMeta = document.querySelector('meta[name="viewport"]');
      if (!viewportMeta) return;
      if (viewportMeta.getAttribute('content') !== content) {
        viewportMeta.setAttribute('content', content);
      }
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
      // Reverse case: launched or locked on Cover then unfolded to Inner
      if (
        effectiveWidth < INNER_POSTURE_BREAKPOINT &&
        (screenWidth >= INNER_POSTURE_BREAKPOINT ||
          (screenWidth === 0 && vvScaledWidth >= INNER_POSTURE_BREAKPOINT && vvScale > 1.15))
      ) {
        effectiveWidth = Math.max(screenWidth, vvScaledWidth);
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

      let nextZoom = 1;

      if (mobile) {
        if (effectiveWidth < INNER_POSTURE_BREAKPOINT) {
          const targetCoverWidth =
            screenWidth > 0 && screenWidth < INNER_POSTURE_BREAKPOINT
              ? screenWidth
              : vvScaledWidth > 0 && vvScaledWidth < INNER_POSTURE_BREAKPOINT
                ? vvScaledWidth
                : effectiveWidth;

          const layoutTooWide = targetCoverWidth > 0 && rawLayoutWidth > targetCoverWidth + 16;
          const scaleOff = vvScale < 0.94 || vvScale > 1.06;

          if (layoutTooWide || scaleOff) {
            if (innerReleaseTimerId !== null) {
              window.clearTimeout(innerReleaseTimerId);
              innerReleaseTimerId = null;
            }
            if (lockedCoverWidth !== targetCoverWidth) {
              lockedCoverWidth = targetCoverWidth;
              lockedCoverSince = Date.now();
            }
            applyViewportMeta(buildLockedViewportContent(targetCoverWidth));
            // If Samsung One UI / Chrome WebAPK still keeps layout width inflated after the
            // explicit viewport meta update settles, compensate visual DPI cleanly via CSS zoom
            // — and keep this compensation active even while editing text or opening time/date pickers.
            if (layoutTooWide && Date.now() - lockedCoverSince >= 280) {
              const ratio = rawLayoutWidth / targetCoverWidth;
              if (ratio >= 1.12) {
                nextZoom = Math.min(2.4, Number(ratio.toFixed(3)));
              }
            }
          } else {
            nextZoom = 1;
          }
        } else if (!inputFocused || screenWidth >= INNER_POSTURE_BREAKPOINT) {
          // Inner screen (unfolded): release any Cover viewport width lock so Chrome restores Inner DPI cleanly
          nextZoom = 1;
          const needsInnerReset =
            lockedCoverWidth !== null ||
            rawLayoutWidth < effectiveWidth - 24 ||
            vvScale < 0.94 ||
            vvScale > 1.06;
          if (needsInnerReset) {
            lockedCoverWidth = null;
            lockedCoverSince = 0;
            applyViewportMeta(buildLockedViewportContent(effectiveWidth));
            if (innerReleaseTimerId !== null) {
              window.clearTimeout(innerReleaseTimerId);
            }
            innerReleaseTimerId = window.setTimeout(() => {
              innerReleaseTimerId = null;
              if (lockedCoverWidth === null) {
                applyViewportMeta(BASE_VIEWPORT_CONTENT);
              }
            }, 300);
          }
        }
      } else {
        if (lockedCoverWidth !== null) {
          lockedCoverWidth = null;
          lockedCoverSince = 0;
          applyViewportMeta(BASE_VIEWPORT_CONTENT);
        }
        nextZoom = 1;
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

      const nextVhCss = `${visibleHeight}px`;
      if (lastVhCssRef.current !== nextVhCss) {
        lastVhCssRef.current = nextVhCss;
        document.documentElement.style.setProperty('--buh-vh', nextVhCss);
      }
      const nextVvTopCss = `${offsetTop}px`;
      if (lastVvTopCssRef.current !== nextVvTopCss) {
        lastVvTopCssRef.current = nextVvTopCss;
        document.documentElement.style.setProperty('--buh-vv-top', nextVvTopCss);
      }

      const widthBucket = String(Math.round(effectiveWidth / 40));
      const prevMax = maxViewportHeightRef.current[widthBucket] ?? 0;
      if (visibleHeight > prevMax || (!inputFocused && visibleHeight >= winHeight - 24)) {
        maxViewportHeightRef.current[widthBucket] = Math.max(visibleHeight, winHeight);
      }
      const baseline = maxViewportHeightRef.current[widthBucket] ?? visibleHeight;
      const keyboardVisible = inputFocused && baseline - visibleHeight > 130;

      lastSyncedWidthRef.current = effectiveWidth;
      setDpiCompensationZoom(nextZoom);
      setIsVirtualKeyboardOpen(keyboardVisible);
      setViewportWidth(effectiveWidth);
      setIsCoarseTouch(coarseMedia.matches);
      setIsInstalledPwa(
        standaloneMedia.matches ||
          (window.navigator as unknown as { standalone?: boolean }).standalone === true
      );

      if (
        document.documentElement.classList.contains('buh-standalone') &&
        (window.scrollY !== 0 || window.scrollX !== 0)
      ) {
        window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
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

    // Always process resize/orientation/posture/DPR events even if fired while screen is briefly hidden/locked.
    const handleDisplayChange = () => {
      scheduleSync([50, 180, 350, 650, 1200]);
    };

    // Re-bind a resolution (dppx) media query whenever DPR changes on fold/unfold
    const bindDprListener = () => {
      if (currentDprMedia) {
        currentDprMedia.removeEventListener?.('change', handleDprChange);
      }
      currentDprMedia = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      currentDprMedia.addEventListener?.('change', handleDprChange);
    };

    const handleDprChange = () => {
      bindDprListener();
      handleDisplayChange();
    };

    // Folding/unfolding across a lock screen on Galaxy Z Fold can finish switching
    // displays 100-1000ms after visibility/focus resumes, so re-check across settle windows.
    const handleVisibilityResume = () => {
      if (document.visibilityState === 'hidden') return;
      scheduleSync([50, 180, 350, 650, 1200]);
    };

    const scheduleDeferredSync = (delays: number[]) => {
      clearPendingSettles();
      for (const delay of delays) {
        const id = window.setTimeout(() => {
          settleTimers.delete(id);
          syncViewport();
        }, delay);
        settleTimers.add(id);
      }
    };

    const handleFocusIn = () => scheduleSync([80, 200, 340]);
    // Defer focusout sync so a tap on a bottom button (e.g. Lookup Send) finishes its click
    // before --buh-vh snaps back to full height and shifts the button away.
    const handleFocusOut = () => scheduleDeferredSync([120, 240, 380]);

    const handlePointerDriftCheck = () => {
      const { effectiveWidth, rawLayoutWidth } = readEffectiveWidth();
      if (
        Math.abs(effectiveWidth - lastSyncedWidthRef.current) > 4 ||
        (effectiveWidth < INNER_POSTURE_BREAKPOINT && rawLayoutWidth > effectiveWidth + 16)
      ) {
        scheduleSync([60, 220, 420]);
      }
    };

    const resizeObserver =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            syncViewport();
          })
        : null;
    resizeObserver?.observe(document.documentElement);

    bindDprListener();
    syncViewport();
    window.addEventListener('resize', handleDisplayChange);
    window.addEventListener('orientationchange', handleDisplayChange);
    window.addEventListener('focus', handleDisplayChange);
    window.addEventListener('pageshow', handleDisplayChange);
    document.addEventListener('visibilitychange', handleVisibilityResume);
    window.addEventListener('focusin', handleFocusIn);
    window.addEventListener('focusout', handleFocusOut);
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
      if (innerReleaseTimerId !== null) {
        window.clearTimeout(innerReleaseTimerId);
      }
      currentDprMedia?.removeEventListener?.('change', handleDprChange);
      resizeObserver?.disconnect();
      window.removeEventListener('resize', handleDisplayChange);
      window.removeEventListener('orientationchange', handleDisplayChange);
      window.removeEventListener('focus', handleDisplayChange);
      window.removeEventListener('pageshow', handleDisplayChange);
      document.removeEventListener('visibilitychange', handleVisibilityResume);
      window.removeEventListener('focusin', handleFocusIn);
      window.removeEventListener('focusout', handleFocusOut);
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

  // Handle PWA launcher shortcuts, notification ?openTask= launches & OS note_taking triggers
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const triggerShortcut = (action: PwaShortcutAction) => {
      setExternalShortcut({ action, nonce: Date.now() + Math.random() });
    };

    const initialParams = new URLSearchParams(window.location.search);
    const openTaskId = initialParams.get('openTask');
    if (openTaskId) {
      setActiveScreen(ScreenId.Tasks);
      setExternalOpenTask({ taskId: openTaskId, nonce: Date.now() });
      try {
        const cleaned = new URL(window.location.href);
        cleaned.searchParams.delete('openTask');
        window.history.replaceState(window.history.state, '', cleaned.pathname + cleaned.search + cleaned.hash);
      } catch {
        // Ignore history restriction
      }
    }

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
  const [googleTasks, setGoogleTasks] = useState<TaskItem[]>(() =>
    initialGoogleCache.googleTasks.map((t) => {
      const reminders = buildDefaultGoogleTaskReminders(t);
      return reminders !== t.reminders ? { ...t, reminders } : t;
    })
  );
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
  const dirtyGoogleTaskIdsRef = useRef<string[]>(dirtyGoogleTaskIds);
  const googleTaskEditVersionRef = useRef<Map<string, number>>(new Map());
  const pendingGoogleTaskAutoSyncRef = useRef<
    Map<string, { timerId: number; version: number; task: TaskItem }>
  >(new Map());
  const inFlightGoogleTaskSyncIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    pendingSyncQueueRef.current = pendingSyncQueue;
  }, [pendingSyncQueue]);

  useEffect(() => {
    googleConnectedRef.current = googleConnected;
  }, [googleConnected]);

  useEffect(() => {
    dirtyGoogleTaskIdsRef.current = dirtyGoogleTaskIds;
  }, [dirtyGoogleTaskIds]);

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

  const offlineNoticeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (offlineNoticeTimerRef.current !== null) {
        window.clearTimeout(offlineNoticeTimerRef.current);
      }
    };
  }, []);

  const showOfflineSyncNotice = useCallback((msg: string) => {
    setOfflineSyncNotice(msg);
    if (offlineNoticeTimerRef.current !== null) {
      window.clearTimeout(offlineNoticeTimerRef.current);
    }
    offlineNoticeTimerRef.current = window.setTimeout(() => {
      setOfflineSyncNotice((curr) => (curr === msg ? null : curr));
      offlineNoticeTimerRef.current = null;
    }, 3400);
  }, []);

  const syncGoogleCalendarEvents = useCallback(async (tokenOverride?: string) => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    setGoogleSyncing(true);
    setGoogleError(null);
    try {
      const fetched = await fetchGoogleCalendarEvents(tokenOverride);
      setGoogleEvents(fetched);
      setGoogleLastSyncedAt(formatClockDate(new Date()));
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

  const rearmRelativeReminders = useCallback(
    (prevTask: TaskItem | undefined, updated: TaskItem): TaskItem => {
      if (
        !prevTask ||
        !updated.reminders ||
        updated.reminders.length === 0 ||
        (prevTask.dateKey === updated.dateKey &&
          prevTask.timeLabel === updated.timeLabel &&
          Boolean(prevTask.isInbox) === Boolean(updated.isInbox))
      ) {
        return updated;
      }
      const now = Date.now();
      const todayKey = getTodayDateKey();
      const clearedReminderIds = new Set<string>();
      let mutated = false;

      const nextReminders = updated.reminders.map((r) => {
        if (r.mode !== 'relative') return r;

        const prevTrigger = computeReminderTriggerMs(prevTask, r);
        const nextTrigger = computeReminderTriggerMs(updated, r);
        const isRescheduledToTodayGoogleDefault =
          updated.source === 'google' &&
          r.id.startsWith('gtask-due-') &&
          updated.timeLabel === 'No time set' &&
          updated.dateKey === todayKey &&
          prevTask.dateKey !== todayKey;

        if (prevTrigger === nextTrigger && !isRescheduledToTodayGoogleDefault) {
          return r;
        }

        const prefix = `${updated.id}:${r.id}`;
        for (const existingKey of Array.from(dispatchedReminderKeysRef.current)) {
          if (existingKey === prefix || existingKey.startsWith(`${prefix}:`)) {
            dispatchedReminderKeysRef.current.delete(existingKey);
          }
        }
        void clearReminderFiredInServiceWorker(updated.id, r.id);
        clearedReminderIds.add(r.id);

        if (nextTrigger === null) {
          // Date was cleared; keep relative reminder saved and ready for when a date is assigned
          if (r.firedAt !== undefined) {
            mutated = true;
            return { ...r, firedAt: undefined };
          }
          return r;
        }

        if (nextTrigger > now || isRescheduledToTodayGoogleDefault) {
          mutated = true;
          return {
            ...r,
            id: makeRearmedReminderId(r.id),
            firedAt: undefined,
          };
        }

        // Rescheduled to an already-past time: don't re-fire if it was already fired,
        // otherwise rotate id so a fresh schedule change is cleanly tracked
        if (!r.firedAt) {
          mutated = true;
          return {
            ...r,
            id: makeRearmedReminderId(r.id),
            firedAt: undefined,
          };
        }
        return r;
      });

      if (clearedReminderIds.size > 0) {
        queueMicrotask(() => {
          setActiveReminderAlerts((prev) =>
            prev.filter(
              (a) => !(a.taskId === updated.id && a.reminderId && clearedReminderIds.has(a.reminderId))
            )
          );
        });
      }

      if (!mutated) return updated;
      return {
        ...updated,
        reminders: nextReminders,
      };
    },
    []
  );

  // Last confirmed remote snapshot for each Google Task (used as common ancestor for silent 3-way merge)
  const googleTaskBaseByIdRef = useRef<Map<string, TaskItem>>(new Map());

  const syncGoogleTasksList = useCallback(async (tokenOverride?: string) => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    setGoogleTasksSyncing(true);
    setGoogleTasksError(null);
    try {
      const { tasks: fetchedTasks, taskLists: fetchedLists } = await fetchGoogleTasks(tokenOverride);
      for (const fetched of fetchedTasks) {
        googleTaskBaseByIdRef.current.set(fetched.id, fetched);
      }

      const pendingQueuedIds = new Set<string>();
      const pendingDeletedIds = new Set<string>();
      const pendingBaseByTaskId = new Map<string, TaskItem>();
      for (const op of pendingSyncQueueRef.current) {
        if (op.type === 'gtask-create') {
          pendingQueuedIds.add(op.tempId);
        } else if (op.type === 'gtask-update') {
          pendingQueuedIds.add(op.taskId);
          if (op.baseTask) {
            pendingBaseByTaskId.set(op.taskId, op.baseTask);
          }
        } else if (op.type === 'gtask-delete') {
          pendingDeletedIds.add(op.taskId);
        }
      }
      const protectedIds = new Set<string>([
        ...dirtyGoogleTaskIdsRef.current,
        ...pendingQueuedIds,
        ...pendingGoogleTaskAutoSyncRef.current.keys(),
        ...inFlightGoogleTaskSyncIdsRef.current,
      ]);

      // Preserve local reminders, timeLabel, and priority attached to Google Tasks,
      // prioritize and silently 3-way merge tasks with pending/offline local edits,
      // suppress tasks with queued offline deletes, and re-arm rescheduled relative reminders
      setGoogleTasks((prev) => {
        const byGoogleId = new Map<string, TaskItem>();
        for (const existing of prev) {
          if (existing.googleTaskId) byGoogleId.set(existing.googleTaskId, existing);
        }
        const mergedFetched: TaskItem[] = [];
        for (const incoming of fetchedTasks) {
          if (pendingDeletedIds.has(incoming.id)) {
            continue;
          }
          const prevMatch = incoming.googleTaskId ? byGoogleId.get(incoming.googleTaskId) : undefined;
          if (!prevMatch) {
            mergedFetched.push(incoming);
            continue;
          }
          if (protectedIds.has(prevMatch.id)) {
            const baseTask = pendingBaseByTaskId.get(prevMatch.id);
            const reconciled = mergeGoogleTaskOfflinePriority(prevMatch, incoming, baseTask);
            mergedFetched.push(rearmRelativeReminders(prevMatch, reconciled));
            continue;
          }
          const merged: TaskItem = {
            ...incoming,
            reminders:
              prevMatch.reminders !== undefined ? prevMatch.reminders : incoming.reminders,
            recurrence: incoming.recurrence ?? prevMatch.recurrence,
            recurrenceSeriesId: prevMatch.recurrenceSeriesId ?? incoming.recurrenceSeriesId,
            timeLabel:
              incoming.timeLabel && incoming.timeLabel !== 'No time set'
                ? incoming.timeLabel
                : prevMatch.timeLabel && prevMatch.timeLabel !== 'No time set'
                  ? prevMatch.timeLabel
                  : incoming.timeLabel,
            priority: prevMatch.priority !== 'Normal' ? prevMatch.priority : incoming.priority,
          };
          mergedFetched.push(rearmRelativeReminders(prevMatch, merged));
        }
        // Keep any offline-created or dirty local Google Tasks not yet present in remote response
        const fetchedIds = new Set(mergedFetched.map((t) => t.id));
        const offlineUnsynced = prev.filter(
          (t) =>
            !pendingDeletedIds.has(t.id) &&
            !fetchedIds.has(t.id) &&
            (Boolean(t.googleTaskId?.startsWith('offline-')) || protectedIds.has(t.id))
        );
        return offlineUnsynced.length > 0 ? [...offlineUnsynced, ...mergedFetched] : mergedFetched;
      });
      setGoogleTaskLists(fetchedLists);
      setDirtyGoogleTaskIds((prev) => prev.filter((id) => protectedIds.has(id)));
      setGoogleTasksLastSyncedAt(formatClockDate(new Date()));
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
  }, [rearmRelativeReminders]);

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

      try {
        for (let i = 0; i < snapshot.length; i += 1) {
          const op = snapshot[i];
          if (typeof navigator !== 'undefined' && !navigator.onLine) break;

          if (op.type === 'gtask-create') {
            const latestLocal =
              googleTasksRef.current.find((t) => t.id === op.tempId) ?? undefined;
            const createInput = latestLocal
              ? {
                  title: latestLocal.title,
                  notes: latestLocal.notes,
                  dateKey: latestLocal.isInbox ? undefined : latestLocal.dateKey,
                  timeLabel: latestLocal.timeLabel,
                  priority: latestLocal.priority,
                  taskListId: op.payload.taskListId || latestLocal.googleTaskListId || '@default',
                  taskListTitle:
                    op.payload.category || latestLocal.googleTaskListTitle || 'My Tasks',
                  recurrence: latestLocal.recurrence ?? op.payload.recurrence,
                  reminders: latestLocal.reminders ?? op.payload.reminders,
                }
              : {
                  title: op.payload.title,
                  notes: op.payload.notes,
                  dateKey: op.payload.dateKey,
                  timeLabel: op.payload.timeLabel,
                  priority: op.payload.priority,
                  taskListId: op.payload.taskListId || '@default',
                  taskListTitle: op.payload.category || 'My Tasks',
                  recurrence: op.payload.recurrence,
                  reminders: op.payload.reminders,
                };
            const created = await createGoogleTask(createInput, tokenOverride);
            const withMeta: TaskItem = {
              ...created,
              reminders: createInput.reminders ?? created.reminders,
              recurrence: createInput.recurrence,
              recurrenceSeriesId:
                latestLocal?.recurrenceSeriesId ?? op.payload.recurrenceSeriesId,
            };
            tempToCreatedTask.set(op.tempId, withMeta);
            googleTaskBaseByIdRef.current.set(withMeta.id, withMeta);
            setGoogleTasks((prev) =>
              prev.map((t) => (t.id === op.tempId ? withMeta : t))
            );
            setDirtyGoogleTaskIds((prev) => prev.filter((id) => id !== op.tempId));
            touchedTasks = true;
          } else if (op.type === 'gtask-update') {
            const mapped = tempToCreatedTask.get(op.taskId);
            const liveLocal = googleTasksRef.current.find(
              (t) => t.id === op.taskId || (mapped && t.id === mapped.id)
            );
            const freshestOfflineTask = liveLocal ?? op.task;
            const remoteBase = googleTaskBaseByIdRef.current.get(
              mapped ? mapped.id : freshestOfflineTask.id
            );
            const reconciledTask =
              remoteBase && op.baseTask
                ? mergeGoogleTaskOfflinePriority(freshestOfflineTask, remoteBase, op.baseTask)
                : freshestOfflineTask;
            const targetTask: TaskItem = mapped
              ? {
                  ...reconciledTask,
                  id: mapped.id,
                  googleTaskId: mapped.googleTaskId,
                  googleTaskListId: mapped.googleTaskListId,
                  googleTaskListTitle: mapped.googleTaskListTitle,
                }
              : reconciledTask;

            if (targetTask.googleTaskId && !targetTask.googleTaskId.startsWith('offline-')) {
              const editVersionAtStart =
                googleTaskEditVersionRef.current.get(op.taskId) ??
                googleTaskEditVersionRef.current.get(targetTask.id) ??
                0;
              inFlightGoogleTaskSyncIdsRef.current.add(op.taskId);
              inFlightGoogleTaskSyncIdsRef.current.add(targetTask.id);
              try {
                let updated: TaskItem;
                try {
                  updated = await updateGoogleTask(targetTask, tokenOverride);
                } catch (updateErr: unknown) {
                  if (updateErr instanceof Error && updateErr.message === 'TASK_NOT_FOUND') {
                    // Task was deleted remotely while edited offline: recreate silently so offline edit wins
                    const recreated = await createGoogleTask(
                      {
                        title: targetTask.title,
                        notes: targetTask.notes,
                        dateKey: targetTask.isInbox ? undefined : targetTask.dateKey,
                        timeLabel: targetTask.timeLabel,
                        priority: targetTask.priority,
                        taskListId: targetTask.googleTaskListId || '@default',
                        taskListTitle: targetTask.googleTaskListTitle || targetTask.category || 'My Tasks',
                        recurrence: targetTask.recurrence,
                        reminders: targetTask.reminders,
                      },
                      tokenOverride
                    );
                    updated = targetTask.completed
                      ? await updateGoogleTask(
                          {
                            ...recreated,
                            completed: true,
                            completedAt: targetTask.completedAt || new Date().toISOString(),
                          },
                          tokenOverride
                        )
                      : recreated;
                  } else {
                    throw updateErr;
                  }
                }

                const finalSynced: TaskItem = {
                  ...updated,
                  reminders: targetTask.reminders,
                  recurrence: targetTask.recurrence,
                  recurrenceSeriesId: targetTask.recurrenceSeriesId,
                };
                googleTaskBaseByIdRef.current.set(finalSynced.id, finalSynced);
                const latestVersion =
                  googleTaskEditVersionRef.current.get(op.taskId) ??
                  googleTaskEditVersionRef.current.get(targetTask.id) ??
                  0;
                if (latestVersion === editVersionAtStart) {
                  setGoogleTasks((prev) =>
                    prev.map((t) =>
                      t.id === targetTask.id || t.id === op.taskId ? finalSynced : t
                    )
                  );
                  setDirtyGoogleTaskIds((prev) =>
                    prev.filter(
                      (id) => id !== op.taskId && id !== targetTask.id && id !== finalSynced.id
                    )
                  );
                }
                touchedTasks = true;
              } finally {
                inFlightGoogleTaskSyncIdsRef.current.delete(op.taskId);
                inFlightGoogleTaskSyncIdsRef.current.delete(targetTask.id);
              }
            }
          } else if (op.type === 'gtask-delete') {
            if (op.googleTaskId && !op.googleTaskId.startsWith('offline-')) {
              await deleteGoogleTask(op.googleTaskListId, op.googleTaskId, tokenOverride);
              googleTaskBaseByIdRef.current.delete(op.taskId);
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
          // Remove only this completed op by id so concurrent offline edits added during flush are preserved
          setPendingSyncQueue((prev) => prev.filter((item) => item.id !== op.id));
        }

        if (syncedOps > 0) {
          showOfflineSyncNotice(
            `Synced ${syncedOps} Google change${syncedOps === 1 ? '' : 's'}`
          );
          await Promise.allSettled([
            touchedEvents || settingsRef.current.googleCalendarSync
              ? syncGoogleCalendarEvents(tokenOverride)
              : Promise.resolve(),
            touchedTasks || settingsRef.current.googleTasksSync
              ? syncGoogleTasksList(tokenOverride)
              : Promise.resolve(),
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

  // --- buh. Cloud Sync (Firestore real-time sync for notes, tasks, schedule blocks, Lookup, lists & settings) ---
  const [quickCheckEntries, setQuickCheckEntries] = useState<QuickCheckEntry[]>(() =>
    loadCachedLookupEntries()
  );
  const [googleReconnectDismissed, setGoogleReconnectDismissed] = useState<boolean>(false);
  const prevPendingSyncCountRef = useRef<number>(pendingSyncQueue.length);
  useEffect(() => {
    if (pendingSyncQueue.length > prevPendingSyncCountRef.current) {
      setGoogleReconnectDismissed(false);
    }
    prevPendingSyncCountRef.current = pendingSyncQueue.length;
  }, [pendingSyncQueue.length]);

  useEffect(() => {
    saveCachedLookupEntries(quickCheckEntries);
  }, [quickCheckEntries]);

  const [firebaseUid, setFirebaseUid] = useState<string | null>(null);
  const [firebaseEmail, setFirebaseEmail] = useState<string | null>(null);
  const [firebaseEmailVerified, setFirebaseEmailVerified] = useState<boolean>(false);
  const [cloudNotesSyncing, setCloudNotesSyncing] = useState<boolean>(false);
  const [cloudNotesLastSyncedAt, setCloudNotesLastSyncedAt] = useState<string | null>(null);
  const [cloudNotesSyncedCount, setCloudNotesSyncedCount] = useState<number>(0);
  const [cloudTasksSyncedCount, setCloudTasksSyncedCount] = useState<number>(0);
  const [cloudEventsSyncedCount, setCloudEventsSyncedCount] = useState<number>(0);
  const [cloudLookupSyncedCount, setCloudLookupSyncedCount] = useState<number>(0);
  const [cloudNotesError, setCloudNotesError] = useState<string | null>(null);

  const notesRef = useRef<NoteItem[]>(notes);
  const noteFoldersRef = useRef<string[]>(noteFolders);
  const collapsedNoteFoldersRef = useRef<string[]>(collapsedNoteFolders);
  const tasksRef = useRef<TaskItem[]>(tasks);
  const eventsRef = useRef<CalendarEvent[]>(events);
  const quickCheckEntriesRef = useRef<QuickCheckEntry[]>(quickCheckEntries);
  const taskListsRef = useRef<string[]>(taskLists);
  const settingsRef = useRef<AppSettingsState>(settings);
  const decisionsRef = useRef<DesignDecisions>(decisions);
  const recentColorsRef = useRef<string[]>(recentColors);
  const isDarkRef = useRef<boolean>(isDark);

  useEffect(() => {
    notesRef.current = notes;
  }, [notes]);
  useEffect(() => {
    noteFoldersRef.current = noteFolders;
  }, [noteFolders]);
  useEffect(() => {
    collapsedNoteFoldersRef.current = collapsedNoteFolders;
  }, [collapsedNoteFolders]);
  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);
  useEffect(() => {
    eventsRef.current = events;
  }, [events]);
  useEffect(() => {
    quickCheckEntriesRef.current = quickCheckEntries;
  }, [quickCheckEntries]);
  useEffect(() => {
    taskListsRef.current = taskLists;
  }, [taskLists]);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);
  useEffect(() => {
    decisionsRef.current = decisions;
  }, [decisions]);
  useEffect(() => {
    recentColorsRef.current = recentColors;
  }, [recentColors]);
  useEffect(() => {
    isDarkRef.current = isDark;
  }, [isDark]);

  const pendingNoteSaveTimersRef = useRef<Map<string, number>>(new Map());
  const pendingNoteSnapshotsRef = useRef<Map<string, NoteItem>>(new Map());
  const pendingTaskCloudTimersRef = useRef<Map<string, number>>(new Map());
  const pendingTaskSnapshotsRef = useRef<Map<string, TaskItem>>(new Map());
  const inFlightTaskCloudIdsRef = useRef<Set<string>>(new Set());
  const localTaskEditVersionRef = useRef<Map<string, number>>(new Map());
  const cloudTaskBaseByIdRef = useRef<Map<string, TaskItem>>(new Map());
  const cloudTaskJournalRef = useRef<OfflineCloudTaskJournal>(loadCloudTaskJournal());
  const pendingEventCloudTimersRef = useRef<Map<string, number>>(new Map());
  const pendingEventSnapshotsRef = useRef<Map<string, CalendarEvent>>(new Map());
  const pendingLookupCloudTimersRef = useRef<Map<string, number>>(new Map());
  const pendingLookupSnapshotsRef = useRef<Map<string, QuickCheckEntry>>(new Map());
  const pendingWorkspacePrefsTimerRef = useRef<number | null>(null);
  const pendingWorkspacePrefsPayloadRef = useRef<{
    taskLists: string[];
    settings: AppSettingsState;
    decisions: DesignDecisions;
    recentColors: string[];
    darkMode: boolean;
  } | null>(null);
  const lastSyncedTasksFpRef = useRef<Map<string, string>>(new Map());
  const lastSyncedEventsFpRef = useRef<Map<string, string>>(new Map());
  const lastSyncedLookupFpRef = useRef<Map<string, string>>(new Map());
  const lastSyncedWorkspacePrefsFpRef = useRef<string | null>(null);
  const cloudWorkspaceHydratedRef = useRef<{
    tasks: boolean;
    events: boolean;
    prefs: boolean;
    lookup: boolean;
  }>({
    tasks: false,
    events: false,
    prefs: false,
    lookup: false,
  });

  const persistCloudTaskJournalNow = useCallback(() => {
    saveCloudTaskJournal(cloudTaskJournalRef.current);
  }, []);

  const recordLocalTaskDirty = useCallback(
    (task: TaskItem, prevTask?: TaskItem) => {
      if (task.source === 'google') return;
      const journal = cloudTaskJournalRef.current;
      delete journal.deletes[task.id];
      const existing = journal.upserts[task.id];
      const baseTask =
        existing?.baseTask ?? cloudTaskBaseByIdRef.current.get(task.id) ?? prevTask;
      journal.upserts[task.id] = {
        task,
        ...(baseTask ? { baseTask } : {}),
        editedAt: Date.now(),
      };
      const nextVer = (localTaskEditVersionRef.current.get(task.id) ?? 0) + 1;
      localTaskEditVersionRef.current.set(task.id, nextVer);
      persistCloudTaskJournalNow();
    },
    [persistCloudTaskJournalNow]
  );

  const recordLocalTaskDeleted = useCallback(
    (taskId: string) => {
      const journal = cloudTaskJournalRef.current;
      delete journal.upserts[taskId];
      journal.deletes[taskId] = Date.now();
      const nextVer = (localTaskEditVersionRef.current.get(taskId) ?? 0) + 1;
      localTaskEditVersionRef.current.set(taskId, nextVer);
      persistCloudTaskJournalNow();
    },
    [persistCloudTaskJournalNow]
  );
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
        setCloudTasksSyncedCount(0);
        setCloudEventsSyncedCount(0);
        setCloudLookupSyncedCount(0);
        setCloudNotesLastSyncedAt(null);
        setCloudNotesError(null);
      }
    });
    return () => unsubscribe();
  }, []);

  const markCloudNotesSyncedNow = useCallback(() => {
    setCloudNotesLastSyncedAt(formatClockDate(new Date()));
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
      pendingNoteSnapshotsRef.current.set(note.id, note);

      const run = () => {
        const latest = cloudSyncReadyRef.current;
        const snapshot = pendingNoteSnapshotsRef.current.get(note.id) || note;
        pendingNoteSaveTimersRef.current.delete(note.id);
        pendingNoteSnapshotsRef.current.delete(note.id);
        if (!latest.uid || !latest.enabled) return;
        void upsertCloudNote(latest.uid, snapshot, noteFoldersRef.current[0] || 'Work')
          .then(() => {
            setCloudNotesError(null);
            markCloudNotesSyncedNow();
          })
          .catch((err) => {
            setCloudNotesError(formatFriendlyCloudSyncError(err));
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
      pendingNoteSnapshotsRef.current.delete(noteId);
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

  // Real-time Firestore subscriptions for notes, tasks, schedule blocks, Lookup & workspace preferences
  useEffect(() => {
    if (!firebaseUid || !firebaseEmailVerified || settings.buhCloudSync === false) {
      cloudWorkspaceHydratedRef.current = {
        tasks: false,
        events: false,
        prefs: false,
        lookup: false,
      };
      return;
    }

    let cancelled = false;
    let unsubPrefs: (() => void) | null = null;
    let unsubWorkspacePrefs: (() => void) | null = null;
    let unsubNotes: (() => void) | null = null;
    let unsubTasks: (() => void) | null = null;
    let unsubEvents: (() => void) | null = null;
    let unsubLookup: (() => void) | null = null;
    let hydratedNotes = false;
    let hydratedTasks = false;
    let hydratedEvents = false;
    let hydratedLookup = false;

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

        unsubWorkspacePrefs = subscribeCloudWorkspacePreferences(
          firebaseUid,
          (prefs) => {
            if (cancelled) return;
            if (!prefs) {
              const localPayload = {
                taskLists: taskListsRef.current,
                settings: settingsRef.current,
                decisions: decisionsRef.current,
                recentColors: recentColorsRef.current,
                darkMode: isDarkRef.current,
              };
              lastSyncedWorkspacePrefsFpRef.current =
                fingerprintWorkspacePreferences(localPayload);
              cloudWorkspaceHydratedRef.current.prefs = true;
              void saveCloudWorkspacePreferences(firebaseUid, localPayload).catch((err) => {
                if (!cancelled) setCloudNotesError(formatFriendlyCloudSyncError(err));
              });
              return;
            }
            lastSyncedWorkspacePrefsFpRef.current = fingerprintWorkspacePreferences(prefs);
            cloudWorkspaceHydratedRef.current.prefs = true;
            if (pendingWorkspacePrefsTimerRef.current === null) {
              setTaskLists(prefs.taskLists);
              setSettings((prev) => ({ ...prev, ...prefs.settings }));
              setDecisions(prefs.decisions);
              setRecentColors(prefs.recentColors);
              setIsDark(prefs.darkMode);
            }
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

        unsubTasks = subscribeCloudTasks(
          firebaseUid,
          (cloudTasks) => {
            if (cancelled) return;
            setCloudTasksSyncedCount(cloudTasks.length);
            setCloudNotesSyncing(false);
            setCloudNotesError(null);
            markCloudNotesSyncedNow();

            const journal = cloudTaskJournalRef.current;
            let journalMutated = false;
            const onlineNow = typeof navigator === 'undefined' || navigator.onLine;
            const cloudIds = new Set(cloudTasks.map((t) => t.id));

            // 1. Reconcile offline deletion tombstones against incoming remote snapshot
            const deletesToFlush: string[] = [];
            for (const deletedId of Object.keys(journal.deletes)) {
              if (!cloudIds.has(deletedId)) {
                delete journal.deletes[deletedId];
                cloudTaskBaseByIdRef.current.delete(deletedId);
                journalMutated = true;
              } else if (onlineNow) {
                deletesToFlush.push(deletedId);
              }
            }
            if (deletesToFlush.length > 0) {
              for (const deletedId of deletesToFlush) {
                void deleteCloudTask(firebaseUid, deletedId)
                  .then(() => {
                    if (cloudTaskJournalRef.current.deletes[deletedId] !== undefined) {
                      delete cloudTaskJournalRef.current.deletes[deletedId];
                      saveCloudTaskJournal(cloudTaskJournalRef.current);
                    }
                    cloudTaskBaseByIdRef.current.delete(deletedId);
                    lastSyncedTasksFpRef.current.delete(deletedId);
                  })
                  .catch(() => {
                    // Keep tombstone in journal so next reconnect retries silently
                  });
              }
            }

            // 2. Track remote snapshots as latest known cloud base & detect brand-new local-only tasks
            for (const ct of cloudTasks) {
              cloudTaskBaseByIdRef.current.set(ct.id, ct);
            }

            const localOnlyToUpload = !hydratedTasks
              ? tasksRef.current.filter(
                  (t) =>
                    t.source !== 'google' &&
                    !cloudIds.has(t.id) &&
                    journal.deletes[t.id] === undefined
                )
              : [];

            if (!hydratedTasks) {
              hydratedTasks = true;
              for (const lt of localOnlyToUpload) {
                if (!journal.upserts[lt.id]) {
                  journal.upserts[lt.id] = { task: lt, editedAt: Date.now() };
                  journalMutated = true;
                }
              }
              if (onlineNow && localOnlyToUpload.length > 0) {
                void Promise.allSettled(
                  localOnlyToUpload.map((lt) =>
                    upsertCloudTask(firebaseUid, lt).then(() => {
                      const entry = cloudTaskJournalRef.current.upserts[lt.id];
                      if (entry && fingerprintCloudTask(entry.task) === fingerprintCloudTask(lt)) {
                        delete cloudTaskJournalRef.current.upserts[lt.id];
                        saveCloudTaskJournal(cloudTaskJournalRef.current);
                      }
                      cloudTaskBaseByIdRef.current.set(lt.id, lt);
                      lastSyncedTasksFpRef.current.set(lt.id, fingerprintCloudTask(lt));
                    })
                  )
                );
              }
            }

            // 3. Silent 3-way offline-priority reconciliation for all incoming remote tasks
            const pendingTimers = pendingTaskCloudTimersRef.current;
            const inFlightIds = inFlightTaskCloudIdsRef.current;
            const currentLocalById = new Map(
              tasksRef.current.filter((t) => t.source !== 'google').map((t) => [t.id, t])
            );
            const nextFpMap = new Map<string, string>();
            const reconciledById = new Map<string, TaskItem>();

            for (const ct of cloudTasks) {
              if (journal.deletes[ct.id] !== undefined) {
                continue;
              }
              const ctFp = fingerprintCloudTask(ct);
              const dirtyEntry = journal.upserts[ct.id];
              const isProtected =
                Boolean(dirtyEntry) || pendingTimers.has(ct.id) || inFlightIds.has(ct.id);

              if (isProtected) {
                const localCandidate = currentLocalById.get(ct.id) ?? dirtyEntry?.task;
                if (localCandidate) {
                  const merged = mergeTaskItemOfflinePriority(
                    localCandidate,
                    ct,
                    dirtyEntry?.baseTask
                  );
                  const mergedFp = fingerprintCloudTask(merged);
                  reconciledById.set(ct.id, merged);

                  if (mergedFp === ctFp && !pendingTimers.has(ct.id) && !inFlightIds.has(ct.id)) {
                    // Remote has converged with offline edit -> clear journal entry cleanly
                    if (dirtyEntry) {
                      delete journal.upserts[ct.id];
                      journalMutated = true;
                    }
                    nextFpMap.set(ct.id, ctFp);
                  } else {
                    // Offline edit still ahead of remote -> keep prioritized in journal & trigger silent push
                    journal.upserts[ct.id] = {
                      task: merged,
                      baseTask: ct,
                      editedAt: dirtyEntry?.editedAt ?? Date.now(),
                    };
                    journalMutated = true;
                    // Leave fingerprint at ctFp (not mergedFp) so the diff-sync effect pushes merged silently
                    nextFpMap.set(ct.id, ctFp);
                  }
                  continue;
                }
              }

              reconciledById.set(ct.id, ct);
              nextFpMap.set(ct.id, ctFp);
            }

            // 4. Preserve offline-created OR offline-edited tasks missing from remote (e.g. deleted remotely while edited offline)
            const preservedOfflineExtras: TaskItem[] = [];
            const seenExtraIds = new Set<string>();
            for (const lt of tasksRef.current) {
              if (lt.source === 'google' || cloudIds.has(lt.id) || journal.deletes[lt.id] !== undefined) {
                continue;
              }
              const isKept =
                Boolean(journal.upserts[lt.id]) ||
                pendingTimers.has(lt.id) ||
                inFlightIds.has(lt.id);
              if (isKept) {
                preservedOfflineExtras.push(lt);
                seenExtraIds.add(lt.id);
              }
            }
            for (const [dirtyId, dirtyRec] of Object.entries(journal.upserts)) {
              if (
                !cloudIds.has(dirtyId) &&
                !seenExtraIds.has(dirtyId) &&
                journal.deletes[dirtyId] === undefined
              ) {
                preservedOfflineExtras.push(dirtyRec.task);
                seenExtraIds.add(dirtyId);
              }
            }

            if (journalMutated) {
              saveCloudTaskJournal(journal);
            }

            lastSyncedTasksFpRef.current = nextFpMap;
            cloudWorkspaceHydratedRef.current.tasks = true;

            setTasks(() => {
              const mergedCloud = cloudTasks
                .filter((ct) => journal.deletes[ct.id] === undefined)
                .map((ct) => reconciledById.get(ct.id) ?? ct);
              return [...preservedOfflineExtras, ...mergedCloud];
            });
          },
          (err) => {
            if (!cancelled) {
              setCloudNotesError(formatFriendlyCloudSyncError(err));
              setCloudNotesSyncing(false);
            }
          }
        );

        unsubEvents = subscribeCloudEvents(
          firebaseUid,
          (cloudEvents) => {
            if (cancelled) return;
            setCloudEventsSyncedCount(cloudEvents.length);
            setCloudNotesSyncing(false);
            setCloudNotesError(null);
            markCloudNotesSyncedNow();

            const cloudIds = new Set(cloudEvents.map((e) => e.id));
            const localOnlyToUpload = !hydratedEvents
              ? eventsRef.current.filter((e) => e.source !== 'google' && !cloudIds.has(e.id))
              : [];

            if (!hydratedEvents) {
              hydratedEvents = true;
              if (localOnlyToUpload.length > 0) {
                void Promise.allSettled(
                  localOnlyToUpload.map((e) => upsertCloudEvent(firebaseUid, e))
                );
              }
            }

            const nextFpMap = new Map<string, string>();
            for (const ce of cloudEvents) {
              nextFpMap.set(ce.id, fingerprintCloudEvent(ce));
            }
            for (const le of localOnlyToUpload) {
              nextFpMap.set(le.id, fingerprintCloudEvent(le));
            }
            for (const pendingId of pendingEventCloudTimersRef.current.keys()) {
              const existingLocal = eventsRef.current.find((e) => e.id === pendingId);
              if (existingLocal && existingLocal.source !== 'google') {
                nextFpMap.set(pendingId, fingerprintCloudEvent(existingLocal));
              }
            }
            lastSyncedEventsFpRef.current = nextFpMap;
            cloudWorkspaceHydratedRef.current.events = true;

            setEvents((prev) => {
              const pendingIds = pendingEventCloudTimersRef.current;
              const prevById = new Map(prev.map((e) => [e.id, e]));
              const mergedCloud = cloudEvents.map((ce) =>
                pendingIds.has(ce.id) && prevById.has(ce.id) ? prevById.get(ce.id)! : ce
              );
              const keepLocalIds = new Set(localOnlyToUpload.map((e) => e.id));
              const localExtra = prev.filter(
                (le) =>
                  le.source !== 'google' &&
                  !cloudIds.has(le.id) &&
                  (pendingIds.has(le.id) || keepLocalIds.has(le.id))
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
        unsubLookup = subscribeCloudLookupEntries(
          firebaseUid,
          (cloudEntries) => {
            if (cancelled) return;
            setCloudLookupSyncedCount(cloudEntries.length);
            setCloudNotesSyncing(false);
            setCloudNotesError(null);
            markCloudNotesSyncedNow();

            const cloudIds = new Set(cloudEntries.map((entry) => entry.id));
            const localOnlyToUpload = !hydratedLookup
              ? quickCheckEntriesRef.current.filter((entry) => !cloudIds.has(entry.id))
              : [];

            if (!hydratedLookup) {
              hydratedLookup = true;
              if (localOnlyToUpload.length > 0) {
                void Promise.allSettled(
                  localOnlyToUpload.map((entry) => upsertCloudLookupEntry(firebaseUid, entry))
                );
              }
            }

            const nextFpMap = new Map<string, string>();
            for (const ce of cloudEntries) {
              nextFpMap.set(ce.id, fingerprintCloudLookupEntry(ce));
            }
            for (const le of localOnlyToUpload) {
              nextFpMap.set(le.id, fingerprintCloudLookupEntry(le));
            }
            for (const pendingId of pendingLookupCloudTimersRef.current.keys()) {
              const existingLocal = quickCheckEntriesRef.current.find((e) => e.id === pendingId);
              if (existingLocal) {
                nextFpMap.set(pendingId, fingerprintCloudLookupEntry(existingLocal));
              }
            }
            lastSyncedLookupFpRef.current = nextFpMap;
            cloudWorkspaceHydratedRef.current.lookup = true;

            setQuickCheckEntries((prev) => {
              const pendingIds = pendingLookupCloudTimersRef.current;
              const prevById = new Map(prev.map((entry) => [entry.id, entry]));
              const mergedCloud = cloudEntries.map((ce) =>
                pendingIds.has(ce.id) && prevById.has(ce.id) ? prevById.get(ce.id)! : ce
              );
              const keepLocalIds = new Set(localOnlyToUpload.map((entry) => entry.id));
              const localExtra = prev.filter(
                (le) => !cloudIds.has(le.id) && (pendingIds.has(le.id) || keepLocalIds.has(le.id))
              );
              return [...mergedCloud, ...localExtra].slice(-30);
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
      unsubWorkspacePrefs?.();
      unsubNotes?.();
      unsubTasks?.();
      unsubEvents?.();
      unsubLookup?.();
      pendingNoteSaveTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
      pendingNoteSaveTimersRef.current.clear();
      pendingNoteSnapshotsRef.current.clear();
      pendingTaskCloudTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
      pendingTaskCloudTimersRef.current.clear();
      pendingTaskSnapshotsRef.current.clear();
      pendingEventCloudTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
      pendingEventCloudTimersRef.current.clear();
      pendingEventSnapshotsRef.current.clear();
      pendingLookupCloudTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
      pendingLookupCloudTimersRef.current.clear();
      pendingLookupSnapshotsRef.current.clear();
      if (pendingWorkspacePrefsTimerRef.current !== null) {
        window.clearTimeout(pendingWorkspacePrefsTimerRef.current);
        pendingWorkspacePrefsTimerRef.current = null;
      }
      pendingWorkspacePrefsPayloadRef.current = null;
      cloudWorkspaceHydratedRef.current = {
        tasks: false,
        events: false,
        prefs: false,
        lookup: false,
      };
    };
  }, [firebaseUid, firebaseEmailVerified, settings.buhCloudSync, markCloudNotesSyncedNow]);

  // Silent diff-based cloud sync for local tasks (with offline-priority journal & in-flight protection)
  useEffect(() => {
    const { uid, enabled } = cloudSyncReadyRef.current;
    if (!uid || !enabled || !cloudWorkspaceHydratedRef.current.tasks || !isOnline) return;

    const journal = cloudTaskJournalRef.current;
    const localTasks = tasks.filter((t) => t.source !== 'google');
    const currentIds = new Set<string>();
    const fpMap = lastSyncedTasksFpRef.current;

    // 1. Flush any persisted offline deletes first
    for (const deletedId of Object.keys(journal.deletes)) {
      if (localTasks.some((t) => t.id === deletedId)) continue;
      fpMap.delete(deletedId);
      void deleteCloudTask(uid, deletedId)
        .then(() => {
          if (cloudTaskJournalRef.current.deletes[deletedId] !== undefined) {
            delete cloudTaskJournalRef.current.deletes[deletedId];
            saveCloudTaskJournal(cloudTaskJournalRef.current);
          }
          cloudTaskBaseByIdRef.current.delete(deletedId);
          setCloudNotesError(null);
          markCloudNotesSyncedNow();
        })
        .catch((err) => {
          setCloudNotesError(formatFriendlyCloudSyncError(err));
        });
    }

    // 2. Push any changed or journaled offline tasks
    for (const task of localTasks) {
      currentIds.add(task.id);
      const nextFp = fingerprintCloudTask(task);
      const isJournaled = Boolean(journal.upserts[task.id]);
      if (fpMap.get(task.id) === nextFp && !isJournaled) continue;

      // Ensure journal captures this mutation until Firestore confirms it
      if (!isJournaled) {
        const baseTask = cloudTaskBaseByIdRef.current.get(task.id);
        journal.upserts[task.id] = {
          task,
          ...(baseTask ? { baseTask } : {}),
          editedAt: Date.now(),
        };
        saveCloudTaskJournal(journal);
      } else {
        journal.upserts[task.id] = {
          ...journal.upserts[task.id],
          task,
        };
      }
      fpMap.set(task.id, nextFp);

      const existingTimer = pendingTaskCloudTimersRef.current.get(task.id);
      if (existingTimer !== undefined) {
        window.clearTimeout(existingTimer);
      }
      const taskSnapshot = task;
      const writeVersion = localTaskEditVersionRef.current.get(task.id) ?? 0;
      pendingTaskSnapshotsRef.current.set(task.id, taskSnapshot);
      const timerId = window.setTimeout(() => {
        pendingTaskCloudTimersRef.current.delete(taskSnapshot.id);
        pendingTaskSnapshotsRef.current.delete(taskSnapshot.id);
        const latest = cloudSyncReadyRef.current;
        if (!latest.uid || !latest.enabled || (typeof navigator !== 'undefined' && !navigator.onLine)) {
          lastSyncedTasksFpRef.current.delete(taskSnapshot.id);
          return;
        }
        inFlightTaskCloudIdsRef.current.add(taskSnapshot.id);
        void upsertCloudTask(latest.uid, taskSnapshot)
          .then(() => {
            const currentVer = localTaskEditVersionRef.current.get(taskSnapshot.id) ?? 0;
            if (currentVer === writeVersion) {
              if (cloudTaskJournalRef.current.upserts[taskSnapshot.id]) {
                delete cloudTaskJournalRef.current.upserts[taskSnapshot.id];
                saveCloudTaskJournal(cloudTaskJournalRef.current);
              }
              cloudTaskBaseByIdRef.current.set(taskSnapshot.id, taskSnapshot);
              lastSyncedTasksFpRef.current.set(taskSnapshot.id, nextFp);
            }
            setCloudNotesError(null);
            markCloudNotesSyncedNow();
          })
          .catch((err) => {
            lastSyncedTasksFpRef.current.delete(taskSnapshot.id);
            setCloudNotesError(formatFriendlyCloudSyncError(err));
          })
          .finally(() => {
            inFlightTaskCloudIdsRef.current.delete(taskSnapshot.id);
          });
      }, isJournaled ? 120 : 400);
      pendingTaskCloudTimersRef.current.set(task.id, timerId);
    }

    // 3. Delete any previously synced tasks removed from local state
    for (const prevId of Array.from(fpMap.keys())) {
      if (!currentIds.has(prevId)) {
        fpMap.delete(prevId);
        const existingTimer = pendingTaskCloudTimersRef.current.get(prevId);
        if (existingTimer !== undefined) {
          window.clearTimeout(existingTimer);
          pendingTaskCloudTimersRef.current.delete(prevId);
        }
        pendingTaskSnapshotsRef.current.delete(prevId);
        if (journal.deletes[prevId] === undefined) {
          journal.deletes[prevId] = Date.now();
          delete journal.upserts[prevId];
          saveCloudTaskJournal(journal);
        }
        void deleteCloudTask(uid, prevId)
          .then(() => {
            if (cloudTaskJournalRef.current.deletes[prevId] !== undefined) {
              delete cloudTaskJournalRef.current.deletes[prevId];
              saveCloudTaskJournal(cloudTaskJournalRef.current);
            }
            cloudTaskBaseByIdRef.current.delete(prevId);
            setCloudNotesError(null);
            markCloudNotesSyncedNow();
          })
          .catch((err) => {
            setCloudNotesError(formatFriendlyCloudSyncError(err));
          });
      }
    }
  }, [tasks, firebaseUid, firebaseEmailVerified, settings.buhCloudSync, isOnline, markCloudNotesSyncedNow]);

  // Silent diff-based cloud sync for local schedule blocks
  useEffect(() => {
    const { uid, enabled } = cloudSyncReadyRef.current;
    if (!uid || !enabled || !cloudWorkspaceHydratedRef.current.events || !isOnline) return;

    const localEvents = events.filter((e) => e.source !== 'google');
    const currentIds = new Set<string>();
    const fpMap = lastSyncedEventsFpRef.current;

    for (const ev of localEvents) {
      currentIds.add(ev.id);
      const nextFp = fingerprintCloudEvent(ev);
      if (fpMap.get(ev.id) === nextFp) continue;
      fpMap.set(ev.id, nextFp);

      const existingTimer = pendingEventCloudTimersRef.current.get(ev.id);
      if (existingTimer !== undefined) {
        window.clearTimeout(existingTimer);
      }
      const evSnapshot = ev;
      pendingEventSnapshotsRef.current.set(ev.id, evSnapshot);
      const timerId = window.setTimeout(() => {
        pendingEventCloudTimersRef.current.delete(evSnapshot.id);
        pendingEventSnapshotsRef.current.delete(evSnapshot.id);
        const latest = cloudSyncReadyRef.current;
        if (!latest.uid || !latest.enabled || (typeof navigator !== 'undefined' && !navigator.onLine)) {
          lastSyncedEventsFpRef.current.delete(evSnapshot.id);
          return;
        }
        void upsertCloudEvent(latest.uid, evSnapshot)
          .then(() => {
            setCloudNotesError(null);
            markCloudNotesSyncedNow();
          })
          .catch((err) => {
            lastSyncedEventsFpRef.current.delete(evSnapshot.id);
            setCloudNotesError(formatFriendlyCloudSyncError(err));
          });
      }, 400);
      pendingEventCloudTimersRef.current.set(ev.id, timerId);
    }

    for (const prevId of Array.from(fpMap.keys())) {
      if (!currentIds.has(prevId)) {
        fpMap.delete(prevId);
        const existingTimer = pendingEventCloudTimersRef.current.get(prevId);
        if (existingTimer !== undefined) {
          window.clearTimeout(existingTimer);
          pendingEventCloudTimersRef.current.delete(prevId);
        }
        pendingEventSnapshotsRef.current.delete(prevId);
        void deleteCloudEvent(uid, prevId)
          .then(() => {
            setCloudNotesError(null);
            markCloudNotesSyncedNow();
          })
          .catch((err) => {
            setCloudNotesError(formatFriendlyCloudSyncError(err));
          });
      }
    }
  }, [events, firebaseUid, firebaseEmailVerified, settings.buhCloudSync, isOnline, markCloudNotesSyncedNow]);

  // Silent diff-based cloud sync for Lookup Q&A history
  useEffect(() => {
    const { uid, enabled } = cloudSyncReadyRef.current;
    if (!uid || !enabled || !cloudWorkspaceHydratedRef.current.lookup || !isOnline) return;

    const currentIds = new Set<string>();
    const fpMap = lastSyncedLookupFpRef.current;

    for (const entry of quickCheckEntries) {
      currentIds.add(entry.id);
      const nextFp = fingerprintCloudLookupEntry(entry);
      if (fpMap.get(entry.id) === nextFp) continue;
      fpMap.set(entry.id, nextFp);

      const existingTimer = pendingLookupCloudTimersRef.current.get(entry.id);
      if (existingTimer !== undefined) {
        window.clearTimeout(existingTimer);
      }
      const entrySnapshot = entry;
      pendingLookupSnapshotsRef.current.set(entry.id, entrySnapshot);
      const timerId = window.setTimeout(() => {
        pendingLookupCloudTimersRef.current.delete(entrySnapshot.id);
        pendingLookupSnapshotsRef.current.delete(entrySnapshot.id);
        const latest = cloudSyncReadyRef.current;
        if (!latest.uid || !latest.enabled || (typeof navigator !== 'undefined' && !navigator.onLine)) {
          lastSyncedLookupFpRef.current.delete(entrySnapshot.id);
          return;
        }
        void upsertCloudLookupEntry(latest.uid, entrySnapshot)
          .then(() => {
            setCloudNotesError(null);
            markCloudNotesSyncedNow();
          })
          .catch((err) => {
            lastSyncedLookupFpRef.current.delete(entrySnapshot.id);
            setCloudNotesError(formatFriendlyCloudSyncError(err));
          });
      }, 400);
      pendingLookupCloudTimersRef.current.set(entry.id, timerId);
    }

    for (const prevId of Array.from(fpMap.keys())) {
      if (!currentIds.has(prevId)) {
        fpMap.delete(prevId);
        const existingTimer = pendingLookupCloudTimersRef.current.get(prevId);
        if (existingTimer !== undefined) {
          window.clearTimeout(existingTimer);
          pendingLookupCloudTimersRef.current.delete(prevId);
        }
        pendingLookupSnapshotsRef.current.delete(prevId);
        void deleteCloudLookupEntry(uid, prevId)
          .then(() => {
            setCloudNotesError(null);
            markCloudNotesSyncedNow();
          })
          .catch((err) => {
            setCloudNotesError(formatFriendlyCloudSyncError(err));
          });
      }
    }
  }, [
    quickCheckEntries,
    firebaseUid,
    firebaseEmailVerified,
    settings.buhCloudSync,
    isOnline,
    markCloudNotesSyncedNow,
  ]);

  // Silent diff-based cloud sync for task lists, app settings, visual decisions & dark mode
  useEffect(() => {
    const { uid, enabled } = cloudSyncReadyRef.current;
    if (!uid || !enabled || !cloudWorkspaceHydratedRef.current.prefs || !isOnline) return;

    const payload = {
      taskLists,
      settings,
      decisions,
      recentColors,
      darkMode: isDark,
    };
    const nextFp = fingerprintWorkspacePreferences(payload);
    if (lastSyncedWorkspacePrefsFpRef.current === nextFp) return;
    lastSyncedWorkspacePrefsFpRef.current = nextFp;

    if (pendingWorkspacePrefsTimerRef.current !== null) {
      window.clearTimeout(pendingWorkspacePrefsTimerRef.current);
    }
    pendingWorkspacePrefsPayloadRef.current = payload;
    pendingWorkspacePrefsTimerRef.current = window.setTimeout(() => {
      pendingWorkspacePrefsTimerRef.current = null;
      const latestPayload = pendingWorkspacePrefsPayloadRef.current || payload;
      pendingWorkspacePrefsPayloadRef.current = null;
      const latest = cloudSyncReadyRef.current;
      if (!latest.uid || !latest.enabled || (typeof navigator !== 'undefined' && !navigator.onLine)) {
        lastSyncedWorkspacePrefsFpRef.current = null;
        return;
      }
      void saveCloudWorkspacePreferences(latest.uid, latestPayload)
        .then(() => {
          setCloudNotesError(null);
          markCloudNotesSyncedNow();
        })
        .catch((err) => {
          lastSyncedWorkspacePrefsFpRef.current = null;
          setCloudNotesError(formatFriendlyCloudSyncError(err));
        });
    }, 450);
  }, [
    taskLists,
    settings,
    decisions,
    recentColors,
    isDark,
    firebaseUid,
    firebaseEmailVerified,
    isOnline,
    markCloudNotesSyncedNow,
  ]);

  // Flush any debounced buh. Cloud writes immediately before tab hide / app switch / close
  useEffect(() => {
    const flushPendingCloudWrites = () => {
      const { uid, enabled } = cloudSyncReadyRef.current;
      if (!uid || !enabled) return;

      const fallbackFolder = noteFoldersRef.current[0] || 'Work';
      pendingNoteSaveTimersRef.current.forEach((timerId, noteId) => {
        window.clearTimeout(timerId);
        const snap = pendingNoteSnapshotsRef.current.get(noteId);
        if (snap && isNoteNonEmpty(snap)) {
          void upsertCloudNote(uid, snap, fallbackFolder).catch(() => {});
        }
      });
      pendingNoteSaveTimersRef.current.clear();
      pendingNoteSnapshotsRef.current.clear();

      pendingTaskCloudTimersRef.current.forEach((timerId, taskId) => {
        window.clearTimeout(timerId);
        const snap = pendingTaskSnapshotsRef.current.get(taskId);
        if (snap) {
          const writeVersion = localTaskEditVersionRef.current.get(taskId) ?? 0;
          inFlightTaskCloudIdsRef.current.add(taskId);
          void upsertCloudTask(uid, snap)
            .then(() => {
              if ((localTaskEditVersionRef.current.get(taskId) ?? 0) === writeVersion) {
                if (cloudTaskJournalRef.current.upserts[taskId]) {
                  delete cloudTaskJournalRef.current.upserts[taskId];
                  saveCloudTaskJournal(cloudTaskJournalRef.current);
                }
                cloudTaskBaseByIdRef.current.set(taskId, snap);
              }
            })
            .catch(() => {
              lastSyncedTasksFpRef.current.delete(taskId);
            })
            .finally(() => {
              inFlightTaskCloudIdsRef.current.delete(taskId);
            });
        }
      });
      pendingTaskCloudTimersRef.current.clear();
      pendingTaskSnapshotsRef.current.clear();

      pendingEventCloudTimersRef.current.forEach((timerId, eventId) => {
        window.clearTimeout(timerId);
        const snap = pendingEventSnapshotsRef.current.get(eventId);
        if (snap) {
          void upsertCloudEvent(uid, snap).catch(() => {
            lastSyncedEventsFpRef.current.delete(eventId);
          });
        }
      });
      pendingEventCloudTimersRef.current.clear();
      pendingEventSnapshotsRef.current.clear();

      pendingLookupCloudTimersRef.current.forEach((timerId, entryId) => {
        window.clearTimeout(timerId);
        const snap = pendingLookupSnapshotsRef.current.get(entryId);
        if (snap) {
          void upsertCloudLookupEntry(uid, snap).catch(() => {
            lastSyncedLookupFpRef.current.delete(entryId);
          });
        }
      });
      pendingLookupCloudTimersRef.current.clear();
      pendingLookupSnapshotsRef.current.clear();

      if (pendingWorkspacePrefsTimerRef.current !== null) {
        window.clearTimeout(pendingWorkspacePrefsTimerRef.current);
        pendingWorkspacePrefsTimerRef.current = null;
        const prefsPayload = pendingWorkspacePrefsPayloadRef.current;
        pendingWorkspacePrefsPayloadRef.current = null;
        if (prefsPayload) {
          void saveCloudWorkspacePreferences(uid, prefsPayload).catch(() => {
            lastSyncedWorkspacePrefsFpRef.current = null;
          });
        }
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flushPendingCloudWrites();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', flushPendingCloudWrites);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', flushPendingCloudWrites);
    };
  }, []);

  const handleSyncCloudNotesNow = useCallback(async () => {
    if (!firebaseUid || !firebaseEmailVerified) return;
    if (settings.buhCloudSync === false) return;
    setCloudNotesSyncing(true);
    setCloudNotesError(null);
    try {
      await ensureUserWorkspace(firebaseUid);
      await Promise.all([
        saveCloudNotePreferences(
          firebaseUid,
          noteFoldersRef.current,
          collapsedNoteFoldersRef.current
        ),
        saveCloudWorkspacePreferences(firebaseUid, {
          taskLists: taskListsRef.current,
          settings: settingsRef.current,
          decisions: decisionsRef.current,
          recentColors: recentColorsRef.current,
          darkMode: isDarkRef.current,
        }),
      ]);
      const fallbackFolder = noteFoldersRef.current[0] || 'Work';
      const localNotesToPush = notesRef.current.filter(isNoteNonEmpty);
      const localTasksToPush = tasksRef.current.filter((t) => t.source !== 'google');
      const localEventsToPush = eventsRef.current.filter((e) => e.source !== 'google');
      const localLookupToPush = quickCheckEntriesRef.current;
      const pendingTaskDeleteIds = Object.keys(cloudTaskJournalRef.current.deletes).filter(
        (id) => !localTasksToPush.some((t) => t.id === id)
      );
      await Promise.all([
        ...localNotesToPush.map((n) => upsertCloudNote(firebaseUid, n, fallbackFolder)),
        ...localTasksToPush.map((t) => upsertCloudTask(firebaseUid, t)),
        ...pendingTaskDeleteIds.map((id) => deleteCloudTask(firebaseUid, id)),
        ...localEventsToPush.map((e) => upsertCloudEvent(firebaseUid, e)),
        ...localLookupToPush.map((entry) => upsertCloudLookupEntry(firebaseUid, entry)),
      ]);
      for (const t of localTasksToPush) {
        delete cloudTaskJournalRef.current.upserts[t.id];
        cloudTaskBaseByIdRef.current.set(t.id, t);
        lastSyncedTasksFpRef.current.set(t.id, fingerprintCloudTask(t));
      }
      for (const id of pendingTaskDeleteIds) {
        delete cloudTaskJournalRef.current.deletes[id];
        cloudTaskBaseByIdRef.current.delete(id);
        lastSyncedTasksFpRef.current.delete(id);
      }
      saveCloudTaskJournal(cloudTaskJournalRef.current);
      const [remoteNotes, remoteTasks, remoteEvents, remoteLookups] = await Promise.all([
        fetchAllCloudNotesOnce(firebaseUid),
        fetchAllCloudTasksOnce(firebaseUid),
        fetchAllCloudEventsOnce(firebaseUid),
        fetchAllCloudLookupEntriesOnce(firebaseUid),
      ]);
      setCloudNotesSyncedCount(remoteNotes.length);
      setCloudTasksSyncedCount(remoteTasks.length);
      setCloudEventsSyncedCount(remoteEvents.length);
      setCloudLookupSyncedCount(remoteLookups.length);
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

  // Periodically & on foreground resume pull new Google Tasks (e.g. created in Google Tasks app)
  // so their reminders trigger automatically in buh. without requiring manual sync
  const lastAutoGoogleSyncAtRef = useRef<number>(0);
  useEffect(() => {
    if (!isOnline || !googleConnected) return;
    if (!settings.googleTasksSync && !settings.googleCalendarSync) return;

    const triggerQuietRefresh = (minGapMs: number) => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      if (typeof navigator !== 'undefined' && !navigator.onLine) return;
      if (!isCalendarAccessTokenFresh()) {
        setGoogleConnected(false);
        return;
      }
      const now = Date.now();
      if (now - lastAutoGoogleSyncAtRef.current < minGapMs) return;
      lastAutoGoogleSyncAtRef.current = now;
      if (pendingSyncQueueRef.current.length > 0) {
        void flushPendingSyncQueue();
        return;
      }
      const jobs: Promise<unknown>[] = [];
      if (settingsRef.current.googleTasksSync) {
        jobs.push(syncGoogleTasksList());
      }
      if (settingsRef.current.googleCalendarSync) {
        jobs.push(syncGoogleCalendarEvents());
      }
      if (jobs.length > 0) {
        void Promise.allSettled(jobs);
      }
    };

    const handleResume = () => triggerQuietRefresh(45_000);
    window.addEventListener('focus', handleResume);
    document.addEventListener('visibilitychange', handleResume);
    const intervalId = window.setInterval(() => triggerQuietRefresh(150_000), 60_000);

    return () => {
      window.removeEventListener('focus', handleResume);
      document.removeEventListener('visibilitychange', handleResume);
      window.clearInterval(intervalId);
    };
  }, [
    isOnline,
    googleConnected,
    settings.googleTasksSync,
    settings.googleCalendarSync,
    flushPendingSyncQueue,
    syncGoogleCalendarEvents,
    syncGoogleTasksList,
  ]);

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
      setGoogleReconnectDismissed(false);
      setGoogleUserEmail(user.email || user.displayName || 'Google Account');
      setSettings((s) => ({ ...s, googleCalendarSync: true, googleTasksSync: true }));
      const flushed = await flushPendingSyncQueue(accessToken);
      if (flushed === 0) {
        await Promise.allSettled([
          syncGoogleCalendarEvents(accessToken),
          syncGoogleTasksList(accessToken),
        ]);
        showOfflineSyncNotice('Google Calendar & Tasks synced');
      }
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code === 'auth/popup-blocked') {
        const msg = 'Browser blocked the sign-in window — tap Sync once more to reconnect.';
        setGoogleError(msg);
        setGoogleTasksError(msg);
      } else if (code !== 'auth/popup-closed-by-user' && code !== 'auth/cancelled-popup-request') {
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
    showOfflineSyncNotice,
  ]);

  const handleSyncGoogleCalendarOrReconnect = useCallback(async () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    if (!googleConnectedRef.current || !isCalendarAccessTokenFresh()) {
      await handleGoogleSignIn();
      return;
    }
    await syncGoogleCalendarEvents();
  }, [handleGoogleSignIn, syncGoogleCalendarEvents]);

  const handleSyncGoogleTasksOrReconnect = useCallback(async () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    if (!googleConnectedRef.current || !isCalendarAccessTokenFresh()) {
      await handleGoogleSignIn();
      return;
    }
    await syncGoogleTasksList();
  }, [handleGoogleSignIn, syncGoogleTasksList]);

  const handleTriggerPendingSync = useCallback(() => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    if (googleConnectedRef.current && isCalendarAccessTokenFresh()) {
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
      setGoogleReconnectDismissed(false);
      setGoogleUserEmail(null);
      setGoogleEvents([]);
      setGoogleLastSyncedAt(null);
      setGoogleTasks([]);
      setGoogleTaskLists([]);
      setGoogleTasksLastSyncedAt(null);
      setDirtyGoogleTaskIds([]);
      setPendingSyncQueue([]);
      googleTaskBaseByIdRef.current.clear();
      clearOfflineGoogleCache();
      cloudTaskJournalRef.current = { upserts: {}, deletes: {} };
      clearCloudTaskJournal();
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
      recurrence?: RecurrenceRule;
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
          recurrence: input.recurrence,
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
        const createdWithRule: CalendarEvent = {
          ...created,
          recurrence: created.recurrence ?? input.recurrence,
        };
        setGoogleEvents((prev) => [...prev, createdWithRule]);
        setGoogleLastSyncedAt(formatClockDate(new Date()));
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
      recurrence?: RecurrenceRule;
      recurrenceSeriesId?: string;
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
        const isInbox = !input.dateKey && !input.recurrence;
        const dateKey = input.dateKey || (input.recurrence ? getTodayDateKey() : '');
        const offlineGoogleTaskId = `offline-${stamp}`;
        const optimistic: TaskItem = {
          id: tempId,
          title: input.title,
          timeLabel: input.timeLabel || 'No time set',
          dateKey,
          category: targetListTitle,
          priority: input.priority || 'Normal',
          completed: false,
          isInbox,
          notes: input.notes || '',
          subtasks: [],
          reminders: buildDefaultGoogleTaskReminders({
            id: tempId,
            googleTaskId: offlineGoogleTaskId,
            completed: false,
            isInbox,
            dateKey,
            recurrence: input.recurrence,
            reminders: input.reminders,
          }),
          recurrence: input.recurrence,
          recurrenceSeriesId: input.recurrenceSeriesId,
          source: 'google',
          googleTaskId: offlineGoogleTaskId,
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
          recurrence: input.recurrence,
          reminders: input.reminders,
        });

        const withMeta: TaskItem = {
          ...created,
          ...(input.reminders && input.reminders.length > 0 ? { reminders: input.reminders } : {}),
          ...(input.recurrence ? { recurrence: input.recurrence } : {}),
          ...(input.recurrenceSeriesId ? { recurrenceSeriesId: input.recurrenceSeriesId } : {}),
        };

        setGoogleTasks((prev) => [withMeta, ...prev]);
        setGoogleTasksLastSyncedAt(formatClockDate(new Date()));
        return withMeta.id;
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

  const handleUpdateGoogleTask = useCallback(async (task: TaskItem, expectedVersion?: number) => {
    setGoogleTasksError(null);

    const existingPending = pendingGoogleTaskAutoSyncRef.current.get(task.id);
    if (existingPending) {
      window.clearTimeout(existingPending.timerId);
      pendingGoogleTaskAutoSyncRef.current.delete(task.id);
    }

    const syncVersion = expectedVersion ?? (googleTaskEditVersionRef.current.get(task.id) ?? 0);

    const queueOfflineUpdate = () => {
      const baseTask = googleTaskBaseByIdRef.current.get(task.id);
      setGoogleTasks((prev) => prev.map((t) => (t.id === task.id ? task : t)));
      setDirtyGoogleTaskIds((prev) => (prev.includes(task.id) ? prev : [...prev, task.id]));
      setPendingSyncQueue((prev) =>
        enqueueSyncOp(prev, {
          id: makeSyncOpId(),
          type: 'gtask-update',
          taskId: task.id,
          task,
          ...(baseTask ? { baseTask } : {}),
          createdAt: Date.now(),
        })
      );
    };

    if (
      (typeof navigator !== 'undefined' && !navigator.onLine) ||
      !googleConnectedRef.current ||
      !isCalendarAccessTokenFresh() ||
      task.googleTaskId?.startsWith('offline-')
    ) {
      if (googleConnectedRef.current && !isCalendarAccessTokenFresh()) {
        setGoogleConnected(false);
      }
      queueOfflineUpdate();
      return;
    }

    inFlightGoogleTaskSyncIdsRef.current.add(task.id);
    try {
      let updated: TaskItem;
      try {
        updated = await updateGoogleTask(task);
      } catch (updateErr: unknown) {
        if (updateErr instanceof Error && updateErr.message === 'TASK_NOT_FOUND') {
          const recreated = await createGoogleTask({
            title: task.title,
            notes: task.notes,
            dateKey: task.isInbox ? undefined : task.dateKey,
            timeLabel: task.timeLabel,
            priority: task.priority,
            taskListId: task.googleTaskListId || '@default',
            taskListTitle: task.googleTaskListTitle || task.category || 'My Tasks',
            recurrence: task.recurrence,
            reminders: task.reminders,
          });
          updated = task.completed
            ? await updateGoogleTask({
                ...recreated,
                completed: true,
                completedAt: task.completedAt || new Date().toISOString(),
              })
            : recreated;
        } else {
          throw updateErr;
        }
      }
      const syncedTask: TaskItem = {
        ...updated,
        reminders: task.reminders,
        recurrence: task.recurrence,
        recurrenceSeriesId: task.recurrenceSeriesId,
      };
      googleTaskBaseByIdRef.current.set(syncedTask.id, syncedTask);
      const latestVersion = googleTaskEditVersionRef.current.get(task.id) ?? 0;
      if (latestVersion === syncVersion) {
        setGoogleTasks((prev) =>
          prev.map((t) => (t.id === task.id ? syncedTask : t))
        );
        setDirtyGoogleTaskIds((prev) =>
          prev.filter((id) => id !== task.id && id !== syncedTask.id)
        );
      }
      setGoogleTasksLastSyncedAt(formatClockDate(new Date()));
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
      setDirtyGoogleTaskIds((prev) => (prev.includes(task.id) ? prev : [...prev, task.id]));
      setGoogleTasksError(msg);
      throw err;
    } finally {
      inFlightGoogleTaskSyncIdsRef.current.delete(task.id);
    }
  }, []);

  // Flush any pending debounced Google Task auto-syncs when leaving/hiding the app
  useEffect(() => {
    const flushPendingGoogleTaskAutoSyncs = () => {
      const entries = Array.from(pendingGoogleTaskAutoSyncRef.current.values());
      if (entries.length === 0) return;
      pendingGoogleTaskAutoSyncRef.current.clear();
      for (const entry of entries) {
        window.clearTimeout(entry.timerId);
        void handleUpdateGoogleTask(entry.task, entry.version).catch(() => {
          // Error already recorded in googleTasksError & dirtyGoogleTaskIds
        });
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flushPendingGoogleTaskAutoSyncs();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', flushPendingGoogleTaskAutoSyncs);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', flushPendingGoogleTaskAutoSyncs);
      for (const entry of pendingGoogleTaskAutoSyncRef.current.values()) {
        window.clearTimeout(entry.timerId);
      }
      pendingGoogleTaskAutoSyncRef.current.clear();
    };
  }, [handleUpdateGoogleTask]);

  const handleToggleGoogleTask = useCallback(
    async (task: TaskItem) => {
      setGoogleTasksError(null);

      // Cancel any stale debounced edit timer so it cannot undo this toggle
      const existingPending = pendingGoogleTaskAutoSyncRef.current.get(task.id);
      if (existingPending) {
        window.clearTimeout(existingPending.timerId);
        pendingGoogleTaskAutoSyncRef.current.delete(task.id);
      }
      const toggleVersion = (googleTaskEditVersionRef.current.get(task.id) ?? 0) + 1;
      googleTaskEditVersionRef.current.set(task.id, toggleVersion);

      const nextCompleted = !task.completed;
      const toggled: TaskItem = {
        ...task,
        completed: nextCompleted,
        completedAt: nextCompleted ? new Date().toISOString() : undefined,
      };
      const maybeSpawnNextGoogleOccurrence = () => {
        if (!nextCompleted || !task.recurrence) return;
        const nextOcc = buildNextRecurringTaskInstance(task);
        if (!nextOcc) return;
        const seriesId = nextOcc.recurrenceSeriesId;
        const alreadyExists = googleTasksRef.current.some(
          (t) =>
            !t.completed &&
            t.dateKey === nextOcc.dateKey &&
            ((seriesId && (t.recurrenceSeriesId === seriesId || t.id === seriesId)) ||
              (t.title.trim().toLowerCase() === nextOcc.title.trim().toLowerCase() &&
                t.category === nextOcc.category))
        );
        if (alreadyExists) return;
        void handleCreateGoogleTask({
          title: nextOcc.title,
          notes: nextOcc.notes,
          dateKey: nextOcc.dateKey,
          timeLabel: nextOcc.timeLabel,
          priority: nextOcc.priority,
          taskListId: task.googleTaskListId,
          category: task.googleTaskListTitle || task.category,
          reminders: nextOcc.reminders,
          recurrence: nextOcc.recurrence,
          recurrenceSeriesId: nextOcc.recurrenceSeriesId,
        });
        const label = formatRelativeTaskDate(nextOcc.dateKey, {
          includeMonthDayForRelative: true,
        }).label;
        showOfflineSyncNotice(`Next "${nextOcc.title}" scheduled for ${label}`);
      };

      const queueOfflineToggle = () => {
        const baseTask = googleTaskBaseByIdRef.current.get(task.id) ?? task;
        setGoogleTasks((prev) => prev.map((t) => (t.id === task.id ? toggled : t)));
        setDirtyGoogleTaskIds((prev) => (prev.includes(task.id) ? prev : [...prev, task.id]));
        setPendingSyncQueue((prev) =>
          enqueueSyncOp(prev, {
            id: makeSyncOpId(),
            type: 'gtask-update',
            taskId: task.id,
            task: toggled,
            baseTask,
            createdAt: Date.now(),
          })
        );
        maybeSpawnNextGoogleOccurrence();
      };

      if (
        (typeof navigator !== 'undefined' && !navigator.onLine) ||
        !googleConnectedRef.current ||
        !isCalendarAccessTokenFresh() ||
        task.googleTaskId?.startsWith('offline-')
      ) {
        if (googleConnectedRef.current && !isCalendarAccessTokenFresh()) {
          setGoogleConnected(false);
        }
        queueOfflineToggle();
        return;
      }

      // Optimistically update immediately for instant UI responsiveness
      setGoogleTasks((prev) => prev.map((t) => (t.id === task.id ? toggled : t)));
      inFlightGoogleTaskSyncIdsRef.current.add(task.id);
      try {
        const updated = await updateGoogleTask(toggled);
        const syncedTask: TaskItem = {
          ...updated,
          reminders: toggled.reminders,
          recurrence: toggled.recurrence,
          recurrenceSeriesId: toggled.recurrenceSeriesId,
        };
        googleTaskBaseByIdRef.current.set(syncedTask.id, syncedTask);
        if ((googleTaskEditVersionRef.current.get(task.id) ?? 0) === toggleVersion) {
          setGoogleTasks((prev) => prev.map((t) => (t.id === task.id ? syncedTask : t)));
          setDirtyGoogleTaskIds((prev) => prev.filter((id) => id !== task.id));
        }
        setGoogleTasksLastSyncedAt(formatClockDate(new Date()));
        maybeSpawnNextGoogleOccurrence();
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
      } finally {
        inFlightGoogleTaskSyncIdsRef.current.delete(task.id);
      }
    },
    [handleCreateGoogleTask, showOfflineSyncNotice]
  );

  const handleDeleteGoogleTask = useCallback(async (task: TaskItem) => {
    setGoogleTasksError(null);
    const existingPending = pendingGoogleTaskAutoSyncRef.current.get(task.id);
    if (existingPending) {
      window.clearTimeout(existingPending.timerId);
      pendingGoogleTaskAutoSyncRef.current.delete(task.id);
    }
    googleTaskEditVersionRef.current.set(
      task.id,
      (googleTaskEditVersionRef.current.get(task.id) ?? 0) + 1
    );

    const queueOfflineDelete = () => {
      setGoogleTasks((prev) => prev.filter((t) => t.id !== task.id));
      setDirtyGoogleTaskIds((prev) => prev.filter((id) => id !== task.id));
      googleTaskBaseByIdRef.current.delete(task.id);
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
      !isCalendarAccessTokenFresh() ||
      task.googleTaskId?.startsWith('offline-')
    ) {
      if (googleConnectedRef.current && !isCalendarAccessTokenFresh()) {
        setGoogleConnected(false);
      }
      queueOfflineDelete();
      return;
    }

    try {
      if (!task.googleTaskId) return;
      await deleteGoogleTask(task.googleTaskListId || '@default', task.googleTaskId);
      setGoogleTasks((prev) => prev.filter((t) => t.id !== task.id));
      setDirtyGoogleTaskIds((prev) => prev.filter((id) => id !== task.id));
      googleTaskBaseByIdRef.current.delete(task.id);
      setGoogleTasksLastSyncedAt(formatClockDate(new Date()));
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
    return [...merged].sort(compareEventsAscending);
  }, [events, googleEvents, settings.googleCalendarSync]);

  // Show cached Google Tasks even while offline or awaiting reconnect,
  // and filter older completed tasks by the configured years/months history window.
  const { visibleTasks, hiddenCompletedTasksCount } = useMemo(() => {
    const merged =
      settings.googleTasksSync && googleTasks.length > 0 ? [...tasks, ...googleTasks] : tasks;

    const years = Math.max(0, Math.floor(settings.completedTaskHistoryYears ?? 0));
    const months = Math.max(0, Math.floor(settings.completedTaskHistoryMonths ?? 0));
    if (years === 0 && months === 0) {
      return {
        visibleTasks: [...merged].sort(compareTasksAscending),
        hiddenCompletedTasksCount: 0,
      };
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

    filtered.sort(compareTasksAscending);
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
      onSyncNow: handleSyncGoogleCalendarOrReconnect,
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
      handleSyncGoogleCalendarOrReconnect,
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
      onSyncNow: handleSyncGoogleTasksOrReconnect,
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
      handleSyncGoogleTasksOrReconnect,
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
      syncedTasksCount: cloudTasksSyncedCount,
      syncedEventsCount: cloudEventsSyncedCount,
      syncedLookupCount: cloudLookupSyncedCount,
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
      cloudTasksSyncedCount,
      cloudEventsSyncedCount,
      cloudLookupSyncedCount,
      cloudNotesError,
      handleSyncCloudNotesNow,
    ]
  );

  const hasLinkedGoogleSync =
    Boolean(googleUserEmail) &&
    (settings.googleCalendarSync || settings.googleTasksSync);
  const hasCachedGoogleData =
    googleEvents.length > 0 ||
    googleTasks.length > 0 ||
    Boolean(googleLastSyncedAt) ||
    Boolean(googleTasksLastSyncedAt);
  const showQuietGoogleRefresh =
    hasLinkedGoogleSync &&
    !googleConnected &&
    !googleReconnectDismissed &&
    hasCachedGoogleData;
  const isRefreshingGoogleBanner =
    googleSigningIn ||
    ((googleSyncing || googleTasksSyncing) && pendingSyncQueue.length === 0 && !googleConnected);

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

  const pendingPersistPayloadRef = useRef<PersistedReviewState | null>(null);
  const persistDirtyRef = useRef(false);
  const persistTimerRef = useRef<number | null>(null);

  const flushPersistedReviewState = useCallback(() => {
    if (persistTimerRef.current !== null) {
      window.clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
    }
    if (!persistDirtyRef.current || !pendingPersistPayloadRef.current) return;
    persistDirtyRef.current = false;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(pendingPersistPayloadRef.current));
    } catch {
      // Ignore storage quota issues
    }
  }, []);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        flushPersistedReviewState();
      }
    };
    window.addEventListener('pagehide', flushPersistedReviewState);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('pagehide', flushPersistedReviewState);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      flushPersistedReviewState();
    };
  }, [flushPersistedReviewState]);

  useEffect(() => {
    pendingPersistPayloadRef.current = {
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
    persistDirtyRef.current = true;

    if (persistTimerRef.current !== null) {
      window.clearTimeout(persistTimerRef.current);
    }
    persistTimerRef.current = window.setTimeout(() => {
      flushPersistedReviewState();
    }, 250);
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
    flushPersistedReviewState,
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

  const googleTasksRef = useRef<TaskItem[]>(googleTasks);
  useEffect(() => {
    googleTasksRef.current = googleTasks;
  }, [googleTasks]);

  const checkDueReminders = useCallback(() => {
    if (!swActionsHydratedRef.current || swWakePendingRef.current) return;
    if (!settingsRef.current.taskRemindersEnabled) return;
    const now = Date.now();
    const todayDateKey = getTodayDateKey();
    const CATCH_UP_WINDOW_MS = 60 * 60_000;
    const SAME_DAY_GOOGLE_CATCH_UP_MS = 16 * 60 * 60_000;

    const scanList = (list: TaskItem[]) => {
      const firedByTask = new Map<string, Set<string>>();
      const triggered: { task: TaskItem; reminder: TaskReminder; triggerMs: number }[] = [];

      for (const task of list) {
        if (task.completed || !task.reminders || task.reminders.length === 0) continue;
        for (const rem of task.reminders) {
          if (rem.firedAt) continue;
          const pairKey = `${task.id}:${rem.id}`;
          if (dispatchedReminderKeysRef.current.has(pairKey)) continue;
          const triggerMs = computeReminderTriggerMs(task, rem);
          if (triggerMs === null) continue;
          const timedKey = `${task.id}:${rem.id}:${Math.round(triggerMs / 1000)}`;
          if (dispatchedReminderKeysRef.current.has(timedKey)) continue;

          // Date-only Google Tasks created externally after 9:00 AM still alert once today on sync
          const isSameDayGoogleDefault =
            task.source === 'google' &&
            rem.mode === 'relative' &&
            rem.id.startsWith('gtask-due-') &&
            task.timeLabel === 'No time set' &&
            task.dateKey === todayDateKey;
          const catchUpWindowMs = isSameDayGoogleDefault
            ? SAME_DAY_GOOGLE_CATCH_UP_MS
            : CATCH_UP_WINDOW_MS;

          if (triggerMs <= now && now - triggerMs <= catchUpWindowMs) {
            dispatchedReminderKeysRef.current.add(pairKey);
            dispatchedReminderKeysRef.current.add(timedKey);

            let set = firedByTask.get(task.id);
            if (!set) {
              set = new Set<string>();
              firedByTask.set(task.id, set);
            }
            set.add(rem.id);
            triggered.push({ task, reminder: rem, triggerMs });
          }
        }
      }

      return { firedByTask, triggered };
    };

    const localScan = scanList(tasksRef.current);
    const googleScan = settingsRef.current.googleTasksSync
      ? scanList(googleTasksRef.current)
      : { firedByTask: new Map<string, Set<string>>(), triggered: [] };

    if (localScan.firedByTask.size > 0) {
      setTasks((prev) =>
        prev.map((t) => {
          const firedIds = localScan.firedByTask.get(t.id);
          if (!firedIds || !t.reminders) return t;
          const updatedTask = {
            ...t,
            reminders: t.reminders.map((r) => (firedIds.has(r.id) ? { ...r, firedAt: now } : r)),
          };
          recordLocalTaskDirty(updatedTask, t);
          return updatedTask;
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
      for (const { task, reminder, triggerMs } of allTriggered) {
        void markReminderFiredInServiceWorker(task.id, reminder.id, triggerMs);
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
  }, [recordLocalTaskDirty]);

  const hasPendingReminders = useMemo(() => {
    const hasUnfired = (list: TaskItem[]) =>
      list.some(
        (t) => !t.completed && t.reminders && t.reminders.some((r) => !r.firedAt)
      );
    return hasUnfired(tasks) || (settings.googleTasksSync && hasUnfired(googleTasks));
  }, [tasks, googleTasks, settings.googleTasksSync]);

  useEffect(() => {
    if (!settings.taskRemindersEnabled || !hasPendingReminders) return;
    checkDueReminders();
    const intervalId = window.setInterval(checkDueReminders, 5000);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [settings.taskRemindersEnabled, hasPendingReminders, checkDueReminders]);

  // Also arm a precise timeout for the single soonest upcoming reminder within 6 hours
  useEffect(() => {
    checkDueReminders();
    if (!settings.taskRemindersEnabled) return;
    const now = Date.now();
    const HORIZON_MS = 6 * 60 * 60 * 1000;
    let soonestDelay: number | null = null;
    const activeTaskPool = settings.googleTasksSync ? [...tasks, ...googleTasks] : tasks;
    for (const task of activeTaskPool) {
      if (task.completed || !task.reminders) continue;
      for (const rem of task.reminders) {
        if (rem.firedAt) continue;
        const triggerMs = computeReminderTriggerMs(task, rem);
        if (triggerMs === null) continue;
        const delay = triggerMs - now;
        if (delay > 0 && delay <= HORIZON_MS) {
          if (soonestDelay === null || delay < soonestDelay) {
            soonestDelay = delay;
          }
        }
      }
    }
    if (soonestDelay === null) return;
    const timer = window.setTimeout(() => {
      checkDueReminders();
    }, soonestDelay + 250);
    return () => window.clearTimeout(timer);
  }, [tasks, googleTasks, settings.googleTasksSync, settings.taskRemindersEnabled, checkDueReminders]);

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
    dispatchedReminderKeysRef.current.add(`${taskId}:${reminderId}`);
    void markReminderFiredInServiceWorker(taskId, reminderId);
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
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id !== taskId || !t.reminders) return t;
        const updatedTask = {
          ...t,
          reminders: t.reminders.map((r) =>
            r.id === reminderId ? { ...r, firedAt: r.firedAt ?? now } : r
          ),
        };
        recordLocalTaskDirty(updatedTask, t);
        return updatedTask;
      })
    );
    setGoogleTasks(markFired);
  }, [recordLocalTaskDirty]);

  const handleDismissReminderAlert = useCallback(
    (alertId: string) => {
      const target = activeReminderAlerts.find((a) => a.id === alertId);
      setActiveReminderAlerts((prev) => prev.filter((a) => a.id !== alertId));
      if (target) {
        handleClearReminder(target.taskId, target.reminderId);
      }
    },
    [activeReminderAlerts, handleClearReminder]
  );

  const handleCompleteFromReminderAlert = useCallback(
    (alertId: string, taskId: string, reminderId?: string) => {
      const now = Date.now();
      setActiveReminderAlerts((prev) => prev.filter((a) => a.id !== alertId && a.taskId !== taskId));
      if (reminderId) {
        dispatchedReminderKeysRef.current.add(`${taskId}:${reminderId}`);
        void markReminderFiredInServiceWorker(taskId, reminderId);
      }

      const localMatch = tasksRef.current.find((t) => t.id === taskId);
      if (localMatch) {
        for (const r of localMatch.reminders ?? []) {
          dispatchedReminderKeysRef.current.add(`${taskId}:${r.id}`);
          void markReminderFiredInServiceWorker(taskId, r.id);
        }
        const nextOcc =
          !localMatch.completed && localMatch.recurrence
            ? buildNextRecurringTaskInstance(localMatch)
            : null;
        setTasks((prev) => {
          const updatedList = prev.map((t) => {
            if (t.id !== taskId) return t;
            const completedTask: TaskItem = {
              ...t,
              completed: true,
              completedAt: t.completedAt || new Date().toISOString(),
              reminders: t.reminders?.map((r) => ({ ...r, firedAt: r.firedAt ?? now })),
            };
            recordLocalTaskDirty(completedTask, t);
            return completedTask;
          });
          if (nextOcc) {
            const seriesId = nextOcc.recurrenceSeriesId;
            const duplicate = updatedList.some(
              (t) =>
                !t.completed &&
                t.dateKey === nextOcc.dateKey &&
                ((seriesId && (t.recurrenceSeriesId === seriesId || t.id === seriesId)) ||
                  (t.title.trim().toLowerCase() === nextOcc.title.trim().toLowerCase() &&
                    t.category === nextOcc.category))
            );
            if (!duplicate) {
              recordLocalTaskDirty(nextOcc);
              return [nextOcc, ...updatedList];
            }
          }
          return updatedList;
        });
        if (!localMatch.completed) {
          if (nextOcc) {
            const nextLabel = formatRelativeTaskDate(nextOcc.dateKey, {
              includeMonthDayForRelative: true,
            }).label;
            showOfflineSyncNotice(`Done · next "${localMatch.title || 'Task'}" on ${nextLabel}`);
          } else {
            showOfflineSyncNotice(`Marked "${localMatch.title || 'Task'}" done`);
          }
        }
        return;
      }

      const googleMatch = googleTasksRef.current.find((t) => t.id === taskId);
      if (googleMatch) {
        for (const r of googleMatch.reminders ?? []) {
          dispatchedReminderKeysRef.current.add(`${taskId}:${r.id}`);
          void markReminderFiredInServiceWorker(taskId, r.id);
        }
        const googleMatchWithFired: TaskItem = googleMatch.reminders
          ? {
              ...googleMatch,
              reminders: googleMatch.reminders.map((r) => ({ ...r, firedAt: r.firedAt ?? now })),
            }
          : googleMatch;
        setGoogleTasks((prev) =>
          prev.map((t) => (t.id === taskId ? googleMatchWithFired : t))
        );
        if (!googleMatchWithFired.completed) {
          void handleToggleGoogleTask(googleMatchWithFired);
          showOfflineSyncNotice(`Marked "${googleMatchWithFired.title || 'Task'}" done`);
        }
      }
    },
    [handleToggleGoogleTask, recordLocalTaskDirty, showOfflineSyncNotice]
  );

  const handleSnoozeReminder = useCallback(
    (taskId: string, reminderId?: string, snoozeMinutes = 10) => {
      const now = Date.now();
      const snoozed = createSnoozedReminder(snoozeMinutes);
      if (reminderId) {
        dispatchedReminderKeysRef.current.add(`${taskId}:${reminderId}`);
        void markReminderFiredInServiceWorker(taskId, reminderId);
      }

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
            const updatedTask = { ...t, reminders: [...existing, snoozed] };
            recordLocalTaskDirty(updatedTask, t);
            return updatedTask;
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
    [recordLocalTaskDirty, showOfflineSyncNotice]
  );

  const handleSnoozeReminderAlert = useCallback(
    (alertId: string, taskId: string, reminderId: string, minutes = 10) => {
      setActiveReminderAlerts((prev) => prev.filter((a) => a.id !== alertId));
      handleSnoozeReminder(taskId, reminderId, minutes);
    },
    [handleSnoozeReminder]
  );

  // Handle Snooze, Done, Clear, Swipe-Away, and Tap-to-Open events coming from Android Service Worker notifications
  useEffect(() => {
    let inFlight: Promise<void> | null = null;

    const applyActionOnce = (item: {
      actionId?: string;
      action?: 'snooze' | 'done' | 'clear';
      taskId?: string;
      reminderId?: string;
      snoozeMinutes?: number;
    }) => {
      if (item.actionId) {
        if (processedSwActionIdsRef.current.has(item.actionId)) {
          return;
        }
        processedSwActionIdsRef.current.add(item.actionId);
        if (processedSwActionIdsRef.current.size > 200) {
          const first = processedSwActionIdsRef.current.values().next().value;
          if (first) processedSwActionIdsRef.current.delete(first);
        }
      }
      if (item.taskId && item.reminderId) {
        dispatchedReminderKeysRef.current.add(`${item.taskId}:${item.reminderId}`);
      }
      if (item.action === 'snooze' && item.taskId) {
        handleSnoozeReminder(item.taskId, item.reminderId, item.snoozeMinutes ?? 10);
      } else if (item.action === 'done' && item.taskId) {
        handleCompleteFromReminderAlert(
          `${item.taskId}:${item.reminderId || ''}`,
          item.taskId,
          item.reminderId
        );
      } else if (item.action === 'clear') {
        handleClearReminder(item.taskId, item.reminderId);
      }
    };

    const processPendingActions = () => {
      if (inFlight) return inFlight;
      swWakePendingRef.current = true;
      inFlight = (async () => {
        try {
          const [pending, swFired] = await Promise.all([
            consumePendingSwReminderActions(),
            getSwFiredReminderKeys(),
          ]);

          for (const firedKey of Object.keys(swFired)) {
            dispatchedReminderKeysRef.current.add(firedKey);
          }

          for (const item of pending) {
            applyActionOnce(item);
          }
        } finally {
          swActionsHydratedRef.current = true;
          swWakePendingRef.current = false;
          inFlight = null;
          checkDueReminders();
        }
      })();
      return inFlight;
    };

    void processPendingActions();

    const handleSwMessage = (event: MessageEvent) => {
      const data = event.data as
        | {
            type?: string;
            actionId?: string;
            action?: 'snooze' | 'done' | 'clear';
            taskId?: string;
            reminderId?: string;
            snoozeMinutes?: number;
          }
        | null;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'REMINDER_ACTION') {
        applyActionOnce(data);
      } else if (data.type === 'REMINDER_OPEN' && data.taskId) {
        setActiveScreen(ScreenId.Tasks);
        setExternalOpenTask({ taskId: data.taskId, nonce: Date.now() });
      } else if (data.type === 'REMINDER_PUSH_DELIVERED' && data.taskId && data.reminderId) {
        applyActionOnce({
          actionId: data.actionId,
          action: 'clear',
          taskId: data.taskId,
          reminderId: data.reminderId,
        });
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
  }, [handleSnoozeReminder, handleClearReminder, handleCompleteFromReminderAlert, checkDueReminders]);

  const [pushReadyNonce, setPushReadyNonce] = useState(0);
  const lastResumePushSyncRef = useRef<number>(0);

  useEffect(() => {
    const onPushReady = () => setPushReadyNonce((n) => n + 1);
    const onResumeRefreshPush = () => {
      if (document.visibilityState === 'hidden') return;
      const now = Date.now();
      if (now - lastResumePushSyncRef.current < 30_000) return;
      lastResumePushSyncRef.current = now;
      setPushReadyNonce((n) => n + 1);
    };
    window.addEventListener('buh:push-ready', onPushReady);
    window.addEventListener('focus', onResumeRefreshPush);
    window.addEventListener('online', onResumeRefreshPush);
    document.addEventListener('visibilitychange', onResumeRefreshPush);
    return () => {
      window.removeEventListener('buh:push-ready', onPushReady);
      window.removeEventListener('focus', onResumeRefreshPush);
      window.removeEventListener('online', onResumeRefreshPush);
      document.removeEventListener('visibilitychange', onResumeRefreshPush);
    };
  }, []);

  // Sync upcoming reminders to BOTH the local Service Worker (PeriodicSync/BackgroundSync)
  // AND the server Web Push scheduler so alerts fire even when the app is closed
  useEffect(() => {
    if (getNotificationPermissionState() !== 'granted') return;

    const timer = window.setTimeout(() => {
      const opts = {
        enabled: settings.taskRemindersEnabled !== false,
        silent: settings.reminderSound === false,
      };
      void syncRemindersToServiceWorker(visibleTasks, opts);
      if (isOnline) {
        void syncScheduledRemindersToPushServer(visibleTasks, opts);
      }
    }, 350);

    return () => window.clearTimeout(timer);
  }, [
    visibleTasks,
    settings.taskRemindersEnabled,
    settings.reminderSound,
    isOnline,
    pushReadyNonce,
  ]);

  const handleToggleTask = (taskId: string) => {
    const existing = tasksRef.current.find((t) => t.id === taskId);
    const nextOcc =
      existing && !existing.completed && existing.recurrence
        ? buildNextRecurringTaskInstance(existing)
        : null;

    setTasks((prev) => {
      const mapped = prev.map((t) => {
        if (t.id !== taskId) return t;
        const nextCompleted = !t.completed;
        const toggledTask: TaskItem = {
          ...t,
          completed: nextCompleted,
          completedAt: nextCompleted ? new Date().toISOString() : undefined,
        };
        recordLocalTaskDirty(toggledTask, t);
        return toggledTask;
      });
      if (nextOcc) {
        const seriesId = nextOcc.recurrenceSeriesId;
        const alreadyExists = mapped.some(
          (t) =>
            !t.completed &&
            t.dateKey === nextOcc.dateKey &&
            ((seriesId && (t.recurrenceSeriesId === seriesId || t.id === seriesId)) ||
              (t.title.trim().toLowerCase() === nextOcc.title.trim().toLowerCase() &&
                t.category === nextOcc.category))
        );
        if (!alreadyExists) {
          recordLocalTaskDirty(nextOcc);
          return [nextOcc, ...mapped];
        }
      }
      return mapped;
    });
    if (nextOcc) {
      const nextLabel = formatRelativeTaskDate(nextOcc.dateKey, {
        includeMonthDayForRelative: true,
      }).label;
      showOfflineSyncNotice(`Next "${nextOcc.title}" scheduled for ${nextLabel}`);
    }
    setActiveReminderAlerts((prev) => prev.filter((a) => a.taskId !== taskId));
  };

  const handleAddTask = (newTask: TaskItem) => {
    recordLocalTaskDirty(newTask);
    setTasks((prev) => [newTask, ...prev]);
  };

  const handleUpdateTask = (updated: TaskItem) => {
    if (updated.completed) {
      setActiveReminderAlerts((prev) => prev.filter((a) => a.taskId !== updated.id));
    }
    if (updated.source === 'google') {
      const prevGoogleTask = googleTasksRef.current.find((t) => t.id === updated.id);
      const nextTask = rearmRelativeReminders(prevGoogleTask, updated);
      setGoogleTasks((prev) => prev.map((t) => (t.id === updated.id ? nextTask : t)));

      const nextVersion = (googleTaskEditVersionRef.current.get(nextTask.id) ?? 0) + 1;
      googleTaskEditVersionRef.current.set(nextTask.id, nextVersion);

      const existingPending = pendingGoogleTaskAutoSyncRef.current.get(nextTask.id);
      if (existingPending) {
        window.clearTimeout(existingPending.timerId);
        pendingGoogleTaskAutoSyncRef.current.delete(nextTask.id);
      }

      const tokenFresh = isCalendarAccessTokenFresh();
      if (googleConnectedRef.current && !tokenFresh) {
        setGoogleConnected(false);
      }

      const canAutoSyncOnline =
        (typeof navigator === 'undefined' || navigator.onLine) &&
        googleConnectedRef.current &&
        tokenFresh &&
        Boolean(nextTask.googleTaskId) &&
        !nextTask.googleTaskId?.startsWith('offline-');

      if (!canAutoSyncOnline) {
        // Queue offline/paused edits to Google Tasks with pre-edit base snapshot so offline edits win on reconciliation
        const baseTask = googleTaskBaseByIdRef.current.get(nextTask.id) ?? prevGoogleTask;
        setDirtyGoogleTaskIds((prev) => (prev.includes(nextTask.id) ? prev : [...prev, nextTask.id]));
        setPendingSyncQueue((prev) =>
          enqueueSyncOp(prev, {
            id: makeSyncOpId(),
            type: 'gtask-update',
            taskId: nextTask.id,
            task: nextTask,
            ...(baseTask ? { baseTask } : {}),
            createdAt: Date.now(),
          })
        );
        return;
      }

      // Online & connected: auto-sync edited Google Task after a short debounce
      const timerId = window.setTimeout(() => {
        pendingGoogleTaskAutoSyncRef.current.delete(nextTask.id);
        void handleUpdateGoogleTask(nextTask, nextVersion).catch(() => {
          // Error already recorded in googleTasksError & dirtyGoogleTaskIds
        });
      }, 550);
      pendingGoogleTaskAutoSyncRef.current.set(nextTask.id, {
        timerId,
        version: nextVersion,
        task: nextTask,
      });
      return;
    }
    const prevLocalTask = tasksRef.current.find((t) => t.id === updated.id);
    const nextLocalTask = rearmRelativeReminders(prevLocalTask, updated);
    recordLocalTaskDirty(nextLocalTask, prevLocalTask);
    setTasks((prev) => prev.map((t) => (t.id === updated.id ? nextLocalTask : t)));
  };

  const handleDeleteTask = (taskId: string) => {
    recordLocalTaskDeleted(taskId);
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
    setActiveReminderAlerts((prev) => prev.filter((a) => a.taskId !== taskId));
  };

  const handleRestoreTask = (task: TaskItem, index?: number) => {
    recordLocalTaskDirty(task);
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
      prev.map((t) => {
        if (t.category !== oldName) return t;
        const renamed = { ...t, category: clean };
        recordLocalTaskDirty(renamed, t);
        return renamed;
      })
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
      prev.map((t) => {
        if (t.category !== name) return t;
        const reassigned = { ...t, category: 'Inbox' };
        recordLocalTaskDirty(reassigned, t);
        return reassigned;
      })
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
      ...(ev.recurrence ? { recurrence: ev.recurrence } : {}),
    };
    recordLocalTaskDirty(created);
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
    cloudTaskJournalRef.current = { upserts: {}, deletes: {} };
    clearCloudTaskJournal();
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

  const handleToggleDark = useCallback(() => setIsDark((d) => !d), []);
  const handleUpdateSettings = useCallback(
    (patch: Partial<AppSettingsState>) => setSettings((s) => ({ ...s, ...patch })),
    []
  );
  const handleConsumeExternalOpenTask = useCallback(() => setExternalOpenTask(null), []);
  const handleConsumeExternalShortcut = useCallback(() => setExternalShortcut(null), []);
  const handleChangeDecisions = useCallback((patch: Partial<DesignDecisions>) => {
    setDecisions((prev) => ({ ...prev, ...patch }));
    setApproved(false);
  }, []);

  const activeTimeFormat = settings.timeFormat === '12h' ? '12h' : '24h';

  const syncBannerNode = (
    <OfflineIndicator
      pendingSyncCount={pendingSyncQueue.length}
      isSyncingQueue={isSyncingOfflineQueue}
      isRefreshingGoogle={isRefreshingGoogleBanner}
      syncNotice={offlineSyncNotice}
      needsReconnectToSync={!googleConnected}
      showQuietGoogleRefresh={showQuietGoogleRefresh}
      reconnectDismissed={googleReconnectDismissed}
      onSyncPending={handleTriggerPendingSync}
      onDismissQuietRefresh={() => setGoogleReconnectDismissed(true)}
    />
  );

  if (isStandaloneAppMode) {
    const standaloneTokens = getDeviceStyleTokens(decisions.visualStyle);
    return (
      <TimeFormatProvider value={activeTimeFormat}>
        <div
          className={`fixed inset-x-0 top-[var(--buh-vv-top,0px)] h-[var(--buh-vh,100dvh)] w-full ${standaloneTokens.surfaceBg} text-stone-900 dark:text-stone-100 overflow-hidden`}
        >
          <div
            style={dpiCompensationZoom > 1.01 ? { zoom: dpiCompensationZoom } : undefined}
            className="h-full w-full overflow-hidden"
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
              onToggleDark={handleToggleDark}
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
              onUpdateSettings={handleUpdateSettings}
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
              quickCheckEntries={quickCheckEntries}
              onChangeQuickCheckEntries={setQuickCheckEntries}
              activeReminderAlerts={activeReminderAlerts}
              onDismissReminderAlert={handleDismissReminderAlert}
              onSnoozeReminderAlert={handleSnoozeReminderAlert}
              onCompleteFromReminderAlert={handleCompleteFromReminderAlert}
              externalOpenTask={externalOpenTask}
              onConsumeExternalOpenTask={handleConsumeExternalOpenTask}
              externalShortcut={externalShortcut}
              onConsumeExternalShortcut={handleConsumeExternalShortcut}
              hiddenCompletedTasksCount={hiddenCompletedTasksCount}
              syncBanner={syncBannerNode}
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
        </div>
      </TimeFormatProvider>
    );
  }

  return (
    <TimeFormatProvider value={activeTimeFormat}>
      <Suspense fallback={<div className="min-h-screen bg-[#F6F7F5] dark:bg-[#0D100E]" />}>
        <StudioPreviewShell
          posture={posture}
          onChangePosture={setPosture}
          activeScreen={activeScreen}
          onChangeScreen={setActiveScreen}
          decisions={decisions}
          onChangeDecisions={handleChangeDecisions}
          onSelectAccentColor={handleSelectAccentColor}
          reviewNote={reviewNote}
          onChangeReviewNote={setReviewNote}
          approved={approved}
          approvalOpen={approvalOpen}
          onOpenApproval={() => setApprovalOpen(true)}
          onCloseApproval={() => setApprovalOpen(false)}
          onConfirmApprove={() => {
            setApproved(true);
            setApprovalOpen(false);
          }}
          isDark={isDark}
          onToggleDark={handleToggleDark}
          showHingeGuide={showHingeGuide}
          onToggleHingeGuide={() => setShowHingeGuide((v) => !v)}
          simulatedKeyboardOpen={simulatedKeyboardOpen}
          onToggleSimulatedKeyboard={() => setSimulatedKeyboardOpen((v) => !v)}
          exportingSource={exportingSource}
          onDownloadSource={handleDownloadSource}
          onResetDemo={handleResetDemo}
          onEnterAppMode={() => setManualFullScreen(true)}
        >
          <FoldDeviceFrame
            posture={posture}
            keyboardOpen={simulatedKeyboardOpen}
            onDismissKeyboard={() => setSimulatedKeyboardOpen(false)}
            decisions={decisions}
            activeScreen={activeScreen}
            onChangeScreen={setActiveScreen}
            isDark={isDark}
            onToggleDark={handleToggleDark}
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
            onUpdateSettings={handleUpdateSettings}
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
            quickCheckEntries={quickCheckEntries}
            onChangeQuickCheckEntries={setQuickCheckEntries}
            activeReminderAlerts={activeReminderAlerts}
            onDismissReminderAlert={handleDismissReminderAlert}
            onSnoozeReminderAlert={handleSnoozeReminderAlert}
            onCompleteFromReminderAlert={handleCompleteFromReminderAlert}
            externalOpenTask={externalOpenTask}
            onConsumeExternalOpenTask={handleConsumeExternalOpenTask}
            externalShortcut={externalShortcut}
            onConsumeExternalShortcut={handleConsumeExternalShortcut}
            hiddenCompletedTasksCount={hiddenCompletedTasksCount}
            syncBanner={syncBannerNode}
          />
        </StudioPreviewShell>
      </Suspense>
      {showExitToast && (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] rounded-xl bg-stone-900/95 dark:bg-stone-100/95 px-4 py-2.5 text-[13px] font-medium text-white dark:text-stone-900 shadow-xl border border-stone-700/60 dark:border-stone-300/60 whitespace-nowrap"
        >
          Press back again to exit
        </div>
      )}
    </TimeFormatProvider>
  );
}
