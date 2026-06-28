"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { Op } from "@/lib/crdt/codec";
import { RGA } from "@/lib/crdt/rga";
import type { Peer } from "@/lib/realtime/protocol";
import {
  appendOps,
  getOrCreateSiteId,
  loadDocumentRecord,
  saveSnapshot,
} from "@/lib/local/repo";
import { SyncEngine } from "@/lib/sync/engine";
import { RealtimeClient } from "@/lib/sync/realtime";
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
  /** Other people live in the room (presence + cursors), excluding this client. */
  const [peers, setPeers] = useState<Peer[]>([]);
  /** Whether the low-latency realtime socket is currently connected. */
  const [live, setLive] = useState(false);

  const rgaRef = useRef<RGA | null>(null);
  const engineRef = useRef<SyncEngine | null>(null);
  const realtimeRef = useRef<RealtimeClient | null>(null);
  const pendingOpsRef = useRef<Op[]>([]);
  const dirtyRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Restore the CRDT from IndexedDB, then start the sync engine.
  useEffect(() => {
    let cancelled = false;
    let engine: SyncEngine | null = null;
    let realtime: RealtimeClient | null = null;

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

      // Live accelerator: apply remote ops the instant they arrive and broadcast
      // ours. Durability still flows through the engine/oplog above, so this is
      // pure latency — if the socket never connects, the doc still converges.
      realtime = new RealtimeClient({
        docId,
        site: siteId,
        onOps: (ops) => {
          let changed = false;
          for (const op of ops) if (rga.apply(op)) changed = true;
          if (changed && !cancelled) {
            setContent(rga.toString());
            // Persist so a reload is safe even before the HTTP cursor catches up.
            void saveSnapshot(docId, rga.snapshot());
          }
        },
        onPresence: (all) => {
          if (!cancelled) setPeers(all.filter((p) => p.site !== siteId));
        },
        onConnectedChange: (connected) => {
          if (!cancelled) setLive(connected);
        },
      });
      realtimeRef.current = realtime;
      realtime.start();
    })().catch(() => {
      if (!cancelled) setStatus("saved");
    });

    return () => {
      cancelled = true;
      engine?.stop();
      engineRef.current = null;
      realtime?.stop();
      realtimeRef.current = null;
      setLive(false);
      setPeers([]);
    };
  }, [docId, canEdit]);

  const flush = useCallback(async () => {
    const rga = rgaRef.current;
    if (!rga || !dirtyRef.current) return;
    dirtyRef.current = false;
    const ops = pendingOpsRef.current;
    pendingOpsRef.current = [];
    realtimeRef.current?.sendOps(ops); // broadcast live; durability handled below
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

  // Report the local caret/selection so peers can render this client's cursor.
  const reportCursor = useCallback((anchor: number, head: number) => {
    realtimeRef.current?.sendCursor(anchor, head);
  }, []);

  return { content, onChange, status, syncStatus, peers, live, reportCursor };
}
