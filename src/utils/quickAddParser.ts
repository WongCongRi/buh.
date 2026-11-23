import { TaskCategory, TaskPriority } from '../types/taskflow';

export interface ParsedQuickTask {
  title: string;
  timeLabel: string;
  category: TaskCategory;
  priority: TaskPriority;
  dateKey: string;
}

export type NlpTokenKind = 'text' | 'time' | 'date' | 'list' | 'priority';

export interface NlpTextSegment {
  text: string;
  kind: NlpTokenKind;
}

const DEFAULT_LISTS = ['Work', 'Projects', 'Personal'];

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

  // 1. Priority spans
  const priorityRegex = /(?:^|\s)(!high|!low)\b|\b(high|urgent|p1|low|p3)\b/gi;
  for (const m of raw.matchAll(priorityRegex)) {
    const idx = m.index ?? 0;
    if (m[1]) {
      const tokenStart = idx + (m[0].length - m[1].length);
      spans.push({ start: tokenStart, end: tokenStart + m[1].length, kind: 'priority' });
    } else if (m[2]) {
      spans.push({ start: idx, end: idx + m[0].length, kind: 'priority' });
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
      spans.push({ start: tokenStart, end: tokenStart + captured.length, kind: 'list' });
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
      spans.push({ start: tokenStart, end: tokenStart + captured.length, kind: 'list' });
    }
  }

  // 3. Date spans
  const dateRegex = /\b(today|tomorrow)\b/gi;
  for (const m of raw.matchAll(dateRegex)) {
    const idx = m.index ?? 0;
    spans.push({ start: idx, end: idx + m[0].length, kind: 'date' });
  }

  // 4. Time spans (12h and 24h, including optional leading "at ")
  const time12Regex = /(?:\bat\s+)?\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/gi;
  for (const m of raw.matchAll(time12Regex)) {
    const idx = m.index ?? 0;
    spans.push({ start: idx, end: idx + m[0].length, kind: 'time' });
  }

  const time24Regex = /(?:\bat\s+)?\b([01]?\d|2[0-3]):([0-5]\d)\b/gi;
  for (const m of raw.matchAll(time24Regex)) {
    const idx = m.index ?? 0;
    spans.push({ start: idx, end: idx + m[0].length, kind: 'time' });
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

  if (!nlpEnabled) {
    return {
      title: trimmed,
      timeLabel: 'No time set',
      category: baseCategory,
      priority: 'Normal',
      dateKey: '2026-11-23',
    };
  }

  let working = trimmed;
  let timeLabel = 'No time set';
  let category: TaskCategory = baseCategory;
  let priority: TaskPriority = 'Normal';
  let dateKey = '2026-11-23';

  // Extract priority keywords
  if (/(?:^|\s)!high\b|\b(high|urgent|p1)\b/i.test(working)) {
    priority = 'High';
    working = working.replace(/(?:^|\s)!high\b|\b(high|urgent|p1)\b/gi, ' ').trim();
  } else if (/(?:^|\s)!low\b|\b(low|p3)\b/i.test(working)) {
    priority = 'Low';
    working = working.replace(/(?:^|\s)!low\b|\b(low|p3)\b/gi, ' ').trim();
  }

  // Extract list hashtags or matching list words (longest first)
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

  // Extract tomorrow / today
  if (/\btomorrow\b/i.test(working)) {
    dateKey = '2026-11-24';
    working = working.replace(/\btomorrow\b/gi, ' ').trim();
  } else if (/\btoday\b/i.test(working)) {
    dateKey = '2026-11-23';
    working = working.replace(/\btoday\b/gi, ' ').trim();
  }

  // Extract simple times like "at 3pm", "3:30pm", "14:00", "9am"
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

  const cleanedTitle = working.replace(/\s{2,}/g, ' ').replace(/\s+at$/i, '').trim() || trimmed;

  return {
    title: cleanedTitle,
    timeLabel,
    category,
    priority,
    dateKey,
  };
}
