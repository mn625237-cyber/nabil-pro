// ══════════════════════════════════════════════════════
// Nabil Pro - Service Worker v6
// ══════════════════════════════════════════════════════

importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

const CACHE_NAME = 'nabil-pro-v6';
const CACHE_FILES = ['/', './index.html', './style.css', './app.js', './manifest.json', './icon-192.png', './icon-512.png'];

// ── تحديث فوري ──
self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(CACHE_FILES)).catch(()=>{}));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => clients.claim())
  );
});

// ── Network first, fallback to cache ──
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

// ── Firebase Config ──
firebase.initializeApp({
  apiKey:            "AIzaSyAikfw9vS3PJQgaWl6SrpcOSG34B5vyXPc",
  authDomain:        "nabil-pro.firebaseapp.com",
  projectId:         "nabil-pro",
  storageBucket:     "nabil-pro.firebasestorage.app",
  messagingSenderId: "82099030853",
  appId:             "1:82099030853:web:89cc0a82a00e8e57d5bee5"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(payload => {
  const title = payload.notification?.title || 'Nabil Pro 🛵';
  const body  = payload.notification?.body  || 'أوردر جديد';
  return self.registration.showNotification(title, {
    body, icon:'https://mn625237-cyber.github.io/nabil-pro/icon-192.png',
    badge:'https://mn625237-cyber.github.io/nabil-pro/icon-192.png',
    tag:'nabil-order', renotify:true, vibrate:[200,100,200], data:{url:'/'}
  });
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({type:'window',includeUncontrolled:true}).then(list => {
      for (const c of list) if (c.url.includes('nabil-pro') && 'focus' in c) return c.focus();
      if (clients.openWindow) return clients.openWindow('https://mn625237-cyber.github.io/nabil-pro/');
    })
  );
});
