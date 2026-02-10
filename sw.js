const CACHE_NAME = 'coup-v1';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './js/constants.js',
  './js/state.js',
  './js/utils.js',
  './js/ui.js',
  './js/network.js',
  './js/game.js',
  './js/main.js',
  'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((response) => {
      return response || fetch(e.request);
    })
  );
});
