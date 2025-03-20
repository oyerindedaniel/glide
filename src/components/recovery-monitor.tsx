import React, { useEffect, useState } from "react";
import {
  useRecoveryStats,
  usePageRecovery,
  usePDFInitRecovery,
} from "@/hooks/use-recovery-events";
import { toast } from "sonner";
import logger from "@/utils/logger";

/**
 * Recovery Monitor Component
 *
 * This component provides UI for monitoring and managing PDF processing recovery events.
 * It demonstrates how to use the recovery hooks to handle orphaned results.
 */
const RecoveryMonitor: React.FC = () => {
  const [expanded, setExpanded] = useState(false);
  const [lastRecoveredPage, setLastRecoveredPage] = useState<{
    clientId: string;
    pageNumber: number;
  } | null>(null);
  const [lastInitRecovery, setLastInitRecovery] = useState<{
    clientId: string;
    totalPages: number;
  } | null>(null);

  // Use the recovery hooks
  const stats = useRecoveryStats();

  // Listen for page recovery events
  usePageRecovery((data) => {
    if (data.clientId && data.pageNumber) {
      setLastRecoveredPage({
        clientId: data.clientId,
        pageNumber: data.pageNumber,
      });

      // Show a toast notification
      toast.info(`Recovered orphaned page ${data.pageNumber}`, {
        description: `Client: ${data.clientId.substring(0, 8)}...`,
        duration: 3000,
      });

      logger.log("[RecoveryMonitor] Page recovery event handled:", data);
    }
  }, []);

  // Listen for PDF initialization recovery events
  usePDFInitRecovery((data) => {
    if (data.clientId && data.totalPages) {
      setLastInitRecovery({
        clientId: data.clientId,
        totalPages: data.totalPages,
      });

      // Show a toast notification
      toast.info(`Recovered PDF initialization with ${data.totalPages} pages`, {
        description: `Client: ${data.clientId.substring(0, 8)}...`,
        duration: 3000,
      });

      logger.log("[RecoveryMonitor] PDF init recovery event handled:", data);
    }
  }, []);

  // Calculate total recoveries
  const totalRecoveries =
    stats.pageRecoveries +
    stats.initRecoveries +
    stats.errorRecoveries +
    stats.cleanupRecoveries +
    stats.abortRecoveries;

  // Show/hide the recovery panel if recoveries are detected
  useEffect(() => {
    if (totalRecoveries > 0 && !expanded) {
      setExpanded(true);
    }
  }, [totalRecoveries, expanded]);

  if (totalRecoveries === 0) {
    return null; // Don't render if no recoveries
  }

  return (
    <div className="fixed bottom-4 right-4 bg-white dark:bg-gray-800 shadow-lg rounded-lg p-3 z-50 max-w-sm">
      <div className="flex justify-between items-center">
        <h3 className="text-sm font-semibold">
          PDF Recovery System {totalRecoveries > 0 && `(${totalRecoveries})`}
        </h3>
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-gray-500 hover:text-gray-700"
        >
          {expanded ? "▼" : "▲"}
        </button>
      </div>

      {expanded && (
        <div className="mt-2 text-xs space-y-2">
          <div className="flex justify-between">
            <span>Pages Recovered:</span>
            <span className="font-mono">{stats.pageRecoveries}</span>
          </div>

          <div className="flex justify-between">
            <span>PDF Initializations:</span>
            <span className="font-mono">{stats.initRecoveries}</span>
          </div>

          <div className="flex justify-between">
            <span>Error Recoveries:</span>
            <span className="font-mono">{stats.errorRecoveries}</span>
          </div>

          <div className="flex justify-between">
            <span>Cleanup Events:</span>
            <span className="font-mono">{stats.cleanupRecoveries}</span>
          </div>

          <div className="flex justify-between">
            <span>Abort Events:</span>
            <span className="font-mono">{stats.abortRecoveries}</span>
          </div>

          {lastRecoveredPage && (
            <div className="mt-2 p-2 bg-blue-50 dark:bg-blue-900 rounded">
              <div className="font-semibold">Last Recovered Page:</div>
              <div>Page: {lastRecoveredPage.pageNumber}</div>
              <div className="truncate">
                Client: {lastRecoveredPage.clientId}
              </div>
            </div>
          )}

          {lastInitRecovery && (
            <div className="mt-2 p-2 bg-green-50 dark:bg-green-900 rounded">
              <div className="font-semibold">Last Recovered PDF:</div>
              <div>Pages: {lastInitRecovery.totalPages}</div>
              <div className="truncate">
                Client: {lastInitRecovery.clientId}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default RecoveryMonitor;
