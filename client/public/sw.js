// CMMS Service Worker - PWA v3
const CACHE_NAME = 'cmms-v3';
const STATIC_ASSETS = ['/', '/manifest.json', '/favicon.ico'];

// ─── Install: cache static assets ───────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch(() => {});
    })
  );
  self.skipWaiting();
});

// ─── Activate: clean old caches ─────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    ).then(() => clients.claim())
  );
});

// ─── Fetch: Network-first for API, Cache-first for static ───────────────────
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;
  if (url.pathname.startsWith('/api/')) return;
  if (url.pathname.startsWith('/trpc/')) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match('/') || caches.match(event.request))
    );
    return;
  }

  if (url.pathname.match(/\.(js|css|png|jpg|jpeg|webp|svg|ico|woff|woff2|ttf)$/)) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        });
      })
    );
    return;
  }
});

// ─── Background Sync: رفع الصور المعلقة عند عودة الاتصال ───────────────────
// يُستدعى تلقائياً من المتصفح بمجرد عودة الإنترنت
self.addEventListener("sync", (event) => {
  if (event.tag === "cmms-upload-sync") {
    event.waitUntil(syncPendingUploads());
  }
});

async function syncPendingUploads() {
  // أخبر جميع نوافذ التطبيق المفتوحة لتبدأ المزامنة عبر الـ hook
  const allClients = await clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of allClients) {
    client.postMessage({ type: "CMMS_SYNC_UPLOADS" });
  }
}

// ─── Web Push Notifications ──────────────────────────────────────────────────
self.addEventListener("push", function (event) {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "إشعار جديد", body: event.data.text() };
  }

  const title = payload.title || "تولان - نظام الصيانة";
  const type = payload.type || "info";

  // Vibration patterns based on notification type
  // critical: long urgent pattern, warning: double pulse, others: single pulse
  const vibrationPattern =
    type === "critical" || type === "error"
      ? [300, 100, 300, 100, 300]
      : type === "warning"
      ? [200, 100, 200]
      : [150];

  const options = {
    body: payload.body || "",
    icon: payload.icon || "/icons/icon-192x192.png",
    badge: payload.badge || "/icons/icon-96x96.png",
    tag: payload.tag || `cmms-${type}-${Date.now()}`,
    data: {
      url: payload.url || "/notifications",
      type: type,
    },
    dir: "rtl",
    lang: "ar",
    // Keep notification visible until user interacts with it for critical alerts
    requireInteraction: type === "critical" || type === "error",
    // Vibration pattern for Android
    vibrate: vibrationPattern,
    // Timestamp for ordering
    timestamp: Date.now(),
    // Actions for quick response (Android Chrome supports this)
    actions: payload.url
      ? [
          {
            action: "open",
            title: "فتح",
            icon: "/icons/icon-96x96.png",
          },
          {
            action: "dismiss",
            title: "إغلاق",
          },
        ]
      : [],
    // Silent flag: if user disabled sound in system settings, respect that
    silent: false,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// ─── Notification Click Handler ──────────────────────────────────────────────
self.addEventListener("notificationclick", function (event) {
  event.notification.close();

  // Handle action buttons
  if (event.action === "dismiss") return;

  const url = event.notification.data?.url || "/notifications";

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(function (clientList) {
        // If app is already open, focus it and navigate
        for (const client of clientList) {
          if (client.url.includes(self.location.origin) && "focus" in client) {
            client.focus();
            if ("navigate" in client) {
              client.navigate(url);
            }
            return;
          }
        }
        // Otherwise open a new window
        if (clients.openWindow) {
          return clients.openWindow(url);
        }
      })
  );
});

// ─── Push Subscription Change ────────────────────────────────────────────────
// Called when the browser refreshes the push subscription (e.g., after expiry)
self.addEventListener("pushsubscriptionchange", function (event) {
  // Re-subscribe automatically when subscription expires
  event.waitUntil(
    self.registration.pushManager
      .subscribe({
        userVisibleOnly: true,
        applicationServerKey: event.oldSubscription
          ? event.oldSubscription.options.applicationServerKey
          : null,
      })
      .then(function (subscription) {
        // Notify the app to update the subscription in the backend
        return clients.matchAll({ type: "window" }).then(function (clients) {
          clients.forEach(function (client) {
            client.postMessage({
              type: "PUSH_SUBSCRIPTION_CHANGED",
              subscription: subscription.toJSON(),
            });
          });
        });
      })
      .catch(function () {
        // Subscription renewal failed, user needs to re-subscribe manually
      })
  );
});
