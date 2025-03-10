import { BaseReaderMode, PageData } from "./base-reader-mode";
import { PanelWebSocketManager } from "../panel/panel-websocket-manager";
import { PanelAnimator } from "../panel/panel-animator";
import { PanelPlaybackController } from "../panel/panel-playback-controller";
import { PanelData, PagePanelData } from "@/types/manga-reader";
import { PRELOAD_AHEAD } from "../manga-reader-renderer";
import { ProcessingStatus } from "@/store/processed-files";
import { throttle } from "@/utils/app";

export class PanelReaderMode extends BaseReaderMode {
  private panelData: Map<string, PanelData[]> = new Map();
  private currentPanelIndex: number = 0;
  private currentPageIndex: number = 0;
  private wsManager: PanelWebSocketManager;
  private animator: PanelAnimator;
  private playbackController: PanelPlaybackController;
  private throttledPageRenderer: () => void;

  constructor(...args: ConstructorParameters<typeof BaseReaderMode>) {
    super(...args);
    this.wsManager = new PanelWebSocketManager(this.handlePanelData.bind(this));
    this.animator = new PanelAnimator(this.canvas, this.context);
    this.playbackController = new PanelPlaybackController(this);

    this.throttledPageRenderer = throttle(() => {
      const newCurrentPage = this.determineCurrentPage();
      const currentPageId = this.getCurrentPageId();
      if (newCurrentPage !== currentPageId && newCurrentPage) {
        this.handlers?.renderVisiblePage(newCurrentPage);
      }
    }, 100);
  }

  initialize(): void {
    this.canvas.style.position = "fixed";
    this.canvas.style.top = "0";
    this.canvas.style.left = "0";
    this.canvas.style.transform = "translate3d(0, 0, 0)";
    this.wsManager.connect();
  }

  cleanup(): void {
    this.wsManager.disconnect();
    this.playbackController.stop();
    this.panelData.clear();
    this.currentPanelIndex = 0;
  }

  private handlePanelData(data: PagePanelData): void {
    this.panelData.set(data.pageId, data.panels);

    const pageIds = Array.from(this.pageContainers.keys());

    let currentPageId = this.getCurrentPageId();
    if (currentPageId && pageIds[this.currentPanelIndex] !== currentPageId) {
      currentPageId = pageIds[this.currentPanelIndex];
    }

    if (currentPageId === data.pageId) {
      this.preloadNextPages(currentPageId);
    }
  }

  renderPage(pageId: string): string | void {
    const pageIds = Array.from(this.pageContainers.keys());
    this.currentPageIndex = pageIds.indexOf(pageId);
    this._visiblePages.clear();
    this._visiblePages.add(pageId);

    const visibleLoadedPages = Array.from(this._visiblePages).filter(
      (pageId) => this.handlers?.hasLoadedPage(pageId) || false
    );
    if (visibleLoadedPages.length === 0) return;

    if (!this.panelData.has(pageId)) {
      this.wsManager.requestPanelData(pageId);
    }
    return pageId;
  }

  private async renderCurrentPanel(): Promise<void> {
    const currentPageId = this.getCurrentPageId();
    if (!currentPageId) return;

    const panels = this.panelData.get(currentPageId);
    if (!panels || !panels[this.currentPanelIndex]) return;

    this.throttledPageRenderer();
  }

  handleResize(): void {
    const currentPageId = this.getCurrentPageId();
    if (currentPageId) {
      this.renderCurrentPanel();
    }
  }

  handleScroll(): void {
    // Panel mode doesn't scroll
    return;
  }

  // Page Navigation Methods
  isNextPage(): boolean {
    const pageIds = Array.from(this.pageContainers.keys());
    return this.currentPageIndex < pageIds.length - 1;
  }

  isPreviousPage(): boolean {
    return this.currentPageIndex > 0;
  }

  nextPage(): void {
    const currentPageId = this.getCurrentPageId();
    if (!currentPageId) return;

    const pageIds = Array.from(this.pageContainers.keys());
    this.currentPageIndex = Math.min(
      pageIds.indexOf(currentPageId) + 1,
      pageIds.length - 1
    );
    this.renderCurrentPanel();
  }

  previousPage(): void {
    const currentPageId = this.getCurrentPageId();
    if (!currentPageId) return;

    const pageIds = Array.from(this.pageContainers.keys());
    this.currentPageIndex = Math.max(pageIds.indexOf(currentPageId) - 1, 0);
    this.renderCurrentPanel();
  }

  // Navigation methods
  nextPanel(): void {
    const currentPageId = Array.from(this._visiblePages)[0];
    if (!currentPageId) return;
    const panels = this.panelData.get(currentPageId);
    if (!panels) return;

    if (this.currentPanelIndex < panels.length - 1) {
      this.currentPanelIndex++;
      this.handlers?.renderVisiblePage(currentPageId);
    }
  }

  previousPanel(): void {
    const currentPageId = this.getCurrentPageId();
    if (!currentPageId || this.currentPanelIndex <= 0) return;
    this.currentPanelIndex--;
    this.renderCurrentPanel();
  }

  togglePlayback(): void {
    this.playbackController.toggle();
  }

  determineCurrentPage(): string | null {
    const pageIds = Array.from(this.pageContainers.keys());
    if (!this.getCurrentPageId()) {
      return pageIds[0] || null;
    }
    return pageIds[this.currentPageIndex];
  }

  checkVisiblePages(): void {
    // Panel mode shows one page at a time
    this._visiblePages.clear();

    const firstPageId = Array.from(this.pageContainers.keys())[0];
    if (firstPageId) {
      this._visiblePages.add(firstPageId);

      if (this.handlers?.needsLoad(firstPageId)) {
        const pageEl = this.pageContainers.get(firstPageId);
        const url = pageEl?.dataset.url;
        const status = pageEl?.dataset.status as ProcessingStatus;
        if (status === ProcessingStatus.COMPLETED && url) {
          this.handlers?.enqueuePageLoad(firstPageId, url);
          this.handlers?.processLoadingQueue();
        }
      }
    }
  }

  render(allPages: PageData[]): void {
    // TODO: consider using a page container for the pages
    const pageContainer = document.createElement("div");
    pageContainer.className = "manga-scroll-container";
    pageContainer.style.position = "absolute";
    pageContainer.style.top = "0";
    pageContainer.style.left = "0";
    pageContainer.style.width = "100%";
    pageContainer.style.height = "auto";
    pageContainer.style.zIndex = "-1";
    pageContainer.style.visibility = "hidden";
    this.parentRef.appendChild(pageContainer);

    allPages.forEach(({ fileName, pageNumber, url, status }) => {
      const pageId = `${fileName}_${pageNumber}`;
      const pageEl = document.createElement("div");
      pageEl.id = `page-${pageId}`;
      pageEl.dataset.pageId = pageId;
      pageEl.dataset.url = url || "";
      pageEl.dataset.status = status;
      pageEl.className = "manga-page-placeholder";
      pageEl.style.width = "100%";
      this.pageContainers.set(pageId, pageEl);
    });
  }

  protected preloadModeSpecificData(
    currentPageId: string,
    allPageIds: string[],
    currentIndex: number
  ): void {
    // Preload panels for current page if needed
    if (!this.panelData.has(currentPageId)) {
      this.wsManager.requestPanelData(currentPageId);
    }

    // Preload panels for next pages
    for (let i = 1; i <= PRELOAD_AHEAD; i++) {
      const nextIndex = currentIndex + i;
      if (nextIndex >= allPageIds.length) break;

      const nextPageId = allPageIds[nextIndex];
      if (!this.panelData.has(nextPageId)) {
        this.wsManager.requestPanelData(nextPageId);
      }
    }
  }
}
