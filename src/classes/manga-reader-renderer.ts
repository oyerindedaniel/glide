import pLimit from "p-limit";
import { ProcessingStatus } from "@/store/processed-files";
import { WorkerMessageType } from "@/types/renderer";
import { debounce } from "@/utils/app";

const BUFFER_SIZE = 3; // Number of pages to load at a time
const PRELOAD_AHEAD = 2; // Number of pages to preload ahead
const RENDER_QUALITY = 1.0;
const DEFAULT_ASPECT_RATIO = 1.5; // Default for initial placeholder heights

class MangaReaderRenderer {
  private canvas: HTMLCanvasElement;
  private context: CanvasRenderingContext2D | null = null;
  private worker: Worker | null = null;
  private pageContainers: Map<string, HTMLDivElement> = new Map();
  private loadedPages: Set<string> = new Set();
  private loadingQueueInProgress: Set<string> = new Set();
  private currentPageId: string | null = null;
  private loadingQueue: string[] = [];
  private parentRef: HTMLElement;
  private pageDimensions: Map<string, { width: number; height: number }> =
    new Map();
  private resizeHandler: () => void;
  private scrollHandler: () => void;
  private scrollContainer: HTMLDivElement | null = null;
  private pageRanges: { start: number; end: number; pageId: string }[] = [];
  private limit = pLimit(2);
  private imageCache: Map<string, HTMLImageElement> = new Map();
  private lastCanvasWidth = 0;
  private lastCanvasHeight = 0;
  private lastScroll: {
    scrollTop: number;
    pageRange:
      | {
          start: number;
          end: number;
          pageId: string;
        }
      | undefined;
  } | null = null;
  private workerInitialized = false;
  private transitionTimeout: ReturnType<typeof setTimeout> | null = null;
  private lastTransition: string | null = null;

  constructor(canvasContainer: HTMLElement = document.body) {
    this.parentRef = canvasContainer;

    // Initialize canvas
    this.canvas = document.createElement("canvas");
    this.canvas.className = "manga-reader-canvas";
    this.canvas.style.boxSizing = "border-box";
    this.canvas.style.position = "sticky";
    this.canvas.style.top = "0";
    this.canvas.style.left = "0";
    this.canvas.style.zIndex = "1";
    this.canvas.style.transform = "translate3d(0, 0, 0)";
    this.canvas.style.willChange = "transform";
    this.parentRef.appendChild(this.canvas);

    // Initialize rendering backend
    if (window.OffscreenCanvas && window.Worker) {
      this.initWorker();
    } else {
      this.context = this.canvas.getContext("2d", { alpha: false });
    }

    // Event handlers
    this.resizeHandler = this.handleResize.bind(this);
    this.scrollHandler = this.handleScroll.bind(this); // ~60fps
    window.addEventListener("resize", this.resizeHandler);
    this.parentRef.addEventListener("scroll", this.scrollHandler, {
      passive: true,
    });
    if (this.pageContainers.size > 0) this.handleResize();
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

      this.workerInitialized = true;

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
      this.workerInitialized = false;
      this.context = this.canvas.getContext("2d", { alpha: false });
    }
  }

  private getHeightFromAspectRatio(
    containerWidth: number,
    dimensions: { width: number; height: number }
  ): number {
    const aspectRatio = dimensions.height / dimensions.width;
    return Math.floor(containerWidth * aspectRatio);
  }

  private handleResize(): void {
    const containerWidth = Math.floor(
      this.parentRef.clientWidth || window.innerWidth
    );
    let newHeight = window.innerHeight;

    if (this.currentPageId) {
      const dimensions = this.pageDimensions.get(this.currentPageId);
      if (dimensions) {
        newHeight = this.getHeightFromAspectRatio(containerWidth, dimensions);
      }
    }

    // Only resize if dimensions actually changed
    if (
      this.lastCanvasWidth !== containerWidth ||
      this.lastCanvasHeight !== newHeight
    ) {
      this.lastCanvasWidth = containerWidth;
      this.lastCanvasHeight = newHeight;

      if (this.worker && this.workerInitialized) {
        this.worker.postMessage({
          type: WorkerMessageType.RESIZE,
          width: containerWidth,
          height: newHeight,
        });
      } else if (!this.workerInitialized) {
        this.canvas.width = containerWidth;
        this.canvas.height = newHeight;
      }
    }

    // Update all placeholder heights
    this.pageContainers.forEach((pageEl, pageId) => {
      const dimensions = this.pageDimensions.get(pageId);
      if (dimensions) {
        const placeholderHeight = this.getHeightFromAspectRatio(
          containerWidth,
          dimensions
        );
        pageEl.style.height = `${placeholderHeight}px`;
      }
    });

    // Recalculate page ranges
    this.pageRanges = Array.from(this.pageContainers.entries()).map(
      ([pageId, el]) => ({
        pageId,
        start: el.offsetTop,
        end: el.offsetTop + el.offsetHeight,
      })
    );

    if (this.pageRanges.length > 0) this.handleScroll();
  }

  private handleScroll(): void {
    const scrollTop = this.parentRef.scrollTop;
    const viewportHeight = window.innerHeight;

    const currentRange =
      scrollTop === this.lastScroll?.scrollTop
        ? this.lastScroll.pageRange
        : this.findCurrentRange(scrollTop);
    this.lastScroll = { scrollTop, pageRange: currentRange };

    if (currentRange && this.currentPageId !== currentRange.pageId) {
      this.handlePageChange(currentRange);
    }

    const scrollDirection =
      scrollTop > this.lastScroll.scrollTop ? "down" : "up";

    const FLOATING_POINT = 2;

    if (currentRange) {
      const pageHeight = currentRange.end - currentRange.start;
      if (pageHeight > viewportHeight) {
        const scrollWithinPage = scrollTop - currentRange.start;
        const maxTranslate = -(pageHeight - viewportHeight);
        const translateY = Math.max(maxTranslate, -scrollWithinPage);
        this.canvas.style.transition = "";
        this.canvas.style.transform = `translate3d(0, ${translateY}px, 0)`;

        // Downward capping: when at the bottom
        if (
          Math.abs(translateY - maxTranslate) <= FLOATING_POINT &&
          scrollDirection === "down"
        ) {
          console.log("Reached bottom of page, capping offset downward");
          this.handleOffsetCapping("downward");
        }
        // Upward capping: when at the top
        else if (
          Math.abs(translateY) <= FLOATING_POINT &&
          scrollDirection === "up"
        ) {
          console.log("Reached top of page, capping offset upward");
          this.handleOffsetCapping("upward");
        }
      } else {
        this.canvas.style.transition = "transform 0.3s ease";
        this.canvas.style.transform = "translate3d(0, 0, 0)";
      }
    }
  }

  private handleOffsetCapping(direction: "upward" | "downward"): void {
    if (!this.currentPageId) return;

    const pageIds = Array.from(this.pageContainers.keys());
    const currentIndex = pageIds.indexOf(this.currentPageId);
    if (currentIndex === -1) return;

    let targetId: string | null = null;
    if (direction === "upward" && currentIndex > 0) {
      targetId = pageIds[currentIndex - 1]; // Previous page
    } else if (direction === "downward" && currentIndex < pageIds.length - 1) {
      targetId = pageIds[currentIndex + 1]; // Next page
    }

    console.log({ targetId });

    if (!targetId) return;

    const transitionKey = `${this.currentPageId}_to_${targetId}_${direction}`;

    if (this.lastTransition === transitionKey) {
      return;
    }

    this.lastTransition = transitionKey;

    const targetPlaceholder = this.pageContainers.get(targetId);
    if (!targetPlaceholder) return;

    const viewportHeight = window.innerHeight;
    const targetRect = targetPlaceholder.getBoundingClientRect();
    const targetHeight = targetRect.height;
    const targetTop = targetPlaceholder.offsetTop;

    let scrollTarget: number;
    if (direction === "upward") {
      scrollTarget = targetTop + targetHeight - viewportHeight; // Bottom of previous page
    } else {
      scrollTarget = targetTop; // Top of next page
    }

    this.parentRef.scrollTo({
      top: scrollTarget,
      behavior: "smooth",
    });
  }

  private findCurrentRange(
    scrollTop: number
  ): { start: number; end: number; pageId: string } | undefined {
    let left = 0;
    let right = this.pageRanges.length - 1;
    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      const range = this.pageRanges[mid];
      if (scrollTop >= range.start && scrollTop < range.end) {
        return range;
      } else if (scrollTop < range.start) {
        right = mid - 1;
      } else {
        left = mid + 1;
      }
    }
    return undefined;
  }

  private debouncePreloadNextPages = debounce((currentPageId: string) => {
    this.preloadNextPages(currentPageId);
  }, 100);

  private renderPage(pageId: string): void {
    if (!pageId) return;

    if (pageId === this.currentPageId) return;

    console.log("Rendering page:", pageId);

    // Determine scroll direction
    const allPageIds = Array.from(this.pageContainers.keys());
    const oldIndex = this.currentPageId
      ? allPageIds.indexOf(this.currentPageId)
      : -1;
    const newIndex = allPageIds.indexOf(pageId);

    let initialTranslateY = 0;
    if (oldIndex !== -1 && newIndex < oldIndex) {
      // Scrolling up to previous page
      const dimensions = this.pageDimensions.get(pageId);
      if (dimensions) {
        const containerWidth = Math.floor(
          this.parentRef.clientWidth || window.innerWidth
        );
        const canvasHeight = this.getHeightFromAspectRatio(
          containerWidth,
          dimensions
        );
        const viewportHeight = window.innerHeight;
        if (canvasHeight > viewportHeight) {
          initialTranslateY = -(canvasHeight - viewportHeight); // Show bottom
        }
      }
    } // Else scrolling down, keep initialTranslateY = 0 to show top

    this.canvas.style.transition = "transform 0.6s ease";
    this.canvas.style.transform = `translate3d(0, ${initialTranslateY}px, 0)`;

    if (this.transitionTimeout) clearTimeout(this.transitionTimeout);
    this.transitionTimeout = setTimeout(() => {
      this.canvas.style.transition = "";
    }, 600);

    const dimensions = this.pageDimensions.get(pageId);
    if (!dimensions) return;

    this.currentPageId = pageId;

    const containerWidth = Math.floor(
      this.parentRef.clientWidth || window.innerWidth
    );
    const newHeight = this.getHeightFromAspectRatio(containerWidth, dimensions);

    if (
      this.lastCanvasWidth !== containerWidth ||
      this.lastCanvasHeight !== newHeight
    ) {
      this.lastCanvasWidth = containerWidth;
      this.lastCanvasHeight = newHeight;

      if (this.worker && this.workerInitialized) {
        this.worker.postMessage({
          type: WorkerMessageType.RESIZE,
          width: containerWidth,
          height: newHeight,
        });
      } else if (!this.workerInitialized) {
        this.canvas.width = containerWidth;
        this.canvas.height = newHeight;
      }
    }

    if (this.worker) {
      this.worker.postMessage({
        type: WorkerMessageType.RENDER_PAGE,
        pageId,
      });
    } else if (this.context) {
      const scale = Math.min(
        this.canvas.width / dimensions!.width,
        this.canvas.height / dimensions!.height
      );
      const scaledWidth = dimensions!.width * scale;
      const scaledHeight = dimensions!.height * scale;
      const x = (this.canvas.width - scaledWidth) / 2;
      const y = (this.canvas.height - scaledHeight) / 2;

      const img = this.imageCache.get(pageId) || new Image();
      if (!this.imageCache.has(pageId)) {
        img.src = this.pageContainers.get(pageId)?.dataset.url || "";
        img.onload = () => {
          this.imageCache.set(pageId, img);
          this.context?.drawImage(img, x, y, scaledWidth, scaledHeight);
        };
        img.onerror = () => {
          console.error(`Failed to load image for page ${pageId}`);
        };
      } else {
        this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.context.drawImage(img, x, y, scaledWidth, scaledHeight);
      }
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

    this.scrollContainer = scrollContainer;

    const containerWidth = Math.floor(
      this.parentRef.clientWidth || window.innerWidth
    );
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
    });

    // Calculate page ranges
    this.pageRanges = Array.from(this.pageContainers.entries()).map(
      ([pageId, el]) => ({
        pageId,
        start: el.offsetTop,
        end: el.offsetTop + el.offsetHeight,
      })
    );

    this.preloadInitialPages(allPages);
    this.processLoadingQueue();

    if (allPages.length > 0) {
      console.log("page", this.pageRanges[0]);
      this.lastScroll = {
        scrollTop: 0,
        pageRange: this.pageRanges[0],
      };
      this.handlePageChange(this.pageRanges[0]);
    }
  }

  private handlePageChange = (currentRange: {
    start: number;
    end: number;
    pageId: string;
  }) => {
    const currentPageId = currentRange.pageId;

    if (!currentPageId) return;

    if (
      this.lastScroll &&
      this.lastScroll.pageRange &&
      this.lastScroll.pageRange.pageId !== currentPageId
    ) {
      console.log("pageid", currentRange.pageId);
      return;
    }

    if (!this.loadedPages.has(currentPageId)) {
      const pageEl = this.pageContainers.get(currentPageId);
      if (pageEl) {
        const url = pageEl.dataset.url || "";
        const status = pageEl.dataset.status as ProcessingStatus;
        if (status === ProcessingStatus.COMPLETED && url) {
          this.enqueuePageLoad(currentPageId, url);
        }
        console.log("Page not loaded, enqueued:", currentPageId);
        // this.processLoadingQueue();
      }
    }

    this.renderPage(currentPageId);
    this.debouncePreloadNextPages(currentPageId);
  };

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

    const containerWidth = this.parentRef.clientWidth || window.innerWidth;
    const defaultHeight = containerWidth * DEFAULT_ASPECT_RATIO;

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
        pageEl.style.height = `${defaultHeight}px`;
        pageEl.style.width = "100%";

        scrollContainer.appendChild(pageEl);
        this.pageContainers.set(pageId, pageEl);

        if (status === ProcessingStatus.COMPLETED && url) {
          this.enqueuePageLoad(pageId, url);
        }
      }
    });

    this.pageRanges = Array.from(this.pageContainers.entries()).map(
      ([pageId, el]) => ({
        pageId,
        start: el.offsetTop,
        end: el.offsetTop + el.offsetHeight,
      })
    );

    this.processLoadingQueue();
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

    initialPages.forEach(({ fileName, pageNumber, url }) => {
      const pageId = `${fileName}_${pageNumber}`;
      this.enqueuePageLoad(pageId, url);
    });
  }

  private enqueuePageLoad(pageId: string, url: string): void {
    if (
      this.loadedPages.has(pageId) ||
      this.loadingQueueInProgress.has(pageId) ||
      this.loadingQueue.includes(pageId)
    ) {
      console.log(`Page ${pageId} already loaded or in progress, skipping.`);
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

    const validPages: { pageId: string; url: string }[] = [];

    for (const pageId of toProcess) {
      if (this.loadedPages.has(pageId)) {
        continue;
      }

      const pageEl = this.pageContainers.get(pageId);
      if (!pageEl) {
        continue;
      }

      const url = pageEl.dataset.url;
      if (!url) {
        continue;
      }

      validPages.push({ pageId, url });
    }

    await Promise.all(
      validPages.map((page) => this.loadAndCacheImage(page.pageId, page.url))
    );
  }

  private pruneImageCache(): void {
    if (this.imageCache.size <= 10) return;
    const toRemove = Array.from(this.imageCache.keys()).slice(
      0,
      this.imageCache.size - 10
    );
    toRemove.forEach((key) => this.imageCache.delete(key));
  }

  private async loadAndCacheImage(pageId: string, url: string): Promise<void> {
    try {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          const dimensions = { width: img.width, height: img.height };
          this.pageDimensions.set(pageId, dimensions);

          // Update placeholder height
          const containerWidth = Math.floor(
            this.parentRef.clientWidth || window.innerWidth
          );
          const placeholderHeight = this.getHeightFromAspectRatio(
            containerWidth,
            dimensions
          );
          const pageEl = this.pageContainers.get(pageId);
          if (pageEl) {
            pageEl.style.height = `${placeholderHeight}px`;
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
            this.imageCache.set(pageId, img);
            this.loadedPages.add(pageId);
            this.pruneImageCache();

            this.pageRanges = Array.from(this.pageContainers.entries()).map(
              ([id, el]) => ({
                pageId: id,
                start: el.offsetTop,
                end: el.offsetTop + el.offsetHeight,
              })
            );

            const range = this.pageRanges.find((r) => r.pageId === pageId);
            if (range) {
              this.handlePageChange(range);
            }
          }
          console.log(this.pageDimensions);
          resolve();
        };
        img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
        img.src = url;
      });
    } finally {
      this.loadingQueueInProgress.delete(pageId);
    }
  }

  private onPageRendered(pageId: string): void {
    this.loadedPages.add(pageId);
    const range = this.pageRanges.find((r) => r.pageId === pageId);
    if (range) {
      console.log("Page rendered, updating:", pageId);
      this.handlePageChange(range);
    }
  }

  public dispose(): void {
    if (this.worker) {
      this.worker.postMessage({ type: WorkerMessageType.TERMINATE });
      console.log("Terminated worker");
      this.worker = null;
    }
    if (this.transitionTimeout) clearTimeout(this.transitionTimeout);
    this.loadedPages.clear();
    this.pageContainers.clear();
    this.pageDimensions.clear();
    this.imageCache.clear();
    this.loadingQueue = [];
    this.workerInitialized = false;

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
