"use client";

import React, { useRef, useState } from "react";
import {
  Panel,
  PanelOverlay,
  PanelContent,
  PanelTitle,
  PanelBody,
  PanelFooter,
  PanelClose,
} from "../ui/panel";
import { Button } from "../ui/button";
import { useIsMounted } from "@/hooks/use-is-mounted";

export function PanelAbortProcessing() {
  const [isOpen, setIsOpen] = useState(false);
  const isMounted = useIsMounted();
  const triggerRef = useRef<HTMLButtonElement>(null);

  if (!isMounted) return;

  return (
    <div className="absolute">
      <Button
        ref={triggerRef}
        onClick={() => setIsOpen(true)}
        aria-expanded={isOpen}
        aria-controls="panel"
      >
        Open Controlled Panel
      </Button>

      <Panel open={isOpen} onOpenChange={setIsOpen} triggerRef={triggerRef}>
        <PanelOverlay />
        <PanelContent className="text-black" id="panel">
          <PanelTitle>Controlled Panel</PanelTitle>
          <PanelBody>
            <p>This is a controlled panel.</p>
          </PanelBody>
          <PanelFooter>
            <PanelClose size="sm" variant="outline">
              Close
            </PanelClose>
          </PanelFooter>
        </PanelContent>
      </Panel>
    </div>
  );
}
