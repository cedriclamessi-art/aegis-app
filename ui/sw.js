const CACHE = 'aegis-v3.7';
const ASSETS = ['/ui/dashboard.html', '/ui/manifest.json'];

self.addEventListener('install', e => e.waitUntil(
  caches.open(CACHE).then(c => c.addAll(ASSETS))
));

self.addEventListener('fetch', e => {
  if (e.request.url.includes('/api/') || e.request.url.includes('/ws/')) return;
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
