// Griffbuch offline support.
// App files: network first (so updates arrive automatically), cache as fallback when offline.
// Fonts: cache first.
// The real app and the test copy share one origin, so each cache name carries its scope
// and a service worker only ever clears its own old caches.
const SCOPE = self.registration.scope;
const CACHE = 'griffbuch-v2@' + SCOPE;
const ASSETS = [
  './', './index.html', './css/app.css',
  './js/i18n.js', './js/core.js', './js/logbook.js', './js/plan.js', './js/app.js',
  './manifest.webmanifest', './manifest-test.webmanifest',
  './icon.svg', './icon-192.png', './icon-512.png', './apple-touch-icon.png'
];
const NETWORK_TIMEOUT = 3500;

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  const legacy = /griffbuch-test/.test(SCOPE) ? null : 'griffbuch-v1';
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => (k.endsWith('@' + SCOPE) && k !== CACHE) || k === legacy).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(r => { clearTimeout(t); resolve(r); }, e => { clearTimeout(t); reject(e); });
  });
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  const network = fetch(request).then(res => {
    if (res && res.ok) cache.put(request, res.clone());
    return res;
  });
  try {
    return await withTimeout(network, NETWORK_TIMEOUT);
  } catch (e) {
    const hit = await cache.match(request, { ignoreSearch: true }) ||
      (request.mode === 'navigate' ? await cache.match('./index.html') : null);
    if (hit) return hit;
    return network;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res && (res.ok || res.type === 'opaque')) cache.put(request, res.clone());
  return res;
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin && url.href.startsWith(SCOPE)) {
    event.respondWith(networkFirst(req));
  } else if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(req));
  }
});
