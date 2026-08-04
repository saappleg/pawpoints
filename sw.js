const CACHE_NAME = 'paw-points-offline-v2';
const ASSETS_TO_CACHE = [
    '/',
    '/index.html',
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
    if (event.request.method !== 'GET' || event.request.url.includes('firestore.googleapis.com')) return;

    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            // HTML Strategy: Try Network first to get updates, fallback to cache if offline
            if (event.request.headers.get('accept').includes('text/html')) {
                return fetch(event.request).then((response) => {
                    const responseClone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
                    return response;
                }).catch(() => cachedResponse);
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
