import React, { createContext, useContext, useEffect } from 'react';
import { TimeFormat } from '../types/taskflow';

let activeTimeFormat: TimeFormat = '24h';

export function getActiveTimeFormat(): TimeFormat {
  return activeTimeFormat;
}

export function setActiveTimeFormat(format: TimeFormat): void {
  activeTimeFormat = format === '12h' ? '12h' : '24h';
}

const TimeFormatContext = createContext<TimeFormat>('24h');

export const TimeFormatProvider: React.FC<{ value: TimeFormat; children: React.ReactNode }> = ({
  value,
  children,
}) => {
  useEffect(() => {
    setActiveTimeFormat(value);
  }, [value]);
  return React.createElement(TimeFormatContext.Provider, { value }, children);
};

export function useTimeFormat(): TimeFormat {
  return useContext(TimeFormatContext);
}

export function parseTimeTo24hParts(raw: string): { hours: number; minutes: number } | null {
  const s = raw.trim();
  if (!s || /^no time set$/i.test(s) || /^full$/i.test(s)) return null;

  const m12 = s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (m12) {
    let hours = parseInt(m12[1], 10);
    const minutes = parseInt(m12[2], 10);
    const mer = m12[3].toUpperCase();
    if (hours < 1 || hours > 12 || minutes < 0 || minutes > 59) return null;
    if (mer === 'PM' && hours < 12) hours += 12;
    if (mer === 'AM' && hours === 12) hours = 0;
    return { hours, minutes };
  }

  const m24 = s.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (m24) {
    return {
      hours: parseInt(m24[1], 10),
      minutes: parseInt(m24[2], 10),
    };
  }

  return null;
}

export function to24hString(raw: string): string {
  const parts = parseTimeTo24hParts(raw);
  if (!parts) return '';
  return `${String(parts.hours).padStart(2, '0')}:${String(parts.minutes).padStart(2, '0')}`;
}

export function formatTimeDisplay(
  raw: string,
  format: TimeFormat = activeTimeFormat,
  options?: { compact?: boolean }
): string {
  if (!raw || raw === 'No time set' || raw === 'Full') return raw;
  const parts = parseTimeTo24hParts(raw);
  if (!parts) return raw;

  if (format === '24h') {
    return `${String(parts.hours).padStart(2, '0')}:${String(parts.minutes).padStart(2, '0')}`;
  }

  const meridiem = parts.hours >= 12 ? 'PM' : 'AM';
  const h12 = parts.hours % 12 === 0 ? 12 : parts.hours % 12;
  const mm = String(parts.minutes).padStart(2, '0');

  if (options?.compact) {
    const suffix = meridiem === 'PM' ? 'p' : 'a';
    return parts.minutes === 0 ? `${h12}${suffix}` : `${h12}:${mm}${suffix}`;
  }

  return `${h12}:${mm} ${meridiem}`;
}

export function formatClockDate(date: Date, format: TimeFormat = activeTimeFormat): string {
  const h24 = date.getHours();
  const mm = String(date.getMinutes()).padStart(2, '0');
  if (format === '24h') {
    return `${String(h24).padStart(2, '0')}:${mm}`;
  }
  const meridiem = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${mm} ${meridiem}`;
}
