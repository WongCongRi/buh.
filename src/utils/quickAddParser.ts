import { getTodayDateKey, getTomorrowDateKey } from '../data/initialData';
import { RecurrenceRule, TaskCategory, TaskPriority, TaskReminder } from '../types/taskflow';
import { addDaysToDateKey, normalizeRecurrenceRule, parseDateKeyLocal } from './recurrence';
import { dedupeReminders, makeReminderId } from './taskReminders';

export interface ParsedQuickTask {
  title: string;
  timeLabel: string;
  category: TaskCategory;
  priority: TaskPriority;
  dateKey: string;
  explicitDate: boolean;
  reminders: TaskReminder[];
  recurrence?: RecurrenceRule;
}

export type NlpTokenKind = 'text' | 'time' | 'date' | 'list' | 'priority' | 'reminder' | 'recurrence';

export interface NlpTextSegment {
  text: string;
  kind: NlpTokenKind;
}

const DEFAULT_LISTS = ['Work', 'Projects', 'Personal'];

const MONTH_MAP: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

const MONTH_TOKEN_SRC =
  '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';

const SINGLE_WEEKDAY_TOKEN_SRC =
  '(?:sun(?:day)?|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:s|nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?)';

const WEEKDAY_DATE_SRC = `(?:(?:next|this)\\s+)?${SINGLE_WEEKDAY_TOKEN_SRC}`;

const DATE_PATTERN_SRC =
  `(?:\\d{4}-\\d{2}-\\d{2}|\\d{1,2}\\/\\d{1,2}(?:\\/\\d{2,4})?|\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH_TOKEN_SRC}(?:,?\\s*\\d{4})?|${MONTH_TOKEN_SRC}\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s*\\d{4})?|today|tomorrow|tmrw|yesterday|${WEEKDAY_DATE_SRC})`;

const TIME_12H_CORE_SRC =
  '(?:(?:0?[1-9]|1[0-2]):[0-5]\\d|(?:1[0-2]|0?[1-9])[0-5]\\d|1[0-2]|0?[1-9])\\s*(?:am|pm)';

const TIME_PATTERN_SRC = `(?:${TIME_12H_CORE_SRC}|(?:[01]?\\d|2[0-3]):[0-5]\\d)`;

const OFFSET_ITEM_SRC =
  '\\d+(?:\\.\\d+)?\\s*(?:weeks?|wks?|wk|w|days?|d|hours?|hrs?|hr|h|minutes?|mins?|min|m)';

const OFFSET_CHAIN_SRC = `(?:${OFFSET_ITEM_SRC})(?:\\s*(?:,|\\band\\b|&)?\\s*(?:${OFFSET_ITEM_SRC}))*`;

const TRIGGER_SRC = '(?:remind(?:\\s+me)?|notify(?:\\s+me)?|alert(?:\\s+me)?)';

// Relative reminders: "remind 10m before", "notify 1d, 1h and 10m before", "1hr before", "10 mins before"
const RELATIVE_REMINDER_REGEX = new RegExp(
  `(?:\\b${TRIGGER_SRC}\\s+)?(${OFFSET_CHAIN_SRC})\\s+before\\b`,
  'gi'
);

// "remind at time" / "notify on time"
const AT_TIME_REMINDER_REGEX = new RegExp(
  `\\b${TRIGGER_SRC}\\s+(?:at|on)\\s+time\\b`,
  'gi'
);

// Relative "remind me in 30mins" / "notify in 1h 15m"
const IN_OFFSET_REMINDER_REGEX = new RegExp(
  `\\b${TRIGGER_SRC}\\s+in\\s+(${OFFSET_CHAIN_SRC})\\b`,
  'gi'
);

// Exact reminders: "remind tomorrow 9am", "notify Nov 25 at 2:30pm", "remind me at 715am", "notify 2026-11-25 14:00"
const EXACT_REMINDER_REGEX = new RegExp(
  `\\b${TRIGGER_SRC}\\s+(?:(?:on|at)\\s+)?(?:(${DATE_PATTERN_SRC})(?:\\s+(?:at\\s+)?(${TIME_PATTERN_SRC}))?|(${TIME_PATTERN_SRC})(?:\\s+(?:on\\s+)?(${DATE_PATTERN_SRC}))?)(?=\\s|$|[,.!?])`,
  'gi'
);

// Standalone relative offset schedule: "in 30mins", "in 1h 15m", "in 2 days"
const IN_OFFSET_SCHEDULE_REGEX = new RegExp(`\\bin\\s+(${OFFSET_CHAIN_SRC})\\b`, 'gi');

const WEEKDAY_NAME_MAP: Record<string, number> = {
  sun: 0,
  sunday: 0,
  sundays: 0,
  mon: 1,
  monday: 1,
  mondays: 1,
  tue: 2,
  tues: 2,
  tuesday: 2,
  tuesdays: 2,
  wed: 3,
  weds: 3,
  wednesday: 3,
  wednesdays: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  thursday: 4,
  thursdays: 4,
  fri: 5,
  friday: 5,
  fridays: 5,
  sat: 6,
  saturday: 6,
  saturdays: 6,
};

const WEEKDAY_TOKEN_SRC =
  '(?:sun(?:days?)?|mon(?:days?)?|tue(?:s(?:days?)?)?|wed(?:s|nesdays?)?|thu(?:rs?(?:days?)?)?|fri(?:days?)?|sat(?:urdays?)?)';

const RECURRENCE_REGEX = new RegExp(
  `\\b(?:every\\s+(?:(\\d+)\\s*(days?|weeks?|wks?|months?|mos?|years?|yrs?)|other\\s+(day|week|month|year)|(weekdays?|weekends?)|(${WEEKDAY_TOKEN_SRC}(?:\\s*(?:,|\\band\\b|&)\\s*${WEEKDAY_TOKEN_SRC})*)|(day|week|month|year))|(daily|weekly|biweekly|monthly|yearly|annually|weekdays|weekends))\\b`,
  'gi'
);

const WEEKDAY_ITEM_REGEX = new RegExp(`\\b(${WEEKDAY_TOKEN_SRC})\\b`, 'gi');
const WEEKDAY_DATE_MATCH_REGEX = new RegExp(
  `^(?:(next|this)\\s+)?(${SINGLE_WEEKDAY_TOKEN_SRC})$`,
  'i'
);
const OFFSET_ITEM_REGEX =
  /(\d+(?:\.\d+)?)\s*(weeks?|wks?|wk|w|days?|d|hours?|hrs?|hr|h|minutes?|mins?|min|m)/gi;

const PRIORITY_TOKEN_REGEX = /(?:^|\s)(!high|!low)\b|\b(high|urgent|p1|low|p3)\b/gi;
const PROJ_ALIAS_TOKEN_REGEX = /(?:^|\s)(#?project)(?=\s|$|[,.!?])/gi;
const DATE_TOKEN_REGEX = new RegExp(`(?:\\bon\\s+)?\\b(${DATE_PATTERN_SRC})\\b`, 'gi');
const TIME_12H_TOKEN_REGEX = new RegExp(`(?:\\bat\\s+)?\\b(${TIME_12H_CORE_SRC})\\b`, 'gi');
const TIME_24H_TOKEN_REGEX = /(?:\bat\s+)?\b([01]?\d|2[0-3]):([0-5]\d)\b/gi;

const TASK_DATE_MATCH_REGEX = new RegExp(`(?:\\bon\\s+)?\\b(${DATE_PATTERN_SRC})\\b`, 'i');
const TIME_12H_PARSE_REGEX =
  /(?:\bat\s+)?\b((?:0?[1-9]|1[0-2]):[0-5]\d|(?:1[0-2]|0?[1-9])[0-5]\d|1[0-2]|0?[1-9])\s*(am|pm)\b/i;
const TIME_24H_PARSE_REGEX = /(?:\bat\s+)?\b([01]?\d|2[0-3]):([0-5]\d)\b/;

const LIST_REGEX_CACHE = new Map<string, { global: RegExp; single: RegExp }>();

function getListRegexes(listName: string): { global: RegExp; single: RegExp } {
  const key = listName.toLowerCase();
  const cached = LIST_REGEX_CACHE.get(key);
  if (cached) return cached;
  if (LIST_REGEX_CACHE.size >= 64) {
    LIST_REGEX_CACHE.clear();
  }
  const escaped = escapeRegExp(listName);
  const entry = {
    global: new RegExp(`(?:^|\\s)(#?${escaped})(?=\\s|$|[,.!?])`, 'gi'),
    single: new RegExp(`(?:^|\\s)(#?${escaped})(?=\\s|$|[,.!?])`, 'i'),
  };
  LIST_REGEX_CACHE.set(key, entry);
  return entry;
}

function parseRecurrenceMatch(match: RegExpMatchArray): RecurrenceRule | undefined {
  const intervalNum = match[1] ? parseInt(match[1], 10) : 1;
  const intervalUnit = match[2]?.toLowerCase();
  const otherUnit = match[3]?.toLowerCase();
  const wkGroup = match[4]?.toLowerCase();
  const weekdayChain = match[5]?.toLowerCase();
  const singleUnit = match[6]?.toLowerCase();
  const keyword = match[7]?.toLowerCase();

  if (intervalUnit) {
    const freq = intervalUnit.startsWith('d')
      ? 'daily'
      : intervalUnit.startsWith('w')
        ? 'weekly'
        : intervalUnit.startsWith('m')
          ? 'monthly'
          : 'yearly';
    return normalizeRecurrenceRule({ frequency: freq, interval: Math.max(1, intervalNum) });
  }
  if (otherUnit) {
    const freq =
      otherUnit === 'day'
        ? 'daily'
        : otherUnit === 'week'
          ? 'weekly'
          : otherUnit === 'month'
            ? 'monthly'
            : 'yearly';
    return normalizeRecurrenceRule({ frequency: freq, interval: 2 });
  }
  if (wkGroup) {
    if (wkGroup.startsWith('weekday')) {
      return normalizeRecurrenceRule({ frequency: 'weekly', interval: 1, daysOfWeek: [1, 2, 3, 4, 5] });
    }
    return normalizeRecurrenceRule({ frequency: 'weekly', interval: 1, daysOfWeek: [0, 6] });
  }
  if (weekdayChain) {
    WEEKDAY_ITEM_REGEX.lastIndex = 0;
    const days: number[] = [];
    for (const part of weekdayChain.matchAll(WEEKDAY_ITEM_REGEX)) {
      const key = part[1]?.toLowerCase();
      if (key && key in WEEKDAY_NAME_MAP) {
        days.push(WEEKDAY_NAME_MAP[key]);
      }
    }
    if (days.length > 0) {
      return normalizeRecurrenceRule({ frequency: 'weekly', interval: 1, daysOfWeek: days });
    }
  }
  if (singleUnit) {
    const freq =
      singleUnit === 'day'
        ? 'daily'
        : singleUnit === 'week'
          ? 'weekly'
          : singleUnit === 'month'
            ? 'monthly'
            : 'yearly';
    return normalizeRecurrenceRule({ frequency: freq, interval: 1 });
  }
  if (keyword) {
    if (keyword === 'daily') return { frequency: 'daily', interval: 1 };
    if (keyword === 'weekly') return { frequency: 'weekly', interval: 1 };
    if (keyword === 'biweekly') return { frequency: 'weekly', interval: 2 };
    if (keyword === 'monthly') return { frequency: 'monthly', interval: 1 };
    if (keyword === 'yearly' || keyword === 'annually') return { frequency: 'yearly', interval: 1 };
    if (keyword === 'weekdays') return { frequency: 'weekly', interval: 1, daysOfWeek: [1, 2, 3, 4, 5] };
    if (keyword === 'weekends') return { frequency: 'weekly', interval: 1, daysOfWeek: [0, 6] };
  }
  return undefined;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatYmd(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseDateExpression(rawDate: string): string | null {
  const s = rawDate.trim().toLowerCase();
  if (s === 'today') return getTodayDateKey();
  if (s === 'tomorrow' || s === 'tmrw') return getTomorrowDateKey();
  if (s === 'yesterday') return addDaysToDateKey(getTodayDateKey(), -1);

  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    return `${iso[1]}-${iso[2]}-${iso[3]}`;
  }

  const now = new Date();
  const currentYear = now.getFullYear();

  const resolveDayMonthYear = (day: number, month: number, explicitYear?: string): string | null => {
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    let year = explicitYear ? parseInt(explicitYear, 10) : currentYear;
    if (year < 100) year += 2000;
    const check = new Date(year, month - 1, day);
    if (check.getMonth() !== month - 1 || check.getDate() !== day) return null;
    if (!explicitYear) {
      const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      if (check < cutoff) year += 1;
    }
    return formatYmd(year, month, day);
  };

  // DD/MM/YYYY, DD/MM/YY, DD/MM (falls back to MM/DD only when second part > 12 and first <= 12)
  const slash = s.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (slash) {
    let day = parseInt(slash[1], 10);
    let month = parseInt(slash[2], 10);
    if (month > 12 && day >= 1 && day <= 12) {
      const tmp = day;
      day = month;
      month = tmp;
    }
    return resolveDayMonthYear(day, month, slash[3]);
  }

  // DD MMM / DD MMM YYYY (e.g. "24 Nov", "01 Dec", "5th Jan 2027")
  const dayMonthWord = s.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)(?:,?\s*(\d{4}))?$/);
  if (dayMonthWord) {
    const day = parseInt(dayMonthWord[1], 10);
    const month = MONTH_MAP[dayMonthWord[2]];
    if (month) {
      return resolveDayMonthYear(day, month, dayMonthWord[3]);
    }
  }

  // MMM DD / MMM DD YYYY (e.g. "Nov 24")
  const monthWord = s.match(/^([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?$/);
  if (monthWord) {
    const month = MONTH_MAP[monthWord[1]];
    const day = parseInt(monthWord[2], 10);
    if (month) {
      return resolveDayMonthYear(day, month, monthWord[3]);
    }
  }

  const weekdayMatch = s.match(WEEKDAY_DATE_MATCH_REGEX);
  if (weekdayMatch) {
    const modifier = weekdayMatch[1]?.toLowerCase() as 'next' | 'this' | undefined;
    const dayToken = weekdayMatch[2].toLowerCase();
    const targetDow = WEEKDAY_NAME_MAP[dayToken];
    if (targetDow !== undefined) {
      const todayKey = getTodayDateKey();
      const todayDow = parseDateKeyLocal(todayKey).getDay();
      let delta: number;
      if (modifier === 'next') {
        // Target that weekday in next calendar week (Monday–Sunday week, matching the app calendar)
        const todayMonIdx = (todayDow + 6) % 7;
        const targetMonIdx = (targetDow + 6) % 7;
        delta = 7 - todayMonIdx + targetMonIdx;
      } else if (modifier === 'this') {
        // Upcoming occurrence starting from today (0..6 days)
        delta = (targetDow - todayDow + 7) % 7;
      } else {
        // Bare weekday (e.g. "Tuesday"): next occurring instance of that weekday (1..7 days)
        delta = (targetDow - todayDow + 7) % 7;
        if (delta === 0) delta = 7;
      }
      return addDaysToDateKey(todayKey, delta);
    }
  }

  return null;
}

function parse12hClockParts(
  hourMinPart: string,
  meridiemRaw: string
): { hour12: number; mins: number; meridiem: 'AM' | 'PM' } | null {
  const digits = hourMinPart.trim();
  const meridiem = meridiemRaw.trim().toUpperCase() === 'PM' ? 'PM' : 'AM';
  let hour12 = 0;
  let mins = 0;

  if (digits.includes(':')) {
    const [hStr, mStr] = digits.split(':');
    hour12 = parseInt(hStr, 10);
    mins = parseInt(mStr, 10);
  } else if (digits.length <= 2) {
    hour12 = parseInt(digits, 10);
    mins = 0;
  } else if (digits.length === 3 || digits.length === 4) {
    hour12 = parseInt(digits.slice(0, -2), 10);
    mins = parseInt(digits.slice(-2), 10);
  } else {
    return null;
  }

  if (Number.isNaN(hour12) || Number.isNaN(mins) || hour12 < 1 || hour12 > 12 || mins < 0 || mins > 59) {
    return null;
  }
  return { hour12, mins, meridiem };
}

function format12hLabel(hour24: number, mins: number): string {
  const meridiem = hour24 >= 12 ? 'PM' : 'AM';
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const paddedHour = hour12 < 10 ? `0${hour12}` : `${hour12}`;
  return `${paddedHour}:${String(mins).padStart(2, '0')} ${meridiem}`;
}

function parseTimeExpressionTo24h(rawTime: string): string | null {
  const s = rawTime.trim().toLowerCase();
  const m12 = s.match(/^(\d{1,4}(?::\d{2})?)\s*(am|pm)$/);
  if (m12) {
    const parsed = parse12hClockParts(m12[1], m12[2]);
    if (!parsed) return null;
    let hour = parsed.hour12;
    if (parsed.meridiem === 'PM' && hour < 12) hour += 12;
    if (parsed.meridiem === 'AM' && hour === 12) hour = 0;
    return `${String(hour).padStart(2, '0')}:${String(parsed.mins).padStart(2, '0')}`;
  }
  const m24 = s.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (m24) {
    const hour = parseInt(m24[1], 10);
    const mins = parseInt(m24[2], 10);
    return `${String(hour).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
  }
  return null;
}

function unitToMinutes(amount: number, rawUnit: string): number {
  const u = rawUnit.toLowerCase();
  if (u.startsWith('w')) return Math.round(amount * 10080);
  if (u.startsWith('d')) return Math.round(amount * 1440);
  if (u.startsWith('h')) return Math.round(amount * 60);
  return Math.round(amount);
}

function parseOffsetChain(offsetChain: string): {
  totalMinutes: number;
  hasClockUnit: boolean;
} {
  OFFSET_ITEM_REGEX.lastIndex = 0;
  let totalMinutes = 0;
  let hasClockUnit = false;
  for (const part of offsetChain.matchAll(OFFSET_ITEM_REGEX)) {
    const amount = parseFloat(part[1]);
    if (!Number.isFinite(amount) || amount < 0) continue;
    const unit = part[2].toLowerCase();
    if (unit.startsWith('h') || unit.startsWith('m')) {
      hasClockUnit = true;
    }
    totalMinutes += unitToMinutes(amount, unit);
  }
  return { totalMinutes, hasClockUnit };
}

interface TokenSpan {
  start: number;
  end: number;
  kind: Exclude<NlpTokenKind, 'text'>;
}

export function tokenizeQuickTaskInput(
  raw: string,
  nlpEnabled: boolean,
  availableLists: string[] = DEFAULT_LISTS
): NlpTextSegment[] {
  if (!nlpEnabled || !raw) {
    return raw ? [{ text: raw, kind: 'text' }] : [];
  }

  const spans: TokenSpan[] = [];
  const reminderRanges: Array<{ start: number; end: number }> = [];

  const overlapsReminder = (start: number, end: number) =>
    reminderRanges.some((r) => start < r.end && end > r.start);

  // 0. Reminder spans first (so dates/times inside reminder clauses stay highlighted as reminder tokens)
  for (const regex of [
    RELATIVE_REMINDER_REGEX,
    AT_TIME_REMINDER_REGEX,
    IN_OFFSET_REMINDER_REGEX,
    EXACT_REMINDER_REGEX,
  ]) {
    regex.lastIndex = 0;
    for (const m of raw.matchAll(regex)) {
      const idx = m.index ?? 0;
      const end = idx + m[0].length;
      if (!overlapsReminder(idx, end)) {
        spans.push({ start: idx, end, kind: 'reminder' });
        reminderRanges.push({ start: idx, end });
      }
    }
  }

  // 0b. Recurrence spans (e.g. "daily", "every 2 weeks", "every mon, wed, fri", "weekdays")
  RECURRENCE_REGEX.lastIndex = 0;
  for (const m of raw.matchAll(RECURRENCE_REGEX)) {
    const idx = m.index ?? 0;
    const end = idx + m[0].length;
    if (!overlapsReminder(idx, end)) {
      spans.push({ start: idx, end, kind: 'recurrence' });
      reminderRanges.push({ start: idx, end });
    }
  }

  // 1. Priority spans
  PRIORITY_TOKEN_REGEX.lastIndex = 0;
  for (const m of raw.matchAll(PRIORITY_TOKEN_REGEX)) {
    const idx = m.index ?? 0;
    if (m[1]) {
      const tokenStart = idx + (m[0].length - m[1].length);
      const end = tokenStart + m[1].length;
      if (!overlapsReminder(tokenStart, end)) {
        spans.push({ start: tokenStart, end, kind: 'priority' });
      }
    } else if (m[2]) {
      const end = idx + m[0].length;
      if (!overlapsReminder(idx, end)) {
        spans.push({ start: idx, end, kind: 'priority' });
      }
    }
  }

  // 2. Named list spans (including Inbox + custom lists, longest names first)
  const uniqueLists = Array.from(new Set([...availableLists, 'Inbox']))
    .filter((l) => l.trim().length > 0)
    .sort((a, b) => b.length - a.length);

  for (const listName of uniqueLists) {
    const listRegex = getListRegexes(listName).global;
    listRegex.lastIndex = 0;
    for (const m of raw.matchAll(listRegex)) {
      const idx = m.index ?? 0;
      const captured = m[1];
      if (!captured) continue;
      const tokenStart = idx + (m[0].length - captured.length);
      const end = tokenStart + captured.length;
      if (!overlapsReminder(tokenStart, end)) {
        spans.push({ start: tokenStart, end, kind: 'list' });
      }
    }
  }

  // Also support singular/plural "#project" alias when "Projects" exists
  if (uniqueLists.some((l) => l.toLowerCase() === 'projects')) {
    PROJ_ALIAS_TOKEN_REGEX.lastIndex = 0;
    for (const m of raw.matchAll(PROJ_ALIAS_TOKEN_REGEX)) {
      const idx = m.index ?? 0;
      const captured = m[1];
      if (!captured) continue;
      const tokenStart = idx + (m[0].length - captured.length);
      const end = tokenStart + captured.length;
      if (!overlapsReminder(tokenStart, end)) {
        spans.push({ start: tokenStart, end, kind: 'list' });
      }
    }
  }

  // 3. Date spans (including weekdays like "Tuesday", "on Tue", "next Tuesday", "this Friday")
  DATE_TOKEN_REGEX.lastIndex = 0;
  for (const m of raw.matchAll(DATE_TOKEN_REGEX)) {
    const idx = m.index ?? 0;
    const end = idx + m[0].length;
    if (!overlapsReminder(idx, end)) {
      spans.push({ start: idx, end, kind: 'date' });
    }
  }

  // 4. Time spans (12h including "715am"/"12:30pm", 24h, and relative offsets like "in 30mins")
  TIME_12H_TOKEN_REGEX.lastIndex = 0;
  for (const m of raw.matchAll(TIME_12H_TOKEN_REGEX)) {
    const idx = m.index ?? 0;
    const end = idx + m[0].length;
    if (!overlapsReminder(idx, end)) {
      spans.push({ start: idx, end, kind: 'time' });
    }
  }

  TIME_24H_TOKEN_REGEX.lastIndex = 0;
  for (const m of raw.matchAll(TIME_24H_TOKEN_REGEX)) {
    const idx = m.index ?? 0;
    const end = idx + m[0].length;
    if (!overlapsReminder(idx, end)) {
      spans.push({ start: idx, end, kind: 'time' });
    }
  }

  IN_OFFSET_SCHEDULE_REGEX.lastIndex = 0;
  for (const m of raw.matchAll(IN_OFFSET_SCHEDULE_REGEX)) {
    const idx = m.index ?? 0;
    const end = idx + m[0].length;
    if (!overlapsReminder(idx, end) && m[1]) {
      const { hasClockUnit } = parseOffsetChain(m[1]);
      spans.push({ start: idx, end, kind: hasClockUnit ? 'time' : 'date' });
    }
  }

  // Deduplicate & sort non-overlapping spans
  spans.sort((a, b) => a.start - b.start || b.end - a.end);
  const accepted: TokenSpan[] = [];
  let cursor = 0;
  for (const span of spans) {
    if (span.start >= cursor && span.end > span.start) {
      accepted.push(span);
      cursor = span.end;
    }
  }

  if (accepted.length === 0) {
    return [{ text: raw, kind: 'text' }];
  }

  const segments: NlpTextSegment[] = [];
  let pos = 0;
  for (const span of accepted) {
    if (span.start > pos) {
      segments.push({ text: raw.slice(pos, span.start), kind: 'text' });
    }
    segments.push({ text: raw.slice(span.start, span.end), kind: span.kind });
    pos = span.end;
  }
  if (pos < raw.length) {
    segments.push({ text: raw.slice(pos), kind: 'text' });
  }

  return segments;
}

export function parseQuickTaskInput(
  raw: string,
  nlpEnabled: boolean,
  defaultInbox: boolean,
  availableLists: string[] = DEFAULT_LISTS,
  fallbackCategory?: TaskCategory
): ParsedQuickTask {
  const trimmed = raw.trim();
  const baseCategory =
    fallbackCategory || (defaultInbox ? 'Inbox' : availableLists[0] || 'Personal');

  const todayKey = getTodayDateKey();
  const tomorrowKey = getTomorrowDateKey();

  if (!nlpEnabled) {
    return {
      title: trimmed,
      timeLabel: 'No time set',
      category: baseCategory,
      priority: 'Normal',
      dateKey: todayKey,
      explicitDate: false,
      reminders: [],
    };
  }

  let working = trimmed;
  let timeLabel = 'No time set';
  let category: TaskCategory = baseCategory;
  let priority: TaskPriority = 'Normal';
  let dateKey = todayKey;
  let explicitDateProvided = false;
  let recurrence: RecurrenceRule | undefined;

  const extractedReminders: TaskReminder[] = [];
  const pendingTimeOnlyExactIndices: number[] = [];

  // 0a. Extract relative reminder clauses (e.g. "remind 1d, 1h and 10m before", "10 mins before")
  RELATIVE_REMINDER_REGEX.lastIndex = 0;
  working = working.replace(RELATIVE_REMINDER_REGEX, (_full, offsetChain: string) => {
    OFFSET_ITEM_REGEX.lastIndex = 0;
    for (const part of offsetChain.matchAll(OFFSET_ITEM_REGEX)) {
      const amount = parseFloat(part[1]);
      if (Number.isFinite(amount) && amount >= 0) {
        extractedReminders.push({
          id: makeReminderId(),
          mode: 'relative',
          offsetMinutes: unitToMinutes(amount, part[2]),
        });
      }
    }
    return ' ';
  });

  // 0b. Extract "remind at time" / "notify on time"
  AT_TIME_REMINDER_REGEX.lastIndex = 0;
  working = working.replace(AT_TIME_REMINDER_REGEX, () => {
    extractedReminders.push({
      id: makeReminderId(),
      mode: 'relative',
      offsetMinutes: 0,
    });
    return ' ';
  });

  // 0b2. Extract relative exact reminders like "remind me in 30mins" / "notify in 1h"
  IN_OFFSET_REMINDER_REGEX.lastIndex = 0;
  working = working.replace(IN_OFFSET_REMINDER_REGEX, (_full, offsetChain: string) => {
    const { totalMinutes } = parseOffsetChain(offsetChain);
    if (totalMinutes >= 0) {
      const target = new Date(Date.now() + totalMinutes * 60_000);
      extractedReminders.push({
        id: makeReminderId(),
        mode: 'exact',
        dateKey: formatYmd(target.getFullYear(), target.getMonth() + 1, target.getDate()),
        time24: `${String(target.getHours()).padStart(2, '0')}:${String(target.getMinutes()).padStart(2, '0')}`,
      });
      return ' ';
    }
    return _full;
  });

  // 0c. Extract exact date/time reminder clauses (e.g. "remind tomorrow 9am", "notify Nov 25 at 2pm", "remind me at 8:30am")
  EXACT_REMINDER_REGEX.lastIndex = 0;
  working = working.replace(
    EXACT_REMINDER_REGEX,
    (_full, d1?: string, t1?: string, t2?: string, d2?: string) => {
      const rawDate = d1 || d2;
      const rawTime = t1 || t2;
      const parsedDate = rawDate ? parseDateExpression(rawDate) : null;
      const parsedTime = rawTime ? parseTimeExpressionTo24h(rawTime) : null;

      if (parsedDate || parsedTime) {
        const idx = extractedReminders.length;
        extractedReminders.push({
          id: makeReminderId(),
          mode: 'exact',
          dateKey: parsedDate || todayKey,
          time24: parsedTime || '09:00',
        });
        if (!parsedDate && parsedTime) {
          pendingTimeOnlyExactIndices.push(idx);
        }
        return ' ';
      }
      return _full;
    }
  );

  // Clean up stray conjunctions left between stripped reminder clauses (e.g., "and", ",")
  working = working.replace(/\s+(?:and|&)\s*$/i, ' ').trim();

  // 0d. Extract recurrence clause (e.g. "every day", "weekdays", "every mon, wed", "every 2 weeks")
  RECURRENCE_REGEX.lastIndex = 0;
  const recMatch = RECURRENCE_REGEX.exec(working);
  if (recMatch) {
    const parsedRec = parseRecurrenceMatch(recMatch);
    if (parsedRec) {
      recurrence = parsedRec;
      working = working.replace(recMatch[0], ' ').trim();
    }
  }

  // 1. Extract priority keywords
  if (/(?:^|\s)!high\b|\b(high|urgent|p1)\b/i.test(working)) {
    priority = 'High';
    working = working.replace(/(?:^|\s)!high\b|\b(high|urgent|p1)\b/gi, ' ').trim();
  } else if (/(?:^|\s)!low\b|\b(low|p3)\b/i.test(working)) {
    priority = 'Low';
    working = working.replace(/(?:^|\s)!low\b|\b(low|p3)\b/gi, ' ').trim();
  }

  // 2. Extract list hashtags or matching list words (longest first)
  const uniqueLists = Array.from(new Set([...availableLists, 'Inbox']))
    .filter((l) => l.trim().length > 0)
    .sort((a, b) => b.length - a.length);

  for (const listName of uniqueLists) {
    const { single, global } = getListRegexes(listName);
    if (single.test(working)) {
      category = listName;
      global.lastIndex = 0;
      working = working.replace(global, ' ').trim();
      break;
    }
  }

  if (category === baseCategory && uniqueLists.some((l) => l.toLowerCase() === 'projects')) {
    if (/(?:^|\s)#?project(?=\s|$|[,.!?])/i.test(working)) {
      const projName = uniqueLists.find((l) => l.toLowerCase() === 'projects') || 'Projects';
      category = projName;
      PROJ_ALIAS_TOKEN_REGEX.lastIndex = 0;
      working = working.replace(PROJ_ALIAS_TOKEN_REGEX, ' ').trim();
    }
  }

  // 3. Extract task date (today, tomorrow, tmrw, Nov 25, 11/25, 2026-11-25)
  const taskDateMatch = working.match(TASK_DATE_MATCH_REGEX);
  if (taskDateMatch && taskDateMatch[1]) {
    const resolved = parseDateExpression(taskDateMatch[1]);
    if (resolved) {
      dateKey = resolved;
      explicitDateProvided = true;
      working = working.replace(taskDateMatch[0], ' ').trim();
    }
  } else if (/\btomorrow\b|\btmrw\b/i.test(working)) {
    dateKey = tomorrowKey;
    explicitDateProvided = true;
    working = working.replace(/\btomorrow\b|\btmrw\b/gi, ' ').trim();
  } else if (/\btoday\b/i.test(working)) {
    dateKey = todayKey;
    explicitDateProvided = true;
    working = working.replace(/\btoday\b/gi, ' ').trim();
  }

  // 3b. Extract relative offsets like "in 30mins", "in 1h 15m", "in 2 days"
  IN_OFFSET_SCHEDULE_REGEX.lastIndex = 0;
  const inOffsetMatch = IN_OFFSET_SCHEDULE_REGEX.exec(working);
  if (inOffsetMatch && inOffsetMatch[1]) {
    const { totalMinutes, hasClockUnit } = parseOffsetChain(inOffsetMatch[1]);
    const target = new Date(Date.now() + totalMinutes * 60_000);
    dateKey = formatYmd(target.getFullYear(), target.getMonth() + 1, target.getDate());
    explicitDateProvided = true;
    if (hasClockUnit) {
      timeLabel = format12hLabel(target.getHours(), target.getMinutes());
    }
    working = working.replace(inOffsetMatch[0], ' ').trim();
  }

  // If a weekly recurrence with specific weekdays was parsed and no explicit date was set,
  // align initial due date to today or the soonest matching weekday.
  if (
    !explicitDateProvided &&
    recurrence?.frequency === 'weekly' &&
    recurrence.daysOfWeek &&
    recurrence.daysOfWeek.length > 0
  ) {
    const startDow = parseDateKeyLocal(dateKey).getDay();
    if (!recurrence.daysOfWeek.includes(startDow)) {
      for (let offset = 1; offset <= 7; offset += 1) {
        const candKey = addDaysToDateKey(dateKey, offset);
        if (recurrence.daysOfWeek.includes(parseDateKeyLocal(candKey).getDay())) {
          dateKey = candKey;
          break;
        }
      }
    }
  }

  // Apply resolved task date to any time-only exact reminders (e.g., "Meeting tomorrow 3pm remind at 1pm")
  for (const idx of pendingTimeOnlyExactIndices) {
    if (extractedReminders[idx]) {
      extractedReminders[idx].dateKey = dateKey;
    }
  }

  // 4. Extract explicit clock times like "at 3pm", "715am", "1230pm", "3:30pm", "14:00", "9am"
  const time12Match = working.match(TIME_12H_PARSE_REGEX);
  const time24Match = working.match(TIME_24H_PARSE_REGEX);

  if (time12Match) {
    const parsed12 = parse12hClockParts(time12Match[1], time12Match[2]);
    if (parsed12) {
      const paddedHour =
        parsed12.hour12 < 10 ? `0${parsed12.hour12}` : `${parsed12.hour12}`;
      timeLabel = `${paddedHour}:${String(parsed12.mins).padStart(2, '0')} ${parsed12.meridiem}`;
      working = working.replace(time12Match[0], ' ').trim();
    }
  } else if (time24Match) {
    const hour24 = parseInt(time24Match[1], 10);
    const mins = parseInt(time24Match[2], 10);
    timeLabel = format12hLabel(hour24, mins);
    working = working.replace(time24Match[0], ' ').trim();
  }

  const cleanedTitle =
    working
      .replace(/\s{2,}/g, ' ')
      .replace(/\s+(?:at|on|and|&)$/i, '')
      .replace(/[,]+$/, '')
      .trim() || trimmed;

  return {
    title: cleanedTitle,
    timeLabel,
    category,
    priority,
    dateKey,
    explicitDate: explicitDateProvided,
    reminders: dedupeReminders(extractedReminders),
    recurrence,
  };
}
