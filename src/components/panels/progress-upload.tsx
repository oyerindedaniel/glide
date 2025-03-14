"use client";

import React, { memo, useCallback, useEffect, useState } from "react";
import {
  Panel,
  PanelContent,
  PanelTitle,
  PanelBody,
  PanelHeader,
  PanelDescription,
  PanelIcon,
} from "../ui/panel";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "../ui/accordion";
import {
  PageStatus,
  ProcessingStatus,
  useProcessedFilesStore,
} from "@/store/processed-files";
import { PanelType, usePanelStore } from "@/store/panel";
import { PANEL_IDS } from "@/constants/panel";
import Image from "next/image";
import { ProgressPulseContent, ProgressPulseRoot } from "../ui/progress-pulse";
import { ScrollArea } from "../ui/scroll-area";
import { FILE_INPUT_TYPES } from "@/constants/processing";
import { SortableRoot, SortableItem, SortableContent } from "../sortable";
import { arrayMove } from "@dnd-kit/sortable";
import {
  DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  SensorDescriptor,
  SensorOptions,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  restrictToVerticalAxis,
  restrictToParentElement,
} from "@dnd-kit/modifiers";
import { useShallow } from "zustand/shallow";
import { Upload, Search } from "lucide-react";
import { useImagePreviewStore } from "@/store/image-preview";

type Sensor = SensorDescriptor<SensorOptions>[];

// ----- Utility Functions -----
const isSortingDisabled = (
  status: ProcessingStatus,
  itemCount: number
): boolean => {
  return ProcessingStatus.COMPLETED !== status || itemCount <= 1;
};

// ----- Sub-Components -----

// TODO: optimize this component

// PDF Page Item Component
const PageItem = memo(
  ({
    fileName,
    page,
    pageData,
    disabled,
  }: {
    fileName: string;
    page: number;
    pageData: { status: ProcessingStatus; url: string | null };
    disabled: boolean;
  }) => {
    const { openImagePreview } = useImagePreviewStore();

    const handleImageClick = (e: React.MouseEvent) => {
      e.stopPropagation();
      if (pageData.url) {
        openImagePreview(
          pageData.url,
          `Page ${page}`,
          `${fileName} - Page ${page}`
        );
      }
    };

    return (
      <SortableItem
        key={`${fileName}-${page}`}
        id={`${fileName}-${page}`}
        disabled={disabled}
      >
        <div
          className="flex items-center gap-5 justify-between py-2 w-full"
          style={{
            contentVisibility: "auto",
            containIntrinsicSize: "54px",
          }}
        >
          <div className="inline-flex items-center gap-5">
            <div className="relative w-10 h-10 overflow-hidden rounded-sm group">
              <Image
                src={pageData.url || "/PDF-upload-icon.svg"}
                className="w-10 h-10 object-cover cursor-pointer hover:scale-110 transition-transform duration-300"
                alt={`Page ${page}`}
                width={40}
                height={40}
                onClick={handleImageClick}
              />
              {pageData.url && (
                <div
                  className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                  onClick={handleImageClick}
                >
                  <Search className="h-4 w-4 text-white" />
                </div>
              )}
            </div>
            <span className="text-sm">{`Page ${page}`}</span>
          </div>
          <ProgressPulseRoot status={pageData.status}>
            <ProgressPulseContent />
          </ProgressPulseRoot>
        </div>
      </SortableItem>
    );
  }
);
PageItem.displayName = "PageItem";

// Sortable Pages List Component
const SortablePagesList = memo(
  ({
    fileName,
    pages,
    sensors,
    onDragEnd,
  }: {
    fileName: string;
    pages: Map<number, { status: ProcessingStatus; url: string | null }>;
    sensors: Sensor;
    onDragEnd: (event: DragEndEvent) => void;
  }) => (
    <SortableRoot
      sensors={sensors}
      items={Array.from(pages.keys()).map((pageNumber) => ({
        id: `${fileName}-${pageNumber}`,
      }))}
      onDragEnd={onDragEnd}
      modifiers={[restrictToVerticalAxis, restrictToParentElement]}
    >
      <SortableContent>
        {Array.from(pages.entries()).map(([page, pageData]) => (
          <PageItem
            key={`${fileName}-${page}`}
            fileName={fileName}
            page={page}
            pageData={pageData}
            disabled={isSortingDisabled(pageData.status, pages.size)}
          />
        ))}
      </SortableContent>
    </SortableRoot>
  )
);
SortablePagesList.displayName = "SortablePagesList";

// PDF File Item Component
const PdfFileItem = memo(
  ({
    fileName,
    pages,
    status,
    sensors,
    openAccordions,
    onAccordionChange,
    onPageDragEnd,
  }: {
    fileName: string;
    pages: Map<number, { status: ProcessingStatus; url: string | null }>;
    status: ProcessingStatus;
    sensors: Sensor;
    openAccordions: string[];
    onAccordionChange: (values: string[]) => void;
    onPageDragEnd: (event: DragEndEvent) => void;
  }) => (
    <Accordion
      type="multiple"
      className="w-full"
      value={openAccordions}
      onValueChange={onAccordionChange}
    >
      <AccordionItem value={fileName} className="w-full">
        <AccordionTrigger className="w-full">
          <div className="inline-flex items-center gap-8 w-full">
            <span>{fileName}</span>
            <ProgressPulseRoot status={status}>
              <ProgressPulseContent />
            </ProgressPulseRoot>
          </div>
        </AccordionTrigger>
        <AccordionContent>
          <SortablePagesList
            fileName={fileName}
            pages={pages}
            sensors={sensors}
            onDragEnd={onPageDragEnd}
          />
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  )
);
PdfFileItem.displayName = "PdfFileItem";

// Image File Item Component
const ImageFileItem = memo(
  ({
    fileName,
    pages,
  }: {
    fileName: string;
    pages: Map<number, { status: ProcessingStatus; url: string | null }>;
  }) => {
    const firstPage = Array.from(pages.values())[0];
    const { openImagePreview } = useImagePreviewStore();

    const handleImageClick = (e: React.MouseEvent) => {
      e.stopPropagation();
      if (firstPage?.url) {
        openImagePreview(firstPage.url, fileName, fileName);
      }
    };

    return (
      <div className="flex items-center gap-5 justify-between py-2">
        <div className="inline-flex items-center gap-5">
          <div className="relative w-10 h-10 overflow-hidden rounded-sm group">
            <Image
              src={firstPage?.url || "/JPG-upload-icon.svg"}
              alt={fileName}
              className="w-10 h-10 object-cover cursor-pointer hover:scale-110 transition-transform duration-300"
              width={30}
              height={30}
              onClick={handleImageClick}
            />
            {firstPage?.url && (
              <div
                className="absolute inset-0 flex items-center justify-center bg-black/80 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                onClick={handleImageClick}
              >
                <Search className="h-4 w-4 text-white" />
              </div>
            )}
          </div>
          <span>{fileName}</span>
        </div>
        <ProgressPulseRoot status={firstPage?.status}>
          <ProgressPulseContent />
        </ProgressPulseRoot>
      </div>
    );
  }
);
ImageFileItem.displayName = "ImageFileItem";

// File Item Component (determines whether to show PDF or Image version)
const FileItem = memo(
  ({
    fileName,
    pages,
    fileType,
    status,
    sensors,
    openAccordions,
    onAccordionChange,
    onPageDragEnd,
    disabled,
  }: {
    fileName: string;
    pages: Map<number, { status: ProcessingStatus; url: string | null }>;
    fileType: string | undefined;
    status: ProcessingStatus;
    sensors: Sensor;
    openAccordions: string[];
    onAccordionChange: (values: string[]) => void;
    onPageDragEnd: (event: DragEndEvent) => void;
    disabled: boolean;
  }) => (
    <SortableItem key={fileName} id={fileName} disabled={disabled}>
      <div
        className="w-full"
        style={{
          contentVisibility: "auto",
          containIntrinsicSize: "54px",
        }}
      >
        {fileType === FILE_INPUT_TYPES.PDF ? (
          <PdfFileItem
            fileName={fileName}
            pages={pages}
            status={status}
            sensors={sensors}
            openAccordions={openAccordions}
            onAccordionChange={onAccordionChange}
            onPageDragEnd={onPageDragEnd}
          />
        ) : (
          <ImageFileItem fileName={fileName} pages={pages} />
        )}
      </div>
    </SortableItem>
  )
);
FileItem.displayName = "FileItem";

// Panel Title Component
const UploadPanelHeader = memo(
  ({
    totalFiles,
    processedFiles,
    allFilesProcessed,
  }: {
    totalFiles: number;
    processedFiles: Map<string, Map<number, PageStatus>>;
    allFilesProcessed: boolean;
  }) => (
    <PanelHeader className="flex items-start gap-4">
      <PanelIcon>
        <Upload aria-hidden="true" className="h-3 w-3" />
        <span className="sr-only">Upload</span>
      </PanelIcon>
      <div>
        <PanelTitle>File Upload In Progress</PanelTitle>
        <PanelDescription>
          {allFilesProcessed
            ? "All files have been successfully processed!"
            : `Processing ${processedFiles.size} of ${totalFiles} files — Hang tight, we're almost done!`}
        </PanelDescription>
      </div>
    </PanelHeader>
  )
);
UploadPanelHeader.displayName = "UploadPanelHeader";

// ----- Main Component -----
export function ProgressUpload() {
  const {
    totalFiles,
    processedFiles,
    allFilesProcessed,
    fileMetadata,
    fileStatus,
    reorderFiles,
    reorderPages,
  } = useProcessedFilesStore(
    useShallow((state) => ({
      totalFiles: state.totalFiles,
      processedFiles: state.processedFiles,
      allFilesProcessed: state.allFilesProcessed,
      fileMetadata: state.fileMetadata,
      fileStatus: state.fileStatus,
      reorderFiles: state.reorderFiles,
      reorderPages: state.reorderPages,
    }))
  );

  const { centerStack, closePanel, openPanel } = usePanelStore(
    useShallow((state) => ({
      centerStack: state.centerStack,
      closePanel: state.closePanel,
      openPanel: state.openPanel,
    }))
  );
  const [openAccordions, setOpenAccordions] = useState<string[]>([]);

  const isOpen = centerStack.includes(PANEL_IDS.PROGRESS_UPLOAD);

  const handlePanelOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        openPanel(PANEL_IDS.PROGRESS_UPLOAD, PanelType.CENTER);
      } else {
        closePanel(PANEL_IDS.PROGRESS_UPLOAD, PanelType.CENTER);
      }
    },
    [closePanel, openPanel]
  );

  // Auto-close panel when no files
  useEffect(() => {
    if (totalFiles <= 0) {
      handlePanelOpenChange(false);
    }
  }, [handlePanelOpenChange, totalFiles]);

  // File reordering handler
  const handleFileDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (active.id !== over?.id) {
        const fileNames = Array.from(processedFiles.keys());
        const oldIndex = fileNames.indexOf(active.id as string);
        const newIndex = fileNames.indexOf(over?.id as string);
        if (oldIndex !== -1 && newIndex !== -1) {
          const newOrder = arrayMove(fileNames, oldIndex, newIndex);
          reorderFiles(newOrder);
        }
      }
    },
    [processedFiles, reorderFiles]
  );

  // Page reordering handler factory
  const handlePageDragEnd = useCallback(
    (fileName: string) => (event: DragEndEvent) => {
      const { active, over } = event;
      if (active.id !== over?.id) {
        const pages = processedFiles.get(fileName);
        if (!pages) return;
        const pageNumbers = Array.from(pages.keys());
        const activePage = Number((active.id as string).split("-").pop());
        const overPage = Number((over?.id as string).split("-").pop());
        const oldIndex = pageNumbers.indexOf(activePage);
        const newIndex = pageNumbers.indexOf(overPage);
        if (oldIndex !== -1 && newIndex !== -1) {
          const newOrder = arrayMove(pageNumbers, oldIndex, newIndex);
          reorderPages(fileName, newOrder);
        }
      }
    },
    [processedFiles, reorderPages]
  );

  // Drag start handler
  const handleDragStart = useCallback(() => {
    setOpenAccordions([]); // Close all accordions during drag
  }, []);

  // DnD sensors setup
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(KeyboardSensor)
  );

  return (
    <>
      <Panel open={isOpen} onOpenChange={handlePanelOpenChange} withOverlay>
        <PanelContent
          className="left-2/4 top-2/4 -translate-x-2/4 -translate-y-2/4 max-w-150 w-full"
          id={PANEL_IDS.PROGRESS_UPLOAD}
        >
          <UploadPanelHeader
            totalFiles={totalFiles}
            processedFiles={processedFiles}
            allFilesProcessed={allFilesProcessed}
          />

          <PanelBody className="text-sm">
            <h2>Total File(s): {totalFiles}</h2>
            <ScrollArea className="h-fit w-full pr-3">
              <div className="max-h-75">
                <SortableRoot
                  sensors={sensors}
                  items={Array.from(processedFiles.keys()).map((fileName) => ({
                    id: fileName,
                  }))}
                  onDragStart={handleDragStart}
                  onDragEnd={handleFileDragEnd}
                  modifiers={[restrictToVerticalAxis, restrictToParentElement]}
                >
                  <SortableContent>
                    {Array.from(processedFiles.entries()).map(
                      ([fileName, pages]) => {
                        const fileType = fileMetadata.get(fileName)?.type;
                        const status = fileStatus.get(fileName);
                        return (
                          <FileItem
                            key={fileName}
                            fileName={fileName}
                            pages={pages}
                            fileType={fileType}
                            status={status!}
                            sensors={sensors}
                            openAccordions={openAccordions}
                            onAccordionChange={setOpenAccordions}
                            onPageDragEnd={handlePageDragEnd(fileName)}
                            disabled={isSortingDisabled(
                              status!,
                              processedFiles.size
                            )}
                          />
                        );
                      }
                    )}
                  </SortableContent>
                </SortableRoot>
              </div>
            </ScrollArea>
          </PanelBody>
        </PanelContent>
      </Panel>
    </>
  );
}

export default memo(ProgressUpload);
