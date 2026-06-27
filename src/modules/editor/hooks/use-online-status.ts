"use client";

import { useSyncExternalStore } from "react";

/**
 * Tracks browser connectivity via the platform online/offline events.
 * `useSyncExternalStore` is the idiomatic way to subscribe to an external,
 * mutable source — SSR-safe (server snapshot is `true`) and tear-free.
 */
function subscribe(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

export function useOnlineStatus(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true
  );
}
