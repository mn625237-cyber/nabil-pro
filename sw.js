// ============================================================
// Nabil Pro — Service Worker v2
// ============================================================

const CACHE = 'nabil-pro-v2';

self.addEventListener('install',  () => self.skipWaiting());
self.addEventListener('activate', e  => e.waitUntil(self.clients.claim()));

// ── Message from main app ────────────────────────────────────
self.addEventListener('message', e => {
  if (e.data?.type === 'SUBSCRIBE_NTFY') {
    startNtfyListener(e.data.topic);
  }
});

let ntfyReader = null;

async function startNtfyListener(topic) {
  if (ntfyReader) { try { ntfyReader.cancel(); } catch{} }
  
  try {
    const resp = await fetch(`https://ntfy.sh/${topic}/sse`);
    const reader = resp.body.getReader();
    ntfyReader = reader;
    const decoder = new TextDecoder();
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      const text = decoder.decode(value);
      const lines = text.split('\n');
      
      for (const line of lines) {
        if (line.startsWith('data:')) {
          try {
            const data = JSON.parse(line.slice(5));
            if (data.event === 'message') {
              await self.registration.showNotification(data.title || 'Nabil Pro 🛵', {
                body:     data.message || 'أوردر جديد',
                icon:     './icon-192.png',
                badge:    './icon-192.png',
                tag:      'nabil-order',
                renotify: true,
                vibrate:  [200, 100, 200]
              });
            }
          } catch {}
        }
      }
    }
  } catch(err) {
    // Retry after 30 sec
    setTimeout(() => startNtfyListener(topic), 30000);
  }
}

// ── Push (standard Web Push fallback) ───────────────────────
self.addEventListener('push', e => {
  if (!e.data) return;
  let payload;
  try { payload = e.data.json(); }
  catch { payload = { title: 'Nabil Pro 🛵', body: e.data.text() }; }

  e.waitUntil(
    self.registration.showNotification(payload.title || 'Nabil Pro 🛵', {
      body:     payload.message || payload.body || 'أوردر جديد',
      icon:     './icon-192.png',
      badge:    './icon-192.png',
      tag:      'nabil-order',
      renotify: true,
      vibrate:  [200, 100, 200]
    })
  );
});

// ── Notification Click ───────────────────────────────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type:'window', includeUncontrolled:true })
      .then(clients => {
        for (const c of clients) {
          if ('focus' in c) return c.focus();
        }
        return self.clients.openWindow('./');
      })
  );
});
