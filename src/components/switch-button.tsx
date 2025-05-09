"use client";

import { Button } from "./ui/button";
import { Mode } from "@/types/app";

interface SwitchButtonProps {
  onSwitch: () => void;
  style?: React.CSSProperties;
  currentMode: Mode;
}

/**
 * SwitchButton component that toggles between upload and search modes.
 *
 * @param props - Component props.
 * @returns The SwitchButton component.
 */
export function SwitchButton(props: SwitchButtonProps) {
  return (
    <div
      style={props.style}
      className="absolute left-2/4 -translate-x-2/4 z-50 opacity-0 group-data-[loaded=true]:animate-[fade_250ms_ease-in_250ms_forwards]"
    >
      <Button
        variant="link"
        className="p-0 h-max cursor-pointer"
        onClick={props.onSwitch}
      >
        {props.currentMode === Mode.UPLOAD
          ? "Switch to Search"
          : "Switch to Upload"}
      </Button>
    </div>
  );
}
