// Scanner di sagome: funziona anche senza rete. Cambia VERSIONE a ogni aggiornamento dei file.
const VERSIONE = 'sagome-v1';
const FILE = ['./', 'index.html', 'core.js', 'lines.js', 'shape.js', 'cv.js', 'aruco.js', 'example.jpg',
  'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSIONE).then(c => c.addAll(FILE)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.filter(n => n !== VERSIONE).map(n => caches.delete(n)))).then(() => self.clients.claim()));
});
// prima la rete (così gli aggiornamenti arrivano), se manca la rete la copia salvata
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request).then(r => {
    const copia = r.clone(); caches.open(VERSIONE).then(c => c.put(e.request, copia)); return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
