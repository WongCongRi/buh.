import { CalendarEvent, TaskItem } from '../types/taskflow';
import { parseTimeTo24hParts } from './timeFormat';

function getTimeMinutes(value?: string): number | null {
  if (!value || value === 'No time set' || value === 'Full') {
    return null;
  }
  const parts = parseTimeTo24hParts(value);
  return parts ? parts.hours * 60 + parts.minutes : null;
}

/**
 * Sort tasks chronologically ascending:
 * 1. Incomplete tasks stay above completed tasks.
 * 2. Undated / Inbox tasks appear before dated tasks (timeless first, then time ascending).
 * 3. Dated tasks sort by date ascending, then untimed/all-day first, then time ascending.
 */
export function compareTasksAscending(a: TaskItem, b: TaskItem): number {
  const completedDiff = Number(a.completed) - Number(b.completed);
  if (completedDiff !== 0) return completedDiff;

  const aHasDate = !a.isInbox && Boolean(a.dateKey);
  const bHasDate = !b.isInbox && Boolean(b.dateKey);
  const aTime = getTimeMinutes(a.timeLabel);
  const bTime = getTimeMinutes(b.timeLabel);

  if (!aHasDate && !bHasDate) {
    if (aTime === null && bTime !== null) return -1;
    if (aTime !== null && bTime === null) return 1;
    if (aTime !== null && bTime !== null && aTime !== bTime) {
      return aTime - bTime;
    }
    return a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
  }

  if (!aHasDate !== !bHasDate) {
    return !aHasDate ? -1 : 1;
  }

  if (a.dateKey !== b.dateKey) {
    return a.dateKey.localeCompare(b.dateKey);
  }

  if (aTime === null && bTime !== null) return -1;
  if (aTime !== null && bTime === null) return 1;
  if (aTime !== null && bTime !== null && aTime !== bTime) {
    return aTime - bTime;
  }

  return a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
}

// Backwards-compatible alias so any in-flight cached module never fails during SW rollover
export const compareTasksDescending = compareTasksAscending;

/**
 * Sort calendar events chronologically ascending:
 * 1. Date ascending (YYYY-MM-DD).
 * 2. All-day ('Full') events appear first within a date.
 * 3. Timed events sort by parsed start time ascending, then end time ascending.
 */
export function compareEventsAscending(a: CalendarEvent, b: CalendarEvent): number {
  const dateDiff = (a.dateKey || '').localeCompare(b.dateKey || '');
  if (dateDiff !== 0) return dateDiff;

  const aFull = !a.startTime || a.startTime === 'Full';
  const bFull = !b.startTime || b.startTime === 'Full';
  if (aFull !== bFull) return aFull ? -1 : 1;

  const aStart = getTimeMinutes(a.startTime);
  const bStart = getTimeMinutes(b.startTime);
  if (aStart !== null && bStart !== null && aStart !== bStart) {
    return aStart - bStart;
  }
  if (aStart !== null && bStart === null) return -1;
  if (aStart === null && bStart !== null) return 1;

  const aEnd = getTimeMinutes(a.endTime);
  const bEnd = getTimeMinutes(b.endTime);
  if (aEnd !== null && bEnd !== null && aEnd !== bEnd) {
    return aEnd - bEnd;
  }

  return (
    a.startTime.localeCompare(b.startTime) ||
    a.title.localeCompare(b.title) ||
    a.id.localeCompare(b.id)
  );
}
