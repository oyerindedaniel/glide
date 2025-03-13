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
  PanelIcon,
} from "../ui/panel";
import { AlertTriangle } from "lucide-react";
import { PanelType, usePanelStore } from "@/store/panel";
import { PANEL_IDS } from "@/constants/panel";
import { useIsMounted } from "@/hooks/use-is-mounted";

interface Props {
  handleAbortAndProcess: () => void;
}

export const PanelAbortProcessing: React.FC<Props> = ({
  handleAbortAndProcess,
}) => {
  const { getActivePanels, closePanel, openPanel } = usePanelStore();
  const { right } = getActivePanels();
  const isMounted = useIsMounted();

  const isOpen = right === PANEL_IDS.ABORT_PROCESSING;

  const onOpenChange = (newOpen: boolean) => {
    if (newOpen) {
      openPanel(PANEL_IDS.ABORT_PROCESSING, PanelType.RIGHT);
    } else {
      closePanel(PANEL_IDS.ABORT_PROCESSING, PanelType.RIGHT);
    }
  };

  if (!isMounted) return;

  return (
    <Panel open={isOpen} onOpenChange={onOpenChange}>
      <PanelContent
        className="bottom-24 right-8 translate-x-0 translate-y-0 bg-[#0B0B0B] text-white max-w-80 w-full"
        id="panel"
      >
        <PanelHeader className="flex items-start gap-4 pb-4">
          <PanelIcon>
            <AlertTriangle className="h-3 w-3" />
          </PanelIcon>
          <div>
            <PanelTitle className="">Cancel Current Processing?</PanelTitle>
            <PanelDescription></PanelDescription>
          </div>
        </PanelHeader>

        <PanelBody className="text-sm pt-4">
          <p>
            Do you want to cancel the current file processing to handle new
            files?
          </p>
        </PanelBody>

        <PanelFooter className="flex flex-col gap-3 pt-4 border-t border-neutral-800 mt-4">
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
