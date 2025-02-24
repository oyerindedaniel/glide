import { useSyncExternalStore } from "react";

/**
 * Subscribes to the online/offline events and triggers updates when the status changes.
 *
 * @param {() => void} callback - The function to call when the online status changes.
 * @returns {() => void} Cleanup function to remove the event listeners.
 */
const subscribe = (callback: () => void) => {
  const handleStatusChange = () => callback();

  window.addEventListener("online", handleStatusChange);
  window.addEventListener("offline", handleStatusChange);

  return () => {
    window.removeEventListener("online", handleStatusChange);
    window.removeEventListener("offline", handleStatusChange);
  };
};

/**
 * Gets the current online status from the browser.
 * @returns {boolean} The current value of `navigator.onLine`.
 */
const getSnapshot = () => navigator.onLine;

/**
 * Provides a fallback value for server-side rendering.
 * @returns {boolean} Assumes the user is online during SSR.
 */
const getServerSnapshot = () => true;

/**
 * Custom hook to track the user's online status.
 *
 * @returns {boolean} Current online status (`true` for online, `false` for offline).
 */
export const useOnlineStatus = () => {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
};
