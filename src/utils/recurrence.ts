import {
  CalendarEvent,
  RecurrenceFrequency,
  RecurrenceRule,
  TaskItem,
  TaskReminder,
} from '../types/taskflow';
import { makeReminderId } from './taskReminders';

const SHORT_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const RRULE_BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;

export const WEEKDAY_BUTTONS: { day: number; short: string; letter: string }[] = [
  { day: 1, short: 'Mon', letter: 'M' },
  { day: 2, short: 'Tue', letter: 'T' },
  { day: 3, short: 'Wed', letter: 'W' },
  { day: 4, short: 'Thu', letter: 'T' },
  { day: 5, short: 'Fri', letter: 'F' },
  { day: 6, short: 'Sat', letter: 'S' },
  { day: 0, short: 'Sun', letter: 'S' },
];

export type RecurrencePresetId = 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly';

export const RECURRENCE_PRESETS: { id: RecurrencePresetId; label: string }[] = [
  { id: 'none', label: 'Off' },
  { id: 'daily', label: 'Daily' },
  { id: 'weekdays', label: 'Weekdays' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'yearly', label: 'Yearly' },
];

export function parseDateKeyLocal(dateKey: string): Date {
  const [yStr, mStr, dStr] = (dateKey || '').split('-');
  const fallback = new Date();
  const y = Number(yStr) || fallback.getFullYear();
  const m = (Number(mStr) || fallback.getMonth() + 1) - 1;
  const d = Number(dStr) || fallback.getDate();
  return new Date(y, m, d);
}

function toDateKeyLocal(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDaysToDateKey(dateKey: string, days: number): string {
  const dt = parseDateKeyLocal(dateKey);
  dt.setDate(dt.getDate() + days);
  return toDateKeyLocal(dt);
}

function diffDaysDateKeys(startKey: string, endKey: string): number {
  const a = parseDateKeyLocal(startKey);
  const b = parseDateKeyLocal(endKey);
  const utcA = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const utcB = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((utcB - utcA) / 86_400_000);
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function getMondayDateKey(dateKey: string): string {
  const dt = parseDateKeyLocal(dateKey);
  const diffToMonday = (dt.getDay() + 6) % 7;
  dt.setDate(dt.getDate() - diffToMonday);
  return toDateKeyLocal(dt);
}

function sanitizeDaysOfWeek(days?: number[]): number[] | undefined {
  if (!days || days.length === 0) return undefined;
  const unique = Array.from(new Set(days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)));
  if (unique.length === 0) return undefined;
  // Sort Mon..Sun order for clean display
  unique.sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
  return unique;
}

export function normalizeRecurrenceRule(rule?: RecurrenceRule | null): RecurrenceRule | undefined {
  if (!rule) return undefined;
  const interval = Math.max(1, Math.min(365, Math.floor(rule.interval || 1)));
  const daysOfWeek = rule.frequency === 'weekly' ? sanitizeDaysOfWeek(rule.daysOfWeek) : undefined;
  const endDateKey =
    rule.endDateKey && /^\d{4}-\d{2}-\d{2}$/.test(rule.endDateKey) ? rule.endDateKey : undefined;
  return {
    frequency: rule.frequency,
    interval,
    ...(daysOfWeek ? { daysOfWeek } : {}),
    ...(endDateKey ? { endDateKey } : {}),
  };
}

export function getPresetIdForRule(rule?: RecurrenceRule): RecurrencePresetId | 'custom' {
  if (!rule) return 'none';
  if (rule.interval !== 1 || rule.endDateKey) return 'custom';
  if (rule.frequency === 'daily') return 'daily';
  if (rule.frequency === 'monthly') return 'monthly';
  if (rule.frequency === 'yearly') return 'yearly';
  if (rule.frequency === 'weekly') {
    const days = sanitizeDaysOfWeek(rule.daysOfWeek);
    if (!days || days.length === 0) return 'weekly';
    if (days.length === 5 && [1, 2, 3, 4, 5].every((d) => days.includes(d))) return 'weekdays';
    if (days.length === 1) return 'weekly';
    return 'custom';
  }
  return 'custom';
}

export function buildRuleFromPreset(
  preset: RecurrencePresetId,
  anchorDateKey?: string
): RecurrenceRule | undefined {
  switch (preset) {
    case 'none':
      return undefined;
    case 'daily':
      return { frequency: 'daily', interval: 1 };
    case 'weekdays':
      return { frequency: 'weekly', interval: 1, daysOfWeek: [1, 2, 3, 4, 5] };
    case 'weekly': {
      const dow = anchorDateKey ? parseDateKeyLocal(anchorDateKey).getDay() : undefined;
      return {
        frequency: 'weekly',
        interval: 1,
        ...(typeof dow === 'number' ? { daysOfWeek: [dow] } : {}),
      };
    }
    case 'monthly':
      return { frequency: 'monthly', interval: 1 };
    case 'yearly':
      return { frequency: 'yearly', interval: 1 };
  }
}

function getNextOccurrenceDateKey(
  currentDateKey: string,
  rawRule: RecurrenceRule
): string | null {
  const rule = normalizeRecurrenceRule(rawRule);
  if (!rule) return null;

  const dt = parseDateKeyLocal(currentDateKey);
  let nextKey = '';

  if (rule.frequency === 'daily') {
    nextKey = addDaysToDateKey(currentDateKey, rule.interval);
  } else if (rule.frequency === 'weekly') {
    const days = rule.daysOfWeek;
    if (days && days.length > 0) {
      const curMonOffset = (dt.getDay() + 6) % 7;
      const mondayKey = getMondayDateKey(currentDateKey);
      const laterInSameWeek = days.find((d) => (d + 6) % 7 > curMonOffset);
      if (laterInSameWeek !== undefined) {
        nextKey = addDaysToDateKey(mondayKey, (laterInSameWeek + 6) % 7);
      } else {
        const nextWeekMonday = addDaysToDateKey(mondayKey, rule.interval * 7);
        const firstDayOffset = (days[0] + 6) % 7;
        nextKey = addDaysToDateKey(nextWeekMonday, firstDayOffset);
      }
    } else {
      nextKey = addDaysToDateKey(currentDateKey, rule.interval * 7);
    }
  } else if (rule.frequency === 'monthly') {
    const totalMonths = dt.getFullYear() * 12 + dt.getMonth() + rule.interval;
    const targetYear = Math.floor(totalMonths / 12);
    const targetMonth = totalMonths % 12;
    const targetDay = Math.min(dt.getDate(), daysInMonth(targetYear, targetMonth));
    nextKey = toDateKeyLocal(new Date(targetYear, targetMonth, targetDay));
  } else {
    const targetYear = dt.getFullYear() + rule.interval;
    const targetMonth = dt.getMonth();
    const targetDay = Math.min(dt.getDate(), daysInMonth(targetYear, targetMonth));
    nextKey = toDateKeyLocal(new Date(targetYear, targetMonth, targetDay));
  }

  if (rule.endDateKey && nextKey > rule.endDateKey) {
    return null;
  }
  return nextKey;
}

export function doesRuleOccurOnDate(
  anchorDateKey: string,
  rawRule: RecurrenceRule,
  targetDateKey: string
): boolean {
  const rule = normalizeRecurrenceRule(rawRule);
  if (!rule) return anchorDateKey === targetDateKey;
  if (targetDateKey < anchorDateKey) return false;
  if (rule.endDateKey && targetDateKey > rule.endDateKey) return false;

  const anchor = parseDateKeyLocal(anchorDateKey);
  const target = parseDateKeyLocal(targetDateKey);

  if (rule.frequency === 'daily') {
    const diff = diffDaysDateKeys(anchorDateKey, targetDateKey);
    return diff >= 0 && diff % rule.interval === 0;
  }

  if (rule.frequency === 'weekly') {
    const anchorMonday = getMondayDateKey(anchorDateKey);
    const targetMonday = getMondayDateKey(targetDateKey);
    const weeksDiff = Math.round(diffDaysDateKeys(anchorMonday, targetMonday) / 7);
    if (weeksDiff < 0 || weeksDiff % rule.interval !== 0) return false;
    const activeDays =
      rule.daysOfWeek && rule.daysOfWeek.length > 0 ? rule.daysOfWeek : [anchor.getDay()];
    return activeDays.includes(target.getDay());
  }

  if (rule.frequency === 'monthly') {
    const monthsDiff =
      (target.getFullYear() - anchor.getFullYear()) * 12 + (target.getMonth() - anchor.getMonth());
    if (monthsDiff < 0 || monthsDiff % rule.interval !== 0) return false;
    const expectedDay = Math.min(
      anchor.getDate(),
      daysInMonth(target.getFullYear(), target.getMonth())
    );
    return target.getDate() === expectedDay;
  }

  const yearsDiff = target.getFullYear() - anchor.getFullYear();
  if (yearsDiff < 0 || yearsDiff % rule.interval !== 0) return false;
  if (target.getMonth() !== anchor.getMonth()) return false;
  const expectedDay = Math.min(
    anchor.getDate(),
    daysInMonth(target.getFullYear(), target.getMonth())
  );
  return target.getDate() === expectedDay;
}

export function eventOccursOnDate(ev: CalendarEvent, targetDateKey: string): boolean {
  const spanDays =
    ev.endDateKey && ev.endDateKey > ev.dateKey
      ? Math.min(60, diffDaysDateKeys(ev.dateKey, ev.endDateKey))
      : 0;

  if (!ev.recurrence) {
    const endKey = ev.endDateKey && ev.endDateKey >= ev.dateKey ? ev.endDateKey : ev.dateKey;
    return ev.dateKey <= targetDateKey && endKey >= targetDateKey;
  }

  for (let offset = 0; offset <= spanDays; offset += 1) {
    const candidateStart = offset === 0 ? targetDateKey : addDaysToDateKey(targetDateKey, -offset);
    if (doesRuleOccurOnDate(ev.dateKey, ev.recurrence, candidateStart)) {
      return true;
    }
  }
  return false;
}

export function materializeEventForDate(ev: CalendarEvent, targetDateKey: string): CalendarEvent {
  if (!ev.recurrence) return ev;
  const spanDays =
    ev.endDateKey && ev.endDateKey > ev.dateKey
      ? Math.min(60, diffDaysDateKeys(ev.dateKey, ev.endDateKey))
      : 0;

  for (let offset = 0; offset <= spanDays; offset += 1) {
    const candidateStart = offset === 0 ? targetDateKey : addDaysToDateKey(targetDateKey, -offset);
    if (doesRuleOccurOnDate(ev.dateKey, ev.recurrence, candidateStart)) {
      return {
        ...ev,
        dateKey: candidateStart,
        endDateKey: spanDays > 0 ? addDaysToDateKey(candidateStart, spanDays) : undefined,
      };
    }
  }
  return ev;
}

export function formatRecurrenceLabel(rawRule?: RecurrenceRule, compact = false): string {
  const rule = normalizeRecurrenceRule(rawRule);
  if (!rule) return 'Does not repeat';

  const TINY_WEEKDAYS = ['Su', 'M', 'Tu', 'W', 'Th', 'F', 'Sa'];
  let base = '';
  const n = rule.interval;

  if (rule.frequency === 'daily') {
    base = compact ? (n === 1 ? '1d' : `${n}d`) : n === 1 ? 'Daily' : `Every ${n} days`;
  } else if (rule.frequency === 'weekly') {
    const days = rule.daysOfWeek;
    const isWeekdays =
      n === 1 && days && days.length === 5 && [1, 2, 3, 4, 5].every((d) => days.includes(d));
    const isWeekends =
      n === 1 && days && days.length === 2 && days.includes(0) && days.includes(6);

    if (isWeekdays) {
      base = compact ? 'M-F' : 'Weekdays';
    } else if (isWeekends) {
      base = compact ? 'Wknd' : 'Weekends';
    } else if (days && days.length > 1) {
      const dayList = compact
        ? days.map((d) => TINY_WEEKDAYS[d]).join('/')
        : days.map((d) => SHORT_WEEKDAYS[d]).join(', ');
      base =
        n === 1
          ? compact
            ? dayList
            : `Weekly (${dayList})`
          : compact
            ? `${n}w ${dayList}`
            : `Every ${n}w (${dayList})`;
    } else if (n === 1) {
      base = compact ? '1w' : 'Weekly';
    } else {
      base = compact ? `${n}w` : `Every ${n} weeks`;
    }
  } else if (rule.frequency === 'monthly') {
    base = compact ? `${n}m` : n === 1 ? 'Monthly' : `Every ${n} months`;
  } else {
    base = compact ? `${n}y` : n === 1 ? 'Yearly' : `Every ${n} years`;
  }

  if (!compact && rule.endDateKey) {
    const endDt = parseDateKeyLocal(rule.endDateKey);
    const endLabel = `${String(endDt.getDate()).padStart(2, '0')} ${SHORT_MONTHS[endDt.getMonth()]}`;
    return `${base} · until ${endLabel}`;
  }

  return base;
}

export function toGoogleCalendarRRule(rawRule: RecurrenceRule): string | null {
  const rule = normalizeRecurrenceRule(rawRule);
  if (!rule) return null;

  const freqMap: Record<RecurrenceFrequency, string> = {
    daily: 'DAILY',
    weekly: 'WEEKLY',
    monthly: 'MONTHLY',
    yearly: 'YEARLY',
  };

  const parts = [`FREQ=${freqMap[rule.frequency]}`];
  if (rule.interval > 1) {
    parts.push(`INTERVAL=${rule.interval}`);
  }
  if (rule.frequency === 'weekly' && rule.daysOfWeek && rule.daysOfWeek.length > 0) {
    parts.push(`BYDAY=${rule.daysOfWeek.map((d) => RRULE_BYDAY[d]).join(',')}`);
  }
  if (rule.endDateKey) {
    const compact = rule.endDateKey.replace(/-/g, '');
    parts.push(`UNTIL=${compact}T235959Z`);
  }

  return `RRULE:${parts.join(';')}`;
}

export function parseGoogleRRule(rruleLines?: string[]): RecurrenceRule | undefined {
  if (!Array.isArray(rruleLines)) return undefined;
  const line = rruleLines.find((r) => typeof r === 'string' && r.toUpperCase().startsWith('RRULE:'));
  if (!line) return undefined;

  const body = line.slice(6);
  const map = new Map<string, string>();
  for (const part of body.split(';')) {
    const [k, v] = part.split('=');
    if (k && v) map.set(k.trim().toUpperCase(), v.trim().toUpperCase());
  }

  const freqRaw = map.get('FREQ');
  let frequency: RecurrenceFrequency | null = null;
  if (freqRaw === 'DAILY') frequency = 'daily';
  else if (freqRaw === 'WEEKLY') frequency = 'weekly';
  else if (freqRaw === 'MONTHLY') frequency = 'monthly';
  else if (freqRaw === 'YEARLY') frequency = 'yearly';
  if (!frequency) return undefined;

  const interval = Math.max(1, parseInt(map.get('INTERVAL') || '1', 10) || 1);

  let daysOfWeek: number[] | undefined;
  const byDay = map.get('BYDAY');
  if (byDay && frequency === 'weekly') {
    const parsed = byDay
      .split(',')
      .map((code) => RRULE_BYDAY.indexOf(code.slice(-2) as (typeof RRULE_BYDAY)[number]))
      .filter((idx) => idx >= 0);
    if (parsed.length > 0) daysOfWeek = parsed;
  }

  let endDateKey: string | undefined;
  const until = map.get('UNTIL');
  if (until && /^\d{8}/.test(until)) {
    endDateKey = `${until.slice(0, 4)}-${until.slice(4, 6)}-${until.slice(6, 8)}`;
  }

  return normalizeRecurrenceRule({
    frequency,
    interval,
    daysOfWeek,
    endDateKey,
  });
}

export function buildNextRecurringTaskInstance(completedTask: TaskItem): TaskItem | null {
  if (!completedTask.recurrence) return null;
  const nextDateKey = getNextOccurrenceDateKey(completedTask.dateKey, completedTask.recurrence);
  if (!nextDateKey) return null;

  const dayDelta = diffDaysDateKeys(completedTask.dateKey, nextDateKey);
  const nextReminders: TaskReminder[] | undefined =
    completedTask.reminders && completedTask.reminders.length > 0
      ? completedTask.reminders.map((rem) => {
          if (rem.mode === 'exact' && rem.dateKey) {
            return {
              ...rem,
              id: makeReminderId(),
              dateKey: addDaysToDateKey(rem.dateKey, dayDelta),
              firedAt: undefined,
            };
          }
          return {
            ...rem,
            id: makeReminderId(),
            firedAt: undefined,
          };
        })
      : undefined;

  return {
    ...completedTask,
    id: `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    dateKey: nextDateKey,
    completed: false,
    completedAt: undefined,
    isInbox: false,
    subtasks: completedTask.subtasks.map((st) => ({ ...st, done: false })),
    reminders: nextReminders,
    recurrence: normalizeRecurrenceRule(completedTask.recurrence),
    recurrenceSeriesId: completedTask.recurrenceSeriesId || completedTask.id,
  };
}
