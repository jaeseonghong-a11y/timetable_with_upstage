"use client";

import { useSyncExternalStore } from "react";

function noopSubscribe(): () => void {
  return () => {};
}

/**
 * Reads a single localStorage key in a way that's safe across SSR/hydration: returns `null`
 * on the server and the very first paint, then swaps to the real stored value on the client.
 * `useState` + `useEffect` would do the same thing but trips the "no setState in an effect body"
 * lint rule and risks a hydration-mismatch warning — `useSyncExternalStore`'s `getServerSnapshot`
 * exists specifically for this "read a browser-only external value" case.
 */
export function useLocalStorageItem(key: string): string | null {
  return useSyncExternalStore(
    noopSubscribe,
    () => window.localStorage.getItem(key),
    () => null,
  );
}
