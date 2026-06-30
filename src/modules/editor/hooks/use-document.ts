"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { Op } from "@/lib/crdt/codec";
import { RGA } from "@/lib/crdt/rga";
import type { Peer } from "@/lib/realtime/protocol";
import {
  appendOps,
  getCursor,
  getOrCreateSiteId,
  loadDocumentRecord,
  saveSnapshot,
  setCursor,
} from "@/lib/local/repo";
import { SyncEngine } from "@/lib/sync/engine";
import { OutboundQueue } from "@/lib/sync/outbound";
import { RealtimeClient } from "@/lib/sync/realtime";
import type { SyncStatus } from "@/lib/sync/status";
import { diffText } from "@/modules/editor/lib/text-diff";
import { restoreToText } from "@/modules/versions/lib/restore";

export type LocalSaveStatus = "loading" | "saving" | "saved";

const SAVE_DEBOUNCE_MS = 400;

const initialOnline = () =>
  typeof navigator === "undefined" ? true : navigator.onLine;

/**
 * Local-first, CRDT-backed document binding with realtime sync.
 *
 * Content lives in an in-memory `RGA`. Every keystroke is diffed into ops,
 * applied synchronously (responsive typing), queued in the durable `oplog`, and
 * snapshotted to IndexedDB on a debounce. An `OutboundQueue` drains that oplog to
 * the server **over the websocket** (durability lives on the socket: prune on
 * ack), while a pull-only `SyncEngine` catches up on anything we missed when we
 * (re)connect. The network is never on the path of a keystroke. Editors push;
 * viewers pull only.
 */
export function useDocument(docId: string, canEdit: boolean) {
  const [content, setContent] = useState("");
  const [status, setStatus] = useState<LocalSaveStatus>("loading");
  /** Other people live in the room (presence + cursors), excluding this client. */
  const [peers, setPeers] = useState<Peer[]>([]);
  /** Whether the low-latency realtime socket is currently connected. */
  const [live, setLive] = useState(false);
  /** Browser network reachability (drives the "offline" badge). */
  const [online, setOnline] = useState(initialOnline);
  /** Local edits queued/in-flight to the server but not yet acked. */
  const [pendingOut, setPendingOut] = useState(false);
  /** A catch-up pull is currently running. */
  const [catchActive, setCatchActive] = useState(false);
  /** The last catch-up pull failed. */
  const [catchErrored, setCatchErrored] = useState(false);

  const rgaRef = useRef<RGA | null>(null);
  const engineRef = useRef<SyncEngine | null>(null);
  const realtimeRef = useRef<RealtimeClient | null>(null);
  const outboundRef = useRef<OutboundQueue | null>(null);
  const pendingOpsRef = useRef<Op[]>([]);
  const dirtyRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The currently-running flush, so a caller (e.g. restore) can await a flush
  // that's already mid-write instead of racing past it.
  const flushPromiseRef = useRef<Promise<void>>(Promise.resolve());
  // Serializes remote-op batches so two frames can't both read the same cursor
  // and one wrongly conclude there's a gap.
  const applyChainRef = useRef<Promise<void>>(Promise.resolve());

  // Single serialized snapshot writer. Local edits, pulled remote ops, and the
  // realtime path all persist through this one chain, so a stale write started
  // earlier can never land after — and clobber — a newer one.
  const writeChainRef = useRef<Promise<void>>(Promise.resolve());
  const persist = useCallback((): Promise<void> => {
    const done = writeChainRef.current.then(async () => {
      const rga = rgaRef.current;
      if (rga) await saveSnapshot(docId, rga.snapshot());
    });
    writeChainRef.current = done.catch(() => {}); // keep the chain alive on error
    return done;
  }, [docId]);

  // Persist the snapshot and *then* advance the pull cursor, atomically on the
  // write chain — the persist-before-advance invariant for remote ops applied
  // live over the socket. The cursor must never move past content the snapshot
  // doesn't yet reflect, or a reload would skip those ops.
  const persistAndAdvance = useCallback(
    (seq: number): Promise<void> => {
      const done = writeChainRef.current.then(async () => {
        const rga = rgaRef.current;
        if (rga) await saveSnapshot(docId, rga.snapshot());
        await setCursor(docId, seq);
      });
      writeChainRef.current = done.catch(() => {});
      return done;
    },
    [docId]
  );

  // Restore the CRDT from IndexedDB, then start sync (push over the socket,
  // catch-up over HTTP).
  useEffect(() => {
    let cancelled = false;
    let engine: SyncEngine | null = null;
    let realtime: RealtimeClient | null = null;
    let outbound: OutboundQueue | null = null;

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

      // Apply a remote op batch gap-safely. Serialized so back-to-back frames
      // advance the cursor in order rather than racing on a stale read.
      const applyRemoteBatch = (batch: {
        ops: Op[];
        fromSeq: number;
        seq: number;
      }) => {
        applyChainRef.current = applyChainRef.current
          .then(async () => {
            if (cancelled) return;
            const cursor = await getCursor(docId);
            if (batch.seq <= cursor) return; // already have it
            if (batch.fromSeq !== cursor) {
              // We missed ops — fall back to a full HTTP catch-up (coalesced).
              void engineRef.current?.catchUp();
              return;
            }
            let changed = false;
            for (const op of batch.ops) if (rga.apply(op)) changed = true;
            await persistAndAdvance(batch.seq);
            if (changed && !cancelled) setContent(rga.toString());
          })
          .catch(() => {});
      };

      // A welcome watermark ahead of our cursor (on connect, or a backpressure
      // nudge) means we have catching up to do.
      const onWelcomeSeq = async (seq: number) => {
        if (cancelled) return;
        if (seq > (await getCursor(docId))) void engineRef.current?.catchUp();
      };

      engine = new SyncEngine({
        docId,
        rga,
        onRemoteApplied: () => {
          if (!cancelled) setContent(rga.toString());
        },
        onState: ({ active, errored }) => {
          if (cancelled) return;
          setCatchActive(active);
          setCatchErrored(errored);
        },
        persist,
      });
      engineRef.current = engine;

      // Live socket: applies remote ops the instant they arrive, broadcasts ours,
      // and carries durability (acks prune the oplog).
      realtime = new RealtimeClient({
        docId,
        site: siteId,
        onOps: applyRemoteBatch,
        onWelcome: (seq) => void onWelcomeSeq(seq),
        onAck: () => void outboundRef.current?.onAck(),
        onError: () => outboundRef.current?.onError(),
        onPresence: (all) => {
          if (!cancelled) setPeers(all.filter((p) => p.site !== siteId));
        },
        onConnectedChange: (connected) => {
          if (cancelled) return;
          setLive(connected);
          if (connected) {
            outboundRef.current?.onConnect(); // drain anything queued offline
            void engineRef.current?.catchUp(); // pull anything we missed
          } else {
            outboundRef.current?.onDisconnect();
          }
        },
      });
      realtimeRef.current = realtime;

      outbound = new OutboundQueue({
        docId,
        canPush: canEdit,
        send: (ops) => realtimeRef.current?.sendOps(ops) ?? false,
        onPendingChange: (has) => {
          if (!cancelled) setPendingOut(has);
        },
      });
      outboundRef.current = outbound;

      engine.start();
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
      outbound?.onDisconnect(); // clear its ack timer
      outboundRef.current = null;
      setLive(false);
      setPeers([]);
      setPendingOut(false);
      setCatchActive(false);
    };
  }, [docId, canEdit, persist, persistAndAdvance]);

  // Network reachability → status, and a reconnect kick when we come back.
  useEffect(() => {
    const goOnline = () => {
      setOnline(true);
      void engineRef.current?.catchUp();
    };
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  // Durability tail shared by every local-write path (debounced flush + restore):
  // append to the durable oplog, persist the snapshot, then push it over the
  // socket. One copy so the persist/push ordering can't drift between paths.
  const commitOps = useCallback(
    async (ops: Op[]) => {
      if (ops.length === 0) return;
      try {
        // Durably queue first, then push over the socket, then snapshot — so a
        // snapshot write failure can't stop acked ops from reaching the server
        // (the oplog is the durable queue; ack prunes it).
        await appendOps(docId, ops);
        outboundRef.current?.kick();
        await persist();
        setStatus("saved");
      } catch {
        // Best-effort: state stays in memory and retries on the next edit/sync.
      }
    },
    [docId, persist]
  );

  const flush = useCallback(async (): Promise<void> => {
    const rga = rgaRef.current;
    // Not dirty: a flush may already be mid-write (the debounce just fired), so
    // await it rather than returning before its durable write completes.
    if (!rga || !dirtyRef.current) {
      await flushPromiseRef.current;
      return;
    }
    dirtyRef.current = false;
    const ops = pendingOpsRef.current;
    pendingOpsRef.current = [];
    const done = commitOps(ops);
    flushPromiseRef.current = done;
    await done;
  }, [commitOps]);

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

  /**
   * Restore a saved version as forward CRDT ops (never a destructive overwrite).
   * It runs through the exact same path as a keystroke — diff → ops → oplog →
   * persist → socket push — so a peer editing concurrently still converges.
   * Returns once the restore is durably queued.
   */
  const restore = useCallback(
    async (text: string) => {
      // Restore writes ops; viewers never push (UI hides it, server re-checks,
      // and the outbound queue's canPush is false). Guard here too so a viewer
      // can't accumulate ops in a local oplog that will never be pushed or pruned.
      if (!canEdit) return;
      const rga = rgaRef.current;
      if (!rga) return;

      // Land any debounced edits first, so the restore diffs against a settled
      // document instead of racing a pending flush.
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      await flush();

      const ops = restoreToText(rga, text);
      if (ops.length === 0) return;

      setContent(rga.toString());
      setStatus("saving");
      await commitOps(ops);
    },
    [canEdit, flush, commitOps]
  );

  /**
   * Capture the current document for a version snapshot: the live materialized
   * text together with the pull cursor it reflects.
   *
   * Read the cursor *first*, then the content. Pulled ops are persisted to the
   * RGA before the cursor advances, so content read after the cursor can only
   * reflect the same-or-more server ops — never fewer. That keeps `baseSeq` an
   * under-claim of what `content` covers (the compaction-safe direction); the
   * reverse order would let a pull during the await push the cursor past the
   * captured text and over-claim coverage.
   */
  const captureVersion = useCallback(async () => {
    const baseSeq = await getCursor(docId);
    const rga = rgaRef.current;
    const content = rga ? rga.toString() : "";
    return { content, baseSeq };
  }, [docId]);

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

  // Derive the single sync badge from the socket + queue + catch-up state.
  const syncStatus: SyncStatus = !online
    ? "offline"
    : !live
      ? "connecting"
      : catchActive || pendingOut
        ? "syncing"
        : catchErrored
          ? "error"
          : "synced";

  return {
    content,
    onChange,
    restore,
    captureVersion,
    status,
    syncStatus,
    peers,
    live,
    reportCursor,
  };
}
