"use client";

import * as React from "react";

/**
 * Merges multiple refs into one callback ref.
 * This allows you to pass multiple refs, such as the ones from the parent and context,
 * and ensures they are all updated correctly.
 *
 * @param refs - An array of refs (either `MutableRefObject` or `LegacyRef`) to merge.
 * @returns A callback ref that updates all the passed refs with the current value.
 */
export function mergeRefs<T>(
  ...refs: Array<React.MutableRefObject<T> | React.LegacyRef<T>>
): React.RefCallback<T> {
  return (value: T | null) => {
    refs.forEach((ref) => {
      if (typeof ref === "function") {
        ref(value);
      } else if (ref != null) {
        (ref as React.MutableRefObject<T | null>).current = value;
      }
    });
  };
}
