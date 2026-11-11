// Offline cache for the PWA. Bump VERSION when files change.
const VERSION = 'flow-v6';
const FILES = [
  './', './index.html', './manifest.webmanifest', './css/style.css',
  './js/main.js', './js/sim.js', './js/render.js', './js/ui.js', './js/economy.js',
  './js/levels.js', './js/save.js', './js/util.js',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png',
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// Network first (so updates show up), cache as fallback when offline.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).then((r) => {
      const copy = r.clone();
      caches.open(VERSION).then((c) => c.put(e.request, copy));
      return r;
    }).catch(() => caches.match(e.request).then((r) => r || caches.match('./index.html')))
  );
});
