/* 明日债离线缓存：首次联网打开后，后续离线可玩 */
const CACHE = 'tomorrow-debt-v10';
const FILES = ['./', './index.html', './style.css', './game.js', './net.js', './peerjs.min.js', './manifest.webmanifest', './icon.svg', './assets/corridor.jpg', './assets/living.jpg', './assets/bedroom.jpg', './assets/bedroom-open.jpg', './assets/tv.jpg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request)));
});
