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
export async function cleanupPDFWorkers(): Promise<boolean> {
  // No-op in server environment
  if (!isBrowser) return true;

  try {
    // Terminate worker pool first
    const workerPool = await PDFWorkerPool.getInstance();
    workerPool.terminateAll();

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

/**
 * Resets the PDFWorkerPool singleton instance
 * Use this to ensure workers are properly cleaned up before re-initialization
 * Useful when dealing with React StrictMode double mounting
 *
 * @returns {boolean} Whether the reset was successful
 */
// Track if reset is in progress to avoid multiple overlapping resets
let resetInProgress = false;

export function resetPDFWorkerPoolInstance(): boolean {
  if (!isBrowser) return true;

  // If already resetting, don't trigger another reset
  if (resetInProgress) {
    return true;
  }

  resetInProgress = true;

  // Add a longer delay to avoid terminating workers during StrictMode's double-mount cycle
  // This allows in-progress operations to complete
  setTimeout(() => {
    try {
      PDFWorkerPool.resetInstance();
    } catch (error) {
      console.error("Error during delayed PDF worker pool reset:", error);
    } finally {
      // Reset the flag after cleanup is done
      resetInProgress = false;
    }
  }, 500);

  return true;
}
