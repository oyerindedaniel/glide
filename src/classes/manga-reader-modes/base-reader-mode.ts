/* eslint-disable @typescript-eslint/no-unused-vars */
import { ProcessingStatus } from "@/store/processed-files";
import { PageDimensions } from "@/types/manga-reader";
import { PRELOAD_AHEAD } from "../manga-reader-renderer";
import { MangaPage } from "@/types/manga-reader";

export interface handlers {
  needsLoad: (pageId: string) => boolean;
  enqueuePageLoad: (pageId: string, url: string) => void;
  processLoadingQueue: () => void;
  renderVisiblePage: (pageId: string) => void;
  hasLoadedPage: (pageId: string) => boolean;
  renderPanel: (pageId: string, panelIndex: number) => void;
}

export interface BaseReaderModeParams {
  canvas: HTMLCanvasElement;
  currentPageId: () => string | null;
  isSortedListDirty: () => boolean;
  setIsSortedListDirty: (isDirty: boolean) => void;
  pageContainers: Map<string, HTMLDivElement>;
  pageDimensions: Map<string, PageDimensions>;
  parentRef: HTMLElement;
  handlers?: handlers;
}

export abstract class BaseReaderMode {
  protected canvas: HTMLCanvasElement;
  protected getCurrentPageId: () => string | null;
  protected getIsSortedListDirty: () => boolean;
  protected pageContainers: Map<string, HTMLDivElement>;
  protected pageDimensions: Map<string, PageDimensions>;
  protected parentRef: HTMLElement;
  protected _visiblePages: Set<string> = new Set();
  protected handlers?: handlers;
  protected setIsSortedListDirty: (isDirty: boolean) => void;

  constructor({
    canvas,
    pageContainers,
    currentPageId,
    isSortedListDirty,
    setIsSortedListDirty,
    pageDimensions,
    parentRef,
    handlers,
  }: BaseReaderModeParams) {
    this.canvas = canvas;
    this.pageContainers = pageContainers;
    this.getCurrentPageId = currentPageId;
    this.getIsSortedListDirty = isSortedListDirty;
    this.setIsSortedListDirty = setIsSortedListDirty;
    this.pageDimensions = pageDimensions;
    this.parentRef = parentRef;
    this.handlers = handlers;
  }

  abstract initialize(): void;
  abstract cleanup(): void;
  abstract renderPage(pageId: string): string | void;
  abstract handleResize(): void;
  abstract handleScroll(): void;
  abstract determineCurrentPage(): string | null;
  abstract checkVisiblePages(): void;
  abstract render(allPages: MangaPage[]): void;

  protected getHeightFromAspectRatio(
    containerWidth: number,
    dimensions: PageDimensions
  ): number {
    const aspectRatio = dimensions.height / dimensions.width;
    return Math.floor(containerWidth * aspectRatio);
  }

  protected preloadNextPages(currentPageId: string): void {
    // Base preloading logic for images
    const allPageIds = Array.from(this.pageContainers.keys());
    const currentIndex = allPageIds.indexOf(currentPageId);
    if (currentIndex === -1) return;

    this.preloadModeSpecificData(currentPageId, allPageIds, currentIndex);

    for (let i = 1; i <= PRELOAD_AHEAD; i++) {
      const nextIndex = currentIndex + i;
      if (nextIndex >= allPageIds.length) break;
      if (!this.handlers?.needsLoad(allPageIds[nextIndex])) continue;

      const nextPageId = allPageIds[nextIndex];
      this.preloadPageData(nextPageId);
      this.handlers?.processLoadingQueue();
    }
  }

  // method for mode-specific preloading
  protected preloadModeSpecificData(
    currentPageId: string,
    allPageIds: string[],
    currentIndex: number
  ): void {
    // Base implementation does nothing
    // Derived classes can override this
  }

  // Helper method to preload a single page
  protected preloadPageData(pageId: string): void {
    const pageEl = this.pageContainers.get(pageId);
    if (pageEl && this.handlers?.needsLoad(pageId)) {
      const url = pageEl.dataset?.url;
      const status = pageEl.dataset?.status as ProcessingStatus;
      if (status === ProcessingStatus.COMPLETED && url) {
        this.handlers?.enqueuePageLoad(pageId, url);
      }
    }
  }

  get visiblePages(): Set<string> {
    return this._visiblePages;
  }
}
