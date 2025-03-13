import { PDFWorkerPool } from "../worker/pdf.worker-pool";

// Check if we're in a browser environment
const isBrowser =
  typeof window !== "undefined" && typeof Worker !== "undefined";

/**
 * Terminates all PDF workers when the user is done with PDF processing
 * This should be called when the application is shutting down or
 * when the user navigates away from PDF processing functionality
 *
 * @returns {boolean} Whether the cleanup was successful
 */
export function cleanupPDFWorkers(): boolean {
  // No-op in server environment
  if (!isBrowser) return true;

  try {
    // Terminate worker pool
    PDFWorkerPool.getInstance().terminateAll();

    // Notify Service Worker to clear cache
    if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: "CLEAR_PDF_CACHE",
      });
    }

    return true;
  } catch (error) {
    console.error("Error cleaning up PDF workers:", error);
    return false;
  }
}
