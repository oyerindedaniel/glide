import { memo } from "react";
import { Play, SkipBack, SkipForward } from "lucide-react";
import { Button } from "../ui/button";

interface PanelControlsProps {
  onPanelControl: (action: "prev" | "next" | "play") => void;
}

export const PanelControls = memo(function PanelControls({
  onPanelControl,
}: PanelControlsProps) {
  return (
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
  );
});
