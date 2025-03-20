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
import { AlertTriangle, FilePlus, FileX } from "lucide-react";
import { usePanelStore } from "@/store/panel";
import { PANEL_IDS } from "@/constants/panel";
import { useIsMounted } from "@/hooks/use-is-mounted";
import { useShallow } from "zustand/shallow";
import {
  FileUploadAction,
  useUserPreferencesStore,
} from "@/store/user-preferences";
import { ProcessingInfo } from "@/hooks/use-file-processing";
import { usePanelHelpers } from "@/hooks/use-panel-helpers";

interface FileUploadOptionsPanelProps {
  handleAbortAndProcess: () => void;
  handleAddToQueue: () => void;
  currentProcessingInfo?: ProcessingInfo;
}

export const FileUploadOptionsPanel: React.FC<FileUploadOptionsPanelProps> = ({
  handleAbortAndProcess,
  handleAddToQueue,
  currentProcessingInfo,
}) => {
  const { sidePanels } = usePanelStore(
    useShallow((state) => ({
      sidePanels: state.sidePanels,
    }))
  );

  const { toggleFileUploadOptionsPanel } = usePanelHelpers();

  const { lastFileUploadAction, setLastFileUploadAction } =
    useUserPreferencesStore(
      useShallow((state) => ({
        lastFileUploadAction: state.lastFileUploadAction,
        setLastFileUploadAction: state.setLastFileUploadAction,
      }))
    );

  const { right } = sidePanels;
  const isMounted = useIsMounted();

  const isOpen = right === PANEL_IDS.ABORT_PROCESSING;

  const handleAction = (action: FileUploadAction) => {
    setLastFileUploadAction(action);

    if (action === "override") {
      handleAbortAndProcess();
    } else {
      handleAddToQueue();
    }
  };

  if (!isMounted) return null;

  return (
    <Panel open={isOpen} onOpenChange={toggleFileUploadOptionsPanel}>
      <PanelContent
        className="bottom-24 right-8 translate-x-0 translate-y-0 max-w-80 w-full"
        id="panel"
      >
        <PanelHeader className="flex items-start gap-4 pb-4">
          <PanelIcon>
            <AlertTriangle className="h-3 w-3" />
          </PanelIcon>
          <div>
            <PanelTitle className="">File Upload Options</PanelTitle>
            <PanelDescription>Choose how to handle new files</PanelDescription>
          </div>
        </PanelHeader>

        <PanelBody className="text-sm pt-4">
          {currentProcessingInfo && (
            <div className="mb-4 p-2 bg-muted/20 rounded-md">
              <p className="font-medium">Currently Processing:</p>
              <p className="text-xs text-muted-foreground">
                {currentProcessingInfo.fileName && (
                  <span>Current file: {currentProcessingInfo.fileName}</span>
                )}
              </p>
              <p className="text-xs text-muted-foreground">
                {currentProcessingInfo.totalFiles > 0 && (
                  <span>Total files: {currentProcessingInfo.totalFiles}</span>
                )}
              </p>
              {currentProcessingInfo.progress > 0 && (
                <div className="w-full h-1.5 bg-muted mt-2 rounded-full overflow-hidden">
                  <div
                    className="bg-primary h-full"
                    style={{ width: `${currentProcessingInfo.progress}%` }}
                  />
                </div>
              )}
            </div>
          )}
          <p>How would you like to handle the new files?</p>
        </PanelBody>

        <PanelFooter className="flex flex-col gap-3 pt-4 border-t border-neutral-800 mt-4">
          <PanelAction
            className="w-full flex items-center justify-center gap-2"
            onClick={() => handleAction("add-to-queue")}
            size="sm"
            variant={
              lastFileUploadAction === "add-to-queue" ? "default" : "outline"
            }
          >
            <FilePlus className="h-4 w-4" />
            <span>Add to Queue</span>
          </PanelAction>
          <PanelAction
            className="w-full flex items-center justify-center gap-2"
            onClick={() => handleAction("override")}
            size="sm"
            variant={
              lastFileUploadAction === "override" ? "default" : "outline"
            }
          >
            <FileX className="h-4 w-4" />
            <span>Override Current Processing</span>
          </PanelAction>
          <PanelClose className="w-full" size="sm" variant="ghost">
            Cancel
          </PanelClose>
        </PanelFooter>
      </PanelContent>
    </Panel>
  );
};
