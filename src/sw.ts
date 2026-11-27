/// <reference lib="es2022" />

interface SwPrecacheEntry {
  url: string;
  revision?: string | null;
}

interface SwExtendableEvent extends Event {
  waitUntil(promise: Promise<unknown>): void;
}

interface SwFetchEvent extends SwExtendableEvent {
  readonly request: Request;
  respondWith(response: Promise<Response> | Response): void;
}

interface SwNotificationData {
  taskId?: string;
  reminderId?: string;
  taskTitle?: string;
  category?: string;
  url?: string;
}

interface SwNotificationEvent extends SwExtendableEvent {
  readonly action: string;
  readonly notification: Notification & { data?: SwNotificationData };
}

interface SwPushMessageData {
  json(): unknown;
  text(): string;
}

interface SwPushEvent extends SwExtendableEvent {
  readonly data: SwPushMessageData | null;
}

interface SwPushSubscriptionChangeEvent extends SwExtendableEvent {
  readonly oldSubscription?: PushSubscription | null;
  readonly newSubscription?: PushSubscription | null;
}

interface SwMessageEvent extends SwExtendableEvent {
  readonly data: unknown;
}

interface SwWindowClient {
  readonly url: string;
  readonly focused?: boolean;
  focus(): Promise<SwWindowClient>;
  postMessage(message: unknown): void;
}

interface SwClients {
  claim(): Promise<void>;
  matchAll(options?: {
    type?: 'window' | 'worker' | 'sharedworker' | 'all';
    includeUncontrolled?: boolean;
  }): Promise<SwWindowClient[]>;
  openWindow(url: string): Promise<SwWindowClient | null>;
}

interface SwSyncEvent extends SwExtendableEvent {
  readonly tag: string;
}

interface SwPeriodicSyncEvent extends SwExtendableEvent {
  readonly tag: string;
}

interface SwLocalScheduledReminder {
  key: string;
  taskId: string;
  reminderId: string;
  triggerAtMs: number;
  title: string;
  body: string;
  category: string;
  tag: string;
  silent: boolean;
}

interface SwGlobalScope {
  readonly location: Location;
  readonly caches: CacheStorage;
  readonly clients: SwClients;
  readonly registration: ServiceWorkerRegistration;
  readonly __WB_MANIFEST: Array<SwPrecacheEntry | string>;
  skipWaiting(): Promise<void>;
  addEventListener(type: 'install' | 'activate', listener: (event: SwExtendableEvent) => void): void;
  addEventListener(type: 'fetch', listener: (event: SwFetchEvent) => void): void;
  addEventListener(type: 'push', listener: (event: SwPushEvent) => void): void;
  addEventListener(
    type: 'pushsubscriptionchange',
    listener: (event: SwPushSubscriptionChangeEvent) => void
  ): void;
  addEventListener(
    type: 'notificationclick' | 'notificationclose',
    listener: (event: SwNotificationEvent) => void
  ): void;
  addEventListener(type: 'message', listener: (event: SwMessageEvent) => void): void;
  addEventListener(type: 'sync', listener: (event: SwSyncEvent) => void): void;
  addEventListener(type: 'periodicsync', listener: (event: SwPeriodicSyncEvent) => void): void;
}

declare const self: SwGlobalScope;

const PRECACHE_NAME = 'buh-precache-v5';
const RUNTIME_CACHE_NAME = 'buh-runtime-v5';
const FONTS_CACHE_NAME = 'buh-fonts-v1';
const REMINDER_ACTIONS_CACHE = 'buh-reminder-actions-v1';
const REMINDER_ACTIONS_URL = '/__buh_pending_reminder_actions__';
const SCHEDULED_REMINDERS_CACHE = 'buh-scheduled-reminders-v1';
const SCHEDULED_REMINDERS_URL = '/__buh_scheduled_reminders__';
const FIRED_REMINDERS_CACHE = 'buh-fired-reminders-v1';
const FIRED_REMINDERS_URL = '/__buh_fired_reminders__';

const rawManifest = self.__WB_MANIFEST;
const manifestEntries: Array<SwPrecacheEntry | string> = Array.isArray(rawManifest)
  ? rawManifest
  : [];

const precacheUrls = Array.from(
  new Set(
    manifestEntries
      .map((entry) => (typeof entry === 'string' ? entry : entry?.url))
      .filter((url): url is string => typeof url === 'string' && url.length > 0)
      .map((url) => new URL(url, self.location.origin).href)
  )
);

async function persistPendingReminderAction(actionPayload: {
  actionId?: string;
  action: 'snooze' | 'done' | 'clear';
  taskId?: string;
  reminderId?: string;
  snoozeMinutes?: number;
  timestamp: number;
}): Promise<void> {
  try {
    const cache = await self.caches.open(REMINDER_ACTIONS_CACHE);
    const existingRes = await cache.match(REMINDER_ACTIONS_URL);
    let list: Array<typeof actionPayload> = [];
    if (existingRes) {
      try {
        const parsed = await existingRes.json();
        if (Array.isArray(parsed)) list = parsed;
      } catch {
        list = [];
      }
    }
    const withId = {
      ...actionPayload,
      actionId:
        actionPayload.actionId ||
        `${actionPayload.action}:${actionPayload.taskId || ''}:${actionPayload.reminderId || ''}:${actionPayload.timestamp}`,
    };
    list.push(withId);
    await cache.put(
      REMINDER_ACTIONS_URL,
      new Response(JSON.stringify(list.slice(-30)), {
        headers: { 'Content-Type': 'application/json' },
      })
    );
  } catch {
    // Ignore cache storage issues
  }
}

async function loadScheduledReminders(): Promise<SwLocalScheduledReminder[]> {
  try {
    const cache = await self.caches.open(SCHEDULED_REMINDERS_CACHE);
    const res = await cache.match(SCHEDULED_REMINDERS_URL);
    if (!res) return [];
    const parsed = await res.json();
    return Array.isArray(parsed) ? (parsed as SwLocalScheduledReminder[]) : [];
  } catch {
    return [];
  }
}

async function saveScheduledReminders(reminders: SwLocalScheduledReminder[]): Promise<void> {
  try {
    const cache = await self.caches.open(SCHEDULED_REMINDERS_CACHE);
    await cache.put(
      SCHEDULED_REMINDERS_URL,
      new Response(JSON.stringify(reminders.slice(0, 100)), {
        headers: { 'Content-Type': 'application/json' },
      })
    );
  } catch {
    // Ignore cache storage errors
  }
}

async function loadFiredReminderKeys(): Promise<Record<string, number>> {
  try {
    const cache = await self.caches.open(FIRED_REMINDERS_CACHE);
    const res = await cache.match(FIRED_REMINDERS_URL);
    if (!res) return {};
    const parsed = await res.json();
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, number>) : {};
  } catch {
    return {};
  }
}

async function saveFiredReminderKeys(keys: Record<string, number>): Promise<void> {
  try {
    const now = Date.now();
    const cutoff = now - 24 * 60 * 60 * 1000;
    const pruned: Record<string, number> = {};
    for (const [k, ts] of Object.entries(keys)) {
      if (typeof ts === 'number' && ts >= cutoff) {
        pruned[k] = ts;
      }
    }
    const cache = await self.caches.open(FIRED_REMINDERS_CACHE);
    await cache.put(
      FIRED_REMINDERS_URL,
      new Response(JSON.stringify(pruned), {
        headers: { 'Content-Type': 'application/json' },
      })
    );
  } catch {
    // Ignore cache storage errors
  }
}

async function markLocalReminderFired(key: string, taskId?: string, reminderId?: string): Promise<void> {
  const fired = await loadFiredReminderKeys();
  const now = Date.now();
  if (key) fired[key] = now;
  if (taskId && reminderId) {
    fired[`${taskId}:${reminderId}`] = now;
  }
  await saveFiredReminderKeys(fired);
}

async function clearLocalReminderFired(taskId?: string, reminderId?: string): Promise<void> {
  if (!taskId || !reminderId) return;
  const fired = await loadFiredReminderKeys();
  const prefix = `${taskId}:${reminderId}`;
  let changed = false;
  for (const k of Object.keys(fired)) {
    if (k === prefix || k.startsWith(`${prefix}:`)) {
      delete fired[k];
      changed = true;
    }
  }
  if (changed) {
    await saveFiredReminderKeys(fired);
  }
  await removeScheduledRemindersFor(taskId, reminderId, false);
  await closeMatchingNotifications(taskId, reminderId, false);
}

async function removeScheduledRemindersFor(
  taskId?: string,
  reminderId?: string,
  removeAllForTask = false
): Promise<void> {
  if (!taskId) return;
  const scheduled = await loadScheduledReminders();
  if (scheduled.length === 0) return;
  const filtered = scheduled.filter((rem) => {
    if (rem.taskId !== taskId) return true;
    if (removeAllForTask || !reminderId) return false;
    return rem.reminderId !== reminderId;
  });
  if (filtered.length !== scheduled.length) {
    await saveScheduledReminders(filtered);
  }
}

async function closeMatchingNotifications(
  taskId?: string,
  reminderId?: string,
  closeAllForTask = false
): Promise<void> {
  if (!taskId) return;
  try {
    const regWithTrigger = self.registration as ServiceWorkerRegistration & {
      getNotifications: (filter?: { tag?: string; includeTriggered?: boolean }) => Promise<Notification[]>;
    };
    let list: Notification[] = [];
    try {
      list = await regWithTrigger.getNotifications({ includeTriggered: true });
    } catch {
      list = await self.registration.getNotifications();
    }
    for (const notif of list) {
      const nData = (notif as Notification & { data?: SwNotificationData }).data;
      if (nData?.taskId !== taskId) continue;
      if (closeAllForTask || !reminderId || nData?.reminderId === reminderId) {
        notif.close();
      }
    }
  } catch {
    // Ignore getNotifications errors
  }
}

async function notifyServerDismiss(
  taskId?: string,
  reminderId?: string,
  completeTask = false
): Promise<void> {
  if (!taskId || !self.registration.pushManager) return;
  try {
    const sub = await self.registration.pushManager.getSubscription();
    if (!sub?.endpoint) return;
    await fetch('/api/push/dismiss', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        endpoint: sub.endpoint,
        taskId,
        reminderId,
        completeTask,
      }),
    });
  } catch {
    // Ignore offline dismiss errors
  }
}

async function checkLocalDueReminders(): Promise<void> {
  const scheduled = await loadScheduledReminders();
  if (scheduled.length === 0) return;

  const fired = await loadFiredReminderKeys();
  const now = Date.now();
  const CATCH_UP_MS = 60 * 60 * 1000;
  const remaining: SwLocalScheduledReminder[] = [];
  const due: SwLocalScheduledReminder[] = [];

  for (const rem of scheduled) {
    if (!rem || typeof rem.triggerAtMs !== 'number') continue;
    const pairKey = `${rem.taskId}:${rem.reminderId}`;
    if (fired[rem.key] || fired[pairKey]) continue;

    if (rem.triggerAtMs <= now) {
      if (now - rem.triggerAtMs <= CATCH_UP_MS) {
        due.push(rem);
      }
    } else {
      remaining.push(rem);
    }
  }

  if (due.length === 0) {
    if (remaining.length !== scheduled.length) {
      await saveScheduledReminders(remaining);
    }
    return;
  }

  await saveScheduledReminders(remaining);

  const windowClients = await self.clients.matchAll({
    type: 'window',
    includeUncontrolled: true,
  });

  for (const rem of due) {
    fired[rem.key] = now;
    fired[`${rem.taskId}:${rem.reminderId}`] = now;

    const notifOptions: NotificationOptions & {
      actions?: Array<{ action: string; title: string }>;
      vibrate?: number[];
      renotify?: boolean;
    } = {
      body: rem.body || 'Scheduled task reminder',
      icon: '/pwa-192x192.png',
      badge: '/badge-96x96.png',
      tag: rem.tag || `buh-reminder-${rem.taskId}-${rem.reminderId}`,
      renotify: true,
      silent: Boolean(rem.silent),
      vibrate: rem.silent ? undefined : [180, 90, 180],
      actions: [
        { action: 'snooze', title: 'Snooze 10m' },
        { action: 'done', title: 'Done' },
      ],
      data: {
        taskId: rem.taskId,
        reminderId: rem.reminderId,
        taskTitle: rem.title,
        category: rem.category,
        url: resolveSafeSameOriginUrl('/'),
      },
    };

    try {
      await self.registration.showNotification(
        rem.title || 'buh. reminder',
        notifOptions as NotificationOptions
      );
    } catch {
      // Ignore notification errors if permission was revoked
    }

    const actionId = `delivered:${rem.taskId}:${rem.reminderId}:${now}`;
    await persistPendingReminderAction({
      actionId,
      action: 'clear',
      taskId: rem.taskId,
      reminderId: rem.reminderId,
      timestamp: now,
    });

    if (windowClients.length > 0) {
      for (const client of windowClients) {
        client.postMessage({
          type: 'REMINDER_PUSH_DELIVERED',
          actionId,
          taskId: rem.taskId,
          reminderId: rem.reminderId,
        });
      }
    }
  }

  await saveFiredReminderKeys(fired);
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      if (precacheUrls.length > 0) {
        const cache = await self.caches.open(PRECACHE_NAME);
        await Promise.allSettled(
          precacheUrls.map(async (url) => {
            try {
              const res = await fetch(url, { cache: 'reload' });
              if (res.ok) {
                await cache.put(url, res);
              }
            } catch {
              // Skip transient fetch errors during install
            }
          })
        );
      }
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  const keepCaches = new Set([
    PRECACHE_NAME,
    RUNTIME_CACHE_NAME,
    FONTS_CACHE_NAME,
    REMINDER_ACTIONS_CACHE,
    SCHEDULED_REMINDERS_CACHE,
    FIRED_REMINDERS_CACHE,
  ]);
  event.waitUntil(
    (async () => {
      const keys = await self.caches.keys();
      await Promise.all(keys.filter((k) => !keepCaches.has(k)).map((k) => self.caches.delete(k)));
      await self.clients.claim();
      await checkLocalDueReminders();
    })()
  );
});

self.addEventListener('message', (event) => {
  const data = event.data as {
    type?: string;
    title?: string;
    options?: NotificationOptions;
    reminders?: SwLocalScheduledReminder[];
    key?: string;
    taskId?: string;
    reminderId?: string;
  } | null;
  if (data && data.type === 'SKIP_WAITING') {
    event.waitUntil(self.skipWaiting());
  } else if (data && data.type === 'SHOW_LOCAL_NOTIFICATION' && typeof data.title === 'string') {
    event.waitUntil(self.registration.showNotification(data.title, data.options || {}));
  } else if (data && data.type === 'SYNC_LOCAL_REMINDERS' && Array.isArray(data.reminders)) {
    event.waitUntil(
      (async () => {
        await saveScheduledReminders(data.reminders || []);
        await checkLocalDueReminders();
      })()
    );
  } else if (data && data.type === 'MARK_REMINDER_FIRED') {
    event.waitUntil(
      markLocalReminderFired(data.key || '', data.taskId, data.reminderId)
    );
  } else if (data && data.type === 'CLEAR_REMINDER_FIRED') {
    event.waitUntil(
      clearLocalReminderFired(data.taskId, data.reminderId)
    );
  } else if (data && data.type === 'CHECK_LOCAL_REMINDERS') {
    event.waitUntil(checkLocalDueReminders());
  }
});

self.addEventListener('periodicsync', (event) => {
  if (event.tag !== 'buh-reminder-check') return;
  event.waitUntil(
    (async () => {
      await checkLocalDueReminders();
      try {
        await fetch('/api/push/tick', { method: 'POST' });
      } catch {
        // Offline or server unreachable; local check above already ran
      }
    })()
  );
});

self.addEventListener('sync', (event) => {
  if (event.tag !== 'buh-reminder-check') return;
  event.waitUntil(
    (async () => {
      await checkLocalDueReminders();
      try {
        await fetch('/api/push/tick', { method: 'POST' });
      } catch {
        // Ignore offline tick errors
      }
    })()
  );
});

function resolveSafeSameOriginUrl(rawUrl?: string): string {
  try {
    const resolved = new URL(rawUrl || '/', self.location.origin);
    if (resolved.origin === self.location.origin) {
      return resolved.href;
    }
  } catch {
    // Fallback to app root
  }
  return new URL('/', self.location.origin).href;
}

function base64UrlToUint8Array(base64Url: string): Uint8Array {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    out[i] = raw.charCodeAt(i);
  }
  return out;
}

interface IncomingPushPayload {
  title?: string;
  body?: string;
  icon?: string;
  badge?: string;
  tag?: string;
  silent?: boolean;
  vibrate?: number[];
  url?: string;
  taskId?: string;
  reminderId?: string;
  category?: string;
  actions?: Array<{ action: string; title: string }>;
}

self.addEventListener('push', (event) => {
  event.waitUntil(
    (async () => {
      let payload: IncomingPushPayload = {};
      if (event.data) {
        try {
          const parsed = event.data.json();
          if (parsed && typeof parsed === 'object') {
            payload = parsed as IncomingPushPayload;
          }
        } catch {
          try {
            const text = event.data.text();
            if (text) payload = { body: text };
          } catch {
            payload = {};
          }
        }
      }

      const title =
        typeof payload.title === 'string' && payload.title.trim().length > 0
          ? payload.title.trim().slice(0, 140)
          : 'buh. reminder';
      const body =
        typeof payload.body === 'string' && payload.body.trim().length > 0
          ? payload.body.trim().slice(0, 280)
          : 'You have an upcoming task reminder.';
      const targetUrl = resolveSafeSameOriginUrl(payload.url);

      const defaultActions = payload.taskId
        ? [
            { action: 'snooze', title: 'Snooze 10m' },
            { action: 'done', title: 'Done' },
          ]
        : [{ action: 'done', title: 'Done' }];

      const actions =
        Array.isArray(payload.actions) && payload.actions.length > 0
          ? payload.actions
              .filter(
                (a): a is { action: string; title: string } =>
                  Boolean(a) && typeof a.action === 'string' && typeof a.title === 'string'
              )
              .slice(0, 2)
          : defaultActions;

      const notifOptions: NotificationOptions & {
        actions?: Array<{ action: string; title: string }>;
        vibrate?: number[];
        renotify?: boolean;
      } = {
        body,
        icon: payload.icon || '/pwa-192x192.png',
        badge: payload.badge || '/badge-96x96.png',
        tag: payload.tag || (payload.taskId ? `buh-push-${payload.taskId}` : 'buh-push'),
        renotify: true,
        silent: Boolean(payload.silent),
        vibrate: payload.silent ? undefined : payload.vibrate || [180, 90, 180],
        actions,
        data: {
          taskId: payload.taskId,
          reminderId: payload.reminderId,
          taskTitle: title,
          category: payload.category,
          url: targetUrl,
        },
      };

      await self.registration.showNotification(title, notifOptions as NotificationOptions);

      if (payload.taskId && payload.reminderId) {
        const now = Date.now();
        const actionId = `push:${payload.taskId}:${payload.reminderId}:${now}`;
        await markLocalReminderFired('', payload.taskId, payload.reminderId);
        await removeScheduledRemindersFor(payload.taskId, payload.reminderId, false);
        await persistPendingReminderAction({
          actionId,
          action: 'clear',
          taskId: payload.taskId,
          reminderId: payload.reminderId,
          timestamp: now,
        });
        const windowClients = await self.clients.matchAll({
          type: 'window',
          includeUncontrolled: true,
        });
        if (windowClients.length > 0) {
          for (const client of windowClients) {
            client.postMessage({
              type: 'REMINDER_PUSH_DELIVERED',
              actionId,
              taskId: payload.taskId,
              reminderId: payload.reminderId,
            });
          }
        }
      }
    })()
  );
});

self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      if (!self.registration.pushManager) return;
      try {
        let subscription = event.newSubscription || null;
        if (!subscription) {
          let applicationServerKey = event.oldSubscription?.options?.applicationServerKey || undefined;
          if (!applicationServerKey) {
            const keyRes = await fetch('/api/push/public-key');
            if (keyRes.ok) {
              const keyJson = (await keyRes.json()) as { publicKey?: string };
              if (keyJson?.publicKey) {
                applicationServerKey = base64UrlToUint8Array(keyJson.publicKey).buffer as ArrayBuffer;
              }
            }
          }
          if (applicationServerKey) {
            subscription = await self.registration.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey,
            });
          }
        }
        if (subscription) {
          const json = subscription.toJSON();
          await fetch('/api/push/subscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ subscription: json }),
          });
          const windowClients = await self.clients.matchAll({
            type: 'window',
            includeUncontrolled: true,
          });
          for (const client of windowClients) {
            client.postMessage({ type: 'PUSH_SUBSCRIPTION_CHANGED', subscription: json });
          }
        }
      } catch {
        // Ignore transient offline re-subscription errors
      }
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Never intercept backend API routes, Digital Asset Links, Service Worker scripts, or Vite dev-server module URLs
  if (
    url.origin === self.location.origin &&
    (url.pathname.startsWith('/api/') ||
      url.pathname.startsWith('/.well-known/') ||
      url.pathname.startsWith('/@') ||
      url.pathname.startsWith('/src/') ||
      url.pathname.startsWith('/node_modules/') ||
      url.pathname === '/sw.js' ||
      url.pathname === '/dev-sw.js' ||
      url.pathname === '/registerSW.js')
  ) {
    return;
  }

  // Google Fonts: Cache-first
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      (async () => {
        const cache = await self.caches.open(FONTS_CACHE_NAME);
        const cached = await cache.match(request);
        if (cached) return cached;
        try {
          const network = await fetch(request);
          if (network.ok || network.type === 'opaque') {
            void cache.put(request, network.clone());
          }
          return network;
        } catch {
          return cached || Response.error();
        }
      })()
    );
    return;
  }

  if (url.origin !== self.location.origin) {
    return;
  }

  // SPA navigation: Network-first with offline fallback to cached app shell
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const network = await fetch(request);
          if (network.ok) {
            const cache = await self.caches.open(RUNTIME_CACHE_NAME);
            void cache.put('/index.html', network.clone());
          }
          return network;
        } catch {
          const precache = await self.caches.open(PRECACHE_NAME);
          const runtime = await self.caches.open(RUNTIME_CACHE_NAME);
          return (
            (await precache.match('/index.html')) ||
            (await runtime.match('/index.html')) ||
            (await precache.match('/')) ||
            Response.error()
          );
        }
      })()
    );
    return;
  }

  // Same-origin static assets: Cache-first with background refresh (stale-while-revalidate)
  if (
    request.destination === 'script' ||
    request.destination === 'style' ||
    request.destination === 'image' ||
    request.destination === 'font' ||
    url.pathname.endsWith('.webmanifest')
  ) {
    event.respondWith(
      (async () => {
        const precache = await self.caches.open(PRECACHE_NAME);
        const runtime = await self.caches.open(RUNTIME_CACHE_NAME);
        const cached =
          (await precache.match(request)) ||
          (request.destination === 'image'
            ? await precache.match(request, { ignoreSearch: true })
            : undefined) ||
          (await runtime.match(request));

        const networkPromise = fetch(request)
          .then((res) => {
            if (res.ok) {
              void runtime.put(request, res.clone());
            }
            return res;
          })
          .catch(() => null);

        if (cached) {
          event.waitUntil(networkPromise);
          return cached;
        }

        const fresh = await networkPromise;
        return fresh || Response.error();
      })()
    );
  }
});

self.addEventListener('notificationclose', (event) => {
  const data: SwNotificationData = event.notification.data || {};
  if (!data.taskId && !data.reminderId) return;

  event.waitUntil(
    (async () => {
      const now = Date.now();
      const actionId = `close:${data.taskId || ''}:${data.reminderId || ''}:${now}`;
      if (data.taskId && data.reminderId) {
        await markLocalReminderFired('', data.taskId, data.reminderId);
      }
      await removeScheduledRemindersFor(data.taskId, data.reminderId, false);
      await persistPendingReminderAction({
        actionId,
        action: 'clear',
        taskId: data.taskId,
        reminderId: data.reminderId,
        timestamp: now,
      });

      const windowClients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });

      if (windowClients.length > 0) {
        for (const client of windowClients) {
          client.postMessage({
            type: 'REMINDER_ACTION',
            actionId,
            action: 'clear',
            taskId: data.taskId,
            reminderId: data.reminderId,
          });
        }
      }

      await notifyServerDismiss(data.taskId, data.reminderId, false);
    })()
  );
});

self.addEventListener('notificationclick', (event) => {
  const notification = event.notification;
  const data: SwNotificationData = notification.data || {};
  const action = event.action;

  notification.close();

  if (action === 'snooze' || action === 'done' || action === 'clear') {
    const snoozeMinutes = action === 'snooze' ? 10 : undefined;
    event.waitUntil(
      (async () => {
        const now = Date.now();
        const actionId = `${action}:${data.taskId || ''}:${data.reminderId || ''}:${now}`;
        if (data.taskId && data.reminderId) {
          await markLocalReminderFired('', data.taskId, data.reminderId);
        }
        await removeScheduledRemindersFor(data.taskId, data.reminderId, action === 'done');
        await closeMatchingNotifications(data.taskId, data.reminderId, action === 'done');
        await persistPendingReminderAction({
          actionId,
          action,
          taskId: data.taskId,
          reminderId: data.reminderId,
          snoozeMinutes,
          timestamp: now,
        });

        const windowClients = await self.clients.matchAll({
          type: 'window',
          includeUncontrolled: true,
        });

        const payload = {
          type: 'REMINDER_ACTION',
          actionId,
          action,
          taskId: data.taskId,
          reminderId: data.reminderId,
          snoozeMinutes,
        };

        if (windowClients.length > 0) {
          for (const client of windowClients) {
            client.postMessage(payload);
          }
        }

        const networkTasks: Promise<unknown>[] = [
          notifyServerDismiss(data.taskId, data.reminderId, action === 'done'),
        ];

        if (action === 'snooze' && windowClients.length === 0) {
          const snoozeTriggerMs = now + (snoozeMinutes ?? 10) * 60 * 1000;
          const snoozeRemId = `snooze-${now}`;
          const snoozeTaskId = data.taskId || snoozeRemId;
          const currentScheduled = await loadScheduledReminders();
          await saveScheduledReminders([
            ...currentScheduled.slice(-99),
            {
              key: `${snoozeTaskId}:${snoozeRemId}:${Math.round(snoozeTriggerMs / 1000)}`,
              taskId: snoozeTaskId,
              reminderId: snoozeRemId,
              triggerAtMs: snoozeTriggerMs,
              title: data.taskTitle || 'Snoozed reminder',
              body: [`Snoozed ${snoozeMinutes ?? 10}m`, data.category].filter(Boolean).join(' · '),
              category: data.category || '',
              tag: `buh-reminder-${snoozeTaskId}-${snoozeRemId}`,
              silent: false,
            },
          ]);

          if (self.registration.pushManager) {
            networkTasks.push(
              (async () => {
                try {
                  const sub = await self.registration.pushManager.getSubscription();
                  if (sub) {
                    await fetch('/api/push/snooze', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        subscription: sub.toJSON(),
                        taskId: data.taskId,
                        reminderId: data.reminderId,
                        taskTitle: data.taskTitle,
                        category: data.category,
                        snoozeMinutes: snoozeMinutes ?? 10,
                      }),
                    });
                  }
                } catch {
                  // Offline fallback: pending snooze is already saved in local cache
                }
              })()
            );
          }
        }

        await Promise.allSettled(networkTasks);
      })()
    );
    return;
  }

  // Default tap on notification body: permanently dismiss this reminder FIRST, then focus/open window
  event.waitUntil(
    (async () => {
      const now = Date.now();
      const actionId = `open-clear:${data.taskId || ''}:${data.reminderId || ''}:${now}`;
      if (data.taskId && data.reminderId) {
        await markLocalReminderFired('', data.taskId, data.reminderId);
      }
      await removeScheduledRemindersFor(data.taskId, data.reminderId, false);
      await closeMatchingNotifications(data.taskId, data.reminderId, false);
      if (data.taskId || data.reminderId) {
        await persistPendingReminderAction({
          actionId,
          action: 'clear',
          taskId: data.taskId,
          reminderId: data.reminderId,
          timestamp: now,
        });
      }

      const dismissPromise = notifyServerDismiss(data.taskId, data.reminderId, false);

      const baseTargetUrl = resolveSafeSameOriginUrl(data.url);
      const windowClients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });

      let focusedClient: SwWindowClient | null = null;
      for (const client of windowClients) {
        if (client.url.startsWith(self.location.origin)) {
          await client.focus();
          if (data.taskId || data.reminderId) {
            client.postMessage({
              type: 'REMINDER_ACTION',
              actionId,
              action: 'clear',
              taskId: data.taskId,
              reminderId: data.reminderId,
            });
          }
          if (data.taskId) {
            client.postMessage({ type: 'REMINDER_OPEN', taskId: data.taskId });
          }
          focusedClient = client;
          break;
        }
      }

      if (!focusedClient) {
        const targetUrlObj = new URL(baseTargetUrl);
        if (data.taskId) {
          targetUrlObj.searchParams.set('openTask', data.taskId);
        }
        const opened = await self.clients.openWindow(targetUrlObj.href);
        if (opened && data.taskId) {
          opened.postMessage({ type: 'REMINDER_OPEN', taskId: data.taskId });
        }
      }

      await dismissPromise;
    })()
  );
});
