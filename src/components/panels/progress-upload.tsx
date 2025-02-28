"use client";

import React, { memo, useCallback, useEffect } from "react";
import {
  Panel,
  PanelContent,
  PanelTitle,
  PanelBody,
  PanelHeader,
  PanelDescription,
} from "../ui/panel";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "../ui/accordion";
import {
  ProcessingStatus,
  useProcessedFilesStore,
} from "@/store/processed-files";
import { PanelType, usePanelStore } from "@/store/panel";
import { PANEL_IDS } from "@/constants/panel";
import Image from "next/image";
import { ProgressPulseContent, ProgressPulseRoot } from "../ui/progress-pulse";
import { ScrollArea } from "../ui/scroll-area";
import { FILE_INPUT_TYPES } from "@/constants/processing";
import { SortableRoot, SortableItem } from "../sortable";
import { arrayMove } from "@dnd-kit/sortable";
import {
  DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";

export function ProgressUpload() {
  const {
    totalFiles,
    processedFiles,
    allFilesProcessed,
    fileMetadata,
    fileStatus,
    reorderFiles,
    reorderPages,
  } = useProcessedFilesStore();
  const { getActivePanels, closePanel, openPanel } = usePanelStore();
  const { center } = getActivePanels();

  const isOpen = center === PANEL_IDS.PROGRESS_UPLOAD;

  const onOpenChange = useCallback(
    (newOpen: boolean) => {
      if (newOpen) {
        openPanel(PANEL_IDS.PROGRESS_UPLOAD, PanelType.CENTER);
      } else {
        closePanel(PANEL_IDS.PROGRESS_UPLOAD, PanelType.CENTER);
      }
    },
    [closePanel, openPanel]
  );

  useEffect(() => {
    if (totalFiles <= 0) {
      onOpenChange(false);
    }
  }, [onOpenChange, totalFiles]);

  const handleFileDragEnd = (event: DragEndEvent) => {
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
  };

  const handlePageDragEnd = (fileName: string) => (event: DragEndEvent) => {
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
  };

  const isSortingDisabled = (
    status: ProcessingStatus,
    itemCount: number
  ): boolean => {
    return ProcessingStatus.COMPLETED !== status || itemCount <= 1;
  };

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(KeyboardSensor)
  );
  return (
    <Panel open={isOpen} onOpenChange={onOpenChange} withOverlay>
      <PanelContent
        className="left-2/4 top-2/4 -translate-x-2/4 -translate-y-2/4 bg-black text-white max-w-150 w-full font-[family-name:var(--font-manrope)]"
        id="panel"
      >
        <PanelHeader>
          <PanelTitle className="text-lg font-semibold">
            File Upload In Progress
          </PanelTitle>
          <PanelDescription className="text-sm text-gray-400">
            {allFilesProcessed
              ? "All files have been successfully processed!"
              : `Processing ${processedFiles.size} of ${totalFiles} files — Hang tight, we're almost done!`}
          </PanelDescription>
        </PanelHeader>
        <PanelBody className="text-sm">
          <h2 className="mb-2">Total File(s): {totalFiles}</h2>
          <ScrollArea className="h-fit w-full pr-3">
            <div className="max-h-75">
              {/* SortableRoot for files */}
              <SortableRoot
                sensors={sensors}
                items={Array.from(processedFiles.keys()).map((fileName) => ({
                  id: fileName,
                }))}
                onDragEnd={handleFileDragEnd}
              >
                {Array.from(processedFiles.entries()).map(
                  ([fileName, pages]) => {
                    const fileType = fileMetadata.get(fileName)?.type;
                    const status = fileStatus.get(fileName);
                    return (
                      <SortableItem
                        key={fileName}
                        id={fileName}
                        disabled={isSortingDisabled(
                          status!,
                          processedFiles.size
                        )}
                      >
                        <div
                          className="w-full"
                          style={{
                            contentVisibility: "auto",
                            containIntrinsicSize: "54px",
                          }}
                        >
                          {fileType === FILE_INPUT_TYPES.PDF ? (
                            <Accordion type="multiple" className="w-full">
                              <AccordionItem
                                value={fileName}
                                className="w-full"
                              >
                                <AccordionTrigger>
                                  <div className="inline-flex items-center gap-8">
                                    <span>{fileName}</span>
                                    <ProgressPulseRoot status={status!}>
                                      <ProgressPulseContent />
                                    </ProgressPulseRoot>
                                  </div>
                                </AccordionTrigger>
                                <AccordionContent>
                                  {/* SortableRoot for pages */}
                                  <SortableRoot
                                    sensors={sensors}
                                    items={Array.from(pages.keys()).map(
                                      (pageNumber) => ({
                                        id: `${fileName}-${pageNumber}`,
                                      })
                                    )}
                                    onDragEnd={handlePageDragEnd(fileName)}
                                  >
                                    {Array.from(pages.entries()).map(
                                      ([page, { status, url }]) => (
                                        <SortableItem
                                          key={`${fileName}-${page}`}
                                          id={`${fileName}-${page}`}
                                          disabled={isSortingDisabled(
                                            status!,
                                            pages.size
                                          )}
                                        >
                                          <div
                                            className="flex items-center gap-5 justify-between py-2 w-full"
                                            style={{
                                              contentVisibility: "auto",
                                              containIntrinsicSize: "54px",
                                            }}
                                          >
                                            <div className="inline-flex items-center gap-5">
                                              <Image
                                                src={
                                                  url || "/PDF-upload-icon.svg"
                                                }
                                                className="w-10 h-10 object-cover rounded-sm"
                                                alt={`Page ${page}`}
                                                width={40}
                                                height={40}
                                              />
                                              <span>{`Page ${page}`}</span>
                                            </div>
                                            <ProgressPulseRoot status={status}>
                                              <ProgressPulseContent />
                                            </ProgressPulseRoot>
                                          </div>
                                        </SortableItem>
                                      )
                                    )}
                                  </SortableRoot>
                                </AccordionContent>
                              </AccordionItem>
                            </Accordion>
                          ) : (
                            <div className="flex items-center gap-5 justify-between py-2">
                              <div className="inline-flex items-center gap-5">
                                <Image
                                  src={
                                    Array.from(pages.values())[0]?.url ||
                                    "/JPG-upload-icon.svg"
                                  }
                                  alt={fileName}
                                  className="w-10 h-10 object-cover rounded-sm"
                                  width={30}
                                  height={30}
                                />
                                <span>{fileName}</span>
                              </div>
                              <ProgressPulseRoot
                                status={Array.from(pages.values())[0]?.status}
                              >
                                <ProgressPulseContent />
                              </ProgressPulseRoot>
                            </div>
                          )}
                        </div>
                      </SortableItem>
                    );
                  }
                )}
              </SortableRoot>
            </div>
          </ScrollArea>
        </PanelBody>
      </PanelContent>
    </Panel>
  );
}

export default memo(ProgressUpload);
