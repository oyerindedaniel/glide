import { useSyncExternalStore, useRef, useCallback } from "react";

/**
 * Utility function to create a MutationObserver for a given node and configuration.
 * @param node - The node to observe.
 * @param config - MutationObserverInit configuration object.
 * @param callback - Callback to trigger when mutations are observed.
 * @returns A function to disconnect the observer.
 */
function observeNode(
  node: HTMLElement,
  config: MutationObserverInit,
  callback: (mutations: MutationRecord[]) => void
): () => void {
  const observer = new MutationObserver(callback);
  observer.observe(node, config);
  return () => observer.disconnect();
}

/**
 * Utility function to manage state for multiple nodes.
 * @param nodes - Array of nodes to observe.
 * @param config - MutationObserverInit configuration object.
 * @param onMutation - Callback invoked with mutation records.
 * @returns A cleanup function to stop observing all nodes.
 */
function observeMultipleNodes(
  nodes: HTMLElement[],
  config: MutationObserverInit,
  onMutation: (mutation: MutationRecord) => void
): () => void {
  const cleanupFns = nodes.map((node) =>
    observeNode(node, config, (mutations) => {
      if (mutations.length > 0) {
        onMutation(mutations[0]!);
      }
    })
  );

  return () => cleanupFns.forEach((cleanup) => cleanup());
}

/**
 * Custom hook to listen for mutations on one or more elements.
 * @param elementsRef - Array of React refs pointing to the elements to observe.
 * @param config - MutationObserverInit configuration object.
 * @returns The latest `MutationRecord` observed or `null`.
 */
export function useElementMutationListener(
  elementsRef: React.RefObject<HTMLElement | null>[],
  config: MutationObserverInit = {
    attributes: true,
    attributeFilter: ["class", "style"],
  }
): MutationRecord | null {
  const mutationCache = useRef<MutationRecord | null>(null);

  const subscribe = useCallback(
    (callback: () => void) => {
      const elements = elementsRef
        .map((ref) => ref.current)
        .filter(Boolean) as HTMLElement[];
      if (elements.length === 0) return () => {};

      return observeMultipleNodes(elements, config, (mutation) => {
        mutationCache.current = mutation; // Caches the latest mutation
        callback();
      });
    },
    [elementsRef, config]
  );

  const getSnapshot = useCallback(() => mutationCache.current, []);
  const getServerSnapshot = useCallback(() => null, []);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
