// sw.js — 60 readable lines you fully control. That is the entire argument for no build step:
// for an offline-first app, you want to be able to READ your own service worker (§2.1).
// Bump CACHE on every deploy.

const CACHE = 'sl-v3';

const SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/css/tokens.css',
  '/css/base.css',
  '/css/components.css',
  '/css/anim.css',
  '/js/app.js',
  '/js/bus.js',
  '/js/db.js',
  '/js/store.js',
  '/js/backup.js',
  '/js/game/dates.js',
  '/js/game/xp.js',
  '/js/game/stats.js',
  '/js/game/streaks.js',
  '/js/game/quests.js',
  '/js/game/questPool.js',
  '/js/ai/summarizer.js',
  '/js/ai/review.js',
  '/js/ui/dom.js',
  '/js/ui/today.js',
  '/js/ui/journal.js',
  '/js/ui/growth.js',
  '/js/ui/stats.js',
  '/js/ui/you.js',
  '/js/ui/radar.js',
  '/js/ui/levelup.js',
  '/js/ui/haptics.js',
  '/icons/apple-touch-icon.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;

  // The AI function is never cached — a stale review is a lie.
  if (url.pathname.startsWith('/.netlify/')) return;

  // Cache-first for the shell. This app must open in airplane mode, instantly.
  e.respondWith(
    caches.match(e.request).then((hit) => {
      if (hit) return hit;
      return fetch(e.request)
        .then((res) => {
          if (res.ok && url.origin === self.location.origin) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
          }
          return res;
        })
        .catch(() => caches.match('/index.html')); // SPA fallback
    }),
  );
});
