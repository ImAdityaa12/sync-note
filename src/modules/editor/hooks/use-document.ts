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
import { SyncEngine } from "@/lib/sync/engine";
import type { SyncStatus } from "@/lib/sync/status";
import { diffText } from "@/modules/editor/lib/text-diff";

export type LocalSaveStatus = "loading" | "saving" | "saved";

const SAVE_DEBOUNCE_MS = 400;

/**
 * Local-first, CRDT-backed document binding with background sync.
 *
 * Content lives in an in-memory `RGA`. Every keystroke is diffed into ops,
 * applied synchronously (responsive typing), queued in the durable `oplog`, and
 * snapshotted to IndexedDB on a debounce. A `SyncEngine` drains that oplog to the
 * server and merges remote ops back in — the network is never on the path of a
 * keystroke. Editors push; viewers pull only.
 */
export function useDocument(docId: string, canEdit: boolean) {
  const [content, setContent] = useState("");
  const [status, setStatus] = useState<LocalSaveStatus>("loading");
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("connecting");

  const rgaRef = useRef<RGA | null>(null);
  const engineRef = useRef<SyncEngine | null>(null);
  const pendingOpsRef = useRef<Op[]>([]);
  const dirtyRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Restore the CRDT from IndexedDB, then start the sync engine.
  useEffect(() => {
    let cancelled = false;
    let engine: SyncEngine | null = null;

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

      engine = new SyncEngine({
        docId,
        rga,
        canPush: canEdit,
        onRemoteApplied: () => {
          if (!cancelled) setContent(rga.toString());
        },
        onStatus: (s) => {
          if (!cancelled) setSyncStatus(s);
        },
      });
      engineRef.current = engine;
      engine.start();
    })().catch(() => {
      if (!cancelled) setStatus("saved");
    });

    return () => {
      cancelled = true;
      engine?.stop();
      engineRef.current = null;
    };
  }, [docId, canEdit]);

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
      engineRef.current?.notifyLocalChange(); // kick off a push
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

      const { index, deleteCount, insert } = diffText(prevText, nextText);
      if (deleteCount > 0) {
        pendingOpsRef.current.push(...rga.deleteAt(index, deleteCount));
      }
      if (insert) {
        pendingOpsRef.current.push(...rga.insertAt(index, insert));
      }

      dirtyRef.current = true;
      setContent(rga.toString());
      setStatus("saving");

      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
    },
    [flush]
  );

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

  return { content, onChange, status, syncStatus };
}
