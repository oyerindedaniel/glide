import { WorkerMessageType } from "@/classes/manga-reader-renderer";

interface CachedPage {
  width: number;
  height: number;
  bitmap?: ImageBitmap;
  loaded: boolean;
}

type WorkerMessage =
  | {
      type: WorkerMessageType.INIT;
      canvas: OffscreenCanvas;
      width: number;
      height: number;
    }
  | { type: WorkerMessageType.RESIZE; width: number; height: number }
  | {
      type: WorkerMessageType.CACHE_IMAGE;
      pageId: string;
      url: string;
      width: number;
      height: number;
    }
  | { type: WorkerMessageType.RENDER_PAGE; pageId: string }
  | { type: WorkerMessageType.CLEAR_CACHE }
  | { type: WorkerMessageType.RENDERED; pageId: string }
  | { type: WorkerMessageType.ERROR; error: string };

let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;
let currentPageId: string | null = null;
let canvasWidth = 0;
let canvasHeight = 0;

const pageCache = new Map<string, CachedPage>();

self.addEventListener("message", async (event: MessageEvent<WorkerMessage>) => {
  const { type } = event.data;

  try {
    switch (type) {
      case WorkerMessageType.INIT:
        initCanvas(
          event.data as Extract<WorkerMessage, { type: WorkerMessageType.INIT }>
        );
        break;

      case WorkerMessageType.RESIZE:
        handleResize(
          event.data as Extract<
            WorkerMessage,
            { type: WorkerMessageType.RESIZE }
          >
        );
        break;

      case WorkerMessageType.CACHE_IMAGE:
        await cacheImage(
          event.data as Extract<
            WorkerMessage,
            { type: WorkerMessageType.CACHE_IMAGE }
          >
        );
        break;

      case WorkerMessageType.RENDER_PAGE:
        renderPage(
          event.data as Extract<
            WorkerMessage,
            { type: WorkerMessageType.RENDER_PAGE }
          >
        );
        break;

      case WorkerMessageType.CLEAR_CACHE:
        clearCache();
        break;
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    self.postMessage({ type: WorkerMessageType.ERROR, error: errorMessage });
  }
});

/**
 * Initialize the offscreen canvas
 */
function initCanvas(
  data: Extract<WorkerMessage, { type: WorkerMessageType.INIT }>
): void {
  canvas = data.canvas;
  ctx = canvas.getContext("2d", { alpha: false });

  if (!ctx) {
    throw new Error("Failed to get canvas context");
  }

  canvasWidth = data.width || canvas.width;
  canvasHeight = data.height || canvas.height;

  canvas.width = canvasWidth;
  canvas.height = canvasHeight;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

/**
 * Handle canvas resize
 */
function handleResize(
  data: Extract<WorkerMessage, { type: WorkerMessageType.RESIZE }>
): void {
  if (!canvas || !ctx) return;

  canvasWidth = data.width;
  canvasHeight = data.height;

  canvas.width = canvasWidth;
  canvas.height = canvasHeight;

  if (currentPageId) {
    renderPageById(currentPageId);
  }
}

/**
 * Cache an image for a page
 */
async function cacheImage(
  data: Extract<WorkerMessage, { type: WorkerMessageType.CACHE_IMAGE }>
): Promise<void> {
  const { pageId, url, width, height } = data;

  try {
    const response = await fetch(url);
    const blob = await response.blob();

    const bitmap = await createImageBitmap(blob);

    pageCache.set(pageId, {
      width,
      height,
      bitmap,
      loaded: true,
    });

    self.postMessage({ type: WorkerMessageType.RENDERED, pageId });

    if (currentPageId === pageId) {
      renderPageById(pageId);
    }

    if (pageCache.size > 10) {
      cleanupCache();
    }
  } catch (error) {
    console.error("Error caching image:", error);
    throw error;
  }
}

/**
 * Render a page from the message data
 */
function renderPage(
  data: Extract<WorkerMessage, { type: WorkerMessageType.RENDER_PAGE }>
): void {
  const { pageId } = data;
  currentPageId = pageId;
  renderPageById(pageId);
}

/**
 * Render a specific page by its ID
 */
function renderPageById(pageId: string): void {
  if (!canvas || !ctx || !pageId) return;

  const page = pageCache.get(pageId);
  if (!page || !page.bitmap) return;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Calculate centered position and scaling
  const scale = Math.min(
    canvas.width / page.width,
    canvas.height / page.height
  );

  const scaledWidth = page.width * scale;
  const scaledHeight = page.height * scale;

  const x = (canvas.width - scaledWidth) / 2;
  const y = (canvas.height - scaledHeight) / 2;

  // Draw image
  ctx.drawImage(page.bitmap, x, y, scaledWidth, scaledHeight);

  self.postMessage({ type: WorkerMessageType.RENDERED, pageId });
}

/**
 * Clear the image cache
 */
function clearCache(): void {
  for (const page of pageCache.values()) {
    if (page.bitmap) {
      page.bitmap.close();
    }
  }

  pageCache.clear();
}

/**
 * Cleanup the least recently used items from cache
 */
function cleanupCache(): void {
  if (pageCache.size <= 5) return;

  const entries = Array.from(pageCache.entries());

  // Sort by distance from current page
  const sorted = entries.sort((a, b) => {
    // Keep current page
    if (a[0] === currentPageId) return 1;
    if (b[0] === currentPageId) return -1;

    // Otherwise sort by pageId (simple approach)
    return a[0].localeCompare(b[0]);
  });

  // Remove oldest entries
  const toRemove = sorted.slice(0, sorted.length - 5);
  for (const [key, page] of toRemove) {
    if (page.bitmap) {
      page.bitmap.close();
    }
    pageCache.delete(key);
  }
}
