/**
 * AEGIS Service Worker v4.2
 * Cache-first for shell, network-first for API.
 * Push notifications for critical events.
 */
const CACHE_VERSION = 'aegis-v4.2';
const SHELL_FILES   = ['/', '/index.html', '/manifest.json'];

// ── Install: cache shell ──────────────────────────────────
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_VERSION).then(c => c.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

// ── Activate: clean old caches ────────────────────────────
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── Fetch: network-first for API, cache-first for shell ───
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // API calls — always network, no cache
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(fetch(e.request).catch(() =>
      new Response(JSON.stringify({ error: 'Hors ligne' }), {
        headers: { 'Content-Type': 'application/json' }
      })
    ));
    return;
  }

  // Shell — cache-first
  e.respondWith(
    caches.match(e.request).then(cached =>
      cached ?? fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_VERSION).then(c => c.put(e.request, clone));
        }
        return res;
      })
    )
  );
});

// ── Push notifications ────────────────────────────────────
self.addEventListener('push', (e) => {
  if (!e.data) return;
  let data;
  try { data = e.data.json(); } catch { data = { title: 'AEGIS', body: e.data.text() }; }

  const ICONS = {
    anomaly_critical:      '🚨',
    constitutional_veto:   '⚖️',
    stock_critical:        '📦',
    dct_winner_found:      '🏆',
    brief_delivered:       '📋',
  };

  const icon = ICONS[data.event_type] ?? '⚡';

  e.waitUntil(
    self.registration.showNotification(`${icon} ${data.title ?? 'AEGIS'}`, {
      body:    data.message ?? data.body ?? '',
      icon:    '/icons/icon-192.png',
      badge:   '/icons/icon-192.png',
      tag:     data.event_type ?? 'aegis-notification',
      renotify: true,
      data:    { url: data.url ?? '/' },
      actions: [
        { action: 'open',    title: 'Voir' },
        { action: 'dismiss', title: 'Ignorer' },
      ],
      vibrate: data.event_type === 'anomaly_critical' ? [200, 100, 200] : [100],
    })
  );
});

// ── Notification click ────────────────────────────────────
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  if (e.action === 'dismiss') return;

  const url = e.notification.data?.url ?? '/';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cls => {
      const existing = cls.find(c => c.url.includes(self.location.origin));
      if (existing) { existing.focus(); existing.navigate(url); }
      else clients.openWindow(url);
    })
  );
});
