const CACHE = 'static-obsidian-v2';

const PRECACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/assets/css/styles.css',
  '/assets/logo.svg',
  '/src/app.js',
  '/src/core/state.js',
  '/src/core/settings.js',
  '/src/core/storage.js',
  '/src/core/git.js',
  '/src/ui/editor.js',
  '/src/ui/handlers.js',
  '/src/ui/sidebar.js',
  '/src/ui/toast.js',
  '/src/ui/modal.js',
  '/src/ui/drag.js',
  '/src/ui/modals.js',
  '/src/render/preview.js',
  '/src/parser/config.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin === 'https://cdn.jsdelivr.net' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        return res;
      }))
    );
    return;
  }
  if (url.origin === 'https://fonts.googleapis.com') {
    event.respondWith(fetch(event.request));
    return;
  }
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
