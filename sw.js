const CACHE_NAME = 'coup-v2';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './style_anim.css',
  './style_pass.css',
  './js/constants.js',
  './js/state.js',
  './js/utils.js',
  './js/ui.js',
  './js/network.js',
  './js/game.js',
  './js/audio.js',
  './js/stats.js',
  './js/main.js',
  'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js'
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then((keyList) => {
            return Promise.all(keyList.map((key) => {
                if (key !== CACHE_NAME) {
                    return caches.delete(key);
                }
            }));
        })
    );
    return self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((response) => {
      return response || fetch(e.request);
    })
  );
});
