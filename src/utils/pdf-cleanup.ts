import { PDFWorkerPool } from "../worker/pdf.worker-pool";
// import { pdfJsWorker } from "../worker/pdf-library.worker";

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
    // Terminate worker pool first
    PDFWorkerPool.getInstance().terminateAll();

    // Double-check pdfJsWorker is also terminated
    // if (pdfJsWorker) {
    //   setTimeout(() => {
    //     try {
    //       // Use non-null assertion since we've already checked
    //       pdfJsWorker!.terminate();
    //     } catch (error) {
    //       console.warn("Could not terminate PDF.js worker directly", error);
    //     }
    //   }, 500);
    // }

    return true;
  } catch (error) {
    console.error("Error cleaning up PDF workers:", error);
    return false;
  }
}
