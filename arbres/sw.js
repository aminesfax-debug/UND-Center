const CACHE = 'arbres-v8';
const ASSETS = ['./', './index.html', './style.css', './js/data.js', './js/app.js', './js/map.js', './js/vendor/leaflet.js', './js/vendor/leaflet.css', './js/sync.js', './js/firebase-config.js', './manifest.webmanifest', './icon-192.png', './icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS))); self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// réseau d'abord en revalidant toujours (no-cache : jamais de version périmée du cache HTTP), repli sur le cache hors-ligne
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (/arcgisonline\.com|openstreetmap\.org/.test(e.request.url)) return; // fonds de carte : réseau seul, pas de mise en cache
  if (e.request.url.includes('googleapis.com') || e.request.url.includes('firebaseio.com')) return; // API Firebase : jamais via le cache
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(r => {
    const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r;
  }).catch(() => caches.match(e.request).then(r => r || (e.request.mode === 'navigate' ? caches.match('./index.html') : Response.error()))));
});
