// App shell: stale-while-revalidate. Stars: network-first with offline fallback. Similar: network only.
const CACHE = 'mystars-v1';
const SHELL = ['/', '/search.js', '/manifest.webmanifest', '/icons/icon-192.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/similar')) return;
  if (url.pathname.startsWith('/api/stars')) {
    e.respondWith(fetch(e.request).then((res) => {
      if (res.ok) caches.open(CACHE).then((c) => c.put('/api/stars', res.clone()));
      return res;
    }).catch(() => caches.match('/api/stars')));
    return;
  }
  const key = url.pathname === '/index.html' || url.search ? url.pathname.replace('/index.html', '/') : e.request;
  e.respondWith(caches.match(key).then((hit) => {
    const net = fetch(e.request).then((res) => { if (res.ok) caches.open(CACHE).then((c) => c.put(key, res.clone())); return res; });
    return hit ? (e.waitUntil(net.catch(() => {})), hit) : net;
  }));
});
