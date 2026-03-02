// @ts-nocheck
// CashTrace Service Worker
// Caches critical pages for offline access and queues failed mutations for later sync.
// Requirements: 10.2 (cache critical pages), 10.3 (queue offline actions)

const CACHE_NAME = 'cashtrace-v1';
const OFFLINE_QUEUE_KEY = 'cashtrace-offline-queue';

const CRITICAL_PAGES = [
  '/',
  '/dashboard',
  '/login',
  '/offline',
];

const STATIC_ASSET_EXTENSIONS = [
  '.js',
  '.css',
  '.png',
  '.jpg',
  '.jpeg',
  '.svg',
  '.ico',
  '.woff',
  '.woff2',
];

// --- Install: pre-cache critical pages ---
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CRITICAL_PAGES)),
  );
  self.skipWaiting();
});

// --- Activate: clean old caches ---
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)),
      ),
    ),
  );
  self.clients.claim();
});

// --- Fetch: cache-first for static, network-first for API, queue mutations offline ---
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) {
    return;
  }

  // Mutation requests (POST/PUT/DELETE) — attempt network, queue on failure
  if (['POST', 'PUT', 'DELETE'].includes(request.method)) {
    event.respondWith(handleMutation(request));
    return;
  }

  // API calls — network-first
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Static assets — cache-first
  if (isStaticAsset(url.pathname)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Navigation / pages — network-first with cache fallback
  event.respondWith(networkFirst(request));
});

// --- Message handler for queue processing ---
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'PROCESS_QUEUE') {
    event.waitUntil(processOfflineQueue());
  }
});

// --- Strategies ---

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) {
    return cached;
  }
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (_err) {
    return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
  }
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (_err) {
    const cached = await caches.match(request);
    if (cached) {
      return cached;
    }
    return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
  }
}

async function handleMutation(request) {
  try {
    return await fetch(request);
  } catch (_err) {
    // Clone request data before it's consumed
    const body = await request.text();
    const queueEntry = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      url: request.url,
      method: request.method,
      headers: Object.fromEntries(request.headers.entries()),
      body,
      createdAt: new Date().toISOString(),
      retryCount: 0,
    };

    await addToOfflineQueue(queueEntry);
    notifyClients({ type: 'OFFLINE_ACTION_QUEUED', action: queueEntry });

    return new Response(
      JSON.stringify({ success: false, offline: true, queued: true }),
      {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
}

// --- Offline queue persistence (IndexedDB-free: uses simple cache-based storage) ---

async function getOfflineQueue() {
  const cache = await caches.open(CACHE_NAME);
  const response = await cache.match(OFFLINE_QUEUE_KEY);
  if (!response) {
    return [];
  }
  return response.json();
}

async function saveOfflineQueue(queue) {
  const cache = await caches.open(CACHE_NAME);
  const response = new Response(JSON.stringify(queue), {
    headers: { 'Content-Type': 'application/json' },
  });
  await cache.put(OFFLINE_QUEUE_KEY, response);
}

async function addToOfflineQueue(entry) {
  const queue = await getOfflineQueue();
  queue.push(entry);
  await saveOfflineQueue(queue);
}

async function processOfflineQueue() {
  const queue = await getOfflineQueue();
  if (queue.length === 0) {
    return;
  }

  const remaining = [];

  for (const entry of queue) {
    try {
      await fetch(entry.url, {
        method: entry.method,
        headers: entry.headers,
        body: entry.body || undefined,
      });
    } catch (_err) {
      entry.retryCount += 1;
      remaining.push(entry);
    }
  }

  await saveOfflineQueue(remaining);

  const synced = queue.length - remaining.length;
  if (synced > 0) {
    notifyClients({ type: 'QUEUE_SYNCED', syncedCount: synced, remainingCount: remaining.length });
  }
}

function notifyClients(message) {
  self.clients.matchAll().then((clients) => {
    clients.forEach((client) => client.postMessage(message));
  });
}

function isStaticAsset(pathname) {
  return STATIC_ASSET_EXTENSIONS.some((ext) => pathname.endsWith(ext));
}
