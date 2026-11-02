/* 明日债 service worker：代码网络优先（更新立刻生效），图片缓存优先 */
const CACHE = 'tomorrow-debt-v11';
const FILES = ['./', './index.html', './style.css', './game.js', './net.js', './peerjs.min.js', './manifest.webmanifest', './icon.svg', './assets/corridor.jpg', './assets/living.jpg', './assets/bedroom.jpg', './assets/bedroom-open.jpg', './assets/tv.jpg'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  const isCode = e.request.mode === 'navigate' || /\.(html|js|css)$/.test(url.pathname);
  if (isCode) {
    e.respondWith(fetch(e.request).then(r => {
      const copy = r.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return r;
    }).catch(() => caches.match(e.request)));
  } else {
    e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request)));
  }
});
