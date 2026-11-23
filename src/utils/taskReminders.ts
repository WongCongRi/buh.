import { getTodayDateKey, getTomorrowDateKey } from '../data/initialData';
import { TaskItem, TaskReminder } from '../types/taskflow';

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
  task: Pick<TaskItem, 'dateKey' | 'timeLabel'>
): Date | null {
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
  task: Pick<TaskItem, 'dateKey' | 'timeLabel'>,
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

export function formatReminderLabel(reminder: TaskReminder): string {
  if (reminder.mode === 'relative') {
    return formatOffsetMinutes(reminder.offsetMinutes ?? 0);
  }
  const dateKey = reminder.dateKey || getTodayDateKey();
  const timeStr = reminder.time24 ? format24hTo12h(reminder.time24) : '9:00 AM';
  const today = getTodayDateKey();
  const tomorrow = getTomorrowDateKey();
  if (dateKey === today) return `Today ${timeStr}`;
  if (dateKey === tomorrow) return `Tmrw ${timeStr}`;

  const [yStr, mStr, dStr] = dateKey.split('-');
  const dt = new Date(Number(yStr), Number(mStr) - 1, Number(dStr));
  if (Number.isNaN(dt.getTime())) return `${dateKey} ${timeStr}`;
  const datePart = dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
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

async function showBrowserOrSwNotification(
  title: string,
  options: NotificationOptions
): Promise<boolean> {
  try {
    if ('serviceWorker' in navigator) {
      let reg = await navigator.serviceWorker.getRegistration();
      if (!reg) {
        reg = await Promise.race<ServiceWorkerRegistration | undefined>([
          navigator.serviceWorker.ready,
          new Promise<undefined>((resolve) => window.setTimeout(() => resolve(undefined), 1200)),
        ]);
      }
      if (reg && typeof reg.showNotification === 'function') {
        await reg.showNotification(title, options);
        return true;
      }
    }
  } catch {
    // Fallback to direct Notification API below
  }

  try {
    new Notification(title, options);
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
      ? `${label}${task.timeLabel !== 'No time set' ? ` · ${task.timeLabel}` : ''}`
      : `Scheduled reminder · ${label}`,
    task.category,
  ].filter(Boolean);
  const body = bodyParts.join(' · ');
  const tag = `buh-reminder-${task.id}-${reminder.id}`;

  const options: NotificationOptions = {
    body,
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    tag,
    silent: opts?.silent,
  };

  return showBrowserOrSwNotification(title, options);
}

export async function dispatchTestNotification(
  playSound = true
): Promise<{ delivered: boolean; permission: NotificationSupportState }> {
  const permission = await requestAppNotificationPermission();
  if (permission !== 'granted') {
    return { delivered: false, permission };
  }

  if (playSound) {
    playSoftReminderChime();
  }

  const delivered = await showBrowserOrSwNotification('buh. notifications active', {
    body: 'Task reminders will alert you at the times you set.',
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    tag: 'buh-test-notification',
    silent: !playSound,
  });

  return { delivered, permission };
}
