// Offline shell for Vesper. Everything is NETWORK-FIRST so app updates take effect on the next
// load; the cache is used only when the server can't be reached. (The previous cache-first
// strategy kept serving old JavaScript after an update.)
const CACHE = 'vesper-shell-v23';
const AUDIO = 'vesper-audio-v1'; // offline music saved by the user (own files / download-permitted Jamendo)
const SHELL = ['/', '/index.html', '/css/app.css', '/js/main.js', '/js/engine.js', '/js/queue.js', '/js/ui.js', '/js/cover.js', '/js/store.js', '/js/views.js', '/js/radio-directory.js', '/js/views-me.js', '/js/nowplaying.js', '/js/panels.js', '/js/lyrics.js', '/js/color.js', '/js/audio.js', '/js/eq.js', '/js/analysis.js', '/js/replay.js', '/js/lrc.js', '/js/artwork.js', '/js/output.js', '/js/ambience.js', '/js/youtube.js', '/js/share.js', '/js/offline.js', '/manifest.webmanifest', '/icon.svg'];
self.addEventListener('install', (event) => {
  // cache: 'reload' bypasses the browser's HTTP cache so the offline copy is the current version.
  event.waitUntil(caches.open(CACHE).then((cache) => Promise.allSettled(SHELL.map((u) => cache.add(new Request(u, { cache: 'reload' }))))).then(() => self.skipWaiting()));
});
// Saved songs play from this device first (quick starts, works offline), with byte-range support for seeking.
async function savedAudio(req) {
  const cache = await caches.open(AUDIO), hit = await cache.match(new URL(req.url).pathname);
  if (!hit) return fetch(req);
  const range = req.headers.get('range');
  if (!range) return hit;
  const buf = await hit.arrayBuffer(), m = /bytes=(\d*)-(\d*)/.exec(range), size = buf.byteLength;
  let start = m && m[1] ? Number(m[1]) : size - Number(m?.[2] || size), end = m && m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  if (start >= size || start < 0) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  return new Response(buf.slice(start, end + 1), { status: 206, headers: { 'Content-Type': hit.headers.get('content-type') || 'audio/mpeg', 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1), 'Accept-Ranges': 'bytes' } });
}
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('vesper-shell-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (event) => {
  const req = event.request, url = new URL(req.url);
  if (req.method === 'GET' && url.origin === self.location.origin && /^\/api\/audio\/(lc|jm|ts)%3A/i.test(url.pathname)) { event.respondWith(savedAudio(req)); return; }
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  event.respondWith((async () => {
    try {
      const res = await fetch(req, { cache: 'no-store' });
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req.mode === 'navigate' ? '/index.html' : req, copy)).catch(() => {}); }
      return res;
    } catch {
      return (await caches.match(req.mode === 'navigate' ? '/index.html' : req, { cacheName: CACHE })) || Response.error();
    }
  })());
});
