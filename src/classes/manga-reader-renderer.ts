import { ProcessingStatus } from "@/store/processed-files";
import { WorkerMessageType } from "@/types/renderer";

const BUFFER_SIZE = 3;
const RENDER_QUALITY = 1.0;

class MangaReaderRenderer {
  private canvas: HTMLCanvasElement;
  private context: CanvasRenderingContext2D | null = null;
  private worker: Worker | null = null;
  private observer: IntersectionObserver;
  private pageContainers: Map<string, HTMLDivElement> = new Map();
  private loadedPages: Set<string> = new Set();
  private currentPageId: string | null = null; // Track the current page ID
  private visiblePages: Set<string> = new Set();
  private loadingQueue: string[] = [];
  private parentRef: HTMLElement; // Store the parent element
  private pageCanvases: Map<string, HTMLCanvasElement> = new Map();
  private pageDimensions: Map<string, { width: number; height: number }> =
    new Map(); // Store image dimensions
  private resizeHandler: () => void;

  constructor(canvasContainer: HTMLElement = document.body) {
    // Default to document.body if no parentRef is provided
    this.parentRef = canvasContainer;

    this.canvas = document.createElement("canvas");
    this.canvas.className = "manga-reader-canvas";
    this.canvas.style.boxSizing = "border-box";
    this.parentRef.appendChild(this.canvas);

    this.observer = new IntersectionObserver(
      this.handleIntersection.bind(this),
      {
        root: null,
        rootMargin: "200px",
        threshold: 0.1,
      }
    );

    if (window.OffscreenCanvas && window.Worker) {
      this.initWorker();
    } else {
      this.context = this.canvas.getContext("2d", { alpha: false });
    }

    this.resizeHandler = this.handleResize.bind(this);
    window.addEventListener("resize", this.resizeHandler);
    this.handleResize();
  }

  private initWorker(): void {
    try {
      this.worker = new Worker(
        new URL("../worker/canvas.worker.ts", import.meta.url)
      );
      const offscreen = this.canvas.transferControlToOffscreen();
      this.worker.postMessage(
        {
          type: WorkerMessageType.INIT,
          canvas: offscreen,
          width: this.canvas.width,
          height: this.canvas.height,
        },
        [offscreen]
      );
      this.worker.addEventListener("message", (event) => {
        const { type, pageId } = event.data;
        if (type === WorkerMessageType.RENDERED && pageId) {
          this.onPageRendered(pageId);
        } else if (type === WorkerMessageType.ERROR) {
          console.error("Worker error:", event.data.error);
        }
      });
    } catch (err) {
      console.warn("Offscreen canvas worker initialization failed:", err);
      this.worker = null;
    }
  }

  private handleResize(): void {
    const containerWidth = Math.floor(
      this.parentRef.clientWidth || window.innerWidth
    );
    let newHeight = window.innerHeight;

    // If there's a current page, adjust height based on its aspect ratio
    if (this.currentPageId) {
      const dimensions = this.pageDimensions.get(this.currentPageId);
      if (dimensions) {
        const aspectRatio = dimensions.height / dimensions.width;
        newHeight = Math.floor(containerWidth * aspectRatio);
      }
    }

    if (this.worker) {
      this.worker.postMessage({
        type: WorkerMessageType.RESIZE,
        width: containerWidth,
        height: newHeight,
      });
    } else {
      this.canvas.width = containerWidth;
      this.canvas.height = newHeight;
    }
    this.renderVisiblePages();
  }

  public render(
    allPages: Array<{
      fileName: string;
      pageNumber: number;
      url: string;
      status: ProcessingStatus;
    }>
  ): void {
    this.pageContainers.clear();
    this.loadedPages.clear();
    this.visiblePages.clear();

    const scrollContainer = document.createElement("div");
    scrollContainer.className = "manga-scroll-container";
    scrollContainer.style.position = "absolute";
    scrollContainer.style.top = "0";
    scrollContainer.style.left = "0";
    scrollContainer.style.width = "100%";
    scrollContainer.style.height = "100%";
    scrollContainer.style.zIndex = "-1";
    scrollContainer.style.visibility = "hidden";
    this.parentRef.appendChild(scrollContainer);

    allPages.forEach(({ fileName, pageNumber, url, status }) => {
      const pageId = `${fileName}_${pageNumber}`;
      const pageEl = document.createElement("div");
      pageEl.id = `page-${pageId}`;
      pageEl.dataset.pageId = pageId;
      pageEl.dataset.url = url || "";
      pageEl.dataset.status = status;
      pageEl.className = "manga-page-placeholder";
      pageEl.style.height = "100svh";
      pageEl.style.width = "100%";

      scrollContainer.appendChild(pageEl);
      this.pageContainers.set(pageId, pageEl);
      this.observer.observe(pageEl);
    });

    // this.currentPageId = allPages[0]?.fileName + "_" + allPages[0]?.pageNumber;

    const initialPages = allPages
      .filter(({ status, url }) => status === ProcessingStatus.COMPLETED && url)
      .slice(0, BUFFER_SIZE);

    initialPages.forEach(({ fileName, pageNumber, url }) => {
      const pageId = `${fileName}_${pageNumber}`;
      this.enqueuePageLoad(pageId, url);
    });

    this.processLoadingQueue();
    this.checkVisiblePages();
  }

  public updatePages(
    allPages: Array<{
      fileName: string;
      pageNumber: number;
      url: string;
      status: ProcessingStatus;
    }>
  ): void {
    const scrollContainer = this.parentRef.querySelector(
      ".manga-scroll-container"
    );
    if (!scrollContainer) return;

    allPages.forEach(({ fileName, pageNumber, url, status }) => {
      const pageId = `${fileName}_${pageNumber}`;
      const existingPageEl = this.pageContainers.get(pageId);

      if (existingPageEl) {
        const currentStatus = existingPageEl.dataset.status as ProcessingStatus;
        const currentUrl = existingPageEl.dataset.url || "";
        if (status !== currentStatus || url !== currentUrl) {
          existingPageEl.dataset.status = status;
          existingPageEl.dataset.url = url || "";
          if (
            status === ProcessingStatus.COMPLETED &&
            url &&
            !this.loadedPages.has(pageId)
          ) {
            this.enqueuePageLoad(pageId, url);
          }
        }
      } else {
        const pageEl = document.createElement("div");
        pageEl.id = `page-${pageId}`;
        pageEl.dataset.pageId = pageId;
        pageEl.dataset.url = url || "";
        pageEl.dataset.status = status;
        pageEl.className = "manga-page-placeholder";
        pageEl.style.height = "100svh";
        pageEl.style.width = "100%";

        scrollContainer.appendChild(pageEl);
        this.pageContainers.set(pageId, pageEl);
        this.observer.observe(pageEl);

        if (status === ProcessingStatus.COMPLETED && url) {
          this.enqueuePageLoad(pageId, url);
        }
      }
    });

    this.processLoadingQueue();
    this.renderVisiblePages();
  }

  private handleIntersection(entries: IntersectionObserverEntry[]): void {
    let needsRender = false;

    entries.forEach((entry) => {
      const pageEl = entry.target as HTMLDivElement;
      const pageId = pageEl.dataset.pageId;
      const url = pageEl.dataset.url || "";
      const status = pageEl.dataset.status as ProcessingStatus;

      if (!pageId) return;

      if (entry.isIntersecting) {
        this.visiblePages.add(pageId);
        if (status === ProcessingStatus.COMPLETED && url) {
          this.enqueuePageLoad(pageId, url);
        }
        needsRender = true;
      } else {
        this.visiblePages.delete(pageId);
      }
    });

    console.log({ visiblePagesAddedFromObserver: this.visiblePages });

    if (needsRender) {
      this.processLoadingQueue();
      this.renderVisiblePages();
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private enqueuePageLoad(pageId: string, url: string): void {
    if (this.loadedPages.has(pageId) || this.loadingQueue.includes(pageId))
      return;
    this.loadingQueue.push(pageId);
    if (this.loadingQueue.length > BUFFER_SIZE * 2) {
      this.loadingQueue = this.loadingQueue.slice(-BUFFER_SIZE * 2);
    }
  }

  private async processLoadingQueue(): Promise<void> {
    const toProcess = this.loadingQueue.slice(0, BUFFER_SIZE);
    this.loadingQueue = this.loadingQueue.filter(
      (id) => !toProcess.includes(id)
    );

    // console.log({ toProcess, loadingQueue: this.loadingQueue });

    for (const pageId of toProcess) {
      const pageEl = this.pageContainers.get(pageId);
      if (!pageEl || this.loadedPages.has(pageId)) continue;
      const url = pageEl.dataset.url;
      if (!url) continue;
      try {
        await this.loadAndCacheImage(pageId, url);
      } catch (err) {
        console.error(`Failed to load image for page ${pageId}:`, err);
      }
    }
  }

  private async loadAndCacheImage(pageId: string, url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        // Store image dimensions
        this.pageDimensions.set(pageId, {
          width: img.width,
          height: img.height,
        });

        if (this.worker) {
          this.worker.postMessage({
            type: WorkerMessageType.CACHE_IMAGE,
            pageId,
            url,
            width: img.width,
            height: img.height,
          });
        } else {
          this.drawImageToCanvas(pageId, img);
        }
        // this.loadedPages.add(pageId);
        resolve();
      };
      img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
      img.src = url;
    });
  }

  private drawImageToCanvas(pageId: string, img: HTMLImageElement): void {
    if (!this.context) return;
    const memCanvas = document.createElement("canvas");
    memCanvas.width = img.width;
    memCanvas.height = img.height;
    const memCtx = memCanvas.getContext("2d");
    if (memCtx) {
      memCtx.drawImage(img, 0, 0);
      this.pageCanvases.set(pageId, memCanvas);
      this.onPageRendered(pageId);
    }
  }

  private onPageRendered(pageId: string): void {
    this.loadedPages.add(pageId);
    if (this.visiblePages.has(pageId)) {
      this.renderVisiblePages();
    }
  }

  private renderVisiblePages(): void {
    const visibleLoadedPages = Array.from(this.visiblePages).filter((pageId) =>
      this.loadedPages.has(pageId)
    );
    if (visibleLoadedPages.length === 0) return;

    const centerPage = this.determineCurrentPage(visibleLoadedPages);

    console.log("visibleLoadedPages", { visibleLoadedPages, centerPage });

    if (centerPage === this.currentPageId) {
      return;
    }

    this.currentPageId = centerPage;
    const dimensions = this.pageDimensions.get(centerPage);
    if (dimensions) {
      const containerWidth = Math.floor(
        this.parentRef.clientWidth || window.innerWidth
      );
      const aspectRatio = dimensions.height / dimensions.width;
      const newHeight = Math.floor(containerWidth * aspectRatio);

      if (this.worker) {
        this.worker.postMessage({
          type: WorkerMessageType.RESIZE,
          width: containerWidth,
          height: newHeight,
        });
      } else {
        this.canvas.width = containerWidth;
        this.canvas.height = newHeight;
      }
    }

    if (this.worker) {
      this.worker.postMessage({
        type: WorkerMessageType.RENDER_PAGE,
        pageId: centerPage,
      });
    } else if (this.context) {
      this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
      const memCanvas = this.pageCanvases.get(centerPage);
      if (memCanvas) {
        const scale = Math.min(
          this.canvas.width / memCanvas.width,
          this.canvas.height / memCanvas.height
        );
        const scaledWidth = memCanvas.width * scale;
        const scaledHeight = memCanvas.height * scale;
        const x = (this.canvas.width - scaledWidth) / 2;
        const y = (this.canvas.height - scaledHeight) / 2;
        this.context.drawImage(memCanvas, x, y, scaledWidth, scaledHeight);
      }
    }
  }

  private determineCurrentPage(visiblePageIds: string[]): string {
    if (visiblePageIds.length === 0) return "";
    let bestVisibility = -1;
    let bestPageId = visiblePageIds[0];
    for (const pageId of visiblePageIds) {
      const el = this.pageContainers.get(pageId);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      const visibleArea =
        Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0);
      if (visibleArea > bestVisibility) {
        bestVisibility = visibleArea;
        bestPageId = pageId;
      }
    }
    return bestPageId;
  }

  private checkVisiblePages(): void {
    const viewportHeight = window.innerHeight;
    this.pageContainers.forEach((pageEl, pageId) => {
      const rect = pageEl.getBoundingClientRect();
      const isVisible = rect.top < viewportHeight && rect.bottom > 0;

      console.log("checkVisiblePages", { pageId, isVisible });
      // Check if at least 20% of the page is visible
      //   const pageHeight = rect.height;
      //   const visibleThreshold = pageHeight * 0.2;

      //   const isVisible =
      //     rect.top < viewportHeight - visibleThreshold &&
      //     rect.bottom > visibleThreshold;

      if (isVisible) {
        this.visiblePages.add(pageId);
        const url = pageEl.dataset.url || "";
        const status = pageEl.dataset.status as ProcessingStatus;
        if (status === ProcessingStatus.COMPLETED && url) {
          this.enqueuePageLoad(pageId, url);
        }
      }
    });
    this.processLoadingQueue();
    this.renderVisiblePages();
  }

  public dispose(): void {
    this.observer.disconnect();
    // if (this.worker) {
    //   this.worker.postMessage({
    //     type: WorkerMessageType.CLEAR_CACHE,
    //   });
    //   this.worker.terminate();
    //   this.worker = null;
    // }
    if (this.worker) {
      this.worker.postMessage({
        type: WorkerMessageType.TERMINATE,
      });
      this.worker = null;
    }
    this.loadedPages.clear();
    this.visiblePages.clear();
    this.pageCanvases.clear();
    this.pageContainers.clear();
    this.pageDimensions.clear();
    this.loadingQueue = [];

    if (this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas);
    }

    const scrollContainers = this.parentRef.querySelectorAll(
      ".manga-scroll-container"
    );
    scrollContainers.forEach((container) => {
      if (container.parentNode) {
        container.parentNode.removeChild(container);
      }
    });

    window.removeEventListener("resize", this.resizeHandler);
  }
}

export { MangaReaderRenderer };
