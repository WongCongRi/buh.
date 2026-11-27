import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Bell,
  BellOff,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  Download,
  Folder,
  GripVertical,
  List,
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
  CloudNotesSyncState,
  FoldPosture,
  GoogleCalendarSyncState,
  GoogleTasksSyncState,
  NoteItem,
  TaskItem,
} from '../../types/taskflow';
import { isValidHex, normalizeHex } from '../../utils/colorUtils';
import { formatDateObjDDMMYYYY } from '../../utils/dateLabels';
import { formatTimeDisplay, useTimeFormat } from '../../utils/timeFormat';
import {
  dispatchTestNotification,
  getNotificationPermissionState,
  getPushSubscriptionStatus,
  isAndroidDevice,
  isEmbeddedIframe,
  NotificationSupportState,
  requestAppNotificationPermission,
  subscribeToServiceWorkerPush,
} from '../../utils/taskReminders';
import { StyleThemeTokens } from '../../utils/themeTokens';
import { GoogleSignInButton } from '../GoogleSignInButton';
import { useBackLayer } from '../../hooks/useAndroidBackNavigation';

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
  noteFolders: string[];
  notes: NoteItem[];
  onAddFolder: (name: string) => void;
  onRenameFolder: (oldName: string, newName: string) => void;
  onDeleteFolder: (name: string) => void;
  onReorderFolder: (fromIndex: number, toIndex: number) => void;
  settings: AppSettingsState;
  onUpdateSettings: (patch: Partial<AppSettingsState>) => void;
  tasks: TaskItem[];
  hiddenCompletedTasksCount?: number;
  googleCalendar: GoogleCalendarSyncState;
  googleTasks: GoogleTasksSyncState;
  cloudNotesSync: CloudNotesSyncState;
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
  noteFolders,
  notes,
  onAddFolder,
  onRenameFolder,
  onDeleteFolder,
  onReorderFolder,
  settings,
  onUpdateSettings,
  tasks,
  hiddenCompletedTasksCount = 0,
  googleCalendar,
  googleTasks,
  cloudNotesSync,
}) => {
  const activeTimeFormat = useTimeFormat();
  const [showExportPreview, setShowExportPreview] = useState(false);

  const taskCountByCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of tasks) {
      map.set(t.category, (map.get(t.category) || 0) + 1);
    }
    return map;
  }, [tasks]);

  const noteCountByFolder = useMemo(() => {
    const map = new Map<string, number>();
    for (const n of notes) {
      map.set(n.folder, (map.get(n.folder) || 0) + 1);
    }
    return map;
  }, [notes]);

  // Lists & Folders sections are collapsed by default
  const [listsExpanded, setListsExpanded] = useState(false);
  const [foldersExpanded, setFoldersExpanded] = useState(false);

  // Task Lists editing & reorder state
  const [newListName, setNewListName] = useState('');
  const [editingList, setEditingList] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState('');
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  // Note Folders editing & reorder state
  const [newFolderName, setNewFolderName] = useState('');
  const [editingFolder, setEditingFolder] = useState<string | null>(null);
  const [editingFolderDraft, setEditingFolderDraft] = useState('');
  const [folderDragIndex, setFolderDragIndex] = useState<number | null>(null);
  const [folderDropIndex, setFolderDropIndex] = useState<number | null>(null);

  useBackLayer(showExportPreview, () => setShowExportPreview(false), 20);
  useBackLayer(
    Boolean(editingList || editingFolder),
    () => {
      setEditingList(null);
      setEditingDraft('');
      setEditingFolder(null);
      setEditingFolderDraft('');
    },
    10
  );

  const [notifPerm, setNotifPerm] = useState<NotificationSupportState>(() =>
    getNotificationPermissionState()
  );
  const [pushSubscribed, setPushSubscribed] = useState<boolean>(false);
  const [pushSupported, setPushSupported] = useState<boolean>(false);
  const [notifBusy, setNotifBusy] = useState(false);
  const [notifFeedback, setNotifFeedback] = useState<string | null>(null);
  // Collapsed by default when notifications are already enabled
  const [showAndroidGuide, setShowAndroidGuide] = useState<boolean>(() => {
    const perm = getNotificationPermissionState();
    if (perm === 'granted') return false;
    return perm === 'denied' || isAndroidDevice();
  });
  const debounceRef = useRef<number | null>(null);
  const pendingCommitHexRef = useRef<string | null>(null);
  const currentHex = normalizeHex(accentColor);
  const [hexInput, setHexInput] = useState<string>(currentHex);
  const [isEditingHex, setIsEditingHex] = useState<boolean>(false);
  const [hexError, setHexError] = useState<boolean>(false);
  const hexInputRef = useRef<HTMLInputElement | null>(null);
  const inIframe = isEmbeddedIframe();

  useEffect(() => {
    if (!isEditingHex) {
      setHexInput(currentHex);
      setHexError(false);
    }
  }, [currentHex, isEditingHex]);

  // Auto-refresh notification permission & Service Worker push status when returning from Android Settings
  useEffect(() => {
    let active = true;
    const refreshPush = () => {
      void getPushSubscriptionStatus().then((status) => {
        if (!active) return;
        setPushSupported(status.supported);
        setPushSubscribed(status.subscribed);
      });
    };
    const refreshPerm = () => {
      const next = getNotificationPermissionState();
      setNotifPerm(next);
      if (next === 'denied') {
        setShowAndroidGuide(true);
      } else if (next === 'granted') {
        setShowAndroidGuide(false);
      }
      refreshPush();
    };
    refreshPush();
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
      active = false;
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
        setShowAndroidGuide(false);
        const pushRes = await subscribeToServiceWorkerPush();
        setPushSubscribed(pushRes.subscribed);
        window.dispatchEvent(new CustomEvent('buh:push-ready'));
        const test = await dispatchTestNotification(settings.reminderSound !== false);
        setNotifFeedback(
          test.viaPush
            ? 'Service worker push enabled — scheduled reminders will alert even when buh. is closed.'
            : test.delivered
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
      if (res.viaPush) {
        setPushSubscribed(true);
        window.dispatchEvent(new CustomEvent('buh:push-ready'));
      }
      if (res.delivered) {
        setNotifFeedback(
          res.viaPush
            ? 'Push alert delivered via service worker — check your notification shade.'
            : 'Test alert sent — check your notification shade or Android App Info.'
        );
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
    setHexInput(normalized);
    setHexError(false);
    pendingCommitHexRef.current = normalized;
    onPreviewAccentColor(normalized);
    if (debounceRef.current) {
      window.clearTimeout(debounceRef.current);
    }
    debounceRef.current = window.setTimeout(() => {
      onSelectAccentColor(normalized);
      pendingCommitHexRef.current = null;
      debounceRef.current = null;
    }, 450);
  };

  const handlePickerBlur = () => {
    if (debounceRef.current) {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    const target = pendingCommitHexRef.current ?? currentHex;
    pendingCommitHexRef.current = null;
    onSelectAccentColor(target);
  };

  const handleHexInputChange = (raw: string) => {
    const trimmed = raw.trimStart();
    const hasLeadingHash = trimmed.startsWith('#');
    const digits = trimmed.replace(/[^0-9a-fA-F]/g, '').slice(0, 6);
    const nextValue = (hasLeadingHash ? '#' : '') + digits;
    setHexInput(nextValue);
    setHexError(false);

    if (digits.length === 6) {
      const normalized = normalizeHex(nextValue);
      pendingCommitHexRef.current = normalized;
      onPreviewAccentColor(normalized);
      if (debounceRef.current) {
        window.clearTimeout(debounceRef.current);
      }
      debounceRef.current = window.setTimeout(() => {
        onSelectAccentColor(normalized);
        pendingCommitHexRef.current = null;
        debounceRef.current = null;
      }, 450);
    }
  };

  const handleHexSubmit = () => {
    if (!isValidHex(hexInput)) {
      setHexError(true);
      return;
    }
    if (debounceRef.current) {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    const normalized = normalizeHex(hexInput);
    pendingCommitHexRef.current = null;
    setHexInput(normalized);
    setHexError(false);
    setIsEditingHex(false);
    onSelectAccentColor(normalized);
    hexInputRef.current?.blur();
  };

  const handleHexBlur = () => {
    if (debounceRef.current) {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    if (isValidHex(hexInput)) {
      const normalized = normalizeHex(hexInput);
      const shouldCommit =
        normalized !== currentHex || pendingCommitHexRef.current !== null;
      pendingCommitHexRef.current = null;
      setHexInput(normalized);
      setHexError(false);
      setIsEditingHex(false);
      if (shouldCommit) {
        onSelectAccentColor(normalized);
      }
      return;
    }
    if (pendingCommitHexRef.current) {
      onSelectAccentColor(pendingCommitHexRef.current);
      pendingCommitHexRef.current = null;
    }
    setHexInput(currentHex);
    setHexError(false);
    setIsEditingHex(false);
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

  const handleCreateFolder = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newFolderName.trim();
    if (!trimmed) return;
    onAddFolder(trimmed);
    setNewFolderName('');
  };

  const handleCommitFolderRename = (oldName: string) => {
    const trimmed = editingFolderDraft.trim();
    if (trimmed && trimmed !== oldName) {
      onRenameFolder(oldName, trimmed);
    }
    setEditingFolder(null);
    setEditingFolderDraft('');
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
    <div className={`flex items-center justify-between gap-3 px-3.5 py-2.5 border-b last:border-b-0 ${tokens.divider}`}>
      <div className="min-w-0">
        <p className="text-[14.5px] font-medium text-stone-900 dark:text-stone-100 leading-snug">{title}</p>
        <p className="text-[12.5px] text-stone-500 dark:text-stone-400 truncate leading-snug mt-0.5">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={onChange}
        className={`w-11 h-6 rounded-full p-0.5 transition-colors shrink-0 ${
          checked ? tokens.accentBg : 'bg-stone-300 dark:bg-stone-700'
        }`}
      >
        <span
          className={`block w-5 h-5 rounded-full bg-white shadow-xs transition-transform ${
            checked ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  );

  // Category 1: Organization (Lists + Note Folders, both collapsed by default)
  const organizationSection = (
    <section className="space-y-2">
      <span className="block text-[12px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500 px-1">
        Organization
      </span>

      {/* Task Lists (collapsible, collapsed by default) */}
      <div className={`${tokens.cardBg} ${tokens.cardRadius} overflow-hidden`}>
        <button
          type="button"
          aria-expanded={listsExpanded}
          onClick={() => setListsExpanded((v) => !v)}
          className={`w-full flex items-center justify-between gap-2.5 px-3.5 py-2.5 text-left transition-colors hover:bg-stone-50/70 dark:hover:bg-white/[0.02] ${
            listsExpanded ? `border-b ${tokens.divider}` : ''
          }`}
        >
          <div className="min-w-0 flex items-center gap-2.5">
            <span className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${tokens.subtleBg} text-stone-500 dark:text-stone-400`}>
              <List className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <p className="text-[14.5px] font-medium text-stone-900 dark:text-stone-100 leading-snug">
                Task Lists
              </p>
              <p className="text-[12.5px] text-stone-500 dark:text-stone-400 truncate leading-snug mt-0.5">
                {listsExpanded
                  ? 'Drag or use arrows to reorder task lists'
                  : `${taskLists.length} ${taskLists.length === 1 ? 'list' : 'lists'} · ${taskLists.join(', ')}`}
              </p>
            </div>
          </div>
          {listsExpanded ? (
            <ChevronUp className="w-4 h-4 text-stone-400 shrink-0" />
          ) : (
            <ChevronDown className="w-4 h-4 text-stone-400 shrink-0" />
          )}
        </button>

        {listsExpanded && (
          <div>
            {taskLists.map((listName, idx) => {
              const count = taskCountByCategory.get(listName) || 0;
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
                  className={`flex items-center justify-between gap-2 px-3.5 py-2 border-b ${tokens.divider} transition-colors ${
                    isDragging ? 'opacity-50' : ''
                  } ${isDropTarget ? tokens.accentSoftBg : ''}`}
                >
                  {isEditing ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        handleCommitRename(listName);
                      }}
                      className="flex-1 flex items-center gap-2"
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
                        className={`flex-1 text-[14px] px-2.5 py-1 ${tokens.subtleBg} text-stone-900 dark:text-stone-100 ${tokens.buttonRadius} focus:outline-none`}
                      />
                      <button
                        type="submit"
                        aria-label="Save list name"
                        className={`p-1.5 ${tokens.accentBg} ${tokens.buttonRadius}`}
                      >
                        <Check className="w-4 h-4" />
                      </button>
                    </form>
                  ) : (
                    <>
                      <div className="min-w-0 flex items-center gap-2">
                        <span
                          className="text-stone-300 dark:text-stone-600 cursor-grab active:cursor-grabbing shrink-0"
                          title="Drag to reorder"
                          aria-hidden="true"
                        >
                          <GripVertical className="w-4 h-4" />
                        </span>
                        <span className="text-[14.5px] font-medium text-stone-900 dark:text-stone-100 truncate">
                          {listName}
                        </span>
                        <span className="text-[12px] text-stone-400 tabular-nums">{count}</span>
                      </div>
                      <div className="flex items-center gap-0.5 shrink-0">
                        <button
                          type="button"
                          disabled={idx === 0}
                          onClick={() => onReorderList(idx, idx - 1)}
                          aria-label={`Move ${listName} up`}
                          className="p-1.5 text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 disabled:opacity-25 rounded"
                        >
                          <ArrowUp className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          disabled={idx === taskLists.length - 1}
                          onClick={() => onReorderList(idx, idx + 1)}
                          aria-label={`Move ${listName} down`}
                          className="p-1.5 text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 disabled:opacity-25 rounded"
                        >
                          <ArrowDown className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingFolder(null);
                            setEditingFolderDraft('');
                            setEditingList(listName);
                            setEditingDraft(listName);
                          }}
                          aria-label={`Rename ${listName}`}
                          className="p-1.5 text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 rounded"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        {taskLists.length > 1 && (
                          <button
                            type="button"
                            onClick={() => onDeleteList(listName)}
                            aria-label={`Delete ${listName}`}
                            className="p-1.5 text-stone-400 hover:text-rose-500 rounded"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              );
            })}

            <form onSubmit={handleCreateList} className="flex items-center gap-2 px-3.5 py-2.5">
              <input
                type="text"
                value={newListName}
                onChange={(e) => setNewListName(e.target.value)}
                placeholder="New list name..."
                aria-label="New list name"
                className={`flex-1 text-[14px] px-2.5 py-1.5 ${tokens.subtleBg} text-stone-900 dark:text-stone-100 placeholder:text-stone-400 ${tokens.buttonRadius} focus:outline-none`}
              />
              <button
                type="submit"
                disabled={!newListName.trim()}
                aria-label="Add list"
                className={`inline-flex items-center gap-1 px-3 py-1.5 text-[13px] font-medium ${tokens.accentBg} ${tokens.buttonRadius} disabled:opacity-40 shrink-0`}
              >
                <Plus className="w-4 h-4" />
                Add
              </button>
            </form>
          </div>
        )}
      </div>

      {/* Note Folders (right under Lists, collapsible, collapsed by default) */}
      <div className={`${tokens.cardBg} ${tokens.cardRadius} overflow-hidden`}>
        <button
          type="button"
          aria-expanded={foldersExpanded}
          onClick={() => setFoldersExpanded((v) => !v)}
          className={`w-full flex items-center justify-between gap-2.5 px-3.5 py-2.5 text-left transition-colors hover:bg-stone-50/70 dark:hover:bg-white/[0.02] ${
            foldersExpanded ? `border-b ${tokens.divider}` : ''
          }`}
        >
          <div className="min-w-0 flex items-center gap-2.5">
            <span className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${tokens.subtleBg} text-stone-500 dark:text-stone-400`}>
              <Folder className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <p className="text-[14.5px] font-medium text-stone-900 dark:text-stone-100 leading-snug">
                Note Folders
              </p>
              <p className="text-[12.5px] text-stone-500 dark:text-stone-400 truncate leading-snug mt-0.5">
                {foldersExpanded
                  ? 'Drag or use arrows to reorder note folders'
                  : `${noteFolders.length} ${noteFolders.length === 1 ? 'folder' : 'folders'} · ${noteFolders.join(', ')}`}
              </p>
            </div>
          </div>
          {foldersExpanded ? (
            <ChevronUp className="w-4 h-4 text-stone-400 shrink-0" />
          ) : (
            <ChevronDown className="w-4 h-4 text-stone-400 shrink-0" />
          )}
        </button>

        {foldersExpanded && (
          <div>
            {noteFolders.map((folderName, idx) => {
              const count = noteCountByFolder.get(folderName) || 0;
              const isEditing = editingFolder === folderName;
              const isDragging = folderDragIndex === idx;
              const isDropTarget =
                folderDropIndex === idx && folderDragIndex !== null && folderDragIndex !== idx;
              return (
                <div
                  key={folderName}
                  draggable={!isEditing}
                  onDragStart={(e) => {
                    setFolderDragIndex(idx);
                    setFolderDropIndex(idx);
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', String(idx));
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    if (folderDropIndex !== idx) setFolderDropIndex(idx);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const from = folderDragIndex ?? Number(e.dataTransfer.getData('text/plain'));
                    if (!Number.isNaN(from) && from !== idx) {
                      onReorderFolder(from, idx);
                    }
                    setFolderDragIndex(null);
                    setFolderDropIndex(null);
                  }}
                  onDragEnd={() => {
                    setFolderDragIndex(null);
                    setFolderDropIndex(null);
                  }}
                  className={`flex items-center justify-between gap-2 px-3.5 py-2 border-b ${tokens.divider} transition-colors ${
                    isDragging ? 'opacity-50' : ''
                  } ${isDropTarget ? tokens.accentSoftBg : ''}`}
                >
                  {isEditing ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        handleCommitFolderRename(folderName);
                      }}
                      className="flex-1 flex items-center gap-2"
                    >
                      <input
                        type="text"
                        autoFocus
                        value={editingFolderDraft}
                        onChange={(e) => setEditingFolderDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') {
                            setEditingFolder(null);
                            setEditingFolderDraft('');
                          }
                        }}
                        aria-label={`Rename ${folderName}`}
                        className={`flex-1 text-[14px] px-2.5 py-1 ${tokens.subtleBg} text-stone-900 dark:text-stone-100 ${tokens.buttonRadius} focus:outline-none`}
                      />
                      <button
                        type="submit"
                        aria-label="Save folder name"
                        className={`p-1.5 ${tokens.accentBg} ${tokens.buttonRadius}`}
                      >
                        <Check className="w-4 h-4" />
                      </button>
                    </form>
                  ) : (
                    <>
                      <div className="min-w-0 flex items-center gap-2">
                        <span
                          className="text-stone-300 dark:text-stone-600 cursor-grab active:cursor-grabbing shrink-0"
                          title="Drag to reorder"
                          aria-hidden="true"
                        >
                          <GripVertical className="w-4 h-4" />
                        </span>
                        <span className="text-[14.5px] font-medium text-stone-900 dark:text-stone-100 truncate">
                          {folderName}
                        </span>
                        <span className="text-[12px] text-stone-400 tabular-nums">{count}</span>
                      </div>
                      <div className="flex items-center gap-0.5 shrink-0">
                        <button
                          type="button"
                          disabled={idx === 0}
                          onClick={() => onReorderFolder(idx, idx - 1)}
                          aria-label={`Move ${folderName} up`}
                          className="p-1.5 text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 disabled:opacity-25 rounded"
                        >
                          <ArrowUp className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          disabled={idx === noteFolders.length - 1}
                          onClick={() => onReorderFolder(idx, idx + 1)}
                          aria-label={`Move ${folderName} down`}
                          className="p-1.5 text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 disabled:opacity-25 rounded"
                        >
                          <ArrowDown className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingList(null);
                            setEditingDraft('');
                            setEditingFolder(folderName);
                            setEditingFolderDraft(folderName);
                          }}
                          aria-label={`Rename ${folderName}`}
                          className="p-1.5 text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 rounded"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        {noteFolders.length > 1 && (
                          <button
                            type="button"
                            onClick={() => onDeleteFolder(folderName)}
                            aria-label={`Delete ${folderName}`}
                            className="p-1.5 text-stone-400 hover:text-rose-500 rounded"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              );
            })}

            <form onSubmit={handleCreateFolder} className="flex items-center gap-2 px-3.5 py-2.5">
              <input
                type="text"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="New folder name..."
                aria-label="New folder name"
                className={`flex-1 text-[14px] px-2.5 py-1.5 ${tokens.subtleBg} text-stone-900 dark:text-stone-100 placeholder:text-stone-400 ${tokens.buttonRadius} focus:outline-none`}
              />
              <button
                type="submit"
                disabled={!newFolderName.trim()}
                aria-label="Add folder"
                className={`inline-flex items-center gap-1 px-3 py-1.5 text-[13px] font-medium ${tokens.accentBg} ${tokens.buttonRadius} disabled:opacity-40 shrink-0`}
              >
                <Plus className="w-4 h-4" />
                Add
              </button>
            </form>
          </div>
        )}
      </div>
    </section>
  );

  // Category 2: Tasks & Capture
  const historyYears = Math.max(0, Math.floor(settings.completedTaskHistoryYears ?? 0));
  const historyMonths = Math.max(0, Math.floor(settings.completedTaskHistoryMonths ?? 0));
  const hasHistoryLimit = historyYears > 0 || historyMonths > 0;
  const historyCutoffLabel = (() => {
    if (!hasHistoryLimit) return 'Showing all completed tasks';
    const now = new Date();
    const cutoff = new Date(
      now.getFullYear() - historyYears,
      now.getMonth() - historyMonths,
      now.getDate()
    );
    const formatted = formatDateObjDDMMYYYY(cutoff);
    return `Showing completed tasks since ${formatted}`;
  })();

  const completedHistoryPresets: { label: string; years: number; months: number }[] = [
    { label: '1m', years: 0, months: 1 },
    { label: '3m', years: 0, months: 3 },
    { label: '6m', years: 0, months: 6 },
    { label: '1y', years: 1, months: 0 },
    { label: 'All', years: 0, months: 0 },
  ];

  const tasksCaptureSection = (
    <section className="space-y-2">
      <span className="block text-[12px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500 px-1">
        Tasks &amp; Capture
      </span>
      <div className={`${tokens.cardBg} ${tokens.cardRadius} overflow-hidden`}>
        {renderToggleRow(
          'Natural language parse',
          'Highlight and extract times and lists while typing',
          settings.nlpQuickParse,
          () => onUpdateSettings({ nlpQuickParse: !settings.nlpQuickParse })
        )}
        <div className="p-3.5 space-y-3">
          <div className="space-y-0.5">
            <p className="text-[14.5px] font-medium text-stone-900 dark:text-stone-100 leading-tight">
              Completed tasks history
            </p>
            <p className="text-[12.5px] text-stone-500 dark:text-stone-400 leading-snug">
              {historyCutoffLabel}
              {hiddenCompletedTasksCount > 0
                ? ` · ${hiddenCompletedTasksCount} older hidden`
                : ''}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1">
              <span className="block text-[11.5px] font-medium text-stone-500 dark:text-stone-400">
                Years
              </span>
              <select
                aria-label="Completed task history years"
                value={historyYears}
                onChange={(e) =>
                  onUpdateSettings({
                    completedTaskHistoryYears: Math.max(0, parseInt(e.target.value, 10) || 0),
                  })
                }
                className={`w-full px-2.5 py-2 text-[13.5px] font-medium ${tokens.subtleBg} text-stone-800 dark:text-stone-100 ${tokens.buttonRadius} focus:outline-none tabular-nums`}
              >
                {Array.from({ length: 11 }, (_, y) => (
                  <option key={y} value={y}>
                    {y} {y === 1 ? 'year' : 'years'}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="block text-[11.5px] font-medium text-stone-500 dark:text-stone-400">
                Months
              </span>
              <select
                aria-label="Completed task history months"
                value={historyMonths}
                onChange={(e) =>
                  onUpdateSettings({
                    completedTaskHistoryMonths: Math.max(0, parseInt(e.target.value, 10) || 0),
                  })
                }
                className={`w-full px-2.5 py-2 text-[13.5px] font-medium ${tokens.subtleBg} text-stone-800 dark:text-stone-100 ${tokens.buttonRadius} focus:outline-none tabular-nums`}
              >
                {Array.from({ length: 12 }, (_, m) => (
                  <option key={m} value={m}>
                    {m} {m === 1 ? 'month' : 'months'}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {completedHistoryPresets.map((preset) => {
              const active =
                historyYears === preset.years && historyMonths === preset.months;
              return (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() =>
                    onUpdateSettings({
                      completedTaskHistoryYears: preset.years,
                      completedTaskHistoryMonths: preset.months,
                    })
                  }
                  className={`px-2.5 py-1 text-[12px] font-medium ${tokens.buttonRadius} transition-colors ${
                    active
                      ? `${tokens.accentBg}`
                      : `${tokens.subtleBg} text-stone-600 dark:text-stone-300 hover:opacity-90`
                  }`}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );

  // Category 3: Notifications
  const notificationsSection = (
    <section className="space-y-2">
      <span className="block text-[12px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500 px-1">
        Notifications
      </span>
      <div className={`${tokens.cardBg} ${tokens.cardRadius} overflow-hidden`}>
        {/* System Permission Row */}
        <div className={`px-3.5 py-3 border-b ${tokens.divider} space-y-2`}>
          <div className="flex items-center justify-between gap-2.5">
            <div className="min-w-0 flex items-center gap-2.5">
              <span
                className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                  notifPerm === 'granted'
                    ? `${tokens.accentSoftBg} ${tokens.accentText}`
                    : notifPerm === 'denied'
                      ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
                      : `${tokens.subtleBg} text-stone-500 dark:text-stone-400`
                }`}
              >
                {notifPerm === 'denied' ? (
                  <BellOff className="w-4 h-4" />
                ) : (
                  <Bell className="w-4 h-4" />
                )}
              </span>
              <div className="min-w-0">
                <p className="text-[14.5px] font-medium text-stone-900 dark:text-stone-100 leading-snug">
                  System notifications
                </p>
                <p className="text-[12.5px] text-stone-500 dark:text-stone-400 leading-snug mt-0.5 truncate">
                  {notifPerm === 'granted'
                    ? pushSubscribed
                      ? 'Allowed · Service worker push subscribed'
                      : pushSupported
                        ? 'Allowed · Tap Send test to register push'
                        : 'Allowed · Registered for Android alerts'
                    : notifPerm === 'denied'
                      ? 'Blocked in system / browser settings'
                      : notifPerm === 'unsupported'
                        ? 'In-app alerts only on this browser'
                        : 'Tap Enable to register push & Android alerts'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {notifPerm === 'default' && (
                <button
                  type="button"
                  disabled={notifBusy}
                  onClick={() => void handleEnableNotifications()}
                  className={`px-3 py-1.5 text-[13px] font-medium ${tokens.accentBg} ${tokens.buttonRadius} hover:opacity-90 disabled:opacity-60`}
                >
                  {notifBusy ? 'Requesting...' : 'Enable'}
                </button>
              )}
              {notifPerm === 'granted' && (
                <button
                  type="button"
                  disabled={notifBusy}
                  onClick={() => void handleSendTestNotification()}
                  className={`px-3 py-1.5 text-[13px] font-medium ${tokens.accentSoftBg} ${tokens.accentText} ${tokens.buttonRadius} hover:opacity-90 disabled:opacity-60`}
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
                    if (next === 'granted') {
                      setShowAndroidGuide(false);
                    }
                    setNotifFeedback(
                      next === 'granted'
                        ? 'Notifications are now enabled.'
                        : 'Still blocked — enable under Android App Info → Notifications.'
                    );
                  }}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium ${tokens.subtleBg} text-stone-700 dark:text-stone-200 ${tokens.buttonRadius}`}
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Recheck
                </button>
              )}
            </div>
          </div>

          {notifFeedback && (
            <p className={`text-[12.5px] leading-snug ${tokens.accentText}`}>{notifFeedback}</p>
          )}

          {inIframe && notifPerm !== 'granted' && (
            <p className="text-[12.5px] text-amber-600 dark:text-amber-400 leading-snug">
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

        {/* Android System Settings Instructions (collapsed by default when notifications are already enabled) */}
        <div className={`px-3.5 py-2.5 border-t ${tokens.divider}`}>
          <button
            type="button"
            aria-expanded={showAndroidGuide}
            onClick={() => setShowAndroidGuide((v) => !v)}
            className="w-full flex items-center justify-between gap-2 text-left py-0.5"
          >
            <span className="inline-flex items-center gap-2 text-[13px] font-medium text-stone-700 dark:text-stone-200">
              <Smartphone className="w-4 h-4 text-stone-400 shrink-0" />
              Android system settings setup
            </span>
            {showAndroidGuide ? (
              <ChevronUp className="w-4 h-4 text-stone-400 shrink-0" />
            ) : (
              <ChevronDown className="w-4 h-4 text-stone-400 shrink-0" />
            )}
          </button>

          {showAndroidGuide && (
            <div className="mt-2 space-y-1.5 text-[12.5px] text-stone-500 dark:text-stone-400 leading-relaxed">
              <p>
                <strong className="text-stone-700 dark:text-stone-200">1. Register permission:</strong>{' '}
                Tap <strong>Enable</strong> above (or <strong>Send test</strong>) first so Android creates the notification channel for <strong>buh.</strong> Notifications include <strong>Snooze 10m</strong> and <strong>Done</strong> buttons.
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
              <p>
                <strong className="text-stone-700 dark:text-stone-200">5. PWABuilder APK (no address bar):</strong>{' '}
                Enable <strong>Notification Delegation</strong> in PWABuilder and deploy its <strong>assetlinks.json</strong> SHA-256 fingerprint via environment variables or <strong>/.well-known/assetlinks.json</strong>.
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );

  // Category 4: Appearance & Display (Theme, Accent Colour, Adaptive Layout)
  const appearanceDisplaySection = (
    <section className="space-y-2">
      <span className="block text-[12px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500 px-1">
        Appearance &amp; Display
      </span>

      <div className={`${tokens.cardBg} ${tokens.cardRadius} overflow-hidden`}>
        <div className={`flex items-center justify-between gap-3 px-3.5 py-2.5 border-b ${tokens.divider}`}>
          <div className="min-w-0">
            <p className="text-[14.5px] font-medium text-stone-900 dark:text-stone-100 leading-snug">Theme mode</p>
            <p className="text-[12.5px] text-stone-500 dark:text-stone-400 truncate leading-snug mt-0.5">
              {isDark ? 'Dark low-light focus' : 'Light daylight clarity'}
            </p>
          </div>
          <button
            type="button"
            onClick={onToggleDark}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium ${tokens.subtleBg} text-stone-800 dark:text-stone-100 ${tokens.buttonRadius} shrink-0`}
          >
            {isDark ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
            {isDark ? 'Dark' : 'Light'}
          </button>
        </div>

        {/* Time Format (24h / 12h) */}
        <div className={`flex items-center justify-between gap-2.5 px-3.5 py-2.5 border-b ${tokens.divider}`}>
          <div className="min-w-0">
            <p className="text-[14.5px] font-medium text-stone-900 dark:text-stone-100 leading-snug">Time format</p>
            <p className="text-[12.5px] text-stone-500 dark:text-stone-400 truncate leading-snug mt-0.5 tabular-nums">
              {(settings.timeFormat ?? '24h') === '12h'
                ? '12-hour clock (2:30 PM)'
                : '24-hour clock (14:30)'}
            </p>
          </div>
          <div
            className={`inline-flex items-center p-0.5 ${tokens.subtleBg} ${tokens.buttonRadius} shrink-0`}
            role="group"
            aria-label="Time format"
          >
            {(['24h', '12h'] as const).map((fmt) => {
              const active = (settings.timeFormat ?? '24h') === fmt;
              return (
                <button
                  key={fmt}
                  type="button"
                  onClick={() => onUpdateSettings({ timeFormat: fmt })}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 text-[12.5px] font-medium tabular-nums ${tokens.buttonRadius} transition-colors ${
                    active
                      ? tokens.accentBg
                      : 'text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-stone-100'
                  }`}
                >
                  {fmt === '24h' && <Clock className="w-3.5 h-3.5" />}
                  {fmt}
                </button>
              );
            })}
          </div>
        </div>

        {/* Accent Colour Picker + Hex Input + 5 Most Recent Colours */}
        <div className={`px-3.5 py-2.5 space-y-2.5 border-b ${tokens.divider}`}>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="min-w-0">
              <p className="text-[14.5px] font-medium text-stone-900 dark:text-stone-100">Accent colour</p>
              <p className="text-[12px] text-stone-500 dark:text-stone-400">
                {hexError ? (
                  <span className="text-rose-500 dark:text-rose-400">Enter 3 or 6 hex digits</span>
                ) : (
                  'Enter hex code or pick'
                )}
              </p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleHexSubmit();
                }}
                className="flex items-center"
              >
                <input
                  ref={hexInputRef}
                  type="text"
                  value={hexInput}
                  onFocus={(e) => {
                    setIsEditingHex(true);
                    e.currentTarget.select();
                  }}
                  onChange={(e) => handleHexInputChange(e.target.value)}
                  onBlur={handleHexBlur}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      if (debounceRef.current) {
                        window.clearTimeout(debounceRef.current);
                        debounceRef.current = null;
                      }
                      pendingCommitHexRef.current = null;
                      setHexError(false);
                      setHexInput(currentHex);
                      setIsEditingHex(false);
                      e.currentTarget.blur();
                    }
                  }}
                  maxLength={7}
                  enterKeyHint="done"
                  spellCheck={false}
                  autoCapitalize="characters"
                  autoComplete="off"
                  placeholder="#C7DFF1"
                  aria-label="Accent colour hex code"
                  className={`w-[5.75rem] px-2.5 py-1.5 text-[13px] font-mono-tabular uppercase text-center ${tokens.subtleBg} text-stone-800 dark:text-stone-100 placeholder:text-stone-400 ${tokens.buttonRadius} border transition-colors focus:outline-none ${
                    hexError
                      ? 'border-rose-400 dark:border-rose-500'
                      : 'border-transparent focus:border-stone-300 dark:focus:border-stone-600'
                  }`}
                />
              </form>
              <label
                htmlFor="settings-accent-picker"
                className={`inline-flex items-center gap-2 px-2.5 py-1.5 ${tokens.subtleBg} ${tokens.buttonRadius} cursor-pointer shrink-0`}
              >
                <input
                  id="settings-accent-picker"
                  type="color"
                  value={currentHex}
                  onChange={(e) => handlePickerChange(e.target.value)}
                  onBlur={handlePickerBlur}
                  aria-label="Choose custom accent colour"
                  className="w-6 h-6 rounded border border-stone-300 dark:border-stone-700 bg-transparent cursor-pointer p-0"
                />
                <span className="text-[13px] font-medium text-stone-700 dark:text-stone-200">Pick</span>
              </label>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="text-[12.5px] text-stone-400 dark:text-stone-500 shrink-0">
              Recent ({recentColors.length}/5)
            </span>
            <div className="flex items-center gap-2" role="group" aria-label="Five most recent accent colours">
              {recentColors.slice(0, 5).map((hex) => {
                const isSelected = normalizeHex(hex) === currentHex;
                return (
                  <button
                    key={hex}
                    type="button"
                    title={hex}
                    aria-label={`Use recent colour ${hex}`}
                    onClick={() => onSelectAccentColor(hex)}
                    className={`w-6 h-6 rounded-full transition-transform border ${
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

        {/* Adaptive Layout Toggles */}
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
    </section>
  );

  // Category 5: Sync & Backup
  const isAnyGoogleSyncing =
    googleCalendar.isSyncing || googleTasks.isSyncing || cloudNotesSync.isSyncing;
  const combinedGoogleError =
    cloudNotesSync.error || googleTasks.error || googleCalendar.error;
  const lastGoogleUpdate =
    cloudNotesSync.lastSyncedAt || googleTasks.lastSyncedAt || googleCalendar.lastSyncedAt;
  const pendingOfflineCount =
    googleTasks.pendingSyncCount ?? googleCalendar.pendingSyncCount ?? 0;
  const cloudSyncEnabled = settings.buhCloudSync !== false;

  const syncBackupSection = (
    <section className="space-y-2">
      <span className="block text-[12px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500 px-1">
        Sync &amp; Backup
      </span>
      <div className={`${tokens.cardBg} ${tokens.cardRadius} overflow-hidden`}>
        {renderToggleRow(
          'buh. Cloud Sync',
          cloudNotesSync.isSignedIn
            ? cloudSyncEnabled
              ? `Active in background · ${cloudNotesSync.syncedNotesCount} notes · ${cloudNotesSync.syncedTasksCount ?? 0} tasks · ${cloudNotesSync.syncedEventsCount ?? 0} blocks · ${cloudNotesSync.syncedLookupCount ?? 0} lookups${cloudNotesSync.lastSyncedAt ? ` · ${formatTimeDisplay(cloudNotesSync.lastSyncedAt, activeTimeFormat)}` : ''}`
              : 'Paused — enable for silent background sync across devices'
            : 'Sign in with Google below to sync tasks, notes, blocks, Lookup & settings automatically',
          cloudSyncEnabled,
          () => onUpdateSettings({ buhCloudSync: !cloudSyncEnabled })
        )}
        {renderToggleRow(
          'Google Calendar sync',
          googleCalendar.isConnected
            ? `Synced with ${googleCalendar.userEmail || 'Google account'}`
            : googleCalendar.userEmail
              ? `${googleCalendar.syncedCount} cached events · tap refresh to pull updates`
              : 'Connect Google to view & add calendar events',
          settings.googleCalendarSync,
          () => onUpdateSettings({ googleCalendarSync: !settings.googleCalendarSync })
        )}
        {renderToggleRow(
          'Google Tasks sync',
          googleTasks.isConnected
            ? `${googleTasks.syncedCount} synced tasks across ${Math.max(1, googleTasks.taskLists.length)} list${googleTasks.taskLists.length === 1 ? '' : 's'}`
            : googleTasks.userEmail
              ? `${googleTasks.syncedCount} cached tasks · tap refresh to pull updates`
              : 'Sync task lists, due dates, and completion status',
          settings.googleTasksSync,
          () => onUpdateSettings({ googleTasksSync: !settings.googleTasksSync })
        )}
        <div className={`px-3.5 py-2.5 border-b ${tokens.divider} space-y-2`}>
          {googleCalendar.isConnected ? (
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[14px] font-medium text-stone-800 dark:text-stone-100 truncate">
                  {googleCalendar.userEmail || 'Google account connected'}
                </p>
                <p className="text-[12.5px] text-stone-500 dark:text-stone-400 truncate tabular-nums">
                  {googleCalendar.syncedCount} events · {googleTasks.syncedCount} Google tasks ·{' '}
                  {cloudNotesSync.syncedNotesCount} notes
                  {lastGoogleUpdate ? ` · ${formatTimeDisplay(lastGoogleUpdate, activeTimeFormat)}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  disabled={isAnyGoogleSyncing}
                  onClick={() => {
                    void googleCalendar.onSyncNow();
                    void googleTasks.onSyncNow();
                    if (cloudSyncEnabled) {
                      void cloudNotesSync.onSyncNow();
                    }
                  }}
                  aria-label="Sync Google Calendar, Tasks, and buh. Cloud Sync now"
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium ${tokens.accentSoftBg} ${tokens.accentText} ${tokens.buttonRadius} disabled:opacity-60`}
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isAnyGoogleSyncing ? 'animate-spin' : ''}`} />
                  Sync
                </button>
                <button
                  type="button"
                  onClick={() => googleCalendar.onSignOut()}
                  aria-label="Disconnect Google account"
                  title="Sign out"
                  className={`p-1.5 ${tokens.subtleBg} text-stone-500 hover:text-rose-500 ${tokens.buttonRadius} transition-colors`}
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {cloudNotesSync.isSignedIn && (
                <div className="flex items-center justify-between gap-2 pb-1">
                  <div className="min-w-0">
                    <p className="text-[13.5px] font-medium text-stone-800 dark:text-stone-100 truncate">
                      {cloudNotesSync.userEmail || 'Google account'}
                    </p>
                    <p className="text-[12px] text-stone-500 dark:text-stone-400 truncate tabular-nums">
                      {cloudSyncEnabled
                        ? `Cloud sync active · ${cloudNotesSync.syncedNotesCount} notes · ${cloudNotesSync.syncedTasksCount ?? 0} tasks · ${cloudNotesSync.syncedEventsCount ?? 0} blocks · ${cloudNotesSync.syncedLookupCount ?? 0} lookups`
                        : 'buh. Cloud Sync paused'}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {cloudSyncEnabled && (
                      <button
                        type="button"
                        disabled={cloudNotesSync.isSyncing}
                        onClick={() => void cloudNotesSync.onSyncNow()}
                        aria-label="Sync buh. Cloud workspace now"
                        className={`inline-flex items-center gap-1 px-2.5 py-1 text-[12.5px] font-medium ${tokens.accentSoftBg} ${tokens.accentText} ${tokens.buttonRadius} disabled:opacity-60`}
                      >
                        <RefreshCw
                          className={`w-3.5 h-3.5 ${cloudNotesSync.isSyncing ? 'animate-spin' : ''}`}
                        />
                        Sync cloud
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => googleCalendar.onSignOut()}
                      aria-label="Sign out of Google account"
                      title="Sign out"
                      className={`p-1.5 ${tokens.subtleBg} text-stone-500 hover:text-rose-500 ${tokens.buttonRadius} transition-colors`}
                    >
                      <LogOut className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}
              <GoogleSignInButton
                onClick={() => googleCalendar.onSignIn()}
                loading={googleCalendar.isSigningIn}
                label={googleCalendar.userEmail ? 'Refresh Google Calendar & Tasks' : 'Sign in with Google'}
              />
              <p className="text-[12.5px] text-stone-400 dark:text-stone-500 leading-snug">
                {googleCalendar.userEmail
                  ? `New tasks, blocks, notes, Lookup history & settings sync silently in buh. Cloud. Tap above anytime to refresh mirrored Google Calendar & Tasks for ${googleCalendar.userEmail}.`
                  : 'Sign in with Google for silent background sync across devices plus Google Calendar & Tasks.'}
              </p>
            </div>
          )}
          {pendingOfflineCount > 0 && (
            <div
              className={`flex items-center justify-between gap-2 px-3 py-2 ${tokens.accentSoftBg} ${tokens.buttonRadius}`}
            >
              <span className={`text-[12.5px] font-medium ${tokens.accentText}`}>
                {pendingOfflineCount} offline change{pendingOfflineCount === 1 ? '' : 's'} queued to sync
              </span>
              {googleTasks.onSyncPending && (
                <button
                  type="button"
                  disabled={isAnyGoogleSyncing}
                  onClick={() => googleTasks.onSyncPending?.()}
                  className={`px-2.5 py-1 text-[12.5px] font-medium ${tokens.accentBg} ${tokens.buttonRadius} shrink-0 disabled:opacity-60`}
                >
                  Sync now
                </button>
              )}
            </div>
          )}
          {combinedGoogleError && (
            <p className="text-[12.5px] text-rose-600 dark:text-rose-400 leading-snug">
              {combinedGoogleError}
            </p>
          )}
        </div>
        <div className="flex items-center justify-between gap-2.5 px-3.5 py-2.5">
          <div className="min-w-0">
            <p className="text-[14.5px] font-medium text-stone-900 dark:text-stone-100">TickTick CSV export</p>
            <p className="text-[12.5px] text-stone-500 dark:text-stone-400 truncate">
              Backup format ({tasks.length} tasks)
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowExportPreview(true)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium ${tokens.accentSoftBg} ${tokens.accentText} ${tokens.buttonRadius} shrink-0`}
          >
            <Download className="w-4 h-4" />
            Export
          </button>
        </div>
      </div>
    </section>
  );

  return (
    <div className={`h-full overflow-y-auto device-scroll ${posture === FoldPosture.Inner ? 'px-4 py-2.5' : 'px-3.5 pt-2.5 pb-24'}`}>
      <div className="flex items-center justify-between mb-3">
        <h2 className={`font-display font-semibold text-stone-900 dark:text-stone-100 ${tokens.headingScale}`}>
          Settings
        </h2>
      </div>

      {posture === FoldPosture.Inner ? (
        <div className={`grid grid-cols-2 ${settings.hingeAwareSplit ? 'gap-5' : 'gap-3.5'} items-start`}>
          <div className="space-y-4">
            {organizationSection}
            {tasksCaptureSection}
            {appearanceDisplaySection}
          </div>
          <div className="space-y-4">
            {notificationsSection}
            {syncBackupSection}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {organizationSection}
          {tasksCaptureSection}
          {notificationsSection}
          {appearanceDisplaySection}
          {syncBackupSection}
        </div>
      )}

      {showExportPreview && (
        <div className="absolute inset-0 z-30 bg-black/40 backdrop-blur-[1px] flex items-center justify-center p-4">
          <div className={`w-full max-w-sm ${tokens.cardBg} ${tokens.cardRadius} p-4 space-y-3`}>
            <div className="flex items-center justify-between">
              <h3 className="font-display text-[16px] font-semibold text-stone-900 dark:text-stone-100">
                TickTick Export Preview
              </h3>
              <button
                type="button"
                onClick={() => setShowExportPreview(false)}
                className="p-1.5 text-stone-400 hover:text-stone-800 dark:hover:text-stone-100"
                aria-label="Close export preview"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <pre className={`text-[12px] font-mono-tabular p-3 overflow-x-auto max-h-48 ${tokens.subtleBg} text-stone-700 dark:text-stone-300 ${tokens.buttonRadius}`}>
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
                className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-[13.5px] font-medium ${tokens.subtleBg} text-stone-800 dark:text-stone-100 ${tokens.buttonRadius} hover:opacity-90`}
              >
                <Download className="w-4 h-4" />
                Download CSV
              </button>
              <button
                type="button"
                onClick={() => setShowExportPreview(false)}
                className={`px-3.5 py-2 text-[13.5px] font-medium ${tokens.accentBg} ${tokens.buttonRadius}`}
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
