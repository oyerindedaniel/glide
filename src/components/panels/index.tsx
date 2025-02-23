"use client";

import { PanelAbortProcessing } from "./panel-abort-processing";
import { useIsMounted } from "@/hooks/use-is-mounted";

export function Panels() {
  const isMounted = useIsMounted();

  if (!isMounted) return;

  return (
    <>
      <PanelAbortProcessing />
    </>
  );
}
