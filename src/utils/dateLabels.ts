import { getTodayDateKey } from '../data/initialData';
import { addDaysToDateKey, parseDateKeyLocal } from './recurrence';

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SHORT_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export interface RelativeTaskDateInfo {
  label: string;
  fullLabel: string;
  isOverdue: boolean;
  isToday: boolean;
}

export function formatDDMMM(dateKey: string): string {
  const dt = parseDateKeyLocal(dateKey);
  const dd = String(dt.getDate()).padStart(2, '0');
  const mmm = SHORT_MONTHS[dt.getMonth()];
  return `${dd} ${mmm}`;
}

export function formatDDMMYYYY(dateKey: string): string {
  const dt = parseDateKeyLocal(dateKey);
  const dd = String(dt.getDate()).padStart(2, '0');
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const yyyy = dt.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

export function formatDateObjDDMMYYYY(dt: Date): string {
  const dd = String(dt.getDate()).padStart(2, '0');
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const yyyy = dt.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

export function formatRelativeTaskDate(
  dateKey: string,
  options?: {
    includeMonthDayForRelative?: boolean;
    includeYearIfDifferent?: boolean;
    compact?: boolean;
  }
): RelativeTaskDateInfo {
  if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    return {
      label: 'No date',
      fullLabel: 'No date',
      isOverdue: false,
      isToday: false,
    };
  }

  const todayKey = getTodayDateKey();
  const yesterdayKey = addDaysToDateKey(todayKey, -1);
  const tomorrowKey = addDaysToDateKey(todayKey, 1);

  const dt = parseDateKeyLocal(dateKey);
  const ddMmm = formatDDMMM(dateKey);
  const isOverdue = dateKey < todayKey;

  if (dateKey === todayKey) {
    const fullLabel = options?.includeMonthDayForRelative ? `Today, ${ddMmm}` : 'Today';
    return {
      label: fullLabel,
      fullLabel,
      isOverdue: false,
      isToday: true,
    };
  }

  if (dateKey === yesterdayKey) {
    const fullLabel = options?.includeMonthDayForRelative ? `Yesterday, ${ddMmm}` : 'Yesterday';
    return {
      label: options?.compact ? 'Yest' : fullLabel,
      fullLabel,
      isOverdue: true,
      isToday: false,
    };
  }

  if (dateKey === tomorrowKey) {
    const fullLabel = options?.includeMonthDayForRelative ? `Tomorrow, ${ddMmm}` : 'Tomorrow';
    return {
      label: options?.compact ? 'Tmrw' : fullLabel,
      fullLabel,
      isOverdue: false,
      isToday: false,
    };
  }

  const todayYear = parseDateKeyLocal(todayKey).getFullYear();
  const showYear = options?.includeYearIfDifferent !== false && dt.getFullYear() !== todayYear;
  const formattedDate = showYear ? formatDDMMYYYY(dateKey) : ddMmm;

  const label = options?.includeMonthDayForRelative
    ? `${SHORT_WEEKDAYS[dt.getDay()]}, ${formattedDate}`
    : formattedDate;

  return {
    label,
    fullLabel: label,
    isOverdue,
    isToday: false,
  };
}
