import { PanelReaderMode } from "../manga-reader-modes/panel-reader-mode";

export class PanelPlaybackController {
  private isPlaying: boolean = false;
  private playbackInterval: ReturnType<typeof setInterval> | null = null;
  private readerMode: PanelReaderMode;
  private playbackDelay: number = 2000; // 2 seconds per panel

  constructor(readerMode: PanelReaderMode) {
    this.readerMode = readerMode;
  }

  toggle(): void {
    this.isPlaying = !this.isPlaying;

    if (this.isPlaying) {
      this.playbackInterval = setInterval(() => {
        this.readerMode.nextPanel();
      }, this.playbackDelay);
    } else {
      this.stop();
    }
  }

  stop(): void {
    if (this.playbackInterval) {
      clearInterval(this.playbackInterval);
      this.playbackInterval = null;
    }
    this.isPlaying = false;
  }

  setPlaybackDelay(delay: number): void {
    this.playbackDelay = delay;
    if (this.isPlaying) {
      this.stop();
      this.toggle();
    }
  }
}
