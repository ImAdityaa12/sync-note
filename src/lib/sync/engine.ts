import type { RGA } from "@/lib/crdt/rga";
import { getCursor, setCursor } from "@/lib/local/repo";

import { httpTransport, type SyncTransport } from "./transport";

interface SyncEngineOptions {
  docId: string;
  rga: RGA;
  /** Called after remote ops change the document, so the editor can re-render. */
  onRemoteApplied: () => void;
  /** Catch-up lifecycle, so the hook can derive the connection status. */
  onState: (state: { active: boolean; errored: boolean }) => void;
  /**
   * Durably persist the current CRDT snapshot. Must be a single serialized
   * writer shared with the editor (the realtime path and local edits persist
   * through the same function), so a stale write can never clobber a newer one.
   */
  persist: () => Promise<void>;
  /** Override the transport (tests inject an in-memory server). */
  transport?: SyncTransport;
}

const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 15_000;

/**
 * Catch-up engine. Pulls ops the client hasn't seen and merges them: pull ops
 * since the saved cursor → apply to the RGA → **persist the snapshot → advance
 * the cursor**. That ordering makes a reload safe: the cursor is never advanced
 * past ops the persisted snapshot doesn't yet reflect, so merged remote edits
 * can't be lost.
 *
 * It is **pull-only** — steady-state durability (pushing local edits) flows over
 * the websocket now, so there is no periodic poll. Catch-up runs only on demand:
 * on open, on (re)connect, when a welcome watermark is ahead of us, and when a
 * live op frame reports a gap. A failed pull retries with backoff (the lone
 * liveness backstop), but an idle, in-sync document issues no requests at all.
 */
export class SyncEngine {
  private readonly opts: SyncEngineOptions;
  private readonly transport: SyncTransport;
  private running = false;
  private inFlight = false;
  private rerun = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryAttempts = 0;

  constructor(opts: SyncEngineOptions) {
    this.opts = opts;
    this.transport = opts.transport ?? httpTransport;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.catchUp(); // initial reconcile on open
  }

  stop(): void {
    this.running = false;
    this.clearRetry();
  }

  /**
   * Pull everything we haven't seen, merge it, and advance the cursor. Public so
   * it can be driven deterministically in tests and triggered by socket events.
   * Coalesces: a request that lands mid-run re-runs once at the end.
   */
  async catchUp(): Promise<void> {
    // Only attempt over a live network — `navigator.onLine` is absent in some
    // non-browser runtimes, so treat only an explicit `false` as offline.
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    if (this.inFlight) {
      this.rerun = true;
      return;
    }
    this.inFlight = true;
    this.opts.onState({ active: true, errored: false });

    try {
      const { docId, rga } = this.opts;
      let since = await getCursor(docId);
      let changed = false;
      for (;;) {
        const { ops, latestSeq, hasMore } = await this.transport.pull(docId, since);
        if (ops.length > 0) {
          for (const op of ops) {
            if (rga.apply(op)) changed = true;
          }
          // Persist BEFORE advancing the cursor whenever we pulled ops — even ops
          // already applied live over the socket, which may not be in the snapshot
          // yet. The cursor is the "durably snapshotted" watermark, so it must
          // never move past ops the snapshot doesn't reflect, or a reload would
          // load stale content and never re-pull them.
          await this.opts.persist();
        }
        if (latestSeq > since) {
          await setCursor(docId, latestSeq);
          since = latestSeq;
        }
        if (!hasMore) break;
      }

      if (changed) this.opts.onRemoteApplied();
      this.opts.onState({ active: false, errored: false });
      this.clearRetry();
    } catch {
      // Network/server error — surface it and retry with backoff so a transient
      // blip self-heals without a steady-state poll.
      this.opts.onState({ active: false, errored: true });
      this.scheduleRetry();
    } finally {
      this.inFlight = false;
      if (this.rerun) {
        this.rerun = false;
        void this.catchUp();
      }
    }
  }

  private scheduleRetry(): void {
    if (!this.running || this.retryTimer) return;
    const delay = Math.min(
      RETRY_MAX_MS,
      RETRY_BASE_MS * 2 ** this.retryAttempts
    );
    this.retryAttempts++;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.catchUp();
    }, delay);
  }

  private clearRetry(): void {
    this.retryAttempts = 0;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }
}
