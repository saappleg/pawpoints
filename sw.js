const CACHE_NAME = 'paw-points-offline-v3';
const OFFLINE_URL = '/offline.html';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  OFFLINE_URL,
  '/output.css',
  '/android-chrome-192x192.webp',
  '/android-chrome-512x512.webp',
  '/favicon.ico',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap'
];

// Install Event: Cache Core Assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

// Activate Event: Clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
             return caches.delete(cache);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch Event: Network-First for HTML/Data, Cache-First for static assets
self.addEventListener('fetch', (event) => {
  // Ignore non-GET requests and Firebase API calls to allow Firestore's built-in offline persistence to work
  const requestUrl = new URL(event.request.url);
  if (event.request.method !== 'GET' || requestUrl.hostname === 'firestore.googleapis.com') return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      // HTML Strategy: Try Network first to get updates, fallback to cache if offline
      if (event.request.headers.get('accept').includes('text/html')) {
        return fetch(event.request).then((response) => {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
          return response;
        }).catch(async () => {
          // NEW: Serve dedicated offline page if network completely fails
          const cache = await caches.open(CACHE_NAME);
          const offlineResponse = await cache.match(OFFLINE_URL);
          return offlineResponse || cachedResponse;
        });
      }

      // Asset Strategy: Use Cache first for instant loading, fallback to network
      return cachedResponse || fetch(event.request).then((response) => {
        const responseClone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
        return response;
      });
    })
  );
});

// ---------------------------------------------------------
// PWABUILDER REQUIRED CAPABILITIES
// ---------------------------------------------------------

// 1. Background Sync (Resilient to poor network connections)
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-updates') {
    console.log('[Service Worker] Background sync triggered.');
    // Logic to sync data to Firebase when connection is restored goes here
  }
});

// 2. Periodic Background Sync (Show data instantly to users)
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'content-sync') {
    console.log('[Service Worker] Periodic background sync triggered.');
    // Logic to pre-fetch updated schedules or client points goes here
  }
});

// 3. Push Notifications
self.addEventListener('push', (event) => {
  if (!event.data) return;
  
  try {
    const data = event.data.json();
    const options = {
      body: data.body || 'You have a new update from Pet Care by Steven!',
      icon: '/android-chrome-192x192.png',
      badge: '/android-chrome-192x192.png',
      data: { url: data.url || '/' }
    };
    event.waitUntil(self.registration.showNotification(data.title || 'Pet Care Update', options));
  } catch (e) {
    const options = {
      body: event.data.text(),
      icon: '/android-chrome-192x192.png'
    };
    event.waitUntil(self.registration.showNotification('Pet Care Update', options));
  }
});

// Handle Push Notification Clicks
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((windowClients) => {
      const targetUrl = event.notification.data && event.notification.data.url ? event.notification.data.url : '/';
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        if (client.url.includes(targetUrl) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
