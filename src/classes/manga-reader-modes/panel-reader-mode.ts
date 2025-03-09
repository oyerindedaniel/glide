import { BaseReaderMode } from "./base-reader-mode";
import { PanelWebSocketManager } from "../panel/panel-websocket-manager";
import { PanelAnimator } from "../panel/panel-animator";
import { PanelPlaybackController } from "../panel/panel-playback-controller";
import { PanelData, PagePanelData } from "@/types/manga-reader";

export class PanelReaderMode extends BaseReaderMode {
  private panelData: Map<string, PanelData[]> = new Map();
  private currentPanelIndex: number = 0;
  private wsManager: PanelWebSocketManager;
  private animator: PanelAnimator;
  private playbackController: PanelPlaybackController;

  constructor(...args: ConstructorParameters<typeof BaseReaderMode>) {
    super(...args);
    this.wsManager = new PanelWebSocketManager(this.handlePanelData.bind(this));
    this.animator = new PanelAnimator(this.canvas, this.context);
    this.playbackController = new PanelPlaybackController(this);
  }

  initialize(): void {
    this.canvas.style.position = "fixed";
    this.canvas.style.top = "50%";
    this.canvas.style.left = "50%";
    this.canvas.style.transform = "translate(-50%, -50%)";
    this.wsManager.connect();
  }

  cleanup(): void {
    this.wsManager.disconnect();
    this.playbackController.stop();
    this.panelData.clear();
    this.currentPanelIndex = 0;
  }

  private handlePanelData(data: PagePanelData): void {
    this.panelData.set(data.pageId, data.panels);
    if (this.currentPageId === data.pageId) {
      this.renderCurrentPanel();
    }
  }

  renderPage(pageId: string): void {
    this.currentPageId = pageId;
    this.currentPanelIndex = 0;
    this.renderCurrentPanel();
    this.wsManager.requestPanelData(pageId);
  }

  private async renderCurrentPanel(): Promise<void> {
    if (!this.currentPageId || !this.context) return;

    const panels = this.panelData.get(this.currentPageId);
    if (!panels || !panels[this.currentPanelIndex]) return;

    const panel = panels[this.currentPanelIndex];
    const img = this.imageCache.get(this.currentPageId);
    if (!img) return;

    await this.animator.animateToPanel(img, panel);
  }

  handleResize(): void {
    if (this.currentPageId) {
      this.renderCurrentPanel();
    }
  }

  // Navigation methods
  nextPanel(): void {
    if (!this.currentPageId) return;
    const panels = this.panelData.get(this.currentPageId);
    if (!panels) return;

    if (this.currentPanelIndex < panels.length - 1) {
      this.currentPanelIndex++;
      this.renderCurrentPanel();
    }
  }

  previousPanel(): void {
    if (!this.currentPageId || this.currentPanelIndex <= 0) return;
    this.currentPanelIndex--;
    this.renderCurrentPanel();
  }

  togglePlayback(): void {
    this.playbackController.toggle();
  }
}
