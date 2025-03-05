import { ProcessingStatus } from "@/store/processed-files";
import { WorkerMessageType } from "@/types/renderer";

const BUFFER_SIZE = 3; // Number of pages to load at a time
const PRELOAD_AHEAD = 2; // Number of pages to preload ahead
const RENDER_QUALITY = 1.0;
const DEFAULT_ASPECT_RATIO = 1.5; // Default for initial placeholder heights

class MangaReaderRenderer {
  private canvas: HTMLCanvasElement;
  private context: CanvasRenderingContext2D | null = null;
  private worker: Worker | null = null;
  private observer: IntersectionObserver;
  private pageContainers: Map<string, HTMLDivElement> = new Map();
  private loadedPages: Set<string> = new Set();
  private loadingQueueInProgress: Set<string> = new Set();
  private currentPageId: string | null = null;
  private visiblePages: Set<string> = new Set();
  private loadingQueue: string[] = [];
  private parentRef: HTMLElement;
  private pageDimensions: Map<string, { width: number; height: number }> =
    new Map();
  private resizeHandler: () => void;
  private scrollHandler: () => void;

  constructor(canvasContainer: HTMLElement = document.body) {
    this.parentRef = canvasContainer;

    // Initialize canvas
    this.canvas = document.createElement("canvas");
    this.canvas.className = "manga-reader-canvas";
    this.canvas.style.position = "sticky";
    this.canvas.style.top = "0";
    this.canvas.style.left = "0";
    this.canvas.style.zIndex = "1";
    this.canvas.style.transform = "translate3d(0, 0, 0)";
    this.canvas.style.willChange = "transform";
    this.parentRef.appendChild(this.canvas);

    // Intersection Observer with tight rootMargin for center page detection
    this.observer = new IntersectionObserver(
      this.handleIntersection.bind(this),
      {
        root: null,
        rootMargin: "0px",
        threshold: [0, 0.1, 0.5, 0.9, 1], // Multiple thresholds for precise center detection
      }
    );

    // Initialize rendering backend
    if (window.OffscreenCanvas && window.Worker) {
      this.initWorker();
    } else {
      this.context = this.canvas.getContext("2d", { alpha: false });
    }

    // Event handlers
    this.resizeHandler = this.handleResize.bind(this);
    this.scrollHandler = this.handleScroll.bind(this);
    window.addEventListener("resize", this.resizeHandler);
    this.parentRef.addEventListener("scroll", this.scrollHandler);
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
        const { type, pageId, deletedPages } = event.data;
        if (type === WorkerMessageType.RENDERED && pageId) {
          this.onPageRendered(pageId);
        } else if (type === WorkerMessageType.CACHE_PRUNED && deletedPages) {
          console.log("Pruned pages:", deletedPages);
          deletedPages.forEach((id: string) => this.loadedPages.delete(id));
        } else if (type === WorkerMessageType.ERROR) {
          console.error("Worker error:", event.data.error);
        }
      });
    } catch (err) {
      console.warn("Offscreen canvas worker initialization failed:", err);
      this.worker = null;
      this.context = this.canvas.getContext("2d", { alpha: false });
    }
  }

  private handleResize(): void {
    const containerWidth = Math.floor(
      this.parentRef.clientWidth || window.innerWidth
    );
    let newHeight = window.innerHeight;

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

    // Update all placeholder heights
    this.pageContainers.forEach((pageEl, pageId) => {
      const dimensions = this.pageDimensions.get(pageId);
      if (dimensions) {
        const aspectRatio = dimensions.height / dimensions.width;
        const placeholderHeight = containerWidth * aspectRatio;
        pageEl.style.height = `${Math.floor(placeholderHeight)}px`;
      }
    });

    this.renderVisiblePages();
  }

  private handleScroll(): void {
    if (!this.currentPageId) return;
    const placeholder = this.pageContainers.get(this.currentPageId);
    if (!placeholder) return;

    const rect = placeholder.getBoundingClientRect();
    const offsetY = rect.top;

    console.log({
      canvasheight: this.canvas.height,
      windowheight: window.innerHeight,
      offsetY,
    });

    // Apply translation only if canvas is taller than viewport and scrolling has occurred
    if (this.canvas.height > window.innerHeight && offsetY < 0) {
      // Cap the translation at the hidden section’s size
      const maxOffset = Math.max(
        offsetY,
        -(this.canvas.height - window.innerHeight)
      );
      console.log({ maxOffset });
      this.canvas.style.transform = `translate3d(0, ${maxOffset}px, 0)`;
    } else {
      // No translation if canvas fits in viewport or hasn’t scrolled up
      this.canvas.style.transform = `translate3d(0, 0, 0)`;
    }
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
    scrollContainer.style.height = "auto";
    scrollContainer.style.zIndex = "-1";
    scrollContainer.style.visibility = "hidden";
    this.parentRef.appendChild(scrollContainer);

    const containerWidth = this.parentRef.clientWidth || window.innerWidth;
    const defaultHeight = containerWidth * DEFAULT_ASPECT_RATIO;

    allPages.forEach(({ fileName, pageNumber, url, status }) => {
      const pageId = `${fileName}_${pageNumber}`;
      const pageEl = document.createElement("div");
      pageEl.id = `page-${pageId}`;
      pageEl.dataset.pageId = pageId;
      pageEl.dataset.url = url || "";
      pageEl.dataset.status = status;
      pageEl.className = "manga-page-placeholder";
      pageEl.style.height = `${defaultHeight}px`;
      pageEl.style.width = "100%";

      scrollContainer.appendChild(pageEl);
      this.pageContainers.set(pageId, pageEl);
      this.observer.observe(pageEl);
    });

    this.preloadInitialPages(allPages);
    this.processLoadingQueue();
    this.checkVisiblePages();
  }

  private preloadInitialPages(
    allPages: Array<{
      fileName: string;
      pageNumber: number;
      url: string;
      status: ProcessingStatus;
    }>
  ): void {
    const initialPages = allPages
      .filter(({ status, url }) => status === ProcessingStatus.COMPLETED && url)
      .slice(0, BUFFER_SIZE + PRELOAD_AHEAD);

    console.log({ initialPages });

    initialPages.forEach(({ fileName, pageNumber, url }) => {
      const pageId = `${fileName}_${pageNumber}`;
      this.enqueuePageLoad(pageId, url);
    });
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
          this.preloadNextPages(pageId);
        }
        needsRender = true;
      } else {
        this.visiblePages.delete(pageId);
      }
    });

    if (needsRender) {
      this.processLoadingQueue();
      this.renderVisiblePages();
    }
  }

  private enqueuePageLoad(pageId: string, url: string): void {
    if (
      this.loadedPages.has(pageId) ||
      this.loadingQueueInProgress.has(pageId) ||
      this.loadingQueue.includes(pageId)
    ) {
      return;
    }
    this.loadingQueue.push(pageId);
    this.loadingQueueInProgress.add(pageId);

    if (this.loadingQueue.length > BUFFER_SIZE * 2) {
      console.log("Pruning loading queue");
      this.loadingQueue = this.loadingQueue.slice(-BUFFER_SIZE * 2);
    }
  }

  private preloadNextPages(currentPageId: string): void {
    const allPageIds = Array.from(this.pageContainers.keys());
    const currentIndex = allPageIds.indexOf(currentPageId);
    if (currentIndex === -1) return;

    for (let i = 1; i <= PRELOAD_AHEAD; i++) {
      const nextIndex = currentIndex + i;
      if (nextIndex >= allPageIds.length) break;

      const nextPageId = allPageIds[nextIndex];
      const pageEl = this.pageContainers.get(nextPageId);
      if (pageEl && !this.loadedPages.has(nextPageId)) {
        const url = pageEl.dataset.url || "";
        const status = pageEl.dataset.status as ProcessingStatus;
        if (status === ProcessingStatus.COMPLETED && url) {
          this.enqueuePageLoad(nextPageId, url);
        }
      }
    }
  }

  private async processLoadingQueue(): Promise<void> {
    const toProcess = this.loadingQueue.slice(0, BUFFER_SIZE);
    console.log("Processing loading queue:", toProcess);
    this.loadingQueue = this.loadingQueue.filter(
      (id) => !toProcess.includes(id)
    );

    for (const pageId of toProcess) {
      if (this.loadedPages.has(pageId)) continue;

      const pageEl = this.pageContainers.get(pageId);
      if (!pageEl) continue;
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
    if (this.loadedPages.has(pageId)) {
      console.log(`Page ${pageId} already loaded or in progress, skipping.`);
      return;
    }

    try {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          const dimensions = { width: img.width, height: img.height };
          this.pageDimensions.set(pageId, dimensions);

          console.log({
            pageId,
            dimensions,
            pagedimensions: this.pageDimensions,
          });

          // Update placeholder height
          const containerWidth =
            this.parentRef.clientWidth || window.innerWidth;
          const aspectRatio = dimensions.height / dimensions.width;
          const placeholderHeight = containerWidth * aspectRatio;
          const pageEl = this.pageContainers.get(pageId);
          if (pageEl) {
            pageEl.style.height = `${Math.floor(placeholderHeight)}px`;
          }

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

          this.loadedPages.add(pageId);
          resolve();
        };
        img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
        img.src = url;
      });
    } finally {
      this.loadingQueueInProgress.delete(pageId);
    }
  }

  private drawImageToCanvas(pageId: string, img: HTMLImageElement): void {
    if (!this.context) return;
    const memCanvas = document.createElement("canvas");
    memCanvas.width = img.width;
    memCanvas.height = img.height;
    const memCtx = memCanvas.getContext("2d");
    if (memCtx) {
      memCtx.drawImage(img, 0, 0);
      this.loadedPages.add(pageId);
      if (this.currentPageId === pageId) {
        this.renderVisiblePages();
      }
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

    if (centerPage === this.currentPageId) return;

    this.currentPageId = centerPage;
    this.canvas.style.transform = `translate3d(0, 0, 0)`; // Reset translation

    const dimensions = this.pageDimensions.get(centerPage);
    if (dimensions) {
      const containerWidth = Math.floor(
        this.parentRef.clientWidth || window.innerWidth
      );
      const aspectRatio = dimensions.height / dimensions.width;
      const newHeight = Math.floor(containerWidth * aspectRatio);

      if (this.worker) {
        console.log({ containerWidth, newHeight });
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
      const scale = Math.min(
        this.canvas.width / dimensions!.width,
        this.canvas.height / dimensions!.height
      );
      const scaledWidth = dimensions!.width * scale;
      const scaledHeight = dimensions!.height * scale;
      const x = (this.canvas.width - scaledWidth) / 2;
      const y = (this.canvas.height - scaledHeight) / 2;
      this.context.drawImage(this.canvas, x, y, scaledWidth, scaledHeight);
    }
  }

  private determineCurrentPage(visiblePageIds: string[]): string {
    if (visiblePageIds.length === 0) return "";
    let bestPageId = visiblePageIds[0];
    let maxIntersectionRatio = -1;

    for (const pageId of visiblePageIds) {
      const el = this.pageContainers.get(pageId);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const intersectionHeight =
        Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0);
      const intersectionRatio = intersectionHeight / rect.height;
      if (intersectionRatio > maxIntersectionRatio) {
        maxIntersectionRatio = intersectionRatio;
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
    if (this.worker) {
      this.worker.postMessage({ type: WorkerMessageType.TERMINATE });
      this.worker = null;
    }
    this.loadedPages.clear();
    this.visiblePages.clear();
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
    this.parentRef.removeEventListener("scroll", this.scrollHandler);
  }
}

export { MangaReaderRenderer };
