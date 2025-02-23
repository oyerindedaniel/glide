"use client";

import { useState, useRef, useCallback, useLayoutEffect } from "react";
import { Background } from "@/components/background";
import { FileDropZone } from "@/components/file-dropzone";
import { SearchInput } from "@/components/search-input";
import { SwitchButton } from "@/components/switch-button";
import { Mode } from "@/types/app";
import ProgressUpload from "@/components/progress-upload";
import { PanelAbortProcessing } from "@/components/panels/panel-abort-processing";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function Home() {
  const [mode, setMode] = useState<Mode>(Mode.UPLOAD);
  const fileDropZoneRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLDivElement>(null);
  const [switchButtonTop, setSwitchButtonTop] = useState<number>(0);
  const [isO, setO] = useState(false);

  /**
   * Updates the position of the switch button based on the active component.
   */
  const updateButtonPosition = useCallback(
    function updateButtonPosition() {
      const activeRef =
        mode === Mode.UPLOAD ? fileDropZoneRef.current : searchInputRef.current;
      if (activeRef) {
        const offsetTop = activeRef.offsetTop;
        const height = activeRef.offsetHeight;

        /* Position the switch button 30px below the active component.
         Since the parent container (Viewport) is positioned relative,
         this top value will be relative to it. */
        setSwitchButtonTop(offsetTop + height + 30);
      }
    },
    [mode]
  );

  useLayoutEffect(() => {
    updateButtonPosition();
  }, [mode, updateButtonPosition]);

  useLayoutEffect(() => {
    window.addEventListener("resize", updateButtonPosition);
    return function () {
      window.removeEventListener("resize", updateButtonPosition);
    };
  }, [updateButtonPosition]);

  function handleSwitch() {
    setMode((prevMode) => {
      return prevMode === Mode.UPLOAD ? Mode.SEARCH : Mode.UPLOAD;
    });
  }

  return (
    <Background>
      {mode === Mode.UPLOAD ? (
        <FileDropZone ref={fileDropZoneRef} />
      ) : (
        <SearchInput ref={searchInputRef} />
      )}
      <SwitchButton
        onSwitch={handleSwitch}
        style={{ top: switchButtonTop }}
        currentMode={mode}
      />
      <ProgressUpload />
      <>
        <PanelAbortProcessing />
      </>
      <div
        data-state={isO ? "open" : "closed"}
        className={cn(
          "absolute top-1/2 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
        )}
      >
        Danieddddd
      </div>

      <Button
        className="fixed bottom-7"
        variant="secondary"
        onClick={() => setO((prev) => !prev)}
      >
        Toog
      </Button>
    </Background>
  );
}
