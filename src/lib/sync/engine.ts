import type { RGA } from "@/lib/crdt/rga";
import {
  getCursor,
  getPendingOps,
  pruneOps,
  saveSnapshot,
  setCursor,
} from "@/lib/local/repo";

import type { SyncStatus } from "./status";
import { httpTransport, type SyncTransport } from "./transport";

interface SyncEngineOptions {
  docId: string;
  rga: RGA;
  /** Editors/owners push; viewers pull only (and the server enforces it too). */
  canPush: boolean;
  /** Called after remote ops change the document, so the editor can re-render. */
  onRemoteApplied: () => void;
  onStatus: (status: SyncStatus) => void;
  /** Override the transport (tests inject an in-memory server). */
  transport?: SyncTransport;
}

const POLL_MS = 2500; // background pull cadence
const PUSH_DEBOUNCE_MS = 600; // coalesce bursts of local edits before pushing

/**
 * Background sync engine. Reconciles the local CRDT with the server: drain the
 * durable oplog → push (idempotent) → prune; then pull ops since the saved
 * cursor → merge into the RGA → **persist the snapshot → advance the cursor**.
 *
 * That ordering is what makes a reload safe: the cursor is never advanced past
 * ops that aren't yet in the persisted snapshot, so merged remote edits can't be
 * lost. Survives offline and interrupted syncs — unacked ops requeue and
 * re-applying an op is a no-op on both client (CRDT) and server (idempotent).
 */
export class SyncEngine {
  private readonly opts: SyncEngineOptions;
  private readonly transport: SyncTransport;
  private running = false;
  private inFlight = false;
  private rerun = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private pushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: SyncEngineOptions) {
    this.opts = opts;
    this.transport = opts.transport ?? httpTransport;
    this.onOnline = this.onOnline.bind(this);
    this.onOffline = this.onOffline.bind(this);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    window.addEventListener("online", this.onOnline);
    window.addEventListener("offline", this.onOffline);
    this.pollTimer = setInterval(() => {
      if (this.running) void this.sync();
    }, POLL_MS);
    void this.sync(); // initial catch-up on open
  }

  stop(): void {
    this.running = false;
    window.removeEventListener("online", this.onOnline);
    window.removeEventListener("offline", this.onOffline);
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.pushTimer) clearTimeout(this.pushTimer);
  }

  /** A local edit happened — schedule a (debounced) push. */
  notifyLocalChange(): void {
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => void this.sync(), PUSH_DEBOUNCE_MS);
  }

  private onOnline(): void {
    void this.sync();
  }

  private onOffline(): void {
    this.opts.onStatus("offline");
  }

  /** One reconcile cycle. Public so it can be driven deterministically in tests. */
  async sync(): Promise<void> {
    // Only treat an *explicit* offline signal as offline — `navigator.onLine` is
    // absent in non-browser runtimes (and Node 21+ defines a partial navigator).
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      this.opts.onStatus("offline");
      return;
    }
    // Serialize: never overlap; coalesce a request that lands mid-run.
    if (this.inFlight) {
      this.rerun = true;
      return;
    }
    this.inFlight = true;
    this.opts.onStatus("syncing");

    try {
      const { docId, rga, canPush } = this.opts;

      // 1) Push pending local ops, then prune exactly what we pushed.
      if (canPush) {
        const pending = await getPendingOps(docId);
        if (pending.length > 0) {
          await this.transport.push(
            docId,
            pending.map((p) => p.op)
          );
          await pruneOps(
            pending
              .map((p) => p.localSeq)
              .filter((seq): seq is number => seq !== undefined)
          );
        }
      }

      // 2) Pull everything we haven't seen; merge, persist, then advance cursor.
      let since = await getCursor(docId);
      let changed = false;
      for (;;) {
        const { ops, latestSeq, hasMore } = await this.transport.pull(
          docId,
          since
        );
        if (ops.length > 0) {
          const before = rga.toString();
          for (const op of ops) rga.apply(op);
          if (rga.toString() !== before) changed = true;
          // Persist BEFORE advancing the cursor — a reload must never skip ops
          // that aren't yet in the snapshot.
          await saveSnapshot(docId, rga.snapshot());
        }
        if (latestSeq > since) {
          await setCursor(docId, latestSeq);
          since = latestSeq;
        }
        if (!hasMore) break;
      }

      if (changed) this.opts.onRemoteApplied();
      this.opts.onStatus("synced");
    } catch {
      // Network/server error — stay queued and retry on the next tick.
      this.opts.onStatus("error");
    } finally {
      this.inFlight = false;
      if (this.rerun) {
        this.rerun = false;
        void this.sync();
      }
    }
  }
}
