// sw.js — Service worker för offline. Cache-first för app-skalet.
// Höj CACHE_VERSION när du ändrar någon av filerna nedan.

const CACHE_VERSION = 'v3';
const CACHE_NAME = `franska-flashcards-${CACHE_VERSION}`;

// Relativa sökvägar så det funkar på en GitHub Pages-subpath.
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './db.js',
  './leitner.js',
  './stats.js',
  './backup.js',
  './starter-deck.js',
  './starter-deck-b1.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          // Cacha nya GET-svar från samma ursprung (t.ex. nya filer).
          if (res && res.ok && new URL(req.url).origin === self.location.origin) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => {
          // Offline-fallback: ge app-skalet för navigeringar.
          if (req.mode === 'navigate') return caches.match('./index.html');
          return undefined;
        });
    })
  );
});
