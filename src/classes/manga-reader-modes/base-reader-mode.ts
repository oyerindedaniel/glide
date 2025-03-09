import { ProcessingStatus } from "@/store/processed-files";
import { PageDimensions } from "@/types/manga-reader";

export abstract class BaseReaderMode {
  protected canvas: HTMLCanvasElement;
  protected context: CanvasRenderingContext2D | null;
  protected currentPageId: string | null = null;
  protected pageContainers: Map<string, HTMLDivElement>;
  protected imageCache: Map<string, HTMLImageElement>;
  protected pageDimensions: Map<string, PageDimensions>;
  protected parentRef: HTMLElement;

  constructor(
    canvas: HTMLCanvasElement,
    context: CanvasRenderingContext2D | null,
    pageContainers: Map<string, HTMLDivElement>,
    imageCache: Map<string, HTMLImageElement>,
    pageDimensions: Map<string, PageDimensions>,
    parentRef: HTMLElement
  ) {
    this.canvas = canvas;
    this.context = context;
    this.pageContainers = pageContainers;
    this.imageCache = imageCache;
    this.pageDimensions = pageDimensions;
    this.parentRef = parentRef;
  }

  abstract initialize(): void;
  abstract cleanup(): void;
  abstract renderPage(pageId: string): void;
  abstract handleResize(): void;
  abstract handleScroll?(): void;

  protected getHeightFromAspectRatio(
    containerWidth: number,
    dimensions: PageDimensions
  ): number {
    const aspectRatio = dimensions.height / dimensions.width;
    return Math.floor(containerWidth * aspectRatio);
  }
}
