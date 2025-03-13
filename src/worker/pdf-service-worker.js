// PDF.js Service Worker
// This Service Worker loads PDF.js once and makes it available to multiple workers

// Load PDF.js library from local node_modules instead of CDN
importScripts(
  new URL(
    "../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
    import.meta.url
  ).href
);

// Define paths for PDF.js resources
const CMAP_URL = new URL("../../node_modules/pdfjs-dist/cmaps", import.meta.url)
  .href;
const CMAP_PACKED = true;
const STANDARD_FONT_DATA_URL = new URL(
  "../../node_modules/pdfjs-dist/standard_fonts",
  import.meta.url
).href;

// Cache name for storing PDF.js and processed pages
const CACHE_NAME = "pdf-processing-cache-v1";

// Install event - cache the PDF.js library
self.addEventListener("install", (event) => {
  console.log("[PDF Service Worker] Installing...");
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll([
        // Cache the PDF.js library resources
        new URL(
          "../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
          import.meta.url
        ).href,
        new URL(
          "../../node_modules/pdfjs-dist/legacy/build/pdf.mjs",
          import.meta.url
        ).href,
        // Also cache common cmaps
        `${CMAP_URL}/Adobe-GB1-UCS2.bcmap`,
        `${CMAP_URL}/Adobe-CNS1-UCS2.bcmap`,
        `${CMAP_URL}/Adobe-Japan1-UCS2.bcmap`,
        `${CMAP_URL}/Adobe-Korea1-UCS2.bcmap`,
      ]);
    })
  );
});

// Activate event - clean up old caches
self.addEventListener("activate", (event) => {
  console.log("[PDF Service Worker] Activating...");
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => {
            return name !== CACHE_NAME;
          })
          .map((name) => {
            return caches.delete(name);
          })
      );
    })
  );
});

// Intercept fetch requests
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Intercept requests for PDF.js library wrapper
  if (url.pathname.endsWith("/pdf-worker-lib")) {
    console.log("[PDF Service Worker] Serving PDF library wrapper");

    // Create a document-like object for PDF.js
    const documentLike = `{
      fonts: self.fonts,
      createElement: function(name) {
        if (name === 'canvas') {
          return new OffscreenCanvas(1, 1);
        }
        return null;
      }
    }`;

    // Provide the PDF.js library as a module to workers
    event.respondWith(
      new Response(
        `
        // PDF.js library wrapper provided by Service Worker
        // This exposes the PDF.js API to web workers
        
        // Configuration for PDF.js
        const CMAP_URL = "${CMAP_URL}";
        const CMAP_PACKED = ${CMAP_PACKED};
        const STANDARD_FONT_DATA_URL = "${STANDARD_FONT_DATA_URL}";
        
        // Document-like object for PDF.js
        const document = ${documentLike};
        
        // Main PDF.js functionality
        self.pdfjsLib = {
          getDocument: function(options) {
            // Add all the required parameters
            const fullOptions = {
              ...options,
              ownerDocument: document,
              useWorkerFetch: true,
              cMapUrl: CMAP_URL,
              cMapPacked: CMAP_PACKED,
              standardFontDataUrl: STANDARD_FONT_DATA_URL
            };
            
            return ${self.pdfjsLib.getDocument.toString()}(fullOptions);
          },
          GlobalWorkerOptions: ${JSON.stringify(
            self.pdfjsLib.GlobalWorkerOptions
          )},
          // Add other needed APIs here
        };
        
        // Canvas factory for rendering
        self.OffscreenCanvasFactory = class {
          create(width, height) {
            const canvas = new OffscreenCanvas(width, height);
            const context = canvas.getContext('2d');
            return { canvas, context };
          }
          
          reset(canvasAndContext, width, height) {
            canvasAndContext.canvas.width = width;
            canvasAndContext.canvas.height = height;
          }
          
          destroy(canvasAndContext) {
            // No-op; cleanup handled by garbage collection
          }
        };
        
        console.log('[PDF Worker] PDF.js library loaded from Service Worker with complete configuration');
        `,
        {
          headers: {
            "Content-Type": "application/javascript",
            "Service-Worker-Allowed": "/",
          },
        }
      )
    );
    return;
  }

  // Handle requests for resources in node_modules
  if (url.pathname.includes("/node_modules/pdfjs-dist/")) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        // Return cached version if available
        if (cachedResponse) {
          return cachedResponse;
        }

        // Otherwise fetch and cache
        return fetch(event.request).then((response) => {
          // Cache a copy of the response
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
          return response;
        });
      })
    );
    return;
  }

  // Handle other requests (like PDF page caching if needed)
  if (url.pathname.startsWith("/pdf-cache/")) {
    // Cache handling for processed PDF pages could go here
    // This would allow for persistent caching of processed pages
  }
});

// Listen for messages from clients (like cache invalidation)
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "CLEAR_PDF_CACHE") {
    console.log("[PDF Service Worker] Clearing cache by request");
    event.waitUntil(
      caches.delete(CACHE_NAME).then(() => {
        console.log("[PDF Service Worker] Cache cleared");
      })
    );
  }
});
