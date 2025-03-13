"use client";

import { useIsMounted } from "@/hooks/use-is-mounted";
import ProgressUpload from "./progress-upload";
import { ImagePreview } from "@/components/ui/image-preview";

export function Panels() {
  const isMounted = useIsMounted();

  if (!isMounted) return;

  return (
    <div className="absolute">
      <ProgressUpload />
      <ImagePreview />
    </div>
  );
}
