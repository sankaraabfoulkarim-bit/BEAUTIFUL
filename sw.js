// ==================== SERVICE WORKER — Dashboard Pro ====================
// Stratégie : Cache First pour assets statiques, Network First pour Firebase

const CACHE_NAME = 'dashboard-pro-v2';
const STATIC_CACHE = 'dashboard-static-v2';

// Assets à mettre en cache immédiatement à l'installation
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  // Firebase SDKs (mis en cache pour fonctionner offline)
  'https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore-compat.js',
  // Police Google Fonts
  'https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&display=swap'
];

// ==================== INSTALLATION ====================
self.addEventListener('install', (event) => {
  console.log('[SW] Installation v2');
  event.waitUntil(
    caches.open(STATIC_CACHE).then(async (cache) => {
      // On essaie de mettre en cache chaque asset individuellement
      // pour qu'un échec ne bloque pas tout
      const results = await Promise.allSettled(
        STATIC_ASSETS.map(url => cache.add(url).catch(e => {
          console.warn('[SW] Impossible de mettre en cache:', url, e.message);
        }))
      );
      console.log('[SW] Assets en cache:', results.filter(r => r.status === 'fulfilled').length, '/', STATIC_ASSETS.length);
    })
  );
  // Prendre le contrôle immédiatement sans attendre le rechargement
  self.skipWaiting();
});

// ==================== ACTIVATION ====================
self.addEventListener('activate', (event) => {
  console.log('[SW] Activation');
  event.waitUntil(
    caches.keys().then(async (keys) => {
      // Supprimer les anciens caches
      await Promise.all(
        keys
          .filter(key => key !== STATIC_CACHE && key !== CACHE_NAME)
          .map(key => {
            console.log('[SW] Suppression ancien cache:', key);
            return caches.delete(key);
          })
      );
    })
  );
  // Prendre le contrôle de tous les onglets ouverts
  self.clients.claim();
});

// ==================== STRATÉGIE DE FETCH ====================
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 1. Requêtes Firebase Auth/Firestore → Network Only (jamais en cache)
  if (
    url.hostname.includes('firestore.googleapis.com') ||
    url.hostname.includes('identitytoolkit.googleapis.com') ||
    url.hostname.includes('securetoken.googleapis.com')
  ) {
    event.respondWith(fetch(request));
    return;
  }

  // 2. Firebase SDK scripts → Cache First (ils changent peu)
  if (url.hostname === 'www.gstatic.com') {
    event.respondWith(cacheFirst(request));
    return;
  }

  // 3. Google Fonts → Cache First
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(request));
    return;
  }

  // 4. Assets locaux (HTML, JS, CSS, images) → Cache First avec fallback réseau
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirstWithNetworkFallback(request));
    return;
  }

  // 5. Tout le reste → Network avec fallback cache
  event.respondWith(networkFirstWithCacheFallback(request));
});

// ==================== STRATÉGIES ====================

// Cache First : cherche dans le cache, sinon réseau et met en cache
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(STATIC_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch(e) {
    return offlineFallback(request);
  }
}

// Cache First pour assets locaux, avec mise à jour en arrière-plan (stale-while-revalidate)
async function cacheFirstWithNetworkFallback(request) {
  const cached = await caches.match(request);
  const networkFetch = fetch(request).then(response => {
    if (response.ok) {
      const cache = caches.open(STATIC_CACHE);
      cache.then(c => c.put(request, response.clone()));
    }
    return response;
  }).catch(() => null);

  return cached || await networkFetch || offlineFallback(request);
}

// Network First : essaie le réseau, sinon cache
async function networkFirstWithCacheFallback(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch(e) {
    const cached = await caches.match(request);
    return cached || offlineFallback(request);
  }
}

// Page de fallback hors-ligne
function offlineFallback(request) {
  if (request.destination === 'document') {
    return caches.match('/index.html');
  }
  // Pour les autres ressources, retourner une réponse vide acceptable
  return new Response('', { status: 408, statusText: 'Hors ligne' });
}

// ==================== MESSAGES DEPUIS L'APP ====================
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data === 'GET_VERSION') {
    event.ports[0].postMessage({ version: CACHE_NAME });
  }
});

// ==================== NOTIFICATIONS PUSH (optionnel) ====================
self.addEventListener('push', (event) => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title || 'Dashboard Pro', {
      body: data.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: data.tag || 'default',
      data: data.url || '/'
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow(event.notification.data || '/')
  );
});
