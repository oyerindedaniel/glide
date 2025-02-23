"use client";

import {
  Panel,
  PanelContent,
  PanelTitle,
  PanelBody,
  PanelFooter,
  PanelClose,
  PanelHeader,
  PanelDescription,
  PanelAction,
} from "../ui/panel";

import { PanelType, usePanelStore } from "@/store/panel";
import { PANEL_IDS } from "@/constants/panel";
import { useIsMounted } from "@/hooks/use-is-mounted";

interface Props {
  handleAbortAndProcess: () => void;
}

export const PanelAbortProcessing: React.FC<Props> = ({
  handleAbortAndProcess,
}) => {
  const { getCurrentCenter, closePanel, openPanel } = usePanelStore();
  const activePanel = getCurrentCenter();
  const isMounted = useIsMounted();

  const isOpen = activePanel === PANEL_IDS.ABORT_PROCESSING;

  const onOpenChange = (newOpen: boolean) => {
    if (newOpen) {
      openPanel(PANEL_IDS.ABORT_PROCESSING, PanelType.CENTER);
    } else {
      closePanel(PANEL_IDS.ABORT_PROCESSING, PanelType.CENTER);
    }
  };

  if (!isMounted) return;

  return (
    <Panel open={isOpen} onOpenChange={onOpenChange}>
      <PanelContent
        className="bottom-35 right-8 translate-x-0 translate-y-0 bg-black text-white max-w-80 w-full font-[family-name:var(--font-manrope)]"
        id="panel"
      >
        <PanelHeader>
          <PanelTitle className="">Cancel Current Processing?</PanelTitle>
          <PanelDescription></PanelDescription>
        </PanelHeader>
        <PanelBody className="text-sm">
          <p>
            Do you want to cancel the current file processing to handle new
            files?
          </p>
        </PanelBody>
        <PanelFooter className="flex flex-col gap-3">
          <PanelAction
            className="w-full"
            onClick={handleAbortAndProcess}
            size="sm"
            variant="outline"
          >
            Process New Files
          </PanelAction>
          <PanelClose className="w-full" size="sm" variant="ghost">
            Continue Current
          </PanelClose>
        </PanelFooter>
      </PanelContent>
    </Panel>
  );
};
