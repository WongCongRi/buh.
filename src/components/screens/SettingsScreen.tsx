import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Bell,
  BellOff,
  Check,
  ChevronDown,
  ChevronUp,
  Download,
  GripVertical,
  LogOut,
  Moon,
  Pencil,
  Plus,
  RefreshCw,
  Smartphone,
  Sun,
  Trash2,
  X,
} from 'lucide-react';
import {
  AppSettingsState,
  FoldPosture,
  GoogleCalendarSyncState,
  GoogleTasksSyncState,
  TaskItem,
} from '../../types/taskflow';
import { normalizeHex } from '../../utils/colorUtils';
import {
  dispatchTestNotification,
  getNotificationPermissionState,
  isAndroidDevice,
  isEmbeddedIframe,
  NotificationSupportState,
  requestAppNotificationPermission,
} from '../../utils/taskReminders';
import { StyleThemeTokens } from '../../utils/themeTokens';
import { GoogleSignInButton } from '../GoogleSignInButton';

interface SettingsScreenProps {
  posture: FoldPosture;
  tokens: StyleThemeTokens;
  isDark: boolean;
  onToggleDark: () => void;
  accentColor: string;
  recentColors: string[];
  onPreviewAccentColor: (hex: string) => void;
  onSelectAccentColor: (hex: string) => void;
  taskLists: string[];
  onAddList: (name: string) => void;
  onRenameList: (oldName: string, newName: string) => void;
  onDeleteList: (name: string) => void;
  onReorderList: (fromIndex: number, toIndex: number) => void;
  settings: AppSettingsState;
  onUpdateSettings: (patch: Partial<AppSettingsState>) => void;
  tasks: TaskItem[];
  googleCalendar: GoogleCalendarSyncState;
  googleTasks: GoogleTasksSyncState;
}

export const SettingsScreen: React.FC<SettingsScreenProps> = ({
  posture,
  tokens,
  isDark,
  onToggleDark,
  accentColor,
  recentColors,
  onPreviewAccentColor,
  onSelectAccentColor,
  taskLists,
  onAddList,
  onRenameList,
  onDeleteList,
  onReorderList,
  settings,
  onUpdateSettings,
  tasks,
  googleCalendar,
  googleTasks,
}) => {
  const [showExportPreview, setShowExportPreview] = useState(false);
  const [newListName, setNewListName] = useState('');
  const [editingList, setEditingList] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState('');
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [notifPerm, setNotifPerm] = useState<NotificationSupportState>(() =>
    getNotificationPermissionState()
  );
  const [notifBusy, setNotifBusy] = useState(false);
  const [notifFeedback, setNotifFeedback] = useState<string | null>(null);
  const [showAndroidGuide, setShowAndroidGuide] = useState<boolean>(
    () => getNotificationPermissionState() === 'denied' || isAndroidDevice()
  );
  const debounceRef = useRef<number | null>(null);
  const currentHex = normalizeHex(accentColor);
  const inIframe = isEmbeddedIframe();

  // Auto-refresh notification permission when returning from Android System Settings
  useEffect(() => {
    const refreshPerm = () => {
      const next = getNotificationPermissionState();
      setNotifPerm(next);
      if (next === 'denied') {
        setShowAndroidGuide(true);
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshPerm();
    };
    window.addEventListener('focus', refreshPerm);
    document.addEventListener('visibilitychange', onVisible);

    let permStatus: PermissionStatus | null = null;
    if (typeof navigator !== 'undefined' && navigator.permissions?.query) {
      navigator.permissions
        .query({ name: 'notifications' as PermissionName })
        .then((status) => {
          permStatus = status;
          permStatus.onchange = refreshPerm;
        })
        .catch(() => {
          // Permissions API not available for notifications in all browsers
        });
    }

    return () => {
      window.removeEventListener('focus', refreshPerm);
      document.removeEventListener('visibilitychange', onVisible);
      if (permStatus) permStatus.onchange = null;
    };
  }, []);

  const handleEnableNotifications = async () => {
    if (notifBusy) return;
    setNotifBusy(true);
    setNotifFeedback(null);
    try {
      const result = await requestAppNotificationPermission();
      setNotifPerm(result);
      if (result === 'granted') {
        const test = await dispatchTestNotification(settings.reminderSound !== false);
        setNotifFeedback(
          test.delivered
            ? 'Notifications allowed — buh. is now registered in Android system settings.'
            : 'Permission granted. You can customize alerts in Android system settings.'
        );
      } else if (result === 'denied') {
        setShowAndroidGuide(true);
        setNotifFeedback('Permission is blocked. Enable notifications in Android system settings below.');
      } else if (result === 'unsupported') {
        setNotifFeedback('System notifications are unsupported in this browser; in-app alerts remain active.');
      } else {
        setNotifFeedback(
          inIframe
            ? 'Preview frame blocked the prompt — open buh. directly or install the app on Android to allow notifications.'
            : 'Prompt dismissed — tap Enable again when ready.'
        );
      }
    } finally {
      setNotifBusy(false);
    }
  };

  const handleSendTestNotification = async () => {
    if (notifBusy) return;
    setNotifBusy(true);
    setNotifFeedback(null);
    try {
      const res = await dispatchTestNotification(settings.reminderSound !== false);
      setNotifPerm(res.permission);
      if (res.delivered) {
        setNotifFeedback('Test alert sent — check your notification shade or Android App Info.');
      } else if (res.permission === 'denied') {
        setShowAndroidGuide(true);
        setNotifFeedback('Blocked in system settings — follow the Android steps below to enable.');
      } else {
        setNotifFeedback('Could not deliver system notification right now.');
      }
    } finally {
      setNotifBusy(false);
    }
  };

  const handlePickerChange = (rawHex: string) => {
    const normalized = normalizeHex(rawHex);
    onPreviewAccentColor(normalized);
    if (debounceRef.current) {
      window.clearTimeout(debounceRef.current);
    }
    debounceRef.current = window.setTimeout(() => {
      onSelectAccentColor(normalized);
      debounceRef.current = null;
    }, 450);
  };

  const handlePickerBlur = () => {
    if (debounceRef.current) {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    onSelectAccentColor(currentHex);
  };

  const handleCreateList = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newListName.trim();
    if (!trimmed) return;
    onAddList(trimmed);
    setNewListName('');
  };

  const handleCommitRename = (oldName: string) => {
    const trimmed = editingDraft.trim();
    if (trimmed && trimmed !== oldName) {
      onRenameList(oldName, trimmed);
    }
    setEditingList(null);
    setEditingDraft('');
  };

  const csvPreview = [
    'Folder Name,Title,Priority,Due Date,Status',
    ...tasks.map(
      (t) =>
        `"${t.category}","${t.title.replace(/"/g, '""')}",${
          t.priority === 'High' ? 5 : t.priority === 'Normal' ? 3 : 1
        },${t.dateKey},${t.completed ? 2 : 0}`
    ),
  ].join('\n');

  const renderToggleRow = (
    title: string,
    description: string,
    checked: boolean,
    onChange: () => void
  ) => (
    <div className={`flex items-center justify-between gap-2 px-2.5 py-1.5 border-b last:border-b-0 ${tokens.divider}`}>
      <div className="min-w-0">
        <p className="text-[11.5px] font-medium text-stone-900 dark:text-stone-100 leading-tight">{title}</p>
        <p className="text-[10px] text-stone-500 dark:text-stone-400 truncate leading-tight mt-0.5">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={onChange}
        className={`w-9 h-5 rounded-full p-0.5 transition-colors shrink-0 ${
          checked ? tokens.accentBg : 'bg-stone-300 dark:bg-stone-700'
        }`}
      >
        <span
          className={`block w-4 h-4 rounded-full bg-white shadow-xs transition-transform ${
            checked ? 'translate-x-4' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  );

  const appearanceCard = (
    <div className="space-y-0.5">
      <span className="text-[10px] font-medium text-stone-400 dark:text-stone-500 px-1">Appearance</span>
      <div className={`${tokens.cardBg} ${tokens.cardRadius} overflow-hidden`}>
        <div className={`flex items-center justify-between px-2.5 py-1.5 border-b ${tokens.divider}`}>
          <div className="min-w-0">
            <p className="text-[11.5px] font-medium text-stone-900 dark:text-stone-100 leading-tight">Theme mode</p>
            <p className="text-[10px] text-stone-500 dark:text-stone-400 truncate leading-tight mt-0.5">
              {isDark ? 'Dark low-light focus' : 'Light daylight clarity'}
            </p>
          </div>
          <button
            type="button"
            onClick={onToggleDark}
            className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10.5px] font-medium ${tokens.subtleBg} text-stone-800 dark:text-stone-100 ${tokens.buttonRadius} shrink-0`}
          >
            {isDark ? <Moon className="w-3 h-3" /> : <Sun className="w-3 h-3" />}
            {isDark ? 'Dark' : 'Light'}
          </button>
        </div>

        {/* Accent Colour Picker + 5 Most Recent Colours */}
        <div className="px-2.5 py-1.5 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[12px] font-medium text-stone-900 dark:text-stone-100">Accent colour</p>
              <p className="text-[10.5px] font-mono-tabular text-stone-500 dark:text-stone-400">
                {currentHex}
              </p>
            </div>
            <label
              htmlFor="settings-accent-picker"
              className={`inline-flex items-center gap-1.5 px-2 py-1 ${tokens.subtleBg} ${tokens.buttonRadius} cursor-pointer shrink-0`}
            >
              <input
                id="settings-accent-picker"
                type="color"
                value={currentHex}
                onChange={(e) => handlePickerChange(e.target.value)}
                onBlur={handlePickerBlur}
                aria-label="Choose custom accent colour"
                className="w-5 h-5 rounded border border-stone-300 dark:border-stone-700 bg-transparent cursor-pointer p-0"
              />
              <span className="text-[11px] font-medium text-stone-700 dark:text-stone-200">Pick</span>
            </label>
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="text-[10.5px] text-stone-400 dark:text-stone-500 shrink-0">
              Recent ({recentColors.length}/5)
            </span>
            <div className="flex items-center gap-1.5" role="group" aria-label="Five most recent accent colours">
              {recentColors.slice(0, 5).map((hex) => {
                const isSelected = normalizeHex(hex) === currentHex;
                return (
                  <button
                    key={hex}
                    type="button"
                    title={hex}
                    aria-label={`Use recent colour ${hex}`}
                    onClick={() => onSelectAccentColor(hex)}
                    className={`w-5 h-5 rounded-full transition-transform border ${
                      isSelected
                        ? 'scale-110 ring-2 ring-offset-1 ring-stone-900 dark:ring-stone-100 dark:ring-offset-[#181B19] border-transparent'
                        : 'border-black/10 dark:border-white/15 hover:scale-105'
                    }`}
                  >
                    <span
                      className="block w-full h-full rounded-full"
                      style={{ backgroundColor: hex }}
                    />
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const listsCard = (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between px-1">
        <span className="text-[10px] font-medium text-stone-400 dark:text-stone-500">Lists (drag or arrow to reorder)</span>
        <span className="text-[10px] text-stone-400 tabular-nums">{taskLists.length} custom</span>
      </div>
      <div className={`${tokens.cardBg} ${tokens.cardRadius} overflow-hidden`}>
        {taskLists.map((listName, idx) => {
          const count = tasks.filter((t) => t.category === listName).length;
          const isEditing = editingList === listName;
          const isDragging = dragIndex === idx;
          const isDropTarget = dropIndex === idx && dragIndex !== null && dragIndex !== idx;
          return (
            <div
              key={listName}
              draggable={!isEditing}
              onDragStart={(e) => {
                setDragIndex(idx);
                setDropIndex(idx);
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', String(idx));
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (dropIndex !== idx) setDropIndex(idx);
              }}
              onDrop={(e) => {
                e.preventDefault();
                const from = dragIndex ?? Number(e.dataTransfer.getData('text/plain'));
                if (!Number.isNaN(from) && from !== idx) {
                  onReorderList(from, idx);
                }
                setDragIndex(null);
                setDropIndex(null);
              }}
              onDragEnd={() => {
                setDragIndex(null);
                setDropIndex(null);
              }}
              className={`flex items-center justify-between gap-1.5 px-2.5 py-1 border-b ${tokens.divider} transition-colors ${
                isDragging ? 'opacity-50' : ''
              } ${isDropTarget ? tokens.accentSoftBg : ''}`}
            >
              {isEditing ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleCommitRename(listName);
                  }}
                  className="flex-1 flex items-center gap-1.5"
                >
                  <input
                    type="text"
                    autoFocus
                    value={editingDraft}
                    onChange={(e) => setEditingDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        setEditingList(null);
                        setEditingDraft('');
                      }
                    }}
                    aria-label={`Rename ${listName}`}
                    className={`flex-1 text-xs px-2 py-0.5 ${tokens.subtleBg} text-stone-900 dark:text-stone-100 ${tokens.buttonRadius} focus:outline-none`}
                  />
                  <button
                    type="submit"
                    aria-label="Save list name"
                    className={`p-1 ${tokens.accentBg} ${tokens.buttonRadius}`}
                  >
                    <Check className="w-3 h-3" />
                  </button>
                </form>
              ) : (
                <>
                  <div className="min-w-0 flex items-center gap-1.5">
                    <span
                      className="text-stone-300 dark:text-stone-600 cursor-grab active:cursor-grabbing shrink-0"
                      title="Drag to reorder"
                      aria-hidden="true"
                    >
                      <GripVertical className="w-3 h-3" />
                    </span>
                    <span className="text-[11.5px] font-medium text-stone-900 dark:text-stone-100 truncate">
                      {listName}
                    </span>
                    <span className="text-[10px] text-stone-400 tabular-nums">{count}</span>
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      type="button"
                      disabled={idx === 0}
                      onClick={() => onReorderList(idx, idx - 1)}
                      aria-label={`Move ${listName} up`}
                      className="p-1 text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 disabled:opacity-25 rounded"
                    >
                      <ArrowUp className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      disabled={idx === taskLists.length - 1}
                      onClick={() => onReorderList(idx, idx + 1)}
                      aria-label={`Move ${listName} down`}
                      className="p-1 text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 disabled:opacity-25 rounded"
                    >
                      <ArrowDown className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingList(listName);
                        setEditingDraft(listName);
                      }}
                      aria-label={`Rename ${listName}`}
                      className="p-1 text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 rounded"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                    {taskLists.length > 1 && (
                      <button
                        type="button"
                        onClick={() => onDeleteList(listName)}
                        aria-label={`Delete ${listName}`}
                        className="p-1 text-stone-400 hover:text-rose-500 rounded"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })}

        <form onSubmit={handleCreateList} className="flex items-center gap-1.5 px-2.5 py-1.5">
          <input
            type="text"
            value={newListName}
            onChange={(e) => setNewListName(e.target.value)}
            placeholder="New list name..."
            aria-label="New list name"
            className={`flex-1 text-[11.5px] px-2 py-0.5 ${tokens.subtleBg} text-stone-900 dark:text-stone-100 placeholder:text-stone-400 ${tokens.buttonRadius} focus:outline-none`}
          />
          <button
            type="submit"
            disabled={!newListName.trim()}
            aria-label="Add list"
            className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10.5px] font-medium ${tokens.accentBg} ${tokens.buttonRadius} disabled:opacity-40 shrink-0`}
          >
            <Plus className="w-3 h-3" />
            Add
          </button>
        </form>
      </div>
    </div>
  );

  const notificationsCard = (
    <div className="space-y-1">
      <span className="text-[10.5px] font-medium text-stone-400 dark:text-stone-500 px-1">
        Notifications
      </span>
      <div className={`${tokens.cardBg} ${tokens.cardRadius} overflow-hidden`}>
        {/* System Permission Row */}
        <div className={`px-2.5 py-2 border-b ${tokens.divider} space-y-1.5`}>
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 flex items-center gap-2">
              <span
                className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${
                  notifPerm === 'granted'
                    ? `${tokens.accentSoftBg} ${tokens.accentText}`
                    : notifPerm === 'denied'
                      ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
                      : `${tokens.subtleBg} text-stone-500 dark:text-stone-400`
                }`}
              >
                {notifPerm === 'denied' ? (
                  <BellOff className="w-3.5 h-3.5" />
                ) : (
                  <Bell className="w-3.5 h-3.5" />
                )}
              </span>
              <div className="min-w-0">
                <p className="text-[11.5px] font-medium text-stone-900 dark:text-stone-100 leading-tight">
                  System notifications
                </p>
                <p className="text-[10px] text-stone-500 dark:text-stone-400 leading-tight mt-0.5 truncate">
                  {notifPerm === 'granted'
                    ? 'Allowed · Registered for Android alerts'
                    : notifPerm === 'denied'
                      ? 'Blocked in system / browser settings'
                      : notifPerm === 'unsupported'
                        ? 'In-app alerts only on this browser'
                        : 'Tap Enable to register in Android settings'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              {notifPerm === 'default' && (
                <button
                  type="button"
                  disabled={notifBusy}
                  onClick={() => void handleEnableNotifications()}
                  className={`px-2.5 py-1 text-[10.5px] font-medium ${tokens.accentBg} ${tokens.buttonRadius} hover:opacity-90 disabled:opacity-60`}
                >
                  {notifBusy ? 'Requesting...' : 'Enable'}
                </button>
              )}
              {notifPerm === 'granted' && (
                <button
                  type="button"
                  disabled={notifBusy}
                  onClick={() => void handleSendTestNotification()}
                  className={`px-2 py-1 text-[10.5px] font-medium ${tokens.accentSoftBg} ${tokens.accentText} ${tokens.buttonRadius} hover:opacity-90 disabled:opacity-60`}
                >
                  {notifBusy ? 'Sending...' : 'Send test'}
                </button>
              )}
              {notifPerm === 'denied' && (
                <button
                  type="button"
                  onClick={() => {
                    const next = getNotificationPermissionState();
                    setNotifPerm(next);
                    setNotifFeedback(
                      next === 'granted'
                        ? 'Notifications are now enabled.'
                        : 'Still blocked — enable under Android App Info → Notifications.'
                    );
                  }}
                  className={`inline-flex items-center gap-1 px-2 py-1 text-[10.5px] font-medium ${tokens.subtleBg} text-stone-700 dark:text-stone-200 ${tokens.buttonRadius}`}
                >
                  <RefreshCw className="w-3 h-3" />
                  Recheck
                </button>
              )}
            </div>
          </div>

          {notifFeedback && (
            <p className={`text-[10px] leading-snug ${tokens.accentText}`}>{notifFeedback}</p>
          )}

          {inIframe && notifPerm !== 'granted' && (
            <p className="text-[10px] text-amber-600 dark:text-amber-400 leading-snug">
              Open buh. as an installed app or direct browser tab on Android to trigger the OS notification permission prompt.
            </p>
          )}
        </div>

        {/* Reminder Toggles */}
        {renderToggleRow(
          'Task reminder alerts',
          'Notify at relative offsets and exact reminder times',
          settings.taskRemindersEnabled !== false,
          () => onUpdateSettings({ taskRemindersEnabled: !(settings.taskRemindersEnabled !== false) })
        )}
        {renderToggleRow(
          'Alert sound chime',
          'Play a soft chime when a reminder triggers',
          settings.reminderSound !== false,
          () => onUpdateSettings({ reminderSound: !(settings.reminderSound !== false) })
        )}

        {/* Android System Settings Instructions */}
        <div className={`px-2.5 py-1.5 border-t ${tokens.divider}`}>
          <button
            type="button"
            onClick={() => setShowAndroidGuide((v) => !v)}
            className="w-full flex items-center justify-between gap-2 text-left py-0.5"
          >
            <span className="inline-flex items-center gap-1.5 text-[10.5px] font-medium text-stone-700 dark:text-stone-200">
              <Smartphone className="w-3 h-3 text-stone-400 shrink-0" />
              Android system settings setup
            </span>
            {showAndroidGuide ? (
              <ChevronUp className="w-3.5 h-3.5 text-stone-400 shrink-0" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 text-stone-400 shrink-0" />
            )}
          </button>

          {showAndroidGuide && (
            <div className="mt-1.5 space-y-1 text-[10px] text-stone-500 dark:text-stone-400 leading-relaxed">
              <p>
                <strong className="text-stone-700 dark:text-stone-200">1. Register permission:</strong>{' '}
                Tap <strong>Enable</strong> above (or <strong>Send test</strong>) first so Android creates the notification channel for <strong>buh.</strong>
              </p>
              <p>
                <strong className="text-stone-700 dark:text-stone-200">2. Installed app (Android / Samsung):</strong>{' '}
                Long-press the <strong>buh.</strong> icon → <strong>App info (ⓘ)</strong> → <strong>Notifications</strong> → turn on <strong>Allow notifications</strong> (or open <strong>Settings → Apps → buh. → Notifications</strong>).
              </p>
              <p>
                <strong className="text-stone-700 dark:text-stone-200">3. In Chrome / Samsung Internet:</strong>{' '}
                Tap the <strong>tune / lock icon</strong> in the address bar → <strong>Permissions</strong> → <strong>Notifications</strong> → <strong>Allow</strong>.
              </p>
              <p>
                <strong className="text-stone-700 dark:text-stone-200">4. Reliable timing on Galaxy Fold:</strong>{' '}
                In <strong>App info → Battery</strong>, select <strong>Unrestricted</strong> so Android doesn&apos;t delay scheduled alerts.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const adaptiveCard = (
    <div className="space-y-1">
      <span className="text-[10.5px] font-medium text-stone-400 dark:text-stone-500 px-1">Adaptive Layout</span>
      <div className={`${tokens.cardBg} ${tokens.cardRadius} overflow-hidden`}>
        {renderToggleRow(
          'Hinge-aware two-pane split',
          'Add center crease clearance when unfolded',
          settings.hingeAwareSplit,
          () => onUpdateSettings({ hingeAwareSplit: !settings.hingeAwareSplit })
        )}
        {renderToggleRow(
          'One-handed cover reach',
          'Keep primary capture inside lower thumb zone',
          settings.oneHandedCoverReach,
          () => onUpdateSettings({ oneHandedCoverReach: !settings.oneHandedCoverReach })
        )}
      </div>
    </div>
  );

  const isAnyGoogleSyncing = googleCalendar.isSyncing || googleTasks.isSyncing;
  const combinedGoogleError = googleTasks.error || googleCalendar.error;
  const lastGoogleUpdate = googleTasks.lastSyncedAt || googleCalendar.lastSyncedAt;
  const pendingOfflineCount = googleTasks.pendingSyncCount ?? googleCalendar.pendingSyncCount ?? 0;

  const integrationsCard = (
    <div className="space-y-1">
      <span className="text-[10.5px] font-medium text-stone-400 dark:text-stone-500 px-1">Google Sync & Export</span>
      <div className={`${tokens.cardBg} ${tokens.cardRadius} overflow-hidden`}>
        {renderToggleRow(
          'Google Calendar sync',
          googleCalendar.isConnected
            ? `Synced with ${googleCalendar.userEmail || 'Google account'}`
            : 'Connect Google to view & add calendar events',
          settings.googleCalendarSync,
          () => onUpdateSettings({ googleCalendarSync: !settings.googleCalendarSync })
        )}
        {renderToggleRow(
          'Google Tasks sync',
          googleTasks.isConnected
            ? `${googleTasks.syncedCount} synced tasks across ${Math.max(1, googleTasks.taskLists.length)} list${googleTasks.taskLists.length === 1 ? '' : 's'}`
            : 'Sync task lists, due dates, and completion status',
          settings.googleTasksSync,
          () => onUpdateSettings({ googleTasksSync: !settings.googleTasksSync })
        )}
        <div className={`px-3 py-2 border-b ${tokens.divider} space-y-1.5`}>
          {googleCalendar.isConnected ? (
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[11px] font-medium text-stone-800 dark:text-stone-100 truncate">
                  {googleCalendar.userEmail || 'Google account connected'}
                </p>
                <p className="text-[10px] text-stone-500 dark:text-stone-400 truncate tabular-nums">
                  {googleCalendar.syncedCount} events · {googleTasks.syncedCount} tasks
                  {lastGoogleUpdate ? ` · ${lastGoogleUpdate}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  disabled={isAnyGoogleSyncing}
                  onClick={() => {
                    void googleCalendar.onSyncNow();
                    void googleTasks.onSyncNow();
                  }}
                  aria-label="Sync Google Calendar and Tasks now"
                  className={`inline-flex items-center gap-1 px-2 py-1 text-[10.5px] font-medium ${tokens.accentSoftBg} ${tokens.accentText} ${tokens.buttonRadius} disabled:opacity-60`}
                >
                  <RefreshCw className={`w-3 h-3 ${isAnyGoogleSyncing ? 'animate-spin' : ''}`} />
                  Sync
                </button>
                <button
                  type="button"
                  onClick={() => googleCalendar.onSignOut()}
                  aria-label="Disconnect Google account"
                  title="Sign out"
                  className={`p-1 ${tokens.subtleBg} text-stone-500 hover:text-rose-500 ${tokens.buttonRadius} transition-colors`}
                >
                  <LogOut className="w-3 h-3" />
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-1.5">
              <GoogleSignInButton
                onClick={() => googleCalendar.onSignIn()}
                loading={googleCalendar.isSigningIn}
                label={googleCalendar.userEmail ? 'Reconnect Google' : 'Sign in with Google'}
              />
              <p className="text-[10px] text-stone-400 dark:text-stone-500 leading-snug">
                {googleCalendar.userEmail
                  ? `Signed in as ${googleCalendar.userEmail}. Tap above to resume live Google Calendar & Tasks sync.`
                  : 'Sign in with your Google account to sync Calendar events and Google Tasks into buh.'}
              </p>
            </div>
          )}
          {pendingOfflineCount > 0 && (
            <div
              className={`flex items-center justify-between gap-2 px-2 py-1.5 ${tokens.accentSoftBg} ${tokens.buttonRadius}`}
            >
              <span className={`text-[10px] font-medium ${tokens.accentText}`}>
                {pendingOfflineCount} offline change{pendingOfflineCount === 1 ? '' : 's'} queued to sync
              </span>
              {googleTasks.onSyncPending && (
                <button
                  type="button"
                  disabled={isAnyGoogleSyncing}
                  onClick={() => googleTasks.onSyncPending?.()}
                  className={`px-2 py-0.5 text-[10px] font-medium ${tokens.accentBg} ${tokens.buttonRadius} shrink-0 disabled:opacity-60`}
                >
                  Sync now
                </button>
              )}
            </div>
          )}
          {combinedGoogleError && (
            <p className="text-[10px] text-rose-600 dark:text-rose-400 leading-snug">
              {combinedGoogleError}
            </p>
          )}
        </div>
        {renderToggleRow(
          'Natural language parse',
          'Highlight and extract times and lists while typing',
          settings.nlpQuickParse,
          () => onUpdateSettings({ nlpQuickParse: !settings.nlpQuickParse })
        )}
        <div className="flex items-center justify-between gap-2 px-3 py-2">
          <div className="min-w-0">
            <p className="text-[12px] font-medium text-stone-900 dark:text-stone-100">TickTick CSV export</p>
            <p className="text-[10.5px] text-stone-500 dark:text-stone-400 truncate">
              Backup format ({tasks.length} tasks)
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowExportPreview(true)}
            className={`inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium ${tokens.accentSoftBg} ${tokens.accentText} ${tokens.buttonRadius} shrink-0`}
          >
            <Download className="w-3 h-3" />
            Export
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className={`h-full overflow-y-auto device-scroll ${posture === FoldPosture.Inner ? 'px-4 py-2' : 'px-3 pt-1.5 pb-20'}`}>
      <div className="flex items-center justify-between mb-1.5">
        <h2 className={`font-display font-semibold text-stone-900 dark:text-stone-100 ${tokens.headingScale}`}>
          Settings
        </h2>
      </div>

      {posture === FoldPosture.Inner ? (
        <div className={`grid grid-cols-2 ${settings.hingeAwareSplit ? 'gap-5' : 'gap-3'} items-start`}>
          <div className="space-y-2">
            {appearanceCard}
            {listsCard}
          </div>
          <div className="space-y-2">
            {notificationsCard}
            {adaptiveCard}
            {integrationsCard}
          </div>
        </div>
      ) : (
        <div className="space-y-1.5">
          {notificationsCard}
          {appearanceCard}
          {listsCard}
          {adaptiveCard}
          {integrationsCard}
        </div>
      )}

      {showExportPreview && (
        <div className="absolute inset-0 z-30 bg-black/40 backdrop-blur-[1px] flex items-center justify-center p-4">
          <div className={`w-full max-w-sm ${tokens.cardBg} ${tokens.cardRadius} p-4 space-y-3`}>
            <div className="flex items-center justify-between">
              <h3 className="font-display text-sm font-semibold text-stone-900 dark:text-stone-100">
                TickTick Export Preview
              </h3>
              <button
                type="button"
                onClick={() => setShowExportPreview(false)}
                className="p-1 text-stone-400 hover:text-stone-800 dark:hover:text-stone-100"
                aria-label="Close export preview"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <pre className={`text-[10px] font-mono-tabular p-2.5 overflow-x-auto max-h-44 ${tokens.subtleBg} text-stone-700 dark:text-stone-300 ${tokens.buttonRadius}`}>
              {csvPreview}
            </pre>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  const blob = new Blob([csvPreview], { type: 'text/csv;charset=utf-8;' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = 'buh-ticktick-export.csv';
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium ${tokens.subtleBg} text-stone-800 dark:text-stone-100 ${tokens.buttonRadius} hover:opacity-90`}
              >
                <Download className="w-3.5 h-3.5" />
                Download CSV
              </button>
              <button
                type="button"
                onClick={() => setShowExportPreview(false)}
                className={`px-3 py-1.5 text-xs font-medium ${tokens.accentBg} ${tokens.buttonRadius}`}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
