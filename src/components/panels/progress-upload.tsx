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
import { useProcessedFilesStore } from "@/store/processed-files";
import { PanelType, usePanelStore } from "@/store/panel";
import { PANEL_IDS } from "@/constants/panel";
import Image from "next/image";
import { ProgressPulseContent, ProgressPulseRoot } from "../ui/progress-pulse";
import { ScrollArea } from "../ui/scroll-area";
import { FILE_INPUT_TYPES } from "@/constants/processing";

/**
 * ProgressUpload Component
 * Displays the upload progress with a detailed accordion for each file.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface ProgressUploadProps {}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function ProgressUpload(props: ProgressUploadProps) {
  const {
    totalFiles,
    processedFiles,
    allFilesProcessed,
    fileMetadata,
    fileStatus,
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
      console.log("in heresh");
      onOpenChange(false);
    }
  }, [onOpenChange, totalFiles]);

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
          <h2 className="mb-2">Total Files: {totalFiles}</h2>
          <ScrollArea className="h-fit w-full pr-3">
            <div className="max-h-75 space-y-4">
              {Array.from(processedFiles.entries()).map(
                ([fileName, pages], idx) => {
                  const fileType = fileMetadata.get(fileName)?.type;
                  const status = fileStatus.get(fileName);
                  return fileType === FILE_INPUT_TYPES.PDF ? (
                    <Accordion key={`${fileName}-${idx}`} type="multiple">
                      <AccordionItem value={fileName}>
                        <AccordionTrigger>
                          <div className="inline-flex items-center gap-8">
                            <span>{fileName}</span>
                            <ProgressPulseRoot status={status!}>
                              <ProgressPulseContent />
                            </ProgressPulseRoot>
                          </div>
                        </AccordionTrigger>
                        <AccordionContent>
                          {Array.from(pages.entries()).map(
                            ([page, { status }]) => (
                              <div
                                key={page}
                                className="flex items-center gap-5 justify-between py-2"
                              >
                                <div className="inline-flex items-center gap-5">
                                  <Image
                                    src="/PDF-upload-icon.svg"
                                    className="w-10 h-10 object-cover"
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
                            )
                          )}
                        </AccordionContent>
                      </AccordionItem>
                    </Accordion>
                  ) : (
                    <div
                      key={`${fileName}-${idx}`}
                      className="flex items-center gap-5 justify-between py-2"
                    >
                      <div className="inline-flex items-center gap-5">
                        <Image
                          src={Array.from(pages.values())[0]?.url || ""}
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
                  );
                }
              )}
            </div>
          </ScrollArea>
        </PanelBody>
      </PanelContent>
    </Panel>
  );
}

export default memo(ProgressUpload);
