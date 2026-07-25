const DYNAMIC_CACHE = 'paw-points-dynamic';

// Install Event - Immediately take control
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

// Activate Event - Claim clients immediately
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Fetch Event - Network First, fallback to Cache
self.addEventListener('fetch', (event) => {
  // Only handle standard HTTP/HTTPS GET requests
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        // If we get a valid response from the network, update the cache copy in the background
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(DYNAMIC_CACHE).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        // If offline/network fails, serve the cached version
        return caches.match(event.request);
      })
  );
});
