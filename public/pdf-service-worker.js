// PDF.js Service Worker
// This service worker caches and serves PDF.js library files

// Cache name for storing PDF.js files
const CACHE_NAME = "pdf-js-cache-v1";

// Standard configuration for PDF.js that will be made globally available
self.CMAP_URL = "/pdfjs/cmaps/";
self.CMAP_PACKED = true;
self.STANDARD_FONT_DATA_URL = "/pdfjs/standard_fonts/";

// Install event - cache all PDF.js files
self.addEventListener("install", function (event) {
  console.log("[PDF Service Worker] Installing...");
  self.skipWaiting(); // Activate immediately

  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll([
        // Main PDF.js files
        "/pdfjs/pdf.js",
        "/pdfjs/pdf.worker.js",
        "/pdfjs/pdf.min.js",
        "/pdfjs/pdf.worker.min.js",
        // We'll let the other files be cached as they are requested
      ]);
    })
  );
});

// Activate event - clean up old caches and take control
self.addEventListener("activate", function (event) {
  console.log("[PDF Service Worker] Activating...");
  event.waitUntil(
    caches
      .keys()
      .then(function (cacheNames) {
        return Promise.all(
          cacheNames
            .filter(function (name) {
              return name !== CACHE_NAME;
            })
            .map(function (name) {
              return caches.delete(name);
            })
        );
      })
      .then(function () {
        return self.clients.claim(); // Take control of clients immediately
      })
  );
});

// Intercept fetch requests
self.addEventListener("fetch", function (event) {
  const url = new URL(event.request.url);

  // Only handle requests for PDF.js files
  if (url.pathname.startsWith("/pdfjs/")) {
    console.log("[PDF Service Worker] Handling request for:", url.pathname);

    event.respondWith(
      caches.match(event.request).then(function (cachedResponse) {
        // Return cached version if available
        if (cachedResponse) {
          console.log("[PDF Service Worker] Serving from cache:", url.pathname);
          return cachedResponse;
        }

        // Otherwise fetch and cache
        console.log("[PDF Service Worker] Fetching:", url.pathname);
        return fetch(event.request).then(function (response) {
          // Don't cache non-successful responses
          if (!response.ok) {
            console.error(
              "[PDF Service Worker] Fetch failed:",
              url.pathname,
              response.status
            );
            return response;
          }

          // Cache a copy of the response
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put(event.request, responseToCache);
            console.log("[PDF Service Worker] Cached:", url.pathname);
          });

          return response;
        });
      })
    );
  }
});

// Listen for messages from clients
self.addEventListener("message", function (event) {
  if (event.data && event.data.type === "CLEAR_CACHE") {
    console.log("[PDF Service Worker] Clearing cache by request");
    event.waitUntil(
      caches.delete(CACHE_NAME).then(function () {
        console.log("[PDF Service Worker] Cache cleared");
      })
    );
  }
});
