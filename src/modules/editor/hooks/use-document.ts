"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { getLocalDocument, saveLocalDocument } from "@/lib/local/repo";

export type LocalSaveStatus = "loading" | "saving" | "saved";

const SAVE_DEBOUNCE_MS = 400;

/**
 * Local-first document binding. Content loads from and persists to IndexedDB;
 * the network is never on the path of a keystroke. Edits update React state
 * synchronously (responsive typing) while persistence is debounced.
 */
export function useDocument(docId: string) {
  const [content, setContentState] = useState("");
  const [status, setStatus] = useState<LocalSaveStatus>("loading");

  // Latest unsaved content + the pending debounce timer.
  const pendingRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load local content on open. No network — works fully offline. Status starts
  // as "loading" from useState; we only flip it once the async read resolves.
  useEffect(() => {
    let cancelled = false;
    getLocalDocument(docId)
      .then((record) => {
        if (cancelled) return;
        setContentState(record?.content ?? "");
        setStatus("saved");
      })
      .catch(() => {
        if (!cancelled) setStatus("saved");
      });
    return () => {
      cancelled = true;
    };
  }, [docId]);

  const flush = useCallback(async () => {
    if (pendingRef.current === null) return;
    const next = pendingRef.current;
    pendingRef.current = null;
    try {
      await saveLocalDocument(docId, next);
      setStatus("saved");
    } catch {
      // Best-effort: content stays in React state and retries on next edit.
    }
  }, [docId]);

  const setContent = useCallback(
    (next: string) => {
      setContentState(next);
      pendingRef.current = next;
      setStatus("saving");
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
    },
    [flush]
  );

  // Persist promptly when the tab is hidden or the editor unmounts, so an
  // in-flight debounce window can't drop the last keystrokes.
  useEffect(() => {
    function onVisibility() {
      if (document.visibilityState === "hidden") void flush();
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      if (timerRef.current) clearTimeout(timerRef.current);
      void flush();
    };
  }, [flush]);

  return { content, setContent, status };
}
