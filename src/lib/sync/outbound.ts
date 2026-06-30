import type { Op } from "@/lib/crdt/codec";
import { MAX_OPS_PER_FRAME } from "@/lib/realtime/protocol";
import { getPendingOps, pruneOps } from "@/lib/local/repo";

export interface OutboundQueueOptions {
  docId: string;
  /** Editors/owners push; viewers never do (the relay also enforces this). */
  canPush: boolean;
  /** Send a batch over the live socket; returns false if the socket is down. */
  send: (ops: Op[]) => boolean;
  /** Fires when the pending/in-flight state flips, so the hook can show "syncing". */
  onPendingChange?: (hasPending: boolean) => void;
  /** Re-send if an ack never arrives (lost ack / flaky socket). 0 disables. */
  ackTimeoutMs?: number;
}

const DEFAULT_ACK_TIMEOUT_MS = 10_000;

/**
 * Drains the durable oplog over the websocket — the steady-state durability path
 * now that the HTTP poll is gone. One batch is in flight at a time: we send it,
 * the relay persists it and acks with the durable seq, and only then do we prune
 * exactly the ops we sent (tracked by their local keys — never derived from the
 * ack seq, which is a watermark that can include peers' ops) and send the next.
 *
 * On disconnect or a rejection the in-flight batch is released but stays in the
 * oplog, so reconnect retries it; persistence is idempotent, so a double send is
 * harmless. An un-acked batch is also retried after `ackTimeoutMs` to survive a
 * lost ack without falling back to polling.
 */
export class OutboundQueue {
  private readonly opts: OutboundQueueOptions;
  /** Local keys of the batch currently awaiting an ack, or null if none. */
  private outstanding: number[] | null = null;
  private draining = false;
  private rerun = false;
  private ackTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: OutboundQueueOptions) {
    this.opts = opts;
  }

  /** A local edit landed in the oplog — try to push it. (Awaitable for tests.) */
  kick(): Promise<void> {
    return this.drain();
  }

  /** The socket (re)connected — resume draining. (Awaitable for tests.) */
  onConnect(): Promise<void> {
    return this.drain();
  }

  /** The socket dropped — release the in-flight batch so reconnect retries it. */
  onDisconnect(): void {
    this.clearAckTimer();
    this.outstanding = null;
  }

  /** The relay durably persisted the in-flight batch — prune it, push the next. */
  async onAck(): Promise<void> {
    this.clearAckTimer();
    const acked = this.outstanding;
    this.outstanding = null;
    if (acked && acked.length > 0) await pruneOps(acked);
    await this.drain(); // continue draining the rest of the oplog
  }

  /** The relay rejected the in-flight batch — release it; reconnect will retry. */
  onError(): void {
    this.clearAckTimer();
    this.outstanding = null;
  }

  private async drain(): Promise<void> {
    if (!this.opts.canPush) return;
    if (this.outstanding) return; // one batch in flight at a time
    if (this.draining) {
      this.rerun = true;
      return;
    }
    this.draining = true;
    try {
      const pending = await getPendingOps(this.opts.docId);
      this.opts.onPendingChange?.(pending.length > 0);
      if (pending.length === 0) return;

      // Cap each frame so it stays under the relay's per-frame op limit; the
      // next batch goes out when this one is acked.
      const batch = pending.slice(0, MAX_OPS_PER_FRAME);
      const localSeqs = batch
        .map((p) => p.localSeq)
        .filter((s): s is number => s !== undefined);

      if (!this.opts.send(batch.map((p) => p.op))) return; // socket down; stay queued
      this.outstanding = localSeqs;
      this.startAckTimer();
    } finally {
      this.draining = false;
      if (this.rerun) {
        this.rerun = false;
        void this.drain();
      }
    }
  }

  private startAckTimer(): void {
    const ms = this.opts.ackTimeoutMs ?? DEFAULT_ACK_TIMEOUT_MS;
    if (ms <= 0) return;
    this.ackTimer = setTimeout(() => {
      this.ackTimer = null;
      // No ack in time — assume the batch or its ack was lost; release and retry
      // (idempotent persist makes a re-send safe).
      this.outstanding = null;
      void this.drain();
    }, ms);
  }

  private clearAckTimer(): void {
    if (this.ackTimer) {
      clearTimeout(this.ackTimer);
      this.ackTimer = null;
    }
  }
}
