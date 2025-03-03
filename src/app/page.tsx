"use client";

import {
  useState,
  useRef,
  useCallback,
  useLayoutEffect,
  useEffect,
  Suspense,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { Background } from "@/components/background";
import { SwitchButton } from "@/components/switch-button";
import { Mode } from "@/types/app";
import ProgressUploadButton from "@/components/progress-upload-button";
import { Panels } from "@/components/panels";
import Header from "@/components/header";
import { cn } from "@/lib/utils";
import { useElementMutationListener } from "@/hooks/use-element-mutation-listener";

const defaultClasses =
  "text-center p-4 absolute top-2/4 left-2/4 -translate-x-2/4 -translate-y-2/4";

const FileDropZone = dynamic(() => import("@/components/file-dropzone"), {
  ssr: false,
  loading: () => (
    <div className={cn("", defaultClasses)}>Loading Upload Zone...</div>
  ),
});
const SearchInput = dynamic(() => import("@/components/search-input"), {
  ssr: false,
  loading: () => (
    <div className={cn("", defaultClasses)}>Loading Search Input...</div>
  ),
});

export default function Home() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const initialMode =
    searchParams.get("mode") === "search" ? Mode.SEARCH : Mode.UPLOAD;
  const [mode, setMode] = useState<Mode>(initialMode);

  const fileDropZoneRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLDivElement>(null);
  const parentRef = useRef<HTMLDivElement>(null);
  const [switchButtonTop, setSwitchButtonTop] = useState<number>(0);

  /**
   * Updates the position of the switch button based on the active component.
   */
  const updateButtonPosition = useCallback(() => {
    const activeRef =
      mode === Mode.UPLOAD ? fileDropZoneRef.current : searchInputRef.current;
    if (activeRef) {
      const offsetTop = activeRef.offsetTop;
      const height = activeRef.offsetHeight;

      // Position the switch button 30px below the active component.
      setSwitchButtonTop(offsetTop + height + 30);
    }
  }, [mode]);

  const mutation = useElementMutationListener([parentRef], {
    childList: true,
  });

  useLayoutEffect(() => {
    updateButtonPosition();
  }, [mode, updateButtonPosition, mutation]);

  useLayoutEffect(() => {
    window.addEventListener("resize", updateButtonPosition);
    return () => {
      window.removeEventListener("resize", updateButtonPosition);
    };
  }, [updateButtonPosition]);

  /**
   * Handles mode switching and URL update
   */
  const handleSwitch = useCallback(() => {
    const newMode = mode === Mode.UPLOAD ? Mode.SEARCH : Mode.UPLOAD;
    const newSearch = newMode === Mode.SEARCH ? "search" : "upload";
    router.replace(`/?mode=${newSearch}`, { scroll: false });
  }, [mode, router]);

  useEffect(() => {
    if (!searchParams.has("mode")) {
      router.replace("/?mode=upload", { scroll: false });
    }
  }, [searchParams, router]);

  /**
   * Keep state in sync with the URL on mount
   */
  useEffect(() => {
    if (searchParams.get("mode") === "search" && mode !== Mode.SEARCH) {
      setMode(Mode.SEARCH);
    } else if (searchParams.get("mode") !== "search" && mode !== Mode.UPLOAD) {
      setMode(Mode.UPLOAD);
    }
  }, [searchParams, mode]);

  console.log("mode", !!mode);

  return (
    <Background>
      <Header />
      <div className="group" data-loaded={!!mutation}>
        <div ref={parentRef}>
          <Suspense
            fallback={<div className={cn("", defaultClasses)}>Loading...</div>}
          >
            {mode === Mode.UPLOAD ? (
              <FileDropZone ref={fileDropZoneRef} />
            ) : (
              <SearchInput ref={searchInputRef} />
            )}
          </Suspense>
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
