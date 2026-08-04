const DYNAMIC_CACHE = 'paw-points-dynamic'; 

// Install Event 
self.addEventListener('install', (event) => { 
    self.skipWaiting(); 
}); 

// Activate Event 
self.addEventListener('activate', (event) => { 
    event.waitUntil(self.clients.claim()); 
}); 

// Notification Click Event 
self.addEventListener('notificationclick', (event) => { 
    event.notification.close(); 
    event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => { 
        if (clientList.length > 0) { 
            let client = clientList[0]; 
            for (let i = 0; i < clientList.length; i++) { 
                if (clientList[i].focused) { 
                    client = clientList[i]; 
                } 
            } 
            return client.focus(); 
        } 
        return clients.openWindow('/'); 
    })); 
}); 

// Fetch Event - Safe Network-First Handler 
self.addEventListener('fetch', (event) => { 
    if (!event.request.url.startsWith('http')) return; 
    if (event.request.method !== 'GET') return; 
    
    event.respondWith(fetch(event.request) 
        .then((networkResponse) => { 
            if (networkResponse && networkResponse.status === 200) { 
                const responseToCache = networkResponse.clone(); 
                caches.open(DYNAMIC_CACHE).then((cache) => { 
                    cache.put(event.request, responseToCache); 
                }); 
            } 
            return networkResponse; 
        }) 
        .catch(() => { 
            return caches.match(event.request).then((cachedResponse) => { 
                return cachedResponse || new Response('Network error occurred', {
                    status: 408, 
                    headers: { 'Content-Type': 'text/plain' } 
                }); 
            }); 
        }) 
    ); 
});

// Background Sync Event
self.addEventListener('sync', (event) => {
    if (event.tag === 'sync-updates') {
        console.log('Service Worker: Syncing updates in background');
        // Add your background sync logic here (e.g., sending queued booking requests)
    }
});

// Periodic Background Sync Event
self.addEventListener('periodicsync', (event) => {
    if (event.tag === 'update-paw-points') {
        console.log('Service Worker: Fetching periodic updates for Paw Points');
        // Add your periodic background sync logic here (e.g., fetching latest point balance)
    }
});

// Push Notification Event
self.addEventListener('push', (event) => {
    let data = { title: 'Pet Care by Steven', content: 'You have a new update!' };
    
    if (event.data) {
        data = event.data.json();
    }
    
    const options = {
        body: data.content,
        icon: '/android-chrome-192x192.png',
        badge: '/favicon-32x32.png'
    };
    
    event.waitUntil(self.registration.showNotification(data.title, options));
});
