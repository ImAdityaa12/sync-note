"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { Op } from "@/lib/crdt/codec";
import { RGA } from "@/lib/crdt/rga";
import {
  appendOps,
  getOrCreateSiteId,
  loadDocumentRecord,
  saveSnapshot,
} from "@/lib/local/repo";
import { diffText } from "@/modules/editor/lib/text-diff";

export type LocalSaveStatus = "loading" | "saving" | "saved";

const SAVE_DEBOUNCE_MS = 400;

/**
 * Local-first, CRDT-backed document binding.
 *
 * Content lives in an in-memory `RGA`; every keystroke is diffed into CRDT ops,
 * applied synchronously (responsive typing), queued in the durable `oplog`, and
 * the snapshot is persisted to IndexedDB on a debounce. The network is never on
 * the path of a keystroke — the sync engine (Phase D) drains the oplog later.
 */
export function useDocument(docId: string) {
  const [content, setContent] = useState("");
  const [status, setStatus] = useState<LocalSaveStatus>("loading");

  const rgaRef = useRef<RGA | null>(null);
  const pendingOpsRef = useRef<Op[]>([]);
  const dirtyRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Restore the CRDT from IndexedDB on open (or seed from legacy text / empty).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const siteId = await getOrCreateSiteId(docId);
      const record = await loadDocumentRecord(docId);
      if (cancelled) return;

      let rga: RGA;
      if (record?.crdtState) {
        rga = RGA.fromSnapshot(record.crdtState, siteId);
      } else {
        rga = new RGA(siteId);
        if (record?.content) rga.insertAt(0, record.content); // migrate Phase B text
      }
      rgaRef.current = rga;
      setContent(rga.toString());
      setStatus("saved");
    })().catch(() => {
      if (!cancelled) setStatus("saved");
    });

    return () => {
      cancelled = true;
    };
  }, [docId]);

  const flush = useCallback(async () => {
    const rga = rgaRef.current;
    if (!rga || !dirtyRef.current) return;
    dirtyRef.current = false;
    const ops = pendingOpsRef.current;
    pendingOpsRef.current = [];
    try {
      await appendOps(docId, ops);
      await saveSnapshot(docId, rga.snapshot());
      setStatus("saved");
    } catch {
      // Best-effort: state stays in memory and retries on the next edit.
    }
  }, [docId]);

  const onChange = useCallback(
    (nextText: string) => {
      const rga = rgaRef.current;
      if (!rga) return;

      const prevText = rga.toString();
      if (nextText === prevText) return;

      // Translate the edit into CRDT ops and apply locally (synchronous).
      const { index, deleteCount, insert } = diffText(prevText, nextText);
      if (deleteCount > 0) {
        pendingOpsRef.current.push(...rga.deleteAt(index, deleteCount));
      }
      if (insert) {
        pendingOpsRef.current.push(...rga.insertAt(index, insert));
      }

      dirtyRef.current = true;
      setContent(rga.toString()); // equals nextText; keeps the textarea controlled
      setStatus("saving");

      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
    },
    [flush]
  );

  // Persist promptly on tab-hide / unmount so the debounce window can't drop edits.
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

  return { content, onChange, status };
}
