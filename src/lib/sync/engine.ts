import type { RGA } from "@/lib/crdt/rga";
import {
  getCursor,
  getPendingOps,
  pruneOps,
  setCursor,
} from "@/lib/local/repo";

import type { SyncStatus } from "./status";
import { pullOps, pushOps } from "./transport";

interface SyncEngineOptions {
  docId: string;
  rga: RGA;
  /** Editors/owners push; viewers pull only (and the server enforces it too). */
  canPush: boolean;
  /** Called after remote ops are merged, so the editor can re-render. */
  onRemoteApplied: () => void;
  onStatus: (status: SyncStatus) => void;
}

const POLL_MS = 2500; // background pull cadence
const PUSH_DEBOUNCE_MS = 600; // coalesce bursts of local edits before pushing

/**
 * Background sync engine. Reconciles the local CRDT with the server over HTTP:
 * drain the durable oplog → push (idempotent) → prune; then pull ops since the
 * saved cursor → merge into the RGA → advance the cursor. Survives offline and
 * interrupted syncs — unacked ops stay queued and retry, and re-applying an op
 * is a no-op on both client (CRDT) and server (idempotent insert).
 *
 * Real-time fan-out + presence/cursors arrive in the next step (WS relay); this
 * already gives multi-device convergence via polling.
 */
export class SyncEngine {
  private readonly opts: SyncEngineOptions;
  private running = false;
  private inFlight = false;
  private rerun = false; // a sync was requested while one was running
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private pushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: SyncEngineOptions) {
    this.opts = opts;
    this.onOnline = this.onOnline.bind(this);
    this.onOffline = this.onOffline.bind(this);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    window.addEventListener("online", this.onOnline);
    window.addEventListener("offline", this.onOffline);
    this.pollTimer = setInterval(() => void this.sync(), POLL_MS);
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

  private async sync(): Promise<void> {
    if (!this.running) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      this.opts.onStatus("offline");
      return;
    }
    // Serialize: never overlap pushes/pulls; coalesce concurrent requests.
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
          await pushOps(
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

      // 2) Pull everything we haven't seen and merge it in.
      let since = await getCursor(docId);
      let applied = false;
      for (;;) {
        const { ops, latestSeq, hasMore } = await pullOps(docId, since);
        for (const op of ops) {
          rga.apply(op);
          applied = true;
        }
        if (latestSeq > since) {
          await setCursor(docId, latestSeq);
          since = latestSeq;
        }
        if (!hasMore) break;
      }

      if (applied) this.opts.onRemoteApplied();
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
