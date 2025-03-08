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
  private observer: IntersectionObserver;
  private pageContainers: Map<string, HTMLDivElement> = new Map();
  private sortedPageIds: string[] = [];
  private isSortedListDirty: boolean = true;
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
  private transitionTimeout: ReturnType<typeof setTimeout> | null = null;
  private rfa: ReturnType<typeof requestAnimationFrame> | null = null;
  private lastTransition: string | null = null;
  private lastScrollTop: number = 0;
  private imageCache: Map<string, HTMLImageElement> = new Map();
  private lastCanvas: { width: number; height: number } = {
    width: 0,
    height: 0,
  };
  private throttledScrollHandler: () => void;

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

    // Intersection Observer with tight rootMargin for center page detection
    this.observer = new IntersectionObserver(
      this.debouncedHandleIntersection.bind(this),
      {
        root: null,
        rootMargin: "0px",
        threshold: [0, 0.5, 1],
      }
    );

    // Initialize rendering backend
    if (window.OffscreenCanvas && window.Worker) {
      this.initWorker();
    } else {
      this.context = this.canvas.getContext("2d", { alpha: false });
    }

    this.throttledScrollHandler = this.throttle(() => {
      const newCurrentPage = this.determineCurrentPage();
      if (newCurrentPage !== this.currentPageId && newCurrentPage) {
        console.log("New current page:", newCurrentPage);
        this.renderVisiblePage(newCurrentPage);
      }
    }, 100);

    // Event handlers
    this.resizeHandler = this.handleResize.bind(this);
    this.scrollHandler = this.handleScroll.bind(this);
    window.addEventListener("resize", this.resizeHandler);
    this.parentRef.addEventListener("scroll", this.scrollHandler, {
      passive: true,
    });
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

    if (
      this.lastCanvas.width !== containerWidth ||
      this.lastCanvas.height !== newHeight
    ) {
      this.lastCanvas.width = containerWidth;
      this.lastCanvas.height = newHeight;
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

    this.isSortedListDirty = true;
    this.throttledScrollHandler();
  }

  private handleScroll(): void {
    if (this.rfa) cancelAnimationFrame(this.rfa);
    this.rfa = requestAnimationFrame(() => {
      this.throttledScrollHandler();

      if (!this.currentPageId) return;
      const placeholder = this.pageContainers.get(this.currentPageId);
      if (!placeholder) return;

      const rect = placeholder.getBoundingClientRect();
      const offsetY = rect.top;
      const canvasHeight = this.canvas.height;
      const viewportHeight = window.innerHeight;
      const maxOffset =
        canvasHeight > viewportHeight ? -(canvasHeight - viewportHeight) : 0;

      const currentScrollTop = this.parentRef.scrollTop;
      const scrollDirection =
        currentScrollTop > this.lastScrollTop ? "down" : "up";
      this.lastScrollTop = currentScrollTop;

      const FLOATING_POINT = 2; // due to floating-point precision or rapid scrolling

      let translateY = 0;
      if (canvasHeight > viewportHeight) {
        if (offsetY < 0) {
          // Scrolling down within the current page
          translateY = Math.max(offsetY, maxOffset);
          if (
            translateY - FLOATING_POINT <= maxOffset &&
            scrollDirection === "down"
          ) {
            this.handleOffsetCapping("downward");
          }
        } else if (offsetY > 0) {
          // Scrolling up within the current page
          translateY = Math.min(offsetY, 0);
          if (translateY - FLOATING_POINT <= 0 && scrollDirection === "up") {
            this.handleOffsetCapping("upward");
          }
        }
      }

      this.canvas.style.transition = "";
      this.canvas.style.transform = `translate3d(0, ${translateY}px, 0)`;
    });
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

    console.log({ targetId, scrollTarget, direction });

    this.parentRef.scrollTo({
      top: scrollTarget,
      behavior: "smooth",
    });
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

    this.isSortedListDirty = true;
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

  private debouncedHandleIntersection = debounce(
    this.handleIntersection.bind(this),
    100
  );

  private handleIntersection(entries: IntersectionObserverEntry[]): void {
    let shouldProcessQueue = false;

    entries.forEach((entry) => {
      const pageEl = entry.target as HTMLDivElement;
      const pageId = pageEl.dataset.pageId;
      const url = pageEl.dataset.url || "";
      const status = pageEl.dataset.status as ProcessingStatus;

      if (!pageId) return;

      if (entry.isIntersecting) {
        if (!this.visiblePages.has(pageId)) {
          this.visiblePages.add(pageId);
          if (
            this.needsLoad(pageId) &&
            status === ProcessingStatus.COMPLETED &&
            url
          ) {
            this.enqueuePageLoad(pageId, url);
            this.preloadNextPages(pageId);
            shouldProcessQueue = true;
          }
        }
      } else {
        this.visiblePages.delete(pageId);
      }
    });

    if (shouldProcessQueue) {
      this.processLoadingQueue();
    }
  }

  private needsLoad(pageId: string): boolean {
    return !(
      this.loadedPages.has(pageId) ||
      this.loadingQueueInProgress.has(pageId) ||
      this.loadingQueue.includes(pageId)
    );
  }

  private enqueuePageLoad(pageId: string, url: string): void {
    if (!this.needsLoad(pageId)) {
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

  // private async processLoadingQueue(): Promise<void> {
  //   const toProcess = this.loadingQueue.slice(0, BUFFER_SIZE);
  //   console.log("Processing loading queue:", toProcess);
  //   this.loadingQueue = this.loadingQueue.filter(
  //     (id) => !toProcess.includes(id)
  //   );

  //   for (const pageId of toProcess) {
  //     if (this.loadedPages.has(pageId)) continue;

  //     const pageEl = this.pageContainers.get(pageId);
  //     if (!pageEl) continue;
  //     const url = pageEl.dataset.url;
  //     if (!url) continue;
  //     try {
  //       await this.loadAndCacheImage(pageId, url);
  //     } catch (err) {
  //       console.error(`Failed to load image for page ${pageId}:`, err);
  //     }
  //   }
  // }

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
      validPages.map(async ({ pageId, url }) => {
        try {
          await this.loadAndCacheImage(pageId, url);
        } catch (err) {
          console.error(`Failed to load image for page ${pageId}:`, err);
        }
      })
    );
  }

  private async loadAndCacheImage(pageId: string, url: string): Promise<void> {
    try {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          const dimensions = { width: img.width, height: img.height };
          this.pageDimensions.set(pageId, dimensions);

          // Update placeholder height
          const containerWidth =
            this.parentRef.clientWidth || window.innerWidth;
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
            this.pruneImageCache();
          }
          this.isSortedListDirty = true;
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

  private onPageRendered(pageId: string): void {
    this.loadedPages.add(pageId);
    if (this.visiblePages.has(pageId)) {
      const currentPage = this.determineCurrentPage();

      if (currentPage === pageId) {
        this.renderVisiblePage(pageId);
      }
    }
  }

  private renderVisiblePage(currentPage: string): void {
    const visibleLoadedPages = Array.from(this.visiblePages).filter((pageId) =>
      this.loadedPages.has(pageId)
    );
    if (visibleLoadedPages.length === 0) return;

    if (currentPage === this.currentPageId) return;

    // Determine scroll direction
    const allPageIds = Array.from(this.pageContainers.keys());
    const oldIndex = this.currentPageId
      ? allPageIds.indexOf(this.currentPageId)
      : -1;
    const newIndex = allPageIds.indexOf(currentPage);

    let initialTranslateY = 0;
    if (oldIndex !== -1 && newIndex < oldIndex) {
      // Scrolling up to previous page
      const dimensions = this.pageDimensions.get(currentPage);
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

    this.currentPageId = currentPage;

    this.canvas.style.transition = "transform 0.6s ease";
    this.canvas.style.transform = `translate3d(0, ${initialTranslateY}px, 0)`;

    if (this.transitionTimeout) clearTimeout(this.transitionTimeout);
    this.transitionTimeout = setTimeout(() => {
      this.canvas.style.transition = "";
    }, 600);

    const dimensions = this.pageDimensions.get(currentPage);
    if (dimensions) {
      const containerWidth = Math.floor(
        this.parentRef.clientWidth || window.innerWidth
      );
      const newHeight = this.getHeightFromAspectRatio(
        containerWidth,
        dimensions
      );

      if (
        this.lastCanvas.width !== containerWidth ||
        this.lastCanvas.height !== newHeight
      ) {
        this.lastCanvas.width = containerWidth;
        this.lastCanvas.height = newHeight;
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
    }

    if (this.worker) {
      this.worker.postMessage({
        type: WorkerMessageType.RENDER_PAGE,
        pageId: currentPage,
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

      const img = this.imageCache.get(currentPage) || new Image();
      if (!this.imageCache.has(currentPage)) {
        img.src = this.pageContainers.get(currentPage)?.dataset.url || "";
        img.onload = () => {
          this.imageCache.set(currentPage, img);
          this.context?.drawImage(img, x, y, scaledWidth, scaledHeight);
        };
        img.onerror = () => {
          console.error(`Failed to load image for page ${currentPage}`);
        };
      } else {
        this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.context.drawImage(img, x, y, scaledWidth, scaledHeight);
      }
    }
  }

  /**
   * Updates the sorted list of page IDs based on their offsetTop values.
   */
  private updateSortedPageIds(): void {
    this.sortedPageIds = Array.from(this.pageContainers.keys()).sort((a, b) => {
      const elA = this.pageContainers.get(a)!;
      const elB = this.pageContainers.get(b)!;
      return elA.offsetTop - elB.offsetTop;
    });
    this.isSortedListDirty = false;
  }

  /**
   * Determines the current page based on the scroll position using binary search.
   * @returns The ID of the current page.
   */
  private determineCurrentPage(): string {
    // Update the sorted list if it's dirty
    if (this.isSortedListDirty) {
      this.updateSortedPageIds();
    }

    const scrollTop = this.parentRef.scrollTop;

    let left = 0;
    let right = this.sortedPageIds.length - 1;

    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      const pageId = this.sortedPageIds[mid];
      const el = this.pageContainers.get(pageId)!;
      const elTop = el.offsetTop;
      const elBottom = elTop + el.offsetHeight;

      // Check if the scroll position is within this page's bounds
      if (elTop <= scrollTop && elBottom > scrollTop) {
        return pageId;
      }
      // If the page starts after the scroll position, look in the left half
      else if (elTop > scrollTop) {
        right = mid - 1;
      }
      // If the page ends before the scroll position, look in the right half
      else {
        left = mid + 1;
      }
    }

    // Handle edge cases
    if (left === 0) {
      return this.sortedPageIds[0]; // Scroll is before the first page
    } else if (left >= this.sortedPageIds.length) {
      return this.sortedPageIds[this.sortedPageIds.length - 1]; // Scroll is after the last page
    } else {
      // Scroll is between pages; pick the closest one
      const prevPage = this.sortedPageIds[left - 1];
      const nextPage = this.sortedPageIds[left];
      const prevEl = this.pageContainers.get(prevPage)!;
      const prevBottom = prevEl.offsetTop + prevEl.offsetHeight;
      return scrollTop < prevBottom ? prevPage : nextPage;
    }
  }

  private checkVisiblePages(): void {
    const viewportHeight = window.innerHeight;
    let shouldProcessQueue = false;

    this.pageContainers.forEach((pageEl, pageId) => {
      const rect = pageEl.getBoundingClientRect();
      const isVisible = rect.top < viewportHeight && rect.bottom > 0;
      if (isVisible) {
        this.visiblePages.add(pageId);
        if (this.needsLoad(pageId)) {
          const url = pageEl.dataset.url || "";
          const status = pageEl.dataset.status as ProcessingStatus;
          if (status === ProcessingStatus.COMPLETED && url) {
            this.enqueuePageLoad(pageId, url);
            shouldProcessQueue = true;
          }
        }
      }
    });

    if (shouldProcessQueue) {
      this.processLoadingQueue();
    }
    this.throttledScrollHandler();
  }

  private pruneImageCache(): void {
    if (this.imageCache.size <= 10) return;
    const toRemove = Array.from(this.imageCache.keys()).slice(
      0,
      this.imageCache.size - 10
    );
    toRemove.forEach((key) => this.imageCache.delete(key));
  }

  private throttle(fn: () => void, delay: number): () => void {
    let timeout: number | null = null;
    return () => {
      if (!timeout) {
        timeout = window.setTimeout(() => {
          fn();
          timeout = null;
        }, delay);
      }
    };
  }

  public dispose(): void {
    this.observer.disconnect();
    if (this.transitionTimeout) clearTimeout(this.transitionTimeout);
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
