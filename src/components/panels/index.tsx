"use client";

import { useIsMounted } from "@/hooks/use-is-mounted";

export function Panels() {
  const isMounted = useIsMounted();

  if (!isMounted) return;

  return <div className="absolute"></div>;
}
