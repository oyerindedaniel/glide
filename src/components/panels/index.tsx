"use client";

import { useIsMounted } from "@/hooks/use-is-mounted";
import ProgressUpload from "./progress-upload";

export function Panels() {
  const isMounted = useIsMounted();

  if (!isMounted) return;

  return (
    <div className="absolute">
      <ProgressUpload />
    </div>
  );
}
