import React, { useState, useCallback, useMemo } from "react";
import Image from "next/image";
import {
  Panel,
  PanelContent,
  PanelIcon,
  PanelHeader,
  PanelTitle,
  PanelBody,
} from "./panel";
import {
  Maximize2,
  ZoomIn,
  ZoomOut,
  Move,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { usePanelStore } from "@/store/panel";
import { PANEL_IDS } from "@/constants/panel";
import { useImagePreviewStore } from "@/store/image-preview";
import { useProcessedFilesStore } from "@/store/processed-files";
import { useShallow } from "zustand/shallow";
import { Button } from "./button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";
import { FILE_INPUT_TYPES } from "@/constants/processing";

const ZOOM_LEVELS = [1, 1.5, 2, 3];

export function ImagePreview() {
  const [zoomLevel, setZoomLevel] = useState(0);
  const currentZoom = ZOOM_LEVELS[zoomLevel];

  const { previewImage, closeImagePreview, openImagePreview } =
    useImagePreviewStore(
      useShallow((state) => ({
        previewImage: state.previewImage,
        closeImagePreview: state.closeImagePreview,
        openImagePreview: state.openImagePreview,
      }))
    );

  const { centerStack } = usePanelStore(
    useShallow((state) => ({
      centerStack: state.centerStack,
    }))
  );

  const allPages = useProcessedFilesStore(
    useShallow((state) => state.allPages)
  );

  const { currentIndex, hasPrevious, hasNext, previousPage, nextPage } =
    useMemo(() => {
      if (!previewImage?.src || allPages.length === 0) {
        return {
          currentIndex: -1,
          hasPrevious: false,
          hasNext: false,
          previousPage: null,
          nextPage: null,
        };
      }

      const currentIndex = allPages.findIndex(
        (page) => page.url === previewImage.src
      );

      const hasPrevious = currentIndex > 0;
      const hasNext = currentIndex >= 0 && currentIndex < allPages.length - 1;

      const previousPage = hasPrevious ? allPages[currentIndex - 1] : null;
      const nextPage = hasNext ? allPages[currentIndex + 1] : null;

      return { currentIndex, hasPrevious, hasNext, previousPage, nextPage };
    }, [previewImage?.src, allPages]);

  const isOpen = centerStack.includes(PANEL_IDS.IMAGE_PREVIEW);

  const handleZoomIn = () => {
    if (zoomLevel < ZOOM_LEVELS.length - 1) {
      setZoomLevel(zoomLevel + 1);
    }
  };

  const handleZoomOut = () => {
    if (zoomLevel > 0) {
      setZoomLevel(zoomLevel - 1);
    }
  };

  const handleReset = () => {
    setZoomLevel(0);
  };

  const handlePrevious = useCallback(() => {
    if (hasPrevious && previousPage) {
      const isPdf = previousPage.fileType === FILE_INPUT_TYPES.PDF;

      const pageName = isPdf
        ? `${previousPage.fileName} - Page ${previousPage.pageNumber}`
        : previousPage.fileName;

      openImagePreview(previousPage.url, pageName, pageName);
    }
  }, [hasPrevious, previousPage, openImagePreview]);

  const handleNext = useCallback(() => {
    if (hasNext && nextPage) {
      const isPdf = nextPage.fileType === FILE_INPUT_TYPES.PDF;

      const pageName = isPdf
        ? `${nextPage.fileName} - Page ${nextPage.pageNumber}`
        : nextPage.fileName;

      openImagePreview(nextPage.url, pageName, pageName);
    }
  }, [hasNext, nextPage, openImagePreview]);

  React.useEffect(() => {
    setZoomLevel(0);
  }, [previewImage?.src, isOpen]);

  if (!previewImage?.src) return null;

  return (
    <Panel
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) closeImagePreview();
      }}
      withOverlay
    >
      <PanelContent
        className="left-2/4 top-2/4 -translate-x-2/4 -translate-y-2/4 max-w-[90vw] max-h-[90vh] w-auto h-auto p-0 flex flex-col"
        panelType="center"
      >
        <PanelHeader className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <PanelIcon>
              <Maximize2 className="h-3 w-3" />
            </PanelIcon>
            <PanelTitle>{previewImage.fileName}</PanelTitle>
          </div>
          <div className="flex items-center space-x-2 mr-9">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  onClick={handleZoomOut}
                  size="icon"
                  variant="subtle"
                  disabled={zoomLevel === 0}
                >
                  <ZoomOut aria-hidden="true" className="h-4 w-4" />
                  <span className="sr-only">Zoom Out</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>Zoom Out</p>
              </TooltipContent>
            </Tooltip>

            <div className="px-2 min-w-12 text-center">
              {Math.round(currentZoom * 100)}%
            </div>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  onClick={handleZoomIn}
                  size="icon"
                  variant="subtle"
                  disabled={zoomLevel === ZOOM_LEVELS.length - 1}
                >
                  <ZoomIn aria-hidden="true" className="h-4 w-4" />
                  <span className="sr-only">Zoom In</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>Zoom In</p>
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button onClick={handleReset} variant="subtle" size="icon">
                  <Move aria-hidden="true" className="h-4 w-4" />
                  <span className="sr-only">Reset Zoom</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>Reset Zoom</p>
              </TooltipContent>
            </Tooltip>
          </div>
        </PanelHeader>
        <PanelBody>
          <div className="relative overflow-auto flex-grow flex items-center justify-center bg-neutral-950">
            {/* Left Navigation Button */}
            {hasPrevious && (
              <div className="absolute left-4 top-1/2 -translate-y-1/2 z-10">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      onClick={handlePrevious}
                      size="icon"
                      variant="subtle"
                    >
                      <ChevronLeft aria-hidden="true" className="h-4 w-4" />
                      <span className="sr-only">Previous Image</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    <p>Previous Image</p>
                  </TooltipContent>
                </Tooltip>
              </div>
            )}

            {/* Right Navigation Button */}
            {hasNext && (
              <div className="absolute right-4 top-1/2 -translate-y-1/2 z-10">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button onClick={handleNext} size="icon" variant="subtle">
                      <ChevronRight aria-hidden="true" className="h-4 w-4" />
                      <span className="sr-only">Next Image</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="left">
                    <p>Next Image</p>
                  </TooltipContent>
                </Tooltip>
              </div>
            )}

            <div
              className={cn(
                "transition-transform duration-300 ease-out",
                currentZoom > 1 && "cursor-move"
              )}
              onClick={(e) => e.stopPropagation()}
            >
              <div
                className="transition-transform duration-300"
                style={{ "--scale": currentZoom } as React.CSSProperties}
              >
                <Image
                  src={previewImage.src}
                  alt={previewImage.alt}
                  width={1200}
                  height={800}
                  className="max-w-full h-auto object-contain max-h-[calc(90vh_-_140px)] scale-[var(--scale)]"
                  quality={100}
                  priority
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
            </div>
          </div>
        </PanelBody>

        {/* Image Counter */}
        {currentIndex >= 0 && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 py-1 px-3 bg-black/60 rounded-full text-white text-sm">
            {currentIndex + 1} / {allPages.length}
          </div>
        )}
      </PanelContent>
    </Panel>
  );
}
