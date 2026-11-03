/* URA Atendimento — service worker (escopo /CO_URA_ATEND/).
 * Outros apps moram no mesmo endereço (wro1984.github.io): este só mexe nos caches que começam com "co-ura-atend-"
 * e só responde por pedidos dentro do próprio escopo.
 *   - app e dados.json: rede primeiro (sempre atualizados); sem rede, a última cópia (o dados.json fica cifrado);
 *   - hist/… e hoje/…: arquivo de dia ou de hora fechada NUNCA muda (nome novo quando muda) → cache primeiro, num cache
 *     próprio que atravessa versões (o app apaga dele o que saiu da publicação). */
const VERSION = '2.0.0';
const CACHE = 'co-ura-atend-v' + VERSION;
const CACHE_HIST = 'co-ura-atend-hist';
const CORE = ['./', 'index.html', 'cripto.js', 'fonte.js', 'dados.js', 'graf.js', 'historico.js', 'alarmes.js', 'app.js',
  'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('co-ura-atend-v') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  const escopo = new URL(self.registration.scope).pathname;
  if (e.request.method !== 'GET' || url.origin !== location.origin || !url.pathname.startsWith(escopo)) return;
  if (url.pathname.startsWith(escopo + 'hist/') || url.pathname.startsWith(escopo + 'hoje/')) {
    e.respondWith(caches.open(CACHE_HIST).then(c => c.match(e.request).then(r => r || fetch(e.request).then(res => {
      if (res.ok) c.put(e.request, res.clone());
      return res;
    }))));
    return;
  }
  e.respondWith(fetch(e.request, url.pathname.endsWith('/dados.json') ? { cache: 'no-store' } : undefined).then(res => {
    if (res.ok) { const cp = res.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); }
    return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: true, cacheName: CACHE })
    .then(r => r || (e.request.mode === 'navigate' ? caches.match('index.html', { cacheName: CACHE }) : Response.error()))));
});
