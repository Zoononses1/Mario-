// Offline cache: stale-while-revalidate. Bump CACHE to force an update for everyone.
const CACHE = 'pixel-hopper-v1';
const ASSETS = ['./', './index.html', './game.js', './manifest.json', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.open(CACHE).then(cache => cache.match(e.request, { ignoreSearch: true }).then(hit => {
    const net = fetch(e.request).then(res => { if (res && res.ok) cache.put(e.request, res.clone()); return res; }).catch(() => hit);
    return hit || net;
  })));
});
