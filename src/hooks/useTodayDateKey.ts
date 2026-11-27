import { useEffect, useState } from 'react';
import { getTodayDateKey, getTomorrowDateKey } from '../data/initialData';

export interface LiveDateKeys {
  todayDateKey: string;
  tomorrowDateKey: string;
}

function getMsUntilNextLocalMidnight(): number {
  const now = new Date();
  const nextMidnight = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
    0,
    0,
    1,
    0
  );
  return Math.max(1_000, nextMidnight.getTime() - now.getTime());
}

/**
 * Returns live local `todayDateKey` and `tomorrowDateKey` strings that
 * automatically advance across local midnight and when the app resumes focus.
 */
export function useTodayDateKey(): LiveDateKeys {
  const [dateKeys, setDateKeys] = useState<LiveDateKeys>(() => ({
    todayDateKey: getTodayDateKey(),
    tomorrowDateKey: getTomorrowDateKey(),
  }));

  useEffect(() => {
    let midnightTimer: number | null = null;

    const refresh = () => {
      const nextToday = getTodayDateKey();
      const nextTomorrow = getTomorrowDateKey();
      setDateKeys((prev) =>
        prev.todayDateKey === nextToday && prev.tomorrowDateKey === nextTomorrow
          ? prev
          : { todayDateKey: nextToday, tomorrowDateKey: nextTomorrow }
      );
    };

    const scheduleMidnightTick = () => {
      if (midnightTimer !== null) {
        window.clearTimeout(midnightTimer);
      }
      midnightTimer = window.setTimeout(() => {
        refresh();
        scheduleMidnightTick();
      }, getMsUntilNextLocalMidnight());
    };

    const handleResume = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      refresh();
      scheduleMidnightTick();
    };

    scheduleMidnightTick();
    window.addEventListener('focus', handleResume);
    document.addEventListener('visibilitychange', handleResume);

    return () => {
      if (midnightTimer !== null) {
        window.clearTimeout(midnightTimer);
      }
      window.removeEventListener('focus', handleResume);
      document.removeEventListener('visibilitychange', handleResume);
    };
  }, []);

  return dateKeys;
}
