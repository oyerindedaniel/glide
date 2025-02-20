/// <reference lib="webworker" />
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const cv: any; // Ensure OpenCV.js is loaded in your worker context

export interface Panel {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface WorkerInputMessage {
  type: "PROCESS_IMAGE";
  imageIndex: number;
  imageBitmap: ImageBitmap;
}

interface WorkerOutputMessage {
  imageIndex: number;
  detectedPanels: Panel[];
}

const processImage = (imageBitmap: ImageBitmap): Panel[] => {
  // Create an OffscreenCanvas and draw the imageBitmap
  const offscreen = new OffscreenCanvas(imageBitmap.width, imageBitmap.height);
  const ctx = offscreen.getContext("2d");

  if (!ctx) return [];

  ctx.drawImage(imageBitmap, 0, 0);
  const imageData = ctx.getImageData(
    0,
    0,
    imageBitmap.width,
    imageBitmap.height
  );

  // Use OpenCV to process the image
  const src = cv.matFromImageData(imageData);
  const gray = new cv.Mat();
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

  const blurred = new cv.Mat();
  cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);

  const edges = new cv.Mat();
  cv.Canny(blurred, edges, 50, 150);

  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  cv.findContours(
    edges,
    contours,
    hierarchy,
    cv.RETR_EXTERNAL,
    cv.CHAIN_APPROX_SIMPLE
  );

  const panels: Panel[] = [];
  for (let i = 0; i < contours.size(); i++) {
    const rect = cv.boundingRect(contours.get(i));
    if (rect.width > 100 && rect.height > 100) {
      panels.push({
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      });
    }
  }

  // Cleanup
  src.delete();
  gray.delete();
  blurred.delete();
  edges.delete();
  contours.delete();
  hierarchy.delete();

  return panels;
};

self.onmessage = async (e: MessageEvent<WorkerInputMessage>) => {
  const { type, imageIndex, imageBitmap } = e.data;
  if (type === "PROCESS_IMAGE") {
    const panels = processImage(imageBitmap);
    const output: WorkerOutputMessage = { imageIndex, detectedPanels: panels };
    self.postMessage(output);
  }
};
