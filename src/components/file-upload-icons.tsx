import type React from "react";
import Image from "next/image";

export const FileUploadIcons: React.FC = () => (
  <div className="flex items-center pointer-events-none select-none">
    <Image
      className="relative -rotate-[14.39deg] z-0 translate-x-5 translate-y-2.5 w-24 pointer-events-none select-none"
      src="/PNG-upload-icon.svg"
      alt="PNG upload icon"
      width={122}
      height={131}
      unoptimized
    />
    <Image
      className="relative z-10 w-24 pointer-events-none select-none"
      src="/JPG-upload-icon.svg"
      alt="JPG upload icon"
      width={122}
      height={131}
      unoptimized
    />
    <Image
      className="relative rotate-[14.39deg] z-0 -translate-x-5 translate-y-2.5 w-24 pointer-events-none select-none"
      src="/PDF-upload-icon.svg"
      alt="PDF upload icon"
      width={122}
      height={131}
      unoptimized
    />
  </div>
);
