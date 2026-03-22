importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

const CACHE_NAME = 'nabil-pro-v17';
const CACHE_FILES = ['/', './index.html', './style.css', './app.js', './manifest.json', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(CACHE_FILES)).catch(() => {}));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).then(r => {
      const clone = r.clone();
      caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
      return r;
    }).catch(() => caches.match(e.request))
  );
});

firebase.initializeApp({
  apiKey:            "AIzaSyAikfw9vS3PJQgaWl6SrpcOSG34B5vyXPc",
  authDomain:        "nabil-pro.firebaseapp.com",
  projectId:         "nabil-pro",
  storageBucket:     "nabil-pro.firebasestorage.app",
  messagingSenderId: "82099030853",
  appId:             "1:82099030853:web:89de9eabad2cc53817cc2c"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(payload => {
  const title = payload.notification?.title || 'Nabil Pro 🛵';
  const body  = payload.notification?.body  || 'إشعار جديد';
  return self.registration.showNotification(title, {
    body,
    icon: 'https://nabil-pro.vercel.app/icon-192.png',
    badge: 'https://nabil-pro.vercel.app/icon-192.png',
    tag: 'nabil-order',
    renotify: true,
    vibrate: [200, 100, 200],
    requireInteraction: true,
    data: { url: 'https://nabil-pro.vercel.app' }
  });
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list)
        if (c.url.includes('nabil-pro') && 'focus' in c) return c.focus();
      if (clients.openWindow) return clients.openWindow('https://nabil-pro.vercel.app');
    })
  );
});
