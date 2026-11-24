import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  User,
} from 'firebase/auth';
import { auth } from '../firebase';
import { CalendarEvent } from '../types/taskflow';

export const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/tasks',
] as const;

const provider = new GoogleAuthProvider();
for (const scope of SCOPES) {
  provider.addScope(scope);
}
provider.setCustomParameters({ prompt: 'select_account' });

// Strict in-memory token cache (never stored in localStorage/sessionStorage)
let isSigningIn = false;
let cachedAccessToken: string | null = null;

export const initGoogleAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void,
  onNeedsReconnect?: (user: User) => void
) => {
  return onAuthStateChanged(auth, (user: User | null) => {
    if (user) {
      if (cachedAccessToken) {
        onAuthSuccess?.(user, cachedAccessToken);
      } else if (!isSigningIn) {
        cachedAccessToken = null;
        if (onNeedsReconnect) {
          onNeedsReconnect(user);
        } else {
          onAuthFailure?.();
        }
      }
    } else {
      cachedAccessToken = null;
      onAuthFailure?.();
    }
  });
};

export const signInWithGoogleCalendar = async (
  loginHint?: string | null
): Promise<{
  user: User;
  accessToken: string;
}> => {
  try {
    isSigningIn = true;
    if (loginHint) {
      provider.setCustomParameters({ login_hint: loginHint });
    } else {
      provider.setCustomParameters({ prompt: 'select_account' });
    }
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Google permission token was not returned. Please try again.');
    }
    cachedAccessToken = credential.accessToken;
    return { user: result.user, accessToken: cachedAccessToken };
  } finally {
    isSigningIn = false;
  }
};

export const getCalendarAccessToken = (): string | null => cachedAccessToken;

export const clearCachedGoogleAccessToken = (): void => {
  cachedAccessToken = null;
};

export const signOutGoogleCalendar = async (): Promise<void> => {
  cachedAccessToken = null;
  await auth.signOut();
};

interface GoogleApiEvent {
  id?: string;
  summary?: string;
  location?: string;
  htmlLink?: string;
  status?: string;
  start?: {
    dateTime?: string;
    date?: string;
  };
  end?: {
    dateTime?: string;
    date?: string;
  };
}

function toLocalDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function toHHMM(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function mapGoogleEventToLocal(item: GoogleApiEvent): CalendarEvent | null {
  if (!item.id || item.status === 'cancelled') return null;
  const startRaw = item.start?.dateTime || item.start?.date;
  if (!startRaw) return null;

  let dateKey = '';
  let endDateKey: string | undefined;
  let startTime = '09:00';
  let endTime = '10:00';
  let durationMinutes = 60;

  if (item.start?.dateTime) {
    const startDt = new Date(item.start.dateTime);
    if (Number.isNaN(startDt.getTime())) return null;
    dateKey = toLocalDateKey(startDt);
    startTime = toHHMM(startDt);

    if (item.end?.dateTime) {
      const endDt = new Date(item.end.dateTime);
      if (!Number.isNaN(endDt.getTime())) {
        endTime = toHHMM(endDt);
        const mappedEndKey = toLocalDateKey(endDt);
        if (mappedEndKey !== dateKey) {
          endDateKey = mappedEndKey;
        }
        durationMinutes = Math.max(15, Math.round((endDt.getTime() - startDt.getTime()) / 60_000));
      }
    }
  } else if (item.start?.date) {
    dateKey = item.start.date.slice(0, 10);
    if (item.end?.date) {
      // Google all-day end.date is exclusive; subtract 1 day for inclusive endDateKey
      const [ey, em, ed] = item.end.date.slice(0, 10).split('-').map((n) => parseInt(n, 10));
      const inclusiveEnd = new Date(ey, (em || 1) - 1, (ed || 1) - 1);
      const mappedEndKey = toLocalDateKey(inclusiveEnd);
      if (mappedEndKey > dateKey) {
        endDateKey = mappedEndKey;
      }
    }
    startTime = 'Full';
    endTime = 'Full';
    durationMinutes = 60;
  }

  return {
    id: `gcal-${item.id}`,
    googleEventId: item.id,
    title: item.summary?.trim() || '(Untitled event)',
    dateKey,
    endDateKey,
    startTime,
    endTime,
    durationMinutes,
    calendarName: 'Google Calendar',
    location: item.location?.trim() || undefined,
    source: 'google',
    htmlLink: item.htmlLink,
  };
}

export async function fetchGoogleCalendarEvents(tokenOverride?: string): Promise<CalendarEvent[]> {
  const token = tokenOverride || cachedAccessToken;
  if (!token) {
    throw new Error('NOT_AUTHENTICATED');
  }

  const now = new Date();
  const timeMin = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30).toISOString();
  const timeMax = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 90).toISOString();

  const url = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');
  url.searchParams.set('singleEvents', 'true');
  url.searchParams.set('orderBy', 'startTime');
  url.searchParams.set('maxResults', '120');
  url.searchParams.set('timeMin', timeMin);
  url.searchParams.set('timeMax', timeMax);

  const resp = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (resp.status === 401 || resp.status === 403) {
    cachedAccessToken = null;
    throw new Error('AUTH_EXPIRED');
  }

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`Google Calendar sync failed (${resp.status})${errText ? `: ${errText.slice(0, 140)}` : ''}`);
  }

  const data = (await resp.json()) as { items?: GoogleApiEvent[] };
  const mapped: CalendarEvent[] = [];
  for (const item of data.items ?? []) {
    const ev = mapGoogleEventToLocal(item);
    if (ev) mapped.push(ev);
  }
  return mapped;
}

export async function createGoogleCalendarEvent(
  eventInput: {
    title: string;
    dateKey: string;
    endDateKey?: string;
    startTime: string;
    endTime: string;
    location?: string;
    calendarName?: string;
  },
  tokenOverride?: string
): Promise<CalendarEvent> {
  const token = tokenOverride || cachedAccessToken;
  if (!token) {
    throw new Error('NOT_AUTHENTICATED');
  }

  const [y, m, d] = eventInput.dateKey.split('-').map((n) => parseInt(n, 10));
  const [ey, em, ed] = (eventInput.endDateKey || eventInput.dateKey)
    .split('-')
    .map((n) => parseInt(n, 10));
  const [sh, sm] = eventInput.startTime.split(':').map((n) => parseInt(n, 10));
  const [eh, emin] = eventInput.endTime.split(':').map((n) => parseInt(n, 10));

  const startDt = new Date(y, (m || 1) - 1, d || 1, Number.isNaN(sh) ? 9 : sh, Number.isNaN(sm) ? 0 : sm);
  const endDt = new Date(
    ey || y,
    ((em || m) || 1) - 1,
    ed || d || 1,
    Number.isNaN(eh) ? startDt.getHours() + 1 : eh,
    Number.isNaN(emin) ? startDt.getMinutes() : emin
  );
  if (endDt <= startDt) {
    endDt.setTime(startDt.getTime() + 60 * 60_000);
  }

  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const resp = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      summary: eventInput.title,
      location: eventInput.location,
      description: eventInput.calendarName ? `Created from buh. (${eventInput.calendarName})` : 'Created from buh.',
      start: {
        dateTime: startDt.toISOString(),
        timeZone,
      },
      end: {
        dateTime: endDt.toISOString(),
        timeZone,
      },
    }),
  });

  if (resp.status === 401 || resp.status === 403) {
    cachedAccessToken = null;
    throw new Error('AUTH_EXPIRED');
  }

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`Could not create Google Calendar event (${resp.status})${errText ? `: ${errText.slice(0, 120)}` : ''}`);
  }

  const created = (await resp.json()) as GoogleApiEvent;
  const mapped = mapGoogleEventToLocal(created);
  if (!mapped) {
    throw new Error('Google Calendar returned an invalid event response.');
  }
  return mapped;
}

export async function deleteGoogleCalendarEvent(
  googleEventId: string,
  tokenOverride?: string
): Promise<void> {
  const token = tokenOverride || cachedAccessToken;
  if (!token) {
    throw new Error('NOT_AUTHENTICATED');
  }

  const resp = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(googleEventId)}`,
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  if (resp.status === 401 || resp.status === 403) {
    cachedAccessToken = null;
    throw new Error('AUTH_EXPIRED');
  }

  if (!resp.ok && resp.status !== 204 && resp.status !== 410) {
    throw new Error(`Could not delete Google Calendar event (${resp.status})`);
  }
}
