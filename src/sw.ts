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
}

declare const self: SwGlobalScope;

const PRECACHE_NAME = 'buh-precache-v2';
const RUNTIME_CACHE_NAME = 'buh-runtime-v2';
const FONTS_CACHE_NAME = 'buh-fonts-v1';
const REMINDER_ACTIONS_CACHE = 'buh-reminder-actions-v1';
const REMINDER_ACTIONS_URL = '/__buh_pending_reminder_actions__';

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
  action: 'snooze' | 'clear';
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
    list.push(actionPayload);
    await cache.put(
      REMINDER_ACTIONS_URL,
      new Response(JSON.stringify(list.slice(-25)), {
        headers: { 'Content-Type': 'application/json' },
      })
    );
  } catch {
    // Ignore cache storage issues
  }
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
  ]);
  event.waitUntil(
    (async () => {
      const keys = await self.caches.keys();
      await Promise.all(keys.filter((k) => !keepCaches.has(k)).map((k) => self.caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener('message', (event) => {
  const data = event.data as {
    type?: string;
    title?: string;
    options?: NotificationOptions;
  } | null;
  if (data && data.type === 'SKIP_WAITING') {
    event.waitUntil(self.skipWaiting());
  } else if (data && data.type === 'SHOW_LOCAL_NOTIFICATION' && typeof data.title === 'string') {
    event.waitUntil(self.registration.showNotification(data.title, data.options || {}));
  }
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
            { action: 'clear', title: 'Clear' },
          ]
        : [{ action: 'clear', title: 'Clear' }];

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
        const windowClients = await self.clients.matchAll({
          type: 'window',
          includeUncontrolled: true,
        });
        for (const client of windowClients) {
          client.postMessage({
            type: 'REMINDER_PUSH_DELIVERED',
            taskId: payload.taskId,
            reminderId: payload.reminderId,
          });
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

  // Never intercept backend API routes or Digital Asset Links (.well-known)
  if (
    url.origin === self.location.origin &&
    (url.pathname.startsWith('/api/') || url.pathname.startsWith('/.well-known/'))
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
        const cached = (await precache.match(request)) || (await runtime.match(request));

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

self.addEventListener('notificationclick', (event) => {
  const notification = event.notification;
  const data: SwNotificationData = notification.data || {};
  const action = event.action;

  notification.close();

  if (action === 'snooze' || action === 'clear') {
    const snoozeMinutes = action === 'snooze' ? 10 : undefined;
    event.waitUntil(
      (async () => {
        const windowClients = await self.clients.matchAll({
          type: 'window',
          includeUncontrolled: true,
        });

        const payload = {
          type: 'REMINDER_ACTION',
          action,
          taskId: data.taskId,
          reminderId: data.reminderId,
          snoozeMinutes,
        };

        if (windowClients.length > 0) {
          for (const client of windowClients) {
            client.postMessage(payload);
          }
        } else {
          await persistPendingReminderAction({
            action,
            taskId: data.taskId,
            reminderId: data.reminderId,
            snoozeMinutes,
            timestamp: Date.now(),
          });

          if (action === 'snooze' && self.registration.pushManager) {
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
              // Offline fallback: pending snooze is already saved in cache for next open
            }
          }
        }
      })()
    );
    return;
  }

  // Default tap on notification body: focus existing standalone app window or open '/'
  event.waitUntil(
    (async () => {
      const targetUrl = resolveSafeSameOriginUrl(data.url);
      const windowClients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });

      for (const client of windowClients) {
        if (client.url.startsWith(self.location.origin)) {
          await client.focus();
          if (data.taskId) {
            client.postMessage({ type: 'REMINDER_OPEN', taskId: data.taskId });
          }
          return;
        }
      }

      const opened = await self.clients.openWindow(targetUrl);
      if (opened && data.taskId) {
        opened.postMessage({ type: 'REMINDER_OPEN', taskId: data.taskId });
      }
    })()
  );
});
