"use client";

import * as React from "react";
import {
  InfoIcon,
  FileIcon,
  FileTextIcon,
  FilesIcon,
  HardDriveIcon,
  ImageIcon,
  TagIcon,
} from "lucide-react";
import { formatFileSize } from "@/utils/file";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import {
  PDF_MAX_FILES_IN_BATCH,
  PDF_SINGLE_FILE_MAX_SIZE,
  PDF_BATCH_FILE_MAX_SIZE,
  PDF_TOTAL_BATCH_MAX_SIZE,
  IMAGE_MAX_FILES_IN_BATCH,
  IMAGE_SINGLE_FILE_MAX_SIZE,
  IMAGE_TOTAL_BATCH_MAX_SIZE,
  MAX_FILENAME_LENGTH,
} from "@/config/app";
import { Button } from "./ui/button";

type LimitItem = {
  icon: React.ReactNode;
  label: string;
  value: string | number;
};

type FileTypeConfig = {
  icon: React.ReactNode;
  title: string;
  limits: LimitItem[];
};

const FileInfoCard = () => {
  const fileTypeConfigs: FileTypeConfig[] = [
    {
      icon: <FileTextIcon className="h-4 w-4 text-blue-400" />,
      title: "PDF Files",
      limits: [
        {
          icon: <FileIcon className="h-3.5 w-3.5 text-neutral-500 mr-2" />,
          label: "Max file size",
          value: formatFileSize(PDF_SINGLE_FILE_MAX_SIZE),
        },
        {
          icon: <FileIcon className="h-3.5 w-3.5 text-neutral-500 mr-2" />,
          label: "Size in batch",
          value: formatFileSize(PDF_BATCH_FILE_MAX_SIZE),
        },
        {
          icon: <HardDriveIcon className="h-3.5 w-3.5 text-neutral-500 mr-2" />,
          label: "Total upload limit",
          value: formatFileSize(PDF_TOTAL_BATCH_MAX_SIZE),
        },
        {
          icon: <FilesIcon className="h-3.5 w-3.5 text-neutral-500 mr-2" />,
          label: "Files per upload",
          value: PDF_MAX_FILES_IN_BATCH,
        },
      ],
    },
    {
      icon: <ImageIcon className="h-4 w-4 text-purple-400" />,
      title: "Image Files",
      limits: [
        {
          icon: <FileIcon className="h-3.5 w-3.5 text-neutral-500 mr-2" />,
          label: "Max file size",
          value: formatFileSize(IMAGE_SINGLE_FILE_MAX_SIZE),
        },
        {
          icon: <HardDriveIcon className="h-3.5 w-3.5 text-neutral-500 mr-2" />,
          label: "Total upload limit",
          value: formatFileSize(IMAGE_TOTAL_BATCH_MAX_SIZE),
        },
        {
          icon: <FilesIcon className="h-3.5 w-3.5 text-neutral-500 mr-2" />,
          label: "Files per upload",
          value: IMAGE_MAX_FILES_IN_BATCH,
        },
        {
          icon: <TagIcon className="h-3.5 w-3.5 text-neutral-500 mr-2" />,
          label: "Max filename length",
          value: `${MAX_FILENAME_LENGTH} chars`,
        },
      ],
    },
  ];

  return (
    <HoverCard openDelay={150} closeDelay={100}>
      <HoverCardTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className="p-0 bg-transparent! h-fit text-white hover:scale-105 hover:text-white! transition-transform duration-200"
          aria-label="File upload restrictions"
        >
          <InfoIcon className="h-4 w-4" />
        </Button>
      </HoverCardTrigger>

      <HoverCardContent className="w-[32rem] p-0 border border-neutral-800 bg-black/95 rounded-lg overflow-hidden shadow-xl">
        <div className="grid grid-cols-2 divide-x divide-neutral-800">
          {fileTypeConfigs.map((config, index) => (
            <div className="p-4" key={index}>
              <div className="flex items-center gap-2 mb-3 border-b border-neutral-800 pb-2">
                {config.icon}
                <h3 className="font-medium text-white text-sm">
                  {config.title}
                </h3>
              </div>
              <div className="space-y-3 text-xs">
                {config.limits.map((limit, idx) => (
                  <div className="flex items-center" key={idx}>
                    {limit.icon}
                    <span className="text-neutral-400 flex-1">
                      {limit.label}
                    </span>
                    <span className="text-neutral-200 font-medium">
                      {limit.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
};

export default FileInfoCard;
