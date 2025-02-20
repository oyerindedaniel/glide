import React, { useState, useRef, useCallback, useEffect } from "react";
import { Panel } from "@/worker/panelDetectionWorker";

// Placeholder TTS & OCR functions
const speakText = async (text: string): Promise<void> => {
  console.log("Speaking: ", text);
  // Replace with real TTS integration
};
const extractTextFromPanel = async (panel: Panel): Promise<string> => {
  // Replace with OCR or pre-stored text as needed.
  return Promise.resolve("Panel text placeholder");
};

export type ReadingDirection = "japanese" | "western";

interface MangaReaderProps {
  images: string[]; // Array of manga page image URLs
}

export const MangaReader: React.FC<MangaReaderProps> = ({ images }) => {
  // State management for current page & panel
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [currentPanelIndex, setCurrentPanelIndex] = useState(0);
  const [panelsMap, setPanelsMap] = useState<{ [key: number]: Panel[] }>({});
  const [readingDirection, setReadingDirection] =
    useState<ReadingDirection>("japanese");

  // Ref for the visible canvas
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Ref for storing the loaded Image (for drawing)
  const imageRef = useRef<HTMLImageElement | null>(null);
  // Ref for current transform (scale and translation)
  const transformRef = useRef({ scale: 1, tx: 0, ty: 0 });
  // Worker reference
  const workerRef = useRef<Worker | null>(null);

  const readingDirectionRef = useRef(readingDirection);
  readingDirectionRef.current = readingDirection;

  useEffect(() => {
    const worker = new Worker(
      new URL("./panelDetectionWorker.ts", import.meta.url)
    );
    workerRef.current = worker;

    worker.onerror = (error) => console.error("Worker error:", error);

    worker.onmessage = (e: MessageEvent) => {
      const { imageIndex, detectedPanels } = e.data as {
        imageIndex: number;
        detectedPanels: Panel[];
      };

      const sortedPanels = detectedPanels.sort((a, b) => {
        if (Math.abs(a.y - b.y) < 20) {
          return readingDirectionRef.current === "japanese"
            ? b.x - a.x
            : a.x - b.x;
        }
        return a.y - b.y;
      });

      setPanelsMap((prev) => ({ ...prev, [imageIndex]: sortedPanels }));
    };

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!workerRef.current) return;

    const errorHandler = (error: ErrorEvent) => {
      console.error("Worker error:", error);
    };

    workerRef.current.addEventListener("error", errorHandler);
    return () => workerRef.current?.removeEventListener("error", errorHandler);
  }, []);

  // Function to load the current image and send it to the worker
  const loadAndProcessImage = useCallback(async () => {
    try {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = images[currentImageIndex];

      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });

      // await img.decode();

      imageRef.current = img;

      const canvas = canvasRef.current;
      if (!canvas) return;

      // Maintain aspect ratio
      const scale = Math.min(
        window.innerWidth / img.width,
        window.innerHeight / img.height
      );
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;

      const ctx = canvas.getContext("2d");

      if (!ctx) return;
      // Initially, draw the full image without transformation.
      // ctx.setTransform(1, 0, 0, 1, 0, 0);
      // ctx.drawImage(img, 0, 0);

      ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);

      // Create an ImageBitmap from the loaded image and send to worker.
      // const imageBitmap = await createImageBitmap(img);

      // Send scaled image to worker
      const scaledBitmap = await createImageBitmap(img, {
        resizeWidth: img.width * 0.5,
        resizeHeight: img.height * 0.5,
        resizeQuality: "high",
      });

      workerRef.current?.postMessage(
        { type: "PROCESS_IMAGE", imageIndex: currentImageIndex, scaledBitmap },
        [scaledBitmap]
      );
    } catch (error) {
      console.error("Image processing failed:", error);
    }
  }, [currentImageIndex, images]);

  // Custom animation function using requestAnimationFrame.
  // It interpolates from the current transform to the target transform.
  const animateToPanel = useCallback(
    (
      target: { tx: number; ty: number; scale: number },
      duration = 1000
    ): Promise<void> => {
      return new Promise((resolve) => {
        const start = performance.now();
        const initial = { ...transformRef.current };
        const step = (now: number) => {
          const t = Math.min((now - start) / duration, 1);
          // Linear interpolation (you can add easing if desired)
          transformRef.current.scale =
            initial.scale + t * (target.scale - initial.scale);
          transformRef.current.tx = initial.tx + t * (target.tx - initial.tx);
          transformRef.current.ty = initial.ty + t * (target.ty - initial.ty);
          drawCanvas();
          if (t < 1) {
            requestAnimationFrame(step);
          } else {
            resolve();
          }
        };
        requestAnimationFrame(step);
      });
    },
    []
  );

  // Function to redraw the visible canvas using the current transform.
  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imageRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(
      transformRef.current.scale,
      0,
      0,
      transformRef.current.scale,
      transformRef.current.tx,
      transformRef.current.ty
    );
    ctx.drawImage(img, 0, 0);
  }, []);

  // Function that triggers the animation to the current panel, then performs TTS.
  const processCurrentPanel = useCallback(async () => {
    const panels = panelsMap[currentImageIndex];
    if (!panels || panels.length === 0) {
      console.log("Panels not detected yet.");
      return;
    }
    // Get current panel (fallback to first panel if index out-of-range)
    const panel = panels[currentPanelIndex] || panels[0];
    // Calculate target transform so that the panel is centered in the canvas.
    const canvas = canvasRef.current;
    if (!canvas) return;
    const targetScale = 1.8; // Desired zoom level
    const targetTx =
      -panel.x * targetScale + (canvas.width - panel.width * targetScale) / 2;
    const targetTy =
      -panel.y * targetScale + (canvas.height - panel.height * targetScale) / 2;
    await animateToPanel({ tx: targetTx, ty: targetTy, scale: targetScale });
    // Extract text from panel (placeholder) and speak it.
    const panelText = await extractTextFromPanel(panel);
    await speakText(panelText);
    // Move to next panel or next image.
    if (currentPanelIndex < panels.length - 1) {
      setCurrentPanelIndex(currentPanelIndex + 1);
    } else if (currentImageIndex < images.length - 1) {
      setCurrentImageIndex(currentImageIndex + 1);
      setCurrentPanelIndex(0);
      // Reset transformation for new image.
      transformRef.current = { scale: 1, tx: 0, ty: 0 };
      await loadAndProcessImage();
    } else {
      console.log("Finished reading all pages.");
    }
  }, [
    panelsMap,
    currentImageIndex,
    currentPanelIndex,
    images,
    animateToPanel,
    loadAndProcessImage,
  ]);

  // Initial load: if no image loaded, load the first image.
  useEffect(() => {
    if (images.length > 0) {
      loadAndProcessImage();
    }
  }, [currentImageIndex, loadAndProcessImage, images]);

  return (
    <div className="manga-reader relative">
      <canvas ref={canvasRef} style={{ width: "100%", height: "auto" }} />
      <div className="controls absolute top-0 left-0 p-4">
        <label htmlFor="direction" className="mr-2 font-bold">
          Reading Direction:
        </label>
        <select
          id="direction"
          value={readingDirection}
          onChange={(e) =>
            setReadingDirection(e.target.value as ReadingDirection)
          }
        >
          <option value="japanese">Japanese (Right-to-Left)</option>
          <option value="western">Western (Left-to-Right)</option>
        </select>
      </div>
      <button
        className="absolute bottom-10 left-1/2 transform -translate-x-1/2 bg-blue-500 text-white px-4 py-2"
        onClick={processCurrentPanel}
      >
        Next Panel
      </button>
    </div>
  );
};
