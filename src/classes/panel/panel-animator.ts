import { PanelData } from "@/types/manga-reader";

export class PanelAnimator {
  private canvas: HTMLCanvasElement;
  private context: CanvasRenderingContext2D | null;
  private transitionDuration: number = 500;

  constructor(
    canvas: HTMLCanvasElement,
    context: CanvasRenderingContext2D | null
  ) {
    this.canvas = canvas;
    this.context = context;
  }

  async animateToPanel(img: HTMLImageElement, panel: PanelData): Promise<void> {
    if (!this.context) return;

    const [srcX, srcY, srcWidth, srcHeight] = panel.bbox;
    const scale = Math.min(
      this.canvas.width / srcWidth,
      this.canvas.height / srcHeight
    );
    const scaledWidth = srcWidth * scale;
    const scaledHeight = srcHeight * scale;
    const destX = (this.canvas.width - scaledWidth) / 2;
    const destY = (this.canvas.height - scaledHeight) / 2;

    await this.animate(
      img,
      srcX,
      srcY,
      srcWidth,
      srcHeight,
      destX,
      destY,
      scaledWidth,
      scaledHeight
    );

    if (panel.text) {
      this.renderPanelText(panel.text, destX, destY + scaledHeight);
    }
  }

  private animate(
    img: HTMLImageElement,
    srcX: number,
    srcY: number,
    srcWidth: number,
    srcHeight: number,
    destX: number,
    destY: number,
    destWidth: number,
    destHeight: number
  ): Promise<void> {
    return new Promise((resolve) => {
      const startTime = performance.now();

      const animate = (currentTime: number) => {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / this.transitionDuration, 1);

        const eased =
          progress < 0.5
            ? 2 * progress * progress
            : 1 - Math.pow(-2 * progress + 2, 2) / 2;

        if (this.context) {
          this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
          this.context.drawImage(
            img,
            srcX,
            srcY,
            srcWidth,
            srcHeight,
            destX,
            destY,
            destWidth,
            destHeight
          );
        }

        if (progress < 1) {
          requestAnimationFrame(animate);
        } else {
          resolve();
        }
      };

      requestAnimationFrame(animate);
    });
  }

  private renderPanelText(text: string, x: number, y: number): void {
    if (!this.context) return;

    this.context.font = "16px Arial";
    this.context.fillStyle = "white";
    this.context.strokeStyle = "black";
    this.context.lineWidth = 3;
    this.context.strokeText(text, x, y);
    this.context.fillText(text, x, y);
  }
}
