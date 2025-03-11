import { ProcessingStatus } from "@/store/processed-files";

export enum ViewMode {
  SCROLL = "scroll",
  PANEL = "panel",
}

export interface PanelData {
  id: number;
  bbox: [number, number, number, number]; // [x, y, width, height]
  text?: string;
}

export interface PagePanelData {
  pageId: string;
  panels: PanelData[];
}

export interface MangaPage {
  fileName: string;
  pageNumber: number;
  url: string;
  status: ProcessingStatus;
}

export interface PageDimensions {
  width: number;
  height: number;
}
