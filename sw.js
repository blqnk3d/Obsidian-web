const CACHE = 'static-obsidian-v4';

const BASE = self.location.pathname.replace(/\/sw\.js$/, '') || '';

const PRECACHE = [
  BASE + '/',
  BASE + '/index.html',
  BASE + '/manifest.json',
  BASE + '/assets/css/styles.css',
  BASE + '/assets/logo.svg',
  BASE + '/src/app.js',
  BASE + '/src/core/state.js',
  BASE + '/src/core/settings.js',
  BASE + '/src/core/storage.js',
  BASE + '/src/core/git.js',
  BASE + '/src/ui/editor.js',
  BASE + '/src/ui/handlers.js',
  BASE + '/src/ui/sidebar.js',
  BASE + '/src/ui/toast.js',
  BASE + '/src/ui/modal.js',
  BASE + '/src/ui/drag.js',
  BASE + '/src/ui/modals.js',
  BASE + '/src/render/preview.js',
  BASE + '/src/parser/config.js',

  // CDN dependencies – precached for offline support
  'https://cdn.jsdelivr.net/npm/markdown-it@14.1.1/+esm',
  'https://cdn.jsdelivr.net/npm/dompurify@3.2.4/+esm',
  'https://cdn.jsdelivr.net/npm/katex@0.16.11/+esm',
  'https://cdn.jsdelivr.net/npm/mermaid@11.4.1/+esm',
  'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.all(
        PRECACHE.map((url) =>
          cache.add(url).catch(() => {
            console.warn('[SW] failed to cache', url);
          })
        )
      )
    )
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
  const isOwn = url.origin === self.location.origin && url.pathname.startsWith(BASE + '/');

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
  if (isOwn) {
    const clean = new URL(event.request.url);
    clean.search = '';
    event.respondWith(
      caches.match(clean.href).then((cached) => cached || fetch(event.request))
    );
    return;
  }
});
