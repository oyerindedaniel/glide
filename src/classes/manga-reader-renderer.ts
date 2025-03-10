import { PanelData } from "@/types/manga-reader";
import { MangaPage } from "@/types/manga-reader";
import { ViewMode } from "@/types/manga-reader";
import { ProcessingStatus } from "@/store/processed-files";
import { BaseReaderMode } from "./manga-reader-modes/base-reader-mode";
import { ScrollReaderMode } from "./manga-reader-modes/scroll-reader-mode";
import { PanelReaderMode } from "./manga-reader-modes/panel-reader-mode";
import { PanelAnimator, AnimationFrame } from "./panel/panel-animator";
import { WorkerMessageType } from "@/types/renderer";

const BUFFER_SIZE = 3; // Number of pages to load at a time
export const PRELOAD_AHEAD = 2; // Number of pages to preload ahead

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
  private scrollRaf: ReturnType<typeof requestAnimationFrame> | null = null;
  private imageCache: Map<string, HTMLImageElement> = new Map();
  private lastCanvas: { width: number; height: number } = {
    width: 0,
    height: 0,
  };
  private currentMode: BaseReaderMode;
  private currentViewMode: ViewMode = ViewMode.SCROLL;
  private isSortedListDirty: boolean = true;
  private animator: PanelAnimator;
  private animationFrames: AnimationFrame[] = [];
  private currentFrameIndex: number = 0;
  private animationRaf: number | null = null;

  constructor(canvasContainer: HTMLElement = document.body) {
    this.parentRef = canvasContainer;

    // Initialize canvas
    this.canvas = document.createElement("canvas");
    this.canvas.className = "manga-reader-canvas";
    this.canvas.style.boxSizing = "border-box";
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

    this.currentViewMode = ViewMode.SCROLL;
    this.currentMode = new ScrollReaderMode({
      canvas: this.canvas,
      pageContainers: this.pageContainers,
      isSortedListDirty: () => this.isSortedListDirty,
      currentPageId: () => this.currentPageId,
      pageDimensions: this.pageDimensions,
      setIsSortedListDirty: (isDirty: boolean) =>
        (this.isSortedListDirty = isDirty),
      parentRef: this.parentRef,
      handlers: this.getHandlers(),
    });

    this.currentMode.initialize();

    this.animator = new PanelAnimator();

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
      this.lastCanvas = { width: containerWidth, height: newHeight };
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

    this.isSortedListDirty = true;

    this.currentMode.handleResize();
  }

  private handleScroll(): void {
    if (this.scrollRaf) cancelAnimationFrame(this.scrollRaf);
    this.scrollRaf = requestAnimationFrame(() => {
      this.currentMode.handleScroll();
    });
  }

  private determineCurrentPage(): string | null {
    return this.currentMode.determineCurrentPage();
  }

  private checkVisiblePages(): void {
    this.currentMode.checkVisiblePages();
  }

  private renderVisiblePage(pageId: string): void {
    if (pageId === this.currentPageId) return;

    const pageToRender = this.currentMode.renderPage(pageId);

    if (!pageToRender || pageId !== pageToRender) return;

    this.currentPageId = pageId;

    const dimensions = this.pageDimensions.get(pageId);
    if (!dimensions) return;

    const containerWidth = Math.floor(
      this.parentRef.clientWidth || window.innerWidth
    );
    const newHeight = this.getHeightFromAspectRatio(containerWidth, dimensions);

    if (
      this.lastCanvas.width !== containerWidth ||
      this.lastCanvas.height !== newHeight
    ) {
      this.lastCanvas = { width: containerWidth, height: newHeight };
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

    // For Panel mode, handle panel rendering
    if (
      this.currentMode instanceof PanelReaderMode &&
      this.hasLoadedPage(pageId)
    ) {
      const currentPanelIndex = (
        this.currentMode as PanelReaderMode
      ).getCurrentPanelIndex();
      this.renderPanelToCanvas(pageId, currentPanelIndex);
    }
    // For Scroll mode or fallback, render the whole page
    else if (this.hasLoadedPage(pageId)) {
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
  }

  public render(allPages: MangaPage[]): void {
    this.pageContainers.clear();
    this.loadedPages.clear();

    this.currentMode.render(allPages);

    // Common operations for both modes
    this.isSortedListDirty = true;
    this.preloadInitialPages(allPages);
    this.processLoadingQueue();
    this.checkVisiblePages();
  }

  private preloadInitialPages(allPages: MangaPage[]): void {
    const initialPages = allPages
      .filter(({ status, url }) => status === ProcessingStatus.COMPLETED && url)
      .slice(0, BUFFER_SIZE + PRELOAD_AHEAD);

    initialPages.forEach(({ fileName, pageNumber, url }) => {
      const pageId = `${fileName}_${pageNumber}`;
      this.enqueuePageLoad(pageId, url);
    });
  }

  private hasLoadedPage(pageId: string): boolean {
    const isLoaded = this.loadedPages.has(pageId);
    if (!isLoaded && this.needsLoad(pageId)) {
      const pageEl = this.pageContainers.get(pageId);
      const url = pageEl?.dataset.url;
      if (url) {
        this.enqueuePageLoad(pageId, url);
        this.processLoadingQueue();
      }
    }
    return isLoaded;
  }

  private needsLoad(pageId: string): boolean {
    return !(
      this.loadedPages.has(pageId) ||
      this.loadingQueueInProgress.has(pageId) ||
      this.loadingQueue.includes(pageId)
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
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

          if (this.currentViewMode === ViewMode.SCROLL) {
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
      setTimeout(() => {
        this.loadingQueueInProgress.delete(pageId);
      }, 1000);
    }
  }

  private onPageRendered(pageId: string): void {
    this.loadedPages.add(pageId);
    if (this.currentMode.visiblePages.has(pageId)) {
      const currentPage = this.determineCurrentPage();
      if (currentPage === pageId && currentPage !== this.currentPageId) {
        this.renderVisiblePage(pageId);
      }
    }
  }

  private pruneImageCache(): void {
    if (this.imageCache.size <= 10) return;
    const toRemove = Array.from(this.imageCache.keys()).slice(
      0,
      this.imageCache.size - 10
    );
    toRemove.forEach((key) => this.imageCache.delete(key));
  }

  private renderPanelToCanvas(
    pageId: string,
    panelIndex: number,
    animate: boolean = true
  ): void {
    const panels =
      this.currentMode instanceof PanelReaderMode
        ? this.currentMode.getPanelData(pageId)
        : null;

    if (!panels || !panels[panelIndex]) return;

    const panel = panels[panelIndex];

    // For animations, get previous panel if applicable
    let previousPanel: PanelData | null = null;
    if (animate && panelIndex > 0) {
      previousPanel = panels[panelIndex - 1];
    } else if (animate && panelIndex === 0) {
      // If we're at the first panel and we need to animate, try to get the last panel from the previous page
      if (this.currentMode instanceof PanelReaderMode) {
        const prevPageId = this.currentMode.getPreviousPageId();
        if (prevPageId) {
          const prevPanels = this.currentMode.getPanelData(prevPageId);
          if (prevPanels && prevPanels.length > 0) {
            previousPanel = prevPanels[prevPanels.length - 1];
          }
        }
      }
    }

    if (this.animationRaf) {
      cancelAnimationFrame(this.animationRaf);
      this.animationRaf = null;
    }

    // Calculate animation frames
    if (animate && previousPanel) {
      this.animationFrames = this.animator.calculateAnimationFrames(
        previousPanel,
        panel,
        this.canvas.width,
        this.canvas.height
      );
      this.currentFrameIndex = 0;
      this.animatePanel(pageId);
    } else {
      // No animation needed, just render the panel directly
      const dimensions = this.animator.calculatePanelDimensions(
        panel,
        this.canvas.width,
        this.canvas.height
      );

      if (this.worker) {
        this.worker.postMessage({
          type: WorkerMessageType.RENDER_PANEL,
          pageId,
          panelData: dimensions,
        });
      } else if (this.context) {
        const img = this.imageCache.get(pageId);
        if (!img) return;

        const { src, dest, text } = dimensions;
        this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.context.drawImage(
          img,
          src.x,
          src.y,
          src.width,
          src.height,
          dest.x,
          dest.y,
          dest.width,
          dest.height
        );

        if (text) {
          this.context.font = "16px Arial";
          this.context.fillStyle = "white";
          this.context.strokeStyle = "black";
          this.context.lineWidth = 3;
          this.context.strokeText(text, dest.x, dest.y + dest.height);
          this.context.fillText(text, dest.x, dest.y + dest.height);
        }
      }
    }
  }

  private animatePanel(pageId: string): void {
    if (this.currentFrameIndex >= this.animationFrames.length) {
      this.animationRaf = null;
      return;
    }

    const frame = this.animationFrames[this.currentFrameIndex];
    const img = this.imageCache.get(pageId);

    if (this.worker) {
      this.worker.postMessage({
        type: WorkerMessageType.RENDER_PANEL,
        pageId,
        panelData: frame,
      });
    } else if (this.context && img) {
      const { src, dest, text } = frame;
      this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.context.drawImage(
        img,
        src.x,
        src.y,
        src.width,
        src.height,
        dest.x,
        dest.y,
        dest.width,
        dest.height
      );

      if (text) {
        this.context.font = "16px Arial";
        this.context.fillStyle = "white";
        this.context.strokeStyle = "black";
        this.context.lineWidth = 3;
        this.context.strokeText(text, dest.x, dest.y + dest.height);
        this.context.fillText(text, dest.x, dest.y + dest.height);
      }
    }

    this.currentFrameIndex++;
    if (this.currentFrameIndex < this.animationFrames.length) {
      this.animationRaf = requestAnimationFrame(() =>
        this.animatePanel(pageId)
      );
    }
  }

  private getHandlers() {
    return {
      hasLoadedPage: this.hasLoadedPage.bind(this),
      needsLoad: this.needsLoad.bind(this),
      enqueuePageLoad: this.enqueuePageLoad.bind(this),
      processLoadingQueue: this.processLoadingQueue.bind(this),
      renderVisiblePage: this.renderVisiblePage.bind(this),
      renderPanel: (
        pageId: string,
        panelIndex: number,
        animate: boolean = true
      ) => {
        if (this.hasLoadedPage(pageId)) {
          this.renderPanelToCanvas(pageId, panelIndex, animate);
        }
      },
    };
  }

  public setViewMode(mode: ViewMode): void {
    this.currentMode.cleanup();
    this.currentViewMode = mode;

    const modeParams = {
      canvas: this.canvas,
      pageContainers: this.pageContainers,
      pageDimensions: this.pageDimensions,
      parentRef: this.parentRef,
      currentPageId: () => this.currentPageId,
      isSortedListDirty: () => this.isSortedListDirty,
      setIsSortedListDirty: (isDirty: boolean) =>
        (this.isSortedListDirty = isDirty),
      loadingHandlers: this.getHandlers(),
    } as const;

    if (mode === ViewMode.PANEL) {
      this.currentMode = new PanelReaderMode(modeParams);
    } else {
      this.currentMode = new ScrollReaderMode(modeParams);
    }

    this.currentMode.initialize();
  }

  public getCurrentMode(): ViewMode {
    return this.currentViewMode;
  }

  public nextPanel(): void {
    if (this.currentMode instanceof PanelReaderMode) {
      this.currentMode.nextPanel();
    }
  }

  public previousPanel(): void {
    if (this.currentMode instanceof PanelReaderMode) {
      this.currentMode.previousPanel();
    }
  }

  public jumpToPanel(panelIndex: number): void {
    if (this.currentMode instanceof PanelReaderMode) {
      this.currentMode.jumpToPanel(panelIndex);
    }
  }

  public isNextPanel(): boolean {
    return this.currentMode instanceof PanelReaderMode
      ? this.currentMode.isNextPanel()
      : false;
  }

  public isPreviousPanel(): boolean {
    return this.currentMode instanceof PanelReaderMode
      ? this.currentMode.isPreviousPanel()
      : false;
  }

  public togglePlayback(): void {
    if (this.currentMode instanceof PanelReaderMode) {
      this.currentMode.togglePlayback();
    }
  }

  public dispose(): void {
    if (this.worker) {
      this.worker.postMessage({ type: WorkerMessageType.TERMINATE });
      this.worker = null;
    }
    this.loadedPages.clear();
    this.pageContainers.clear();
    this.pageDimensions.clear();
    this.loadingQueue = [];

    if (this.currentMode) {
      this.currentMode.cleanup();
    }

    if (this.animationRaf) {
      cancelAnimationFrame(this.animationRaf);
      this.animationRaf = null;
    }

    if (this.animator) {
      this.animator.dispose();
    }

    this.animationFrames = [];

    if (this.scrollRaf) {
      cancelAnimationFrame(this.scrollRaf);
      this.scrollRaf = null;
    }

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
