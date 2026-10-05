/* Service worker: caches the app shell + assets so the booth works offline
   once it has been opened once. Bump CACHE_VERSION whenever assets change. */
const CACHE_VERSION = 'photobooth-v7';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/config.js',
  './js/app.js',
  './js/flash.js',
  './vendor/mediapipe/selfie_segmentation.js',
  './vendor/mediapipe/selfie_segmentation.binarypb',
  './vendor/mediapipe/selfie_segmentation.tflite',
  './vendor/mediapipe/selfie_segmentation_landscape.tflite',
  './vendor/mediapipe/selfie_segmentation_solution_simd_wasm_bin.js',
  './vendor/mediapipe/selfie_segmentation_solution_simd_wasm_bin.wasm',
  './vendor/mediapipe/selfie_segmentation_solution_wasm_bin.js',
  './vendor/mediapipe/selfie_segmentation_solution_wasm_bin.wasm',
  './manifest.webmanifest',
  './assets/stamp.png',
  './assets/cursor.gif',
  './assets/frames/classic.png',
  './assets/pokemon/oshawott.png',
  './assets/pokemon/oshawott-guide.png',
  './assets/pokemon/oshawott-icon.png',
  './assets/pokemon/rowlet-icon.png',
  './assets/pokemon/eevee-icon.png',
  './assets/pokemon/gengar-icon.png',
  './assets/fonts/SmoothMarker.ttf',
  './assets/fonts/Pixellari.ttf',
  './assets/fonts/pixelify-sans-latin-400-normal.woff2',
  './assets/fonts/pixelify-sans-latin-600-normal.woff2',
  './assets/fonts/pixelify-sans-latin-700-normal.woff2',
  './assets/icons/icon-180.png',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_VERSION).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network first, fall back to cache (so updates are picked up when online).
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE_VERSION).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
