"use client";

import React, { memo } from "react";
import {
  Panel,
  PanelContent,
  PanelTitle,
  PanelBody,
  PanelFooter,
  PanelClose,
  PanelHeader,
  PanelDescription,
  PanelAction,
} from "../ui/panel";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "../ui/accordion";
import { useProcessedFilesStore } from "@/store/processed-files";
import { PanelType, usePanelStore } from "@/store/panel";
import { PANEL_IDS } from "@/constants/panel";
import Image from "next/image";
import { FILE_INPUT_TYPES } from "@/constants/processing";

/**
 * ProgressUpload Component
 * Displays an upload progress bar.
 */

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface ProgressUploadProps {}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function ProgressUpload(props: ProgressUploadProps) {
  const { totalFiles, processedFiles, allFilesProcessed } =
    useProcessedFilesStore();
  const { getActivePanels, closePanel, openPanel } = usePanelStore();
  const { center } = getActivePanels();

  const isOpen = center === PANEL_IDS.PROGRESS_UPLOAD;

  const onOpenChange = (newOpen: boolean) => {
    if (newOpen) {
      openPanel(PANEL_IDS.PROGRESS_UPLOAD, PanelType.CENTER);
    } else {
      closePanel(PANEL_IDS.PROGRESS_UPLOAD, PanelType.CENTER);
    }
  };

  return (
    <Panel open={isOpen} onOpenChange={onOpenChange}>
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
          <h2>Total Files: {totalFiles}</h2>
          {Array.from(processedFiles.entries()).map(([fileName, pages]) => (
            <div key={fileName}>
              {Array.from(pages.entries()).map(([page, { url, type }]) => (
                <div className="" key={page}>
                  {type === FILE_INPUT_TYPES.PDF ? (
                    <Accordion type="single" collapsible>
                      <AccordionItem value={`Page ${page}`}>
                        <AccordionTrigger>{fileName}</AccordionTrigger>
                        <AccordionContent>
                          <div className="flex items-center gap-5">
                            <Image
                              src="/PNG-upload-icon.svg"
                              alt={`Page ${page}`}
                              width={30}
                              height={30}
                            />
                            <span>{`Page ${page}`}</span>
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    </Accordion>
                  ) : (
                    <Image
                      src={url}
                      alt={`Page ${page}`}
                      width={30}
                      height={30}
                    />
                  )}
                </div>
              ))}
            </div>
          ))}
        </PanelBody>
        {/* <PanelFooter className="flex flex-col gap-3">
          <PanelAction
            className="w-full"
            size="sm"
            variant="outline"
          ></PanelAction>
          <PanelClose className="w-full" size="sm" variant="ghost"></PanelClose>
        </PanelFooter> */}
      </PanelContent>
    </Panel>
  );
}

export default memo(ProgressUpload);
