const C = 'playground-v7',
  S = ['./', 'index.html', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', e =>
  e.waitUntil(
    caches
      .open(C)
      .then(c => c.addAll(S))
      .then(() => self.skipWaiting())
  )
);

self.addEventListener('activate', e =>
  e.waitUntil(
    caches
      .keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('playground-') && k !== C).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  )
);

self.addEventListener('fetch', e => {
  // Don't touch non-GET requests — API calls (POST etc.) go straight to the network.
  if (e.request.method !== 'GET') return;

  if (e.request.mode === 'navigate')
    e.respondWith(
      fetch(e.request)
        .then(r => {
          caches.open(C).then(c => c.put(e.request, r.clone()));
          return r;
        })
        .catch(() => caches.match(e.request).then(x => x || caches.match('index.html')))
    );
  else e.respondWith(caches.match(e.request).then(x => x || fetch(e.request)));
});
