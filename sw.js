// ══════════════════════════════════════════════════════
// Nabil Pro - Service Worker v5 (FCM)
// ══════════════════════════════════════════════════════

importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

// ── تحديث فوري بدون انتظار ──
self.addEventListener('install', e => {
  self.skipWaiting(); // تثبيت فوري
});

self.addEventListener('activate', e => {
  e.waitUntil(clients.claim()); // تفعيل فوري على كل التبويبات
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

// ── استقبل الإشعارات لما التطبيق في الخلفية أو مغلق ──
messaging.onBackgroundMessage(payload => {
  const title = payload.notification?.title || 'Nabil Pro 🛵';
  const body  = payload.notification?.body  || 'أوردر جديد';

  return self.registration.showNotification(title, {
    body,
    icon:      'https://mn625237-cyber.github.io/nabil-pro/icon-192.png',
    badge:     'https://mn625237-cyber.github.io/nabil-pro/icon-192.png',
    tag:       'nabil-order',
    renotify:  true,
    vibrate:   [200, 100, 200],
    data:      { url: '/' }
  });
});

// ── لما المستخدم يضغط على الإشعار ──
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type:'window', includeUncontrolled:true }).then(list => {
      for (const client of list) {
        if (client.url.includes('nabil-pro') && 'focus' in client)
          return client.focus();
      }
      if (clients.openWindow)
        return clients.openWindow('https://mn625237-cyber.github.io/nabil-pro/');
    })
  );
});
