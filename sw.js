// Service Worker - improved
const CACHE_VERSION = 'v1';
const STATIC_CACHE = `paw-points-static-${CACHE_VERSION}`;
const DYNAMIC_CACHE = `paw-points-dynamic-${CACHE_VERSION}`;
const MAX_DYNAMIC_ENTRIES = 50;

// Update this list with the files you want precached (offline page, core CSS/JS, icons).
// Make sure these paths exist in your app build.
const PRECACHE_URLS = [
  '/offline.html'
];

// Helpers
async function trimCache(cacheName, maxItems) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length > maxItems) {
    // delete oldest entries until under limit
    const deleteCount = keys.length - maxItems;
    for (let i = 0; i < deleteCount; i++) {
      await cache.delete(keys[i]);
    }
  }
}

function isSameOrigin(request) {
  try {
    const requestURL = new URL(request.url);
    return requestURL.origin === self.location.origin;
  } catch (e) {
    return false;
  }
}

// Install: precache critical assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

// Activate: remove old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key !== STATIC_CACHE && key !== DYNAMIC_CACHE)
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

// Allow pages to trigger skipWaiting by posting {type: 'SKIP_WAITING'}
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Notification click: open provided URL or focus existing client
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const urlToOpen = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === urlToOpen && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});

// Fetch: safe network-first for same-origin GETs, with cache fallback and offline page for navigations.
// For static assets you can use a cache-first approach (example below).
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only handle GET over http(s)
  if (request.method !== 'GET') return;
  if (!request.url.startsWith('http')) return;

  // Don't cache third-party requests (analytics, CDNs) unless you explicitly want to.
  if (!isSameOrigin(request)) {
    // Let cross-origin requests go to network normally
    return;
  }

  // Navigation requests (HTML pages) - network first with offline fallback
  if (request.mode === 'navigate' || (request.headers && request.headers.get('accept') && request.headers.get('accept').includes('text/html'))) {
    event.respondWith(
      (async () => {
        try {
          const networkResponse = await fetch(request);
          // If response is valid, update dynamic cache
          if (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'opaque')) {
            const clone = networkResponse.clone();
            const cache = await caches.open(DYNAMIC_CACHE);
            cache.put(request, clone).catch(() => {});
            trimCache(DYNAMIC_CACHE, MAX_DYNAMIC_ENTRIES).catch(() => {});
          }
          return networkResponse;
        } catch (err) {
          // Network failed — try cache, then offline page
          const cached = await caches.match(request);
          if (cached) return cached;
          const offline = await caches.match('/offline.html');
          return offline || new Response('Offline', { status: 504, headers: { 'Content-Type': 'text/plain' } });
        }
      })()
    );
    return;
  }

  // For other same-origin GET requests (assets), use cache-first then network fallback (fast responses)
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse;
      return fetch(request)
        .then((networkResponse) => {
          // Only cache valid responses (status 200) or opaque (CORS) if you want
          if (!networkResponse || (networkResponse.status !== 200 && networkResponse.type !== 'opaque')) {
            return networkResponse;
          }
          const responseToCache = networkResponse.clone();
          caches.open(DYNAMIC_CACHE).then((cache) => {
            cache.put(request, responseToCache).catch(() => {});
            trimCache(DYNAMIC_CACHE, MAX_DYNAMIC_ENTRIES).catch(() => {});
          });
          return networkResponse;
        })
        .catch(() => {
          // If fetch failed and request is for an image, you could return a placeholder; here return nothing so browser handles it.
          return undefined;
        });
    })
  );
});
