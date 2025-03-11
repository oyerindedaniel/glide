import { PanelData } from "@/types/manga-reader";

export interface PanelRenderData {
  panel: PanelData;
  canvas: {
    width: number;
    height: number;
  };
}

export interface AnimationFrame {
  src: { x: number; y: number; width: number; height: number };
  dest: { x: number; y: number; width: number; height: number };
  text?: string;
  progress: number;
}

export class PanelAnimator {
  private animationFrameId: number | null = null;
  private isDisposed: boolean = false;

  calculatePanelDimensions(
    panel: PanelData,
    canvasWidth: number,
    canvasHeight: number
  ) {
    const [srcX, srcY, srcWidth, srcHeight] = panel.bbox;

    // Calculate scale factor while maintaining aspect ratio
    const scaleX = canvasWidth / srcWidth;
    const scaleY = canvasHeight / srcHeight;
    const scale = Math.min(scaleX, scaleY);

    // Apply scaling to position and size
    const scaledWidth = srcWidth * scale;
    const scaledHeight = srcHeight * scale;
    const scaledX = srcX * scale;
    const scaledY = srcY * scale;

    // const destX = (canvasWidth - scaledWidth) / 2;
    // const destY = (canvasHeight - scaledHeight) / 2;

    return {
      src: { x: srcX, y: srcY, width: srcWidth, height: srcHeight },
      dest: {
        x: scaledX,
        y: scaledY,
        width: scaledWidth,
        height: scaledHeight,
      },
      text: panel.text,
    };
  }

  calculateAnimationFrames(
    fromPanel: PanelData | null,
    toPanel: PanelData,
    canvasWidth: number,
    canvasHeight: number,
    frameCount: number = 20
  ): AnimationFrame[] {
    // If there's no fromPanel, we just return the target panel dimensions
    if (!fromPanel) {
      const dimensions = this.calculatePanelDimensions(
        toPanel,
        canvasWidth,
        canvasHeight
      );
      return [{ ...dimensions, progress: 1 }];
    }

    const fromDimensions = this.calculatePanelDimensions(
      fromPanel,
      canvasWidth,
      canvasHeight
    );
    const toDimensions = this.calculatePanelDimensions(
      toPanel,
      canvasWidth,
      canvasHeight
    );

    const frames: AnimationFrame[] = [];

    for (let i = 0; i <= frameCount; i++) {
      const progress = i / frameCount;
      const easedProgress = this.easeInOutQuad(progress);

      const frame: AnimationFrame = {
        src: {
          x: this.lerp(fromDimensions.src.x, toDimensions.src.x, easedProgress),
          y: this.lerp(fromDimensions.src.y, toDimensions.src.y, easedProgress),
          width: this.lerp(
            fromDimensions.src.width,
            toDimensions.src.width,
            easedProgress
          ),
          height: this.lerp(
            fromDimensions.src.height,
            toDimensions.src.height,
            easedProgress
          ),
        },
        dest: {
          x: this.lerp(
            fromDimensions.dest.x,
            toDimensions.dest.x,
            easedProgress
          ),
          y: this.lerp(
            fromDimensions.dest.y,
            toDimensions.dest.y,
            easedProgress
          ),
          width: this.lerp(
            fromDimensions.dest.width,
            toDimensions.dest.width,
            easedProgress
          ),
          height: this.lerp(
            fromDimensions.dest.height,
            toDimensions.dest.height,
            easedProgress
          ),
        },
        text: toDimensions.text,
        progress,
      };

      frames.push(frame);
    }

    return frames;
  }

  private lerp(start: number, end: number, amount: number): number {
    return start + (end - start) * amount;
  }

  private easeInOutQuad(t: number): number {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }

  /**
   * Cancels any ongoing animations and cleans up resources
   */
  dispose(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    this.isDisposed = true;
  }

  /**
   * Starts animating between panels
   */
  animateBetweenPanels(
    callback: (frame: AnimationFrame) => void,
    frames: AnimationFrame[],
    duration: number = 500
  ): void {
    if (this.isDisposed) return;

    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
    }

    let startTime: number | null = null;

    const animate = (timestamp: number) => {
      if (this.isDisposed) return;

      if (startTime === null) {
        startTime = timestamp;
      }

      const elapsed = timestamp - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Find the closest frame based on progress
      const frameIndex = Math.min(
        Math.floor(progress * frames.length),
        frames.length - 1
      );

      callback(frames[frameIndex]);

      if (progress < 1) {
        this.animationFrameId = requestAnimationFrame(animate);
      } else {
        this.animationFrameId = null;
      }
    };

    this.animationFrameId = requestAnimationFrame(animate);
  }
}
