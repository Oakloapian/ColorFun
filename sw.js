/* Offline cache: app shell + every image in Images/manifest.json.
   Strategy: serve from cache instantly, refresh in the background (new images appear on next open). */
const V = 'colorfun-v5';   // bump when app code changes so phones pick up the update
const SHELL = ['./', 'index.html', 'app.css', 'app.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(V);
    await c.addAll(SHELL);
    try {
      const r = await fetch('Images/manifest.json', { cache: 'no-store' });
      const list = await r.clone().json();
      await c.put('Images/manifest.json', r);
      await Promise.all(list.map(n => c.add('Images/' + encodeURIComponent(n)).catch(() => {})));
    } catch (err) {}
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== V) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const c = await caches.open(V);
    // Picture list: always try the network first so new pictures show up after ONE refresh.
    if (new URL(req.url).pathname.endsWith('/Images/manifest.json')) {
      try { const r = await fetch(req, { cache: 'no-store' }); if (r.ok) { c.put(req, r.clone()); return r; } } catch (err) {}
      return (await c.match(req, { ignoreSearch: true })) || new Response('[]', { headers: { 'Content-Type': 'application/json' } });
    }
    const hit = await c.match(req, { ignoreSearch: true });
    const net = fetch(req).then(r => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => null);
    return hit || (await net) || new Response('Offline', { status: 503 });
  })());
});
