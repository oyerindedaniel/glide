/* eslint-disable @typescript-eslint/no-unused-vars */
import { debounce, throttle } from "@/utils/app";
import { BaseReaderMode } from "./base-reader-mode";
import { ProcessingStatus } from "@/store/processed-files";
import { MangaPage } from "@/types/manga-reader";

const DEFAULT_ASPECT_RATIO = 1.5; // Default for initial placeholder heights

export class ScrollReaderMode extends BaseReaderMode {
  private lastScrollTop: number = 0;
  private transitionTimeout: ReturnType<typeof setTimeout> | null = null;
  private lastTransition: string | null = null;
  private sortedPageIds: string[] = [];
  private observer: IntersectionObserver;
  private throttledPageRenderer: () => void;

  constructor(...args: ConstructorParameters<typeof BaseReaderMode>) {
    super(...args);
    this.observer = new IntersectionObserver(
      this.debouncedHandleIntersection.bind(this),
      {
        root: null,
        rootMargin: "0px",
        threshold: [0, 0.5, 1],
      }
    );

    this.throttledPageRenderer = throttle(() => {
      const newCurrentPage = this.determineCurrentPage();
      const currentPageId = this.getCurrentPageId();
      if (
        newCurrentPage &&
        newCurrentPage !== currentPageId &&
        this._visiblePages.has(newCurrentPage)
      ) {
        this.handlers?.renderVisiblePage(newCurrentPage);
      }
    }, 150);
  }

  initialize(): void {
    this.canvas.style.position = "fixed";
    this.canvas.style.top = "0";
    this.canvas.style.left = "0";
    this.canvas.style.transform = "translate3d(0, 0, 0)";
  }

  cleanup(): void {
    this.observer.disconnect();
    this._visiblePages.clear();
    this.lastScrollTop = 0;
    this.sortedPageIds = [];
    if (this.transitionTimeout) {
      clearTimeout(this.transitionTimeout);
    }
  }

  public renderPage(pageId: string): string | void {
    const visibleLoadedPages = Array.from(this._visiblePages).filter(
      (pageId) => this.handlers?.hasLoadedPage(pageId) || false
    );

    if (visibleLoadedPages.length === 0) return;

    const currentPageId = this.getCurrentPageId();
    const allPageIds = Array.from(this.pageContainers.keys());
    const oldIndex = currentPageId ? allPageIds.indexOf(currentPageId) : -1;
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
      this.canvas.style.transition = "none";
    }, 600);

    return pageId;
  }

  handleResize(): void {
    const containerWidth = this.parentRef.clientWidth || window.innerWidth;

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

    const currentPageId = this.getCurrentPageId();
    if (currentPageId) {
      this.throttledPageRenderer();
    }
  }

  handleScroll(): void {
    const currentPageId = this.getCurrentPageId();
    if (!currentPageId) return;

    this.throttledPageRenderer();

    const placeholder = this.pageContainers.get(currentPageId);
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

    const FLOATING_POINT = 2;

    let translateY = 0;
    if (canvasHeight > viewportHeight) {
      if (offsetY < 0) {
        translateY = Math.max(offsetY, maxOffset);
        if (
          translateY - FLOATING_POINT <= maxOffset &&
          scrollDirection === "down"
        ) {
          this.handleOffsetCapping("downward");
        }
      } else if (offsetY > 0) {
        translateY = Math.min(offsetY, 0);
        if (translateY - FLOATING_POINT <= 0 && scrollDirection === "up") {
          this.handleOffsetCapping("upward");
        }
      }
    }

    this.canvas.style.transition = "none";
    this.canvas.style.transform = `translate3d(0, ${translateY}px, 0)`;
  }

  private handleOffsetCapping(direction: "upward" | "downward"): void {
    const currentPageId = this.getCurrentPageId();
    if (!currentPageId) return;

    const pageIds = Array.from(this.pageContainers.keys());
    const currentIndex = pageIds.indexOf(currentPageId);
    if (currentIndex === -1) return;

    let targetId: string | null = null;
    if (direction === "upward" && currentIndex > 0) {
      targetId = pageIds[currentIndex - 1];
    } else if (direction === "downward" && currentIndex < pageIds.length - 1) {
      targetId = pageIds[currentIndex + 1];
    }

    if (!targetId) return;

    const transitionKey = `${currentPageId}_to_${targetId}_${direction}`;
    if (this.lastTransition === transitionKey) return;
    this.lastTransition = transitionKey;

    const targetPlaceholder = this.pageContainers.get(targetId);
    if (!targetPlaceholder) return;

    const viewportHeight = window.innerHeight;
    const targetRect = targetPlaceholder.getBoundingClientRect();
    const targetHeight = targetRect.height;
    const targetTop = targetPlaceholder.offsetTop;

    const scrollTarget =
      direction === "upward"
        ? targetTop + targetHeight - viewportHeight
        : targetTop;

    this.parentRef.scrollTo({
      top: scrollTarget,
      behavior: "smooth",
    });
  }

  private debouncedHandleIntersection = debounce(
    this.handleIntersection.bind(this),
    100
  );

  handleIntersection(entries: IntersectionObserverEntry[]): void {
    let shouldProcessQueue = false;

    entries.forEach((entry) => {
      const pageEl = entry.target as HTMLDivElement;
      const pageId = pageEl.dataset.pageId;
      const url = pageEl.dataset.url || "";
      const status = pageEl.dataset.status as ProcessingStatus;

      if (!pageId) return;

      if (entry.isIntersecting) {
        if (!this._visiblePages.has(pageId)) {
          this._visiblePages.add(pageId);
          if (
            this.handlers?.needsLoad(pageId) &&
            status === ProcessingStatus.COMPLETED &&
            url
          ) {
            this.handlers?.enqueuePageLoad(pageId, url);
            this.preloadNextPages(pageId);
            shouldProcessQueue = true;
          }
        }
      } else {
        this._visiblePages.delete(pageId);
      }
    });

    if (shouldProcessQueue) {
      this.handlers?.processLoadingQueue();
    }
  }

  determineCurrentPage(): string | null {
    if (this.getIsSortedListDirty()) {
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

      if (elTop <= scrollTop && elBottom > scrollTop) {
        return pageId;
      } else if (elTop > scrollTop) {
        right = mid - 1;
      } else {
        left = mid + 1;
      }
    }

    if (this.sortedPageIds.length === 0) return null;

    if (left === 0) {
      return this.sortedPageIds[0];
    } else if (left >= this.sortedPageIds.length) {
      return this.sortedPageIds[this.sortedPageIds.length - 1];
    } else {
      const prevPage = this.sortedPageIds[left - 1];
      const nextPage = this.sortedPageIds[left];
      const prevEl = this.pageContainers.get(prevPage)!;
      const prevBottom = prevEl.offsetTop + prevEl.offsetHeight;
      return scrollTop < prevBottom ? prevPage : nextPage;
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
    this.setIsSortedListDirty(false);
  }

  checkVisiblePages(): void {
    const viewportHeight = window.innerHeight;
    let shouldProcessQueue = false;
    let currentPageId: string | null = null;

    this.pageContainers.forEach((pageEl, pageId) => {
      const rect = pageEl.getBoundingClientRect();
      const isVisible = rect.top < viewportHeight && rect.bottom > 0;
      if (isVisible) {
        this._visiblePages.add(pageId);
        currentPageId = pageId;
        if (this.handlers?.needsLoad(pageId)) {
          const url = pageEl.dataset?.url;
          const status = pageEl.dataset?.status as ProcessingStatus;
          if (status === ProcessingStatus.COMPLETED && url) {
            this.handlers.enqueuePageLoad(pageId, url);
            shouldProcessQueue = true;
          }
        }
      }
    });

    if (shouldProcessQueue) {
      this.handlers?.processLoadingQueue();
    }

    if (currentPageId) {
      this.handlers?.renderVisiblePage(currentPageId);
    }
  }

  render(allPages: MangaPage[]): void {
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
  }

  protected preloadModeSpecificData(
    currentPageId: string,
    allPageIds: string[],
    currentIndex: number
  ): void {
    // ScrollReaderMode doesn't need additional preloading
    // could add scroll-specific preloading here if needed
  }
}
