"use client";

import Image from "next/image";
import Link from "next/link";
import { memo } from "react";
import { Maximize, Play, Pause, SkipBack, SkipForward } from "lucide-react";
import { Button } from "../ui/button";
import { ViewMode } from "@/types/manga-reader";

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
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-8">
        <Button className="" size="icon" variant="ghost">
          <Maximize aria-hidden />
          <span className="sr-only">Maximize screen</span>
        </Button>
        <Link className="cursor-pointer" href="/">
          <Image
            className="w-24"
            src="/manga-glide.svg"
            alt="logo"
            width={133}
            height={30}
            unoptimized
            priority
          />
        </Link>
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant={currentMode === ViewMode.SCROLL ? "default" : "secondary"}
          onClick={() => onViewModeChange(ViewMode.SCROLL)}
        >
          Scroll Mode
        </Button>
        <Button
          variant={currentMode === ViewMode.PANEL ? "default" : "secondary"}
          onClick={() => onViewModeChange(ViewMode.PANEL)}
        >
          Panel Mode
        </Button>
      </div>

      {currentMode === ViewMode.PANEL && (
        <div className="flex items-center gap-2">
          <Button
            size="icon"
            variant="ghost"
            onClick={() => onPanelControl("prev")}
          >
            <SkipBack className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => onPanelControl("play")}
          >
            <Play className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => onPanelControl("next")}
          >
            <SkipForward className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
});
