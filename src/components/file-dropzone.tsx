import * as React from "react";
import { forwardRef } from "react";
import { FileUploadIcons } from "./file-upload-icons";

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface FileDropZoneProps {}

export const FileDropZone = forwardRef<HTMLDivElement, FileDropZoneProps>(
  function FileDropZone(props, ref) {
    return (
      <div>
        <div className="drop-overlay absolute inset-0 pointer-events-none opacity-0" />
        <div
          ref={ref}
          className="w-fit left-2/4 -translate-x-2/4 absolute top-[30%]"
        >
          <FileUploadIcons />
          <div className="mt-5">
            <p className="font-[family-name:var(--font-manrope)] text-center text-sm">
              Drop your file(s) here
            </p>
          </div>
        </div>
      </div>
    );
  }
);
