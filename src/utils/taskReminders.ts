import { getTodayDateKey, getTomorrowDateKey } from '../data/initialData';
import { TaskItem, TaskReminder, TimeFormat } from '../types/taskflow';
import { formatRelativeTaskDate } from './dateLabels';
import { formatTimeDisplay } from './timeFormat';

export interface ReminderPreset {
  shortLabel: string;
  label: string;
  offsetMinutes: number;
}

export const REMINDER_PRESETS: ReminderPreset[] = [
  { shortLabel: 'At time', label: 'At time', offsetMinutes: 0 },
  { shortLabel: '10m', label: '10m before', offsetMinutes: 10 },
  { shortLabel: '1h', label: '1h before', offsetMinutes: 60 },
  { shortLabel: '1d', label: '1d before', offsetMinutes: 1440 },
];

export function makeReminderId(): string {
  return `rem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

export function makeRearmedReminderId(existingId: string): string {
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  if (existingId.startsWith('gtask-due-')) {
    const base = existingId
      .replace(/-r[0-9a-z]+$/i, '')
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 72);
    return `${base}-r${stamp}`;
  }
  return makeReminderId();
}

export function format24hTo12h(time24: string): string {
  const [hhStr, mmStr] = time24.split(':');
  const hh = parseInt(hhStr, 10);
  const mm = parseInt(mmStr, 10);
  if (Number.isNaN(hh) || Number.isNaN(mm)) return time24;
  const meridiem = hh >= 12 ? 'PM' : 'AM';
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12}:${String(mm).padStart(2, '0')} ${meridiem}`;
}

export function parseTimeLabelTo24h(timeLabel: string): { hours: number; minutes: number } | null {
  const m12 = timeLabel.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (m12) {
    let hours = parseInt(m12[1], 10);
    const minutes = parseInt(m12[2], 10);
    const meridiem = m12[3].toUpperCase();
    if (meridiem === 'PM' && hours < 12) hours += 12;
    if (meridiem === 'AM' && hours === 12) hours = 0;
    return { hours, minutes };
  }
  const m24 = timeLabel.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (m24) {
    return { hours: parseInt(m24[1], 10), minutes: parseInt(m24[2], 10) };
  }
  return null;
}

export function parseTaskScheduledDate(
  task: Pick<TaskItem, 'dateKey' | 'timeLabel'> & { isInbox?: boolean }
): Date | null {
  if (task.isInbox) return null;
  const [yStr, mStr, dStr] = (task.dateKey || '').split('-');
  const y = Number(yStr);
  const m = Number(mStr);
  const d = Number(dStr);
  if (!y || !m || !d) return null;

  const parsedTime = parseTimeLabelTo24h(task.timeLabel);
  // Default to 9:00 AM local time when a task has no clock time set
  const hours = parsedTime ? parsedTime.hours : 9;
  const minutes = parsedTime ? parsedTime.minutes : 0;
  return new Date(y, m - 1, d, hours, minutes, 0, 0);
}

export function computeReminderTriggerMs(
  task: Pick<TaskItem, 'dateKey' | 'timeLabel'> & { isInbox?: boolean },
  reminder: TaskReminder
): number | null {
  if (reminder.mode === 'exact') {
    if (!reminder.dateKey || !reminder.time24) return null;
    const [yStr, mStr, dStr] = reminder.dateKey.split('-');
    const [hhStr, mmStr] = reminder.time24.split(':');
    const y = Number(yStr);
    const m = Number(mStr);
    const d = Number(dStr);
    const hh = Number(hhStr);
    const mm = Number(mmStr);
    if (!y || !m || !d || Number.isNaN(hh) || Number.isNaN(mm)) return null;
    return new Date(y, m - 1, d, hh, mm, 0, 0).getTime();
  }

  const scheduled = parseTaskScheduledDate(task);
  if (!scheduled) return null;
  const offset = typeof reminder.offsetMinutes === 'number' ? reminder.offsetMinutes : 0;
  return scheduled.getTime() - offset * 60_000;
}

export function formatOffsetMinutes(offsetMinutes: number): string {
  if (offsetMinutes <= 0) return 'At time';
  if (offsetMinutes % 10080 === 0) {
    const w = offsetMinutes / 10080;
    return `${w}w before`;
  }
  if (offsetMinutes % 1440 === 0) {
    const d = offsetMinutes / 1440;
    return `${d}d before`;
  }
  if (offsetMinutes % 60 === 0) {
    const h = offsetMinutes / 60;
    return `${h}h before`;
  }
  return `${offsetMinutes}m before`;
}

export function formatReminderLabel(reminder: TaskReminder, timeFormat?: TimeFormat): string {
  if (reminder.mode === 'relative') {
    return formatOffsetMinutes(reminder.offsetMinutes ?? 0);
  }
  const dateKey = reminder.dateKey || getTodayDateKey();
  const timeStr = formatTimeDisplay(reminder.time24 || '09:00', timeFormat);
  const today = getTodayDateKey();
  const tomorrow = getTomorrowDateKey();
  if (dateKey === today) return `Today ${timeStr}`;
  if (dateKey === tomorrow) return `Tmrw ${timeStr}`;

  const datePart = formatRelativeTaskDate(dateKey).label;
  return `${datePart} · ${timeStr}`;
}

export function reminderKey(reminder: Pick<TaskReminder, 'mode' | 'offsetMinutes' | 'dateKey' | 'time24'>): string {
  if (reminder.mode === 'relative') {
    return `rel:${reminder.offsetMinutes ?? 0}`;
  }
  return `exact:${reminder.dateKey || ''}:${reminder.time24 || ''}`;
}

export function dedupeReminders(reminders: TaskReminder[]): TaskReminder[] {
  const seen = new Set<string>();
  const result: TaskReminder[] = [];
  for (const r of reminders) {
    const key = reminderKey(r);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(r);
    }
  }
  return result;
}

export type NotificationSupportState = NotificationPermission | 'unsupported';

export function isEmbeddedIframe(): boolean {
  try {
    return typeof window !== 'undefined' && window.self !== window.top;
  } catch {
    return true;
  }
}

export function isAndroidDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /android/i.test(navigator.userAgent);
}

export function getNotificationPermissionState(): NotificationSupportState {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') {
    return 'unsupported';
  }
  return Notification.permission;
}

export async function requestAppNotificationPermission(): Promise<NotificationSupportState> {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') {
    return 'unsupported';
  }
  if (Notification.permission === 'granted' || Notification.permission === 'denied') {
    return Notification.permission;
  }
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

export function playSoftReminderChime(): void {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(784, now); // G5
    osc.frequency.setValueAtTime(1046.5, now + 0.12); // C6

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.36);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.38);
    window.setTimeout(() => {
      void ctx.close().catch(() => {});
    }, 500);
  } catch {
    // Ignore autoplay restrictions
  }
}

export interface AndroidNotificationAction {
  action: string;
  title: string;
  icon?: string;
}

export interface AndroidNotificationOptions extends NotificationOptions {
  actions?: AndroidNotificationAction[];
  vibrate?: number[];
  renotify?: boolean;
}

export interface PendingSwReminderAction {
  actionId?: string;
  action: 'snooze' | 'done' | 'clear';
  taskId?: string;
  reminderId?: string;
  snoozeMinutes?: number;
  timestamp: number;
}

const REMINDER_ACTIONS_CACHE = 'buh-reminder-actions-v1';
const REMINDER_ACTIONS_URL = '/__buh_pending_reminder_actions__';
const SCHEDULED_REMINDERS_CACHE = 'buh-scheduled-reminders-v1';
const SCHEDULED_REMINDERS_URL = '/__buh_scheduled_reminders__';
const FIRED_REMINDERS_CACHE = 'buh-fired-reminders-v1';
const FIRED_REMINDERS_URL = '/__buh_fired_reminders__';
const FIRED_REMINDERS_LS_KEY = 'buh-fired-reminders-v1';

export function loadPersistedFiredReminderKeys(): Record<string, number> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(FIRED_REMINDERS_LS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, number>;
    if (!parsed || typeof parsed !== 'object') return {};
    const cutoff = Date.now() - 48 * 60 * 60 * 1000;
    const pruned: Record<string, number> = {};
    for (const [k, ts] of Object.entries(parsed)) {
      if (typeof ts === 'number' && ts >= cutoff) {
        pruned[k] = ts;
      }
    }
    return pruned;
  } catch {
    return {};
  }
}

export function persistFiredReminderKeys(keys: string[]): void {
  if (typeof window === 'undefined' || keys.length === 0) return;
  try {
    const current = loadPersistedFiredReminderKeys();
    const now = Date.now();
    for (const k of keys) {
      if (k) current[k] = now;
    }
    window.localStorage.setItem(FIRED_REMINDERS_LS_KEY, JSON.stringify(current));
  } catch {
    // Ignore storage quota errors
  }
}

export function clearPersistedFiredReminderKeys(taskId: string, reminderId: string): void {
  if (typeof window === 'undefined') return;
  try {
    const current = loadPersistedFiredReminderKeys();
    const prefix = `${taskId}:${reminderId}`;
    let changed = false;
    for (const k of Object.keys(current)) {
      if (k === prefix || k.startsWith(`${prefix}:`)) {
        delete current[k];
        changed = true;
      }
    }
    if (changed) {
      window.localStorage.setItem(FIRED_REMINDERS_LS_KEY, JSON.stringify(current));
    }
  } catch {
    // Ignore storage errors
  }
}

export async function getSwFiredReminderKeys(): Promise<Record<string, number>> {
  if (typeof window === 'undefined' || !('caches' in window)) return {};
  try {
    const cache = await window.caches.open(FIRED_REMINDERS_CACHE);
    const res = await cache.match(FIRED_REMINDERS_URL);
    if (!res) return {};
    const parsed = await res.json();
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, number>) : {};
  } catch {
    return {};
  }
}

export async function markReminderFiredInServiceWorker(
  taskId: string,
  reminderId: string,
  triggerAtMs?: number
): Promise<void> {
  const pairKey = `${taskId}:${reminderId}`;
  const timedKey =
    typeof triggerAtMs === 'number' && Number.isFinite(triggerAtMs)
      ? `${taskId}:${reminderId}:${Math.round(triggerAtMs / 1000)}`
      : '';
  persistFiredReminderKeys(timedKey ? [pairKey, timedKey] : [pairKey]);

  if (typeof window === 'undefined') return;
  try {
    if ('caches' in window) {
      const cache = await window.caches.open(FIRED_REMINDERS_CACHE);
      const existing = await getSwFiredReminderKeys();
      const now = Date.now();
      existing[pairKey] = now;
      if (timedKey) existing[timedKey] = now;
      await cache.put(
        FIRED_REMINDERS_URL,
        new Response(JSON.stringify(existing), {
          headers: { 'Content-Type': 'application/json' },
        })
      );
    }
  } catch {
    // Ignore cache storage errors
  }

  try {
    const reg = await getActiveServiceWorkerRegistration();
    const worker = reg?.active || navigator.serviceWorker?.controller;
    worker?.postMessage({
      type: 'MARK_REMINDER_FIRED',
      key: timedKey,
      taskId,
      reminderId,
    });
    if (reg && typeof reg.getNotifications === 'function') {
      const regWithTrigger = reg as ServiceWorkerRegistration & {
        getNotifications: (filter?: { tag?: string; includeTriggered?: boolean }) => Promise<Notification[]>;
      };
      let list: Notification[] = [];
      try {
        list = await regWithTrigger.getNotifications({ includeTriggered: true });
      } catch {
        list = await reg.getNotifications();
      }
      for (const notif of list) {
        const nData = (notif as Notification & { data?: { taskId?: string; reminderId?: string } }).data;
        if (nData?.taskId === taskId && (!reminderId || nData?.reminderId === reminderId)) {
          notif.close();
        }
      }
    }
  } catch {
    // Ignore SW postMessage errors
  }
}

export async function clearReminderFiredInServiceWorker(
  taskId: string,
  reminderId: string
): Promise<void> {
  clearPersistedFiredReminderKeys(taskId, reminderId);
  if (typeof window === 'undefined') return;
  const prefix = `${taskId}:${reminderId}`;

  try {
    if ('caches' in window) {
      const cache = await window.caches.open(FIRED_REMINDERS_CACHE);
      const existing = await getSwFiredReminderKeys();
      let changed = false;
      for (const k of Object.keys(existing)) {
        if (k === prefix || k.startsWith(`${prefix}:`)) {
          delete existing[k];
          changed = true;
        }
      }
      if (changed) {
        await cache.put(
          FIRED_REMINDERS_URL,
          new Response(JSON.stringify(existing), {
            headers: { 'Content-Type': 'application/json' },
          })
        );
      }
    }
  } catch {
    // Ignore cache storage errors
  }

  try {
    const reg = await getActiveServiceWorkerRegistration();
    const worker = reg?.active || navigator.serviceWorker?.controller;
    worker?.postMessage({
      type: 'CLEAR_REMINDER_FIRED',
      taskId,
      reminderId,
    });
    if (reg && typeof reg.getNotifications === 'function') {
      const regWithTrigger = reg as ServiceWorkerRegistration & {
        getNotifications: (filter?: { tag?: string; includeTriggered?: boolean }) => Promise<Notification[]>;
      };
      let list: Notification[] = [];
      try {
        list = await regWithTrigger.getNotifications({ includeTriggered: true });
      } catch {
        list = await reg.getNotifications();
      }
      for (const notif of list) {
        const nData = (notif as Notification & { data?: { taskId?: string; reminderId?: string } }).data;
        if (nData?.taskId === taskId && (!reminderId || nData?.reminderId === reminderId)) {
          notif.close();
        }
      }
    }
  } catch {
    // Ignore SW postMessage errors
  }
}

export function createSnoozedReminder(minutes = 10): TaskReminder {
  const target = new Date(Date.now() + minutes * 60_000);
  const y = target.getFullYear();
  const m = String(target.getMonth() + 1).padStart(2, '0');
  const d = String(target.getDate()).padStart(2, '0');
  const hh = String(target.getHours()).padStart(2, '0');
  const mm = String(target.getMinutes()).padStart(2, '0');
  return {
    id: makeReminderId(),
    mode: 'exact',
    dateKey: `${y}-${m}-${d}`,
    time24: `${hh}:${mm}`,
  };
}

export async function consumePendingSwReminderActions(): Promise<PendingSwReminderAction[]> {
  if (typeof window === 'undefined' || !('caches' in window)) return [];
  try {
    const cache = await window.caches.open(REMINDER_ACTIONS_CACHE);
    const res = await cache.match(REMINDER_ACTIONS_URL);
    if (!res) return [];
    const parsed = await res.json();
    await cache.delete(REMINDER_ACTIONS_URL);
    return Array.isArray(parsed) ? (parsed as PendingSwReminderAction[]) : [];
  } catch {
    return [];
  }
}

async function showBrowserOrSwNotification(
  title: string,
  options: AndroidNotificationOptions
): Promise<boolean> {
  try {
    if ('serviceWorker' in navigator) {
      const readyReg = await Promise.race<ServiceWorkerRegistration | undefined>([
        navigator.serviceWorker.ready,
        new Promise<undefined>((resolve) => window.setTimeout(() => resolve(undefined), 1800)),
      ]);
      const reg = readyReg || (await navigator.serviceWorker.getRegistration());
      if (reg && typeof reg.showNotification === 'function') {
        await reg.showNotification(title, options as NotificationOptions);
        return true;
      }
    }
  } catch {
    // Fallback to direct Notification API below
  }

  try {
    // Direct new Notification() throws TypeError if SW-only fields like `actions` are passed
    const { actions: _a, vibrate: _v, renotify: _r, ...basicOptions } = options;
    new Notification(title, basicOptions);
    return true;
  } catch {
    return false;
  }
}

export async function dispatchSystemTaskNotification(
  task: TaskItem,
  reminder: TaskReminder,
  opts?: { silent?: boolean }
): Promise<boolean> {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') {
    return false;
  }
  if (Notification.permission !== 'granted') {
    return false;
  }

  const label = formatReminderLabel(reminder);
  const title = task.title || 'Task reminder';
  const bodyParts = [
    reminder.mode === 'relative'
      ? `${label}${task.timeLabel !== 'No time set' ? ` · ${formatTimeDisplay(task.timeLabel)}` : ''}`
      : `Scheduled reminder · ${label}`,
    task.category,
  ].filter(Boolean);
  const body = bodyParts.join(' · ');
  const tag = `buh-reminder-${task.id}-${reminder.id}`;

  const options: AndroidNotificationOptions = {
    body,
    icon: '/pwa-192x192.png',
    badge: '/badge-96x96.png',
    tag,
    renotify: true,
    silent: opts?.silent,
    vibrate: opts?.silent ? undefined : [180, 90, 180],
    actions: [
      { action: 'snooze', title: 'Snooze 10m' },
      { action: 'done', title: 'Done' },
    ],
    data: {
      taskId: task.id,
      reminderId: reminder.id,
      taskTitle: title,
      category: task.category,
      url: '/',
    },
  };

  return showBrowserOrSwNotification(title, options);
}

export interface PushSubscriptionStatus {
  supported: boolean;
  subscribed: boolean;
  endpoint: string | null;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function getActiveServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  try {
    const readyReg = await Promise.race<ServiceWorkerRegistration | undefined>([
      navigator.serviceWorker.ready,
      new Promise<undefined>((resolve) => window.setTimeout(() => resolve(undefined), 2000)),
    ]);
    return readyReg || (await navigator.serviceWorker.getRegistration()) || null;
  } catch {
    return null;
  }
}

export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export async function getPushSubscriptionStatus(): Promise<PushSubscriptionStatus> {
  if (!isPushSupported()) {
    return { supported: false, subscribed: false, endpoint: null };
  }
  try {
    const reg = await getActiveServiceWorkerRegistration();
    const existing = await reg?.pushManager?.getSubscription();
    return {
      supported: true,
      subscribed: Boolean(existing),
      endpoint: existing?.endpoint ?? null,
    };
  } catch {
    return { supported: true, subscribed: false, endpoint: null };
  }
}

function arrayBufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function formatTaskReminderBody(task: TaskItem, reminder: TaskReminder): string {
  const label = formatReminderLabel(reminder);
  return [
    reminder.mode === 'relative'
      ? `${label}${task.timeLabel !== 'No time set' ? ` · ${formatTimeDisplay(task.timeLabel)}` : ''}`
      : `Scheduled reminder · ${label}`,
    task.category,
  ]
    .filter(Boolean)
    .join(' · ');
}

export async function subscribeToServiceWorkerPush(): Promise<{
  subscribed: boolean;
  permission: NotificationSupportState;
  subscription: PushSubscriptionJSON | null;
  persistentVapid?: boolean;
  error?: string;
}> {
  const permission = await requestAppNotificationPermission();
  if (permission !== 'granted') {
    return { subscribed: false, permission, subscription: null };
  }
  if (!isPushSupported()) {
    return {
      subscribed: false,
      permission,
      subscription: null,
      error: 'PushManager is not supported in this browser.',
    };
  }
  try {
    const reg = await getActiveServiceWorkerRegistration();
    if (!reg || !reg.pushManager) {
      return {
        subscribed: false,
        permission,
        subscription: null,
        error: 'Service worker is not ready yet.',
      };
    }

    const keyResp = await fetch('/api/push/public-key');
    if (!keyResp.ok) {
      return {
        subscribed: false,
        permission,
        subscription: null,
        error: 'Could not retrieve server push key.',
      };
    }
    const { publicKey, persistent } = (await keyResp.json()) as {
      publicKey?: string;
      persistent?: boolean;
    };
    if (!publicKey) {
      return {
        subscribed: false,
        permission,
        subscription: null,
        error: 'Server push public key is missing.',
      };
    }

    let sub = await reg.pushManager.getSubscription();
    // If server VAPID key changed (e.g. redeploy with new key), rotate the browser push subscription automatically
    if (sub && sub.options?.applicationServerKey) {
      const existingKey = arrayBufferToBase64Url(sub.options.applicationServerKey);
      if (existingKey !== publicKey) {
        try {
          await sub.unsubscribe();
        } catch {
          // Ignore unsubscribe errors and attempt fresh subscription
        }
        sub = null;
      }
    }

    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as unknown as BufferSource,
      });
    }

    const subJson = sub.toJSON();
    await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: subJson }),
    });

    return {
      subscribed: true,
      permission,
      subscription: subJson,
      persistentVapid: Boolean(persistent),
    };
  } catch (err: unknown) {
    return {
      subscribed: false,
      permission,
      subscription: null,
      error: err instanceof Error ? err.message : 'Unable to register push subscription.',
    };
  }
}

export async function syncScheduledRemindersToPushServer(
  tasks: TaskItem[],
  opts: { enabled: boolean; silent: boolean }
): Promise<{ synced: boolean; scheduledCount: number; persistentVapid?: boolean }> {
  if (!isPushSupported()) {
    return { synced: false, scheduledCount: 0 };
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { synced: false, scheduledCount: 0 };
  }
  if (getNotificationPermissionState() !== 'granted') {
    return { synced: false, scheduledCount: 0 };
  }

  try {
    if (!opts.enabled) {
      const reg = await getActiveServiceWorkerRegistration();
      const existing = await reg?.pushManager?.getSubscription();
      if (existing?.endpoint) {
        await fetch('/api/push/clear-schedule', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: existing.endpoint }),
        });
      }
      return { synced: true, scheduledCount: 0 };
    }

    const subRes = await subscribeToServiceWorkerPush();
    if (!subRes.subscribed || !subRes.subscription) {
      return { synced: false, scheduledCount: 0 };
    }

    const now = Date.now();
    const [firedSw, firedLocal] = [await getSwFiredReminderKeys(), loadPersistedFiredReminderKeys()];
    const reminders: Array<{
      taskId: string;
      reminderId: string;
      triggerAtMs: number;
      title: string;
      body: string;
      category: string;
      tag: string;
      silent: boolean;
    }> = [];

    for (const task of tasks) {
      if (task.completed || !task.reminders || task.reminders.length === 0) continue;
      for (const rem of task.reminders) {
        if (rem.firedAt) continue;
        const pairKey = `${task.id}:${rem.id}`;
        if (firedLocal[pairKey] || firedSw[pairKey]) continue;
        const triggerAtMs = computeReminderTriggerMs(task, rem);
        if (triggerAtMs === null || triggerAtMs <= now) continue;
        const timedKey = `${task.id}:${rem.id}:${Math.round(triggerAtMs / 1000)}`;
        if (firedLocal[timedKey] || firedSw[timedKey]) continue;
        reminders.push({
          taskId: task.id,
          reminderId: rem.id,
          triggerAtMs,
          title: task.title || 'Task reminder',
          body: formatTaskReminderBody(task, rem),
          category: task.category || '',
          tag: `buh-reminder-${task.id}-${rem.id}`,
          silent: opts.silent,
        });
      }
    }

    reminders.sort((a, b) => a.triggerAtMs - b.triggerAtMs);

    const resp = await fetch('/api/push/schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subscription: subRes.subscription,
        reminders: reminders.slice(0, 100),
      }),
    });
    if (!resp.ok) {
      return { synced: false, scheduledCount: 0 };
    }
    const data = (await resp.json()) as {
      scheduledCount?: number;
      persistentVapid?: boolean;
    };
    return {
      synced: true,
      scheduledCount: data.scheduledCount ?? reminders.length,
      persistentVapid: data.persistentVapid ?? subRes.persistentVapid,
    };
  } catch {
    return { synced: false, scheduledCount: 0 };
  }
}

export async function syncRemindersToServiceWorker(
  tasks: TaskItem[],
  opts: { enabled: boolean; silent: boolean }
): Promise<{ scheduledCount: number; periodicSyncRegistered: boolean }> {
  if (typeof window === 'undefined') {
    return { scheduledCount: 0, periodicSyncRegistered: false };
  }

  const now = Date.now();
  const [firedSw, firedLocal] = [await getSwFiredReminderKeys(), loadPersistedFiredReminderKeys()];

  const reminders: Array<{
    key: string;
    taskId: string;
    reminderId: string;
    triggerAtMs: number;
    title: string;
    body: string;
    category: string;
    tag: string;
    silent: boolean;
  }> = [];

  if (opts.enabled && getNotificationPermissionState() === 'granted') {
    for (const task of tasks) {
      if (task.completed || !task.reminders || task.reminders.length === 0) continue;
      for (const rem of task.reminders) {
        if (rem.firedAt) continue;
        const pairKey = `${task.id}:${rem.id}`;
        if (firedLocal[pairKey] || firedSw[pairKey]) continue;
        const triggerAtMs = computeReminderTriggerMs(task, rem);
        if (triggerAtMs === null || triggerAtMs <= now) continue;
        const key = `${task.id}:${rem.id}:${Math.round(triggerAtMs / 1000)}`;
        if (firedLocal[key] || firedSw[key]) continue;
        reminders.push({
          key,
          taskId: task.id,
          reminderId: rem.id,
          triggerAtMs,
          title: task.title || 'Task reminder',
          body: formatTaskReminderBody(task, rem),
          category: task.category || '',
          tag: `buh-reminder-${task.id}-${rem.id}`,
          silent: opts.silent,
        });
      }
    }
    reminders.sort((a, b) => a.triggerAtMs - b.triggerAtMs);
  }

  const trimmed = reminders.slice(0, 100);

  try {
    if ('caches' in window) {
      const cache = await window.caches.open(SCHEDULED_REMINDERS_CACHE);
      await cache.put(
        SCHEDULED_REMINDERS_URL,
        new Response(JSON.stringify(trimmed), {
          headers: { 'Content-Type': 'application/json' },
        })
      );
    }
  } catch {
    // Ignore cache storage errors
  }

  let periodicSyncRegistered = false;
  try {
    const reg = await getActiveServiceWorkerRegistration();
    const worker = reg?.active || navigator.serviceWorker?.controller;
    worker?.postMessage({
      type: 'SYNC_LOCAL_REMINDERS',
      reminders: trimmed,
    });

    if (reg && trimmed.length > 0) {
      const regWithSync = reg as ServiceWorkerRegistration & {
        periodicSync?: {
          register: (tag: string, options?: { minInterval?: number }) => Promise<void>;
        };
        sync?: {
          register: (tag: string) => Promise<void>;
        };
      };

      if (regWithSync.periodicSync && typeof regWithSync.periodicSync.register === 'function') {
        try {
          await regWithSync.periodicSync.register('buh-reminder-check', {
            minInterval: 15 * 60 * 1000,
          });
          periodicSyncRegistered = true;
        } catch {
          // Browser may restrict Periodic Background Sync until PWA engagement threshold is reached
        }
      }

      if (regWithSync.sync && typeof regWithSync.sync.register === 'function') {
        try {
          await regWithSync.sync.register('buh-reminder-check');
        } catch {
          // Ignore if background sync is unavailable
        }
      }

      // Opportunistically schedule native Notification Triggers (TimestampTrigger) when supported
      const TimestampTriggerCtor = (
        window as unknown as { TimestampTrigger?: new (timestamp: number) => unknown }
      ).TimestampTrigger;
      if (typeof TimestampTriggerCtor === 'function' && 'showTrigger' in Notification.prototype) {
        const horizonMs = now + 24 * 60 * 60 * 1000;
        for (const rem of trimmed) {
          if (rem.triggerAtMs <= now + 5_000 || rem.triggerAtMs > horizonMs) continue;
          try {
            await reg.showNotification(rem.title, {
              body: rem.body,
              icon: '/pwa-192x192.png',
              badge: '/badge-96x96.png',
              tag: rem.tag,
              silent: rem.silent,
              showTrigger: new TimestampTriggerCtor(rem.triggerAtMs),
              actions: [
                { action: 'snooze', title: 'Snooze 10m' },
                { action: 'done', title: 'Done' },
              ],
              data: {
                taskId: rem.taskId,
                reminderId: rem.reminderId,
                taskTitle: rem.title,
                category: rem.category,
                url: '/',
              },
            } as NotificationOptions);
          } catch {
            // Skip if browser rejects showTrigger
            break;
          }
        }
      }
    }
  } catch {
    // Ignore SW sync errors
  }

  return { scheduledCount: trimmed.length, periodicSyncRegistered };
}

export async function dispatchTestNotification(
  playSound = true
): Promise<{ delivered: boolean; viaPush: boolean; permission: NotificationSupportState }> {
  const permission = await requestAppNotificationPermission();
  if (permission !== 'granted') {
    return { delivered: false, viaPush: false, permission };
  }

  if (playSound) {
    playSoftReminderChime();
  }

  // Prefer real Service Worker Web Push delivery when online & PushManager is available
  if (isPushSupported() && (typeof navigator === 'undefined' || navigator.onLine)) {
    try {
      const subRes = await subscribeToServiceWorkerPush();
      if (subRes.subscribed && subRes.subscription) {
        const pushResp = await fetch('/api/push/send-test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subscription: subRes.subscription,
            title: 'buh. push notifications active',
            body: 'Task reminders will alert you on Android with Snooze & Done actions.',
            silent: !playSound,
          }),
        });
        if (pushResp.ok) {
          return { delivered: true, viaPush: true, permission };
        }
      }
    } catch {
      // Fall back to direct Service Worker registration.showNotification below
    }
  }

  const delivered = await showBrowserOrSwNotification('buh. notifications active', {
    body: 'Task reminders will alert you on Android with Snooze & Done actions.',
    icon: '/pwa-192x192.png',
    badge: '/badge-96x96.png',
    tag: 'buh-test-notification',
    renotify: true,
    silent: !playSound,
    vibrate: playSound ? [160, 80, 160] : undefined,
    actions: [
      { action: 'snooze', title: 'Snooze 10m' },
      { action: 'done', title: 'Done' },
    ],
    data: { url: '/' },
  });

  return { delivered, viaPush: false, permission };
}

