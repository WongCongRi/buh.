import { getTodayDateKey, getTomorrowDateKey } from '../data/initialData';
import { TaskCategory, TaskPriority, TaskReminder } from '../types/taskflow';
import { dedupeReminders, makeReminderId } from './taskReminders';

export interface ParsedQuickTask {
  title: string;
  timeLabel: string;
  category: TaskCategory;
  priority: TaskPriority;
  dateKey: string;
  reminders: TaskReminder[];
}

export type NlpTokenKind = 'text' | 'time' | 'date' | 'list' | 'priority' | 'reminder';

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

const DATE_PATTERN_SRC =
  '(?:\\d{4}-\\d{2}-\\d{2}|\\d{1,2}\\/\\d{1,2}(?:\\/\\d{2,4})?|(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s*\\d{4})?|today|tomorrow|tmrw)';

const TIME_PATTERN_SRC = '(?:\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)|(?:[01]?\\d|2[0-3]):[0-5]\\d)';

const OFFSET_ITEM_SRC = '\\d+\\s*(?:weeks?|wks?|w|days?|d|hours?|hrs?|h|minutes?|mins?|m)';

const TRIGGER_SRC = '(?:remind(?:\\s+me)?|notify(?:\\s+me)?|alert(?:\\s+me)?)';

// Relative reminders: "remind 10m before", "notify 1d, 1h and 10m before", "1hr before", "10 mins before"
const RELATIVE_REMINDER_REGEX = new RegExp(
  `(?:\\b${TRIGGER_SRC}\\s+)?((?:${OFFSET_ITEM_SRC})(?:\\s*(?:,|\\band\\b|&)\\s*(?:${OFFSET_ITEM_SRC}))*)\\s+before\\b`,
  'gi'
);

// "remind at time" / "notify on time"
const AT_TIME_REMINDER_REGEX = new RegExp(
  `\\b${TRIGGER_SRC}\\s+(?:at|on)\\s+time\\b`,
  'gi'
);

// Exact reminders: "remind tomorrow 9am", "notify Nov 25 at 2:30pm", "remind me at 8:15am", "notify 2026-11-25 14:00"
const EXACT_REMINDER_REGEX = new RegExp(
  `\\b${TRIGGER_SRC}\\s+(?:(?:on|at)\\s+)?(?:(${DATE_PATTERN_SRC})(?:\\s+(?:at\\s+)?(${TIME_PATTERN_SRC}))?|(${TIME_PATTERN_SRC})(?:\\s+(?:on\\s+)?(${DATE_PATTERN_SRC}))?)(?=\\s|$|[,.!?])`,
  'gi'
);

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

  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    return `${iso[1]}-${iso[2]}-${iso[3]}`;
  }

  const now = new Date();
  const currentYear = now.getFullYear();

  const slash = s.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (slash) {
    const month = parseInt(slash[1], 10);
    const day = parseInt(slash[2], 10);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    let year = slash[3] ? parseInt(slash[3], 10) : currentYear;
    if (year < 100) year += 2000;
    if (!slash[3]) {
      const candidate = new Date(year, month - 1, day);
      const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      if (candidate < cutoff) year += 1;
    }
    return formatYmd(year, month, day);
  }

  const monthWord = s.match(/^([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?$/);
  if (monthWord) {
    const month = MONTH_MAP[monthWord[1]];
    const day = parseInt(monthWord[2], 10);
    if (!month || day < 1 || day > 31) return null;
    let year = monthWord[3] ? parseInt(monthWord[3], 10) : currentYear;
    if (!monthWord[3]) {
      const candidate = new Date(year, month - 1, day);
      const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      if (candidate < cutoff) year += 1;
    }
    return formatYmd(year, month, day);
  }

  return null;
}

function parseTimeExpressionTo24h(rawTime: string): string | null {
  const s = rawTime.trim().toLowerCase();
  const m12 = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/);
  if (m12) {
    let hour = parseInt(m12[1], 10);
    const mins = parseInt(m12[2] || '0', 10);
    if (hour < 1 || hour > 12 || mins > 59) return null;
    if (m12[3] === 'pm' && hour < 12) hour += 12;
    if (m12[3] === 'am' && hour === 12) hour = 0;
    return `${String(hour).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
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
  if (u.startsWith('w')) return amount * 10080;
  if (u.startsWith('d')) return amount * 1440;
  if (u.startsWith('h')) return amount * 60;
  return amount;
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
  for (const regex of [RELATIVE_REMINDER_REGEX, AT_TIME_REMINDER_REGEX, EXACT_REMINDER_REGEX]) {
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

  // 1. Priority spans
  const priorityRegex = /(?:^|\s)(!high|!low)\b|\b(high|urgent|p1|low|p3)\b/gi;
  for (const m of raw.matchAll(priorityRegex)) {
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
    const listRegex = new RegExp(`(?:^|\\s)(#?${escapeRegExp(listName)})(?=\\s|$|[,.!?])`, 'gi');
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
    const projRegex = /(?:^|\s)(#?project)(?=\s|$|[,.!?])/gi;
    for (const m of raw.matchAll(projRegex)) {
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

  // 3. Date spans
  const dateRegex = new RegExp(`\\b(${DATE_PATTERN_SRC})\\b`, 'gi');
  for (const m of raw.matchAll(dateRegex)) {
    const idx = m.index ?? 0;
    const end = idx + m[0].length;
    if (!overlapsReminder(idx, end)) {
      spans.push({ start: idx, end, kind: 'date' });
    }
  }

  // 4. Time spans (12h and 24h, including optional leading "at ")
  const time12Regex = /(?:\bat\s+)?\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/gi;
  for (const m of raw.matchAll(time12Regex)) {
    const idx = m.index ?? 0;
    const end = idx + m[0].length;
    if (!overlapsReminder(idx, end)) {
      spans.push({ start: idx, end, kind: 'time' });
    }
  }

  const time24Regex = /(?:\bat\s+)?\b([01]?\d|2[0-3]):([0-5]\d)\b/gi;
  for (const m of raw.matchAll(time24Regex)) {
    const idx = m.index ?? 0;
    const end = idx + m[0].length;
    if (!overlapsReminder(idx, end)) {
      spans.push({ start: idx, end, kind: 'time' });
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
      reminders: [],
    };
  }

  let working = trimmed;
  let timeLabel = 'No time set';
  let category: TaskCategory = baseCategory;
  let priority: TaskPriority = 'Normal';
  let dateKey = todayKey;

  const extractedReminders: TaskReminder[] = [];
  const pendingTimeOnlyExactIndices: number[] = [];

  // 0a. Extract relative reminder clauses (e.g. "remind 1d, 1h and 10m before", "10 mins before")
  RELATIVE_REMINDER_REGEX.lastIndex = 0;
  working = working.replace(RELATIVE_REMINDER_REGEX, (_full, offsetChain: string) => {
    const itemRe = /(\d+)\s*(weeks?|wks?|w|days?|d|hours?|hrs?|h|minutes?|mins?|m)/gi;
    for (const part of offsetChain.matchAll(itemRe)) {
      const amount = parseInt(part[1], 10);
      if (!Number.isNaN(amount) && amount >= 0) {
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
    const listRegex = new RegExp(`(?:^|\\s)(#?${escapeRegExp(listName)})(?=\\s|$|[,.!?])`, 'i');
    if (listRegex.test(working)) {
      category = listName;
      working = working
        .replace(new RegExp(`(?:^|\\s)#?${escapeRegExp(listName)}(?=\\s|$|[,.!?])`, 'gi'), ' ')
        .trim();
      break;
    }
  }

  if (category === baseCategory && uniqueLists.some((l) => l.toLowerCase() === 'projects')) {
    if (/(?:^|\s)#?project(?=\s|$|[,.!?])/i.test(working)) {
      const projName = uniqueLists.find((l) => l.toLowerCase() === 'projects') || 'Projects';
      category = projName;
      working = working.replace(/(?:^|\s)#?project(?=\s|$|[,.!?])/gi, ' ').trim();
    }
  }

  // 3. Extract task date (today, tomorrow, tmrw, Nov 25, 11/25, 2026-11-25)
  const taskDateMatch = working.match(new RegExp(`(?:\\bon\\s+)?\\b(${DATE_PATTERN_SRC})\\b`, 'i'));
  if (taskDateMatch && taskDateMatch[1]) {
    const resolved = parseDateExpression(taskDateMatch[1]);
    if (resolved) {
      dateKey = resolved;
      working = working.replace(taskDateMatch[0], ' ').trim();
    }
  } else if (/\btomorrow\b|\btmrw\b/i.test(working)) {
    dateKey = tomorrowKey;
    working = working.replace(/\btomorrow\b|\btmrw\b/gi, ' ').trim();
  } else if (/\btoday\b/i.test(working)) {
    dateKey = todayKey;
    working = working.replace(/\btoday\b/gi, ' ').trim();
  }

  // Apply resolved task date to any time-only exact reminders (e.g., "Meeting tomorrow 3pm remind at 1pm")
  for (const idx of pendingTimeOnlyExactIndices) {
    if (extractedReminders[idx]) {
      extractedReminders[idx].dateKey = dateKey;
    }
  }

  // 4. Extract simple times like "at 3pm", "3:30pm", "14:00", "9am"
  const time12Match = working.match(/(?:\bat\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  const time24Match = working.match(/(?:\bat\s+)?([01]?\d|2[0-3]):([0-5]\d)\b/);

  if (time12Match) {
    const rawHour = parseInt(time12Match[1], 10);
    const mins = time12Match[2] || '00';
    const meridiem = time12Match[3].toUpperCase();
    const paddedHour = rawHour < 10 ? `0${rawHour}` : `${rawHour}`;
    timeLabel = `${paddedHour}:${mins} ${meridiem}`;
    working = working.replace(time12Match[0], ' ').trim();
  } else if (time24Match) {
    const hour24 = parseInt(time24Match[1], 10);
    const mins = time24Match[2];
    const meridiem = hour24 >= 12 ? 'PM' : 'AM';
    const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
    const paddedHour = hour12 < 10 ? `0${hour12}` : `${hour12}`;
    timeLabel = `${paddedHour}:${mins} ${meridiem}`;
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
    reminders: dedupeReminders(extractedReminders),
  };
}
