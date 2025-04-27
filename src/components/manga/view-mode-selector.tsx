import { memo } from "react";
import { Button } from "../ui/button";
import { ViewMode } from "@/types/manga-reader";
import { ScrollText, Layers } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

interface ViewModeSelectorProps {
  currentMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
}

export const ViewModeSelector = memo(function ViewModeSelector({
  currentMode,
  onViewModeChange,
}: ViewModeSelectorProps) {
  return (
    <div className="flex flex-col">
      <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2 text-right">
        Mode
      </h3>
      <div className="h-px bg-gray-200/20 w-full mb-3" />

      <div className="flex items-center gap-2  justify-end">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon"
              variant={currentMode === ViewMode.SCROLL ? "default" : "ghost"}
              onClick={() => onViewModeChange(ViewMode.SCROLL)}
              className="h-9 w-9"
              disabled
            >
              <ScrollText className="h-5 w-5" />
              <span className="sr-only">Scroll Mode</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>Scroll Mode</p>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon"
              variant={currentMode === ViewMode.PANEL ? "default" : "ghost"}
              onClick={() => onViewModeChange(ViewMode.PANEL)}
              className="h-9 w-9"
              disabled
            >
              <Layers className="h-5 w-5" />
              <span className="sr-only">Panel Mode</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>Panel Mode</p>
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
});
