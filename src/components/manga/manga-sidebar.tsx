"use client";

import { memo } from "react";
import { ViewMode } from "@/types/manga-reader";
import { SidebarHeader } from "./sidebar-header";
import { ViewModeSelector } from "./view-mode-selector";
import { PanelControls } from "./panel-controls";

interface MangaSidebarProps {
  currentMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  onPanelControl: (action: "prev" | "next" | "play") => void;
}

export const MangaSidebar = memo(function MangaSidebar({
  currentMode,
  onViewModeChange,
  onPanelControl,
}: MangaSidebarProps) {
  return (
    <div className="flex flex-col gap-4 justify-between h-full">
      <SidebarHeader />
      <div className="flex flex-col gap-4">
        <ViewModeSelector
          currentMode={currentMode}
          onViewModeChange={onViewModeChange}
        />
        {currentMode === ViewMode.PANEL && (
          <PanelControls onPanelControl={onPanelControl} />
        )}
      </div>
    </div>
  );
});
