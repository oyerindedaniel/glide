import { WorkerMessageType } from "@/types/renderer";

interface CachedPage {
  width: number;
  height: number;
  bitmap?: ImageBitmap;
  loaded: boolean;
  lastAccessed: number;
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
  | { type: WorkerMessageType.TERMINATE }
  | { type: WorkerMessageType.RENDERED; pageId: string }
  | { type: WorkerMessageType.CACHE_PRUNED; deletedPages: string[] }
  | { type: WorkerMessageType.ERROR; error: string };

let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;
let currentPageId: string | null = null;
let canvasWidth = 0;
let canvasHeight = 0;

const pageCache = new Map<string, CachedPage>();

function pruneCache(): void {
  if (pageCache.size <= 10) return;

  const entries = Array.from(pageCache.entries());
  const sorted = entries.sort((a, b) => a[1].lastAccessed - b[1].lastAccessed);
  const toRemove = sorted
    .filter(([key]) => key !== currentPageId)
    .slice(0, sorted.length - 5);

  const deletedPages: string[] = [];
  toRemove.forEach(([key, page]) => {
    page.bitmap?.close();
    pageCache.delete(key);
    deletedPages.push(key);
  });

  if (deletedPages.length > 0) {
    self.postMessage({ type: WorkerMessageType.CACHE_PRUNED, deletedPages });
  }
}

function clearCanvas(): void {
  if (ctx && canvas) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
}

function renderPage(page: CachedPage): void {
  if (!ctx || !canvas) return;

  clearCanvas();

  const scale = Math.min(
    canvas.width / page.width,
    canvas.height / page.height
  );
  const scaledWidth = page.width * scale;
  const scaledHeight = page.height * scale;

  const x = (canvas.width - scaledWidth) / 2;
  const y = (canvas.height - scaledHeight) / 2;

  ctx.drawImage(page.bitmap!, x, y, scaledWidth, scaledHeight);
}

self.addEventListener("message", async (event: MessageEvent<WorkerMessage>) => {
  const { type } = event.data;

  try {
    switch (type) {
      case WorkerMessageType.INIT: {
        const { canvas: initCanvas, width, height } = event.data;
        canvas = initCanvas;
        ctx = canvas.getContext("2d", { alpha: false });
        if (!ctx) throw new Error("Failed to get canvas context");

        canvasWidth = width || canvas.width;
        canvasHeight = height || canvas.height;
        canvas.width = canvasWidth;
        canvas.height = canvasHeight;
        clearCanvas();
        break;
      }

      case WorkerMessageType.RESIZE: {
        if (!canvas || !ctx) return;
        const { width, height } = event.data;
        canvasWidth = width;
        canvasHeight = height;
        canvas.width = canvasWidth;
        canvas.height = canvasHeight;

        if (currentPageId) {
          const page = pageCache.get(currentPageId);
          if (page && page.bitmap) renderPage(page);
        }
        break;
      }

      case WorkerMessageType.CACHE_IMAGE: {
        const { pageId, url, width, height } = event.data;
        const response = await fetch(url);
        const blob = await response.blob();
        const bitmap = await createImageBitmap(blob);

        pageCache.set(pageId, {
          width,
          height,
          bitmap,
          loaded: true,
          lastAccessed: Date.now(),
        });
        self.postMessage({ type: WorkerMessageType.RENDERED, pageId });

        if (currentPageId === pageId) renderPage(pageCache.get(pageId)!);
        pruneCache();
        break;
      }

      case WorkerMessageType.RENDER_PAGE: {
        const { pageId } = event.data;
        currentPageId = pageId;

        const page = pageCache.get(pageId);
        if (page && page.bitmap) {
          renderPage(page);
          page.lastAccessed = Date.now();
          self.postMessage({ type: WorkerMessageType.RENDERED, pageId });
          pruneCache();
        }
        break;
      }

      case WorkerMessageType.CLEAR_CACHE: {
        pageCache.forEach((page) => page.bitmap?.close());
        pageCache.clear();
        break;
      }

      case WorkerMessageType.TERMINATE: {
        pageCache.forEach((page) => page.bitmap?.close());
        pageCache.clear();
        self.close();
        break;
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    self.postMessage({ type: WorkerMessageType.ERROR, error: errorMessage });
  }
});
