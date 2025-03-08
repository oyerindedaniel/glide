"use client";

import {
  useState,
  useRef,
  useCallback,
  useLayoutEffect,
  useEffect,
  Suspense,
} from "react";
import { useRouter } from "next/navigation";
import { Background } from "@/components/background";
import { SwitchButton } from "@/components/switch-button";
import { Mode } from "@/types/app";
import ProgressUploadButton from "@/components/progress-upload-button";
import { Panels } from "@/components/panels";
import Header from "@/components/header";
import { useElementMutationListener } from "@/hooks/use-element-mutation-listener";
import { useDropAnimationStore } from "@/store/drop-animation-store";
import FileDropZone from "@/components/file-dropzone";
import SearchInput from "@/components/search-input";
import { ModeHandler } from "@/components/mode-handler";

export default function HomePage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(Mode.UPLOAD);

  const fileDropZoneRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLDivElement>(null);
  const parentRef = useRef<HTMLDivElement>(null);
  const [switchButtonTop, setSwitchButtonTop] = useState<number>(0);

  const { cleanup } = useDropAnimationStore();

  // Cleanup drop animation store on unmount
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  // Updates switch button position based on active component
  const updateButtonPosition = useCallback(() => {
    const activeRef =
      mode === Mode.UPLOAD ? fileDropZoneRef.current : searchInputRef.current;
    if (activeRef) {
      const offsetTop = activeRef.offsetTop;
      const height = activeRef.offsetHeight;
      setSwitchButtonTop(offsetTop + height + 30);
    }
  }, [mode]);

  //   const mutation = useElementMutationListener([parentRef], { childList: true });

  useLayoutEffect(() => {
    updateButtonPosition();
  }, [mode, updateButtonPosition]);

  useLayoutEffect(() => {
    window.addEventListener("resize", updateButtonPosition);
    return () => {
      window.removeEventListener("resize", updateButtonPosition);
    };
  }, [updateButtonPosition]);

  // Handles mode switching by updating URL only
  const handleSwitch = useCallback(() => {
    const newMode = mode === Mode.UPLOAD ? Mode.SEARCH : Mode.UPLOAD;
    const newSearch = newMode === Mode.SEARCH ? "search" : "upload";
    router.replace(`/?mode=${newSearch}`, { scroll: false });
  }, [mode, router]);

  const handleModeChange = useCallback((newMode: Mode) => {
    setMode(newMode);
  }, []);

  return (
    <Background>
      <Header />
      <Suspense fallback={null}>
        <ModeHandler onModeChange={handleModeChange} />
      </Suspense>

      <div className="group" data-loaded={true}>
        <div ref={parentRef}>
          {mode === Mode.UPLOAD ? (
            <FileDropZone ref={fileDropZoneRef} />
          ) : (
            <SearchInput ref={searchInputRef} />
          )}
        </div>
        <SwitchButton
          onSwitch={handleSwitch}
          style={{ top: switchButtonTop }}
          currentMode={mode}
        />
      </div>
      <ProgressUploadButton />
      <Panels />
    </Background>
  );
}
