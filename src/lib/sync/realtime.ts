import type { Op } from "@/lib/crdt/codec";
import type {
  ClientFrame,
  ErrorCode,
  Peer,
  ServerFrame,
} from "@/lib/realtime/protocol";

interface TicketResponse {
  ticket: string;
  url: string;
}

/** A batch of remote ops with the seq range it covers (for gap-safe applying). */
export interface RemoteOpBatch {
  ops: Op[];
  /** Room seq before this batch — the client applies only if it equals its cursor. */
  fromSeq: number;
  /** Room watermark after this batch (the new cursor on a contiguous apply). */
  seq: number;
}

export interface RealtimeClientOptions {
  docId: string;
  /** This replica's CRDT site id, so our cursor correlates with our ops. */
  site: string;
  /** A remote op batch to apply to the local CRDT (gap-checked by the caller). */
  onOps: (batch: RemoteOpBatch) => void;
  /** The room watermark from a welcome frame (connect or a backpressure nudge). */
  onWelcome: (seq: number) => void;
  /** The server durably persisted our pushed ops up to `seq` — safe to prune. */
  onAck: (seq: number) => void;
  /** The server rejected a frame (rate limit, forbidden, server error, …). */
  onError: (code: ErrorCode) => void;
  /** Latest presence snapshot of the *other* people in the room. */
  onPresence: (peers: Peer[]) => void;
  /** Whether the live socket is currently connected. */
  onConnectedChange: (connected: boolean) => void;
}

const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 15_000;
const CURSOR_THROTTLE_MS = 50; // ~20 presence updates/sec is smooth + cheap

/**
 * Client side of the realtime relay — a thin **live accelerator** over the
 * durable HTTP `SyncEngine`. It pushes local ops to peers and applies remote ops
 * the instant they arrive, and carries cursor presence. It deliberately owns no
 * durability: the oplog + HTTP push/pull remain the source of truth, so if the
 * socket is down the document still converges (just less instantly), and a
 * dropped connection simply reconnects with backoff.
 */
export class RealtimeClient {
  private ws: WebSocket | null = null;
  private stopped = false;
  private attempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private cursorTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingCursor: { anchor: number; head: number } | null = null;
  private lastCursorAt = 0;

  constructor(private readonly opts: RealtimeClientOptions) {}

  start(): void {
    this.stopped = false;
    void this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.cursorTimer) clearTimeout(this.cursorTimer);
    const ws = this.ws;
    this.ws = null;
    ws?.close();
  }

  /** Whether the live socket is currently open (can carry pushes). */
  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Push locally-produced ops to peers + durable store. Returns whether they were
   * actually sent; a `false` (socket down) tells the caller to keep them queued.
   */
  sendOps(ops: Op[]): boolean {
    if (ops.length === 0) return false;
    return this.send({ t: "op", ops });
  }

  /**
   * Broadcast this client's caret/selection as presence — throttled (leading +
   * trailing) so fast typing can't flood the socket, while the final resting
   * position is always delivered.
   */
  sendCursor(anchor: number, head: number): void {
    this.pendingCursor = { anchor, head };
    const elapsed = Date.now() - this.lastCursorAt;
    if (elapsed >= CURSOR_THROTTLE_MS) {
      this.flushCursor();
    } else if (!this.cursorTimer) {
      this.cursorTimer = setTimeout(
        () => this.flushCursor(),
        CURSOR_THROTTLE_MS - elapsed
      );
    }
  }

  private flushCursor(): void {
    if (this.cursorTimer) {
      clearTimeout(this.cursorTimer);
      this.cursorTimer = null;
    }
    const cursor = this.pendingCursor;
    if (!cursor) return;
    this.pendingCursor = null;
    this.lastCursorAt = Date.now();
    this.send({ t: "cursor", anchor: cursor.anchor, head: cursor.head });
  }

  private send(frame: ClientFrame): boolean {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(frame));
      return true;
    }
    return false;
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;

    let info: TicketResponse;
    try {
      const res = await fetch(
        `/api/realtime/ticket?doc=${encodeURIComponent(this.opts.docId)}`
      );
      if (!res.ok) {
        // 401/403/404 won't fix themselves by retrying (re-auth / no access);
        // back off only on transient failures.
        if (res.status === 401 || res.status === 403 || res.status === 404) {
          return;
        }
        throw new Error(`ticket ${res.status}`);
      }
      info = (await res.json()) as TicketResponse;
    } catch {
      this.scheduleReconnect();
      return;
    }
    if (this.stopped) return;

    const url = `${info.url}/?ticket=${encodeURIComponent(
      info.ticket
    )}&site=${encodeURIComponent(this.opts.site)}`;

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.attempts = 0;
      this.opts.onConnectedChange(true);
    };
    ws.onmessage = (event) => this.onMessage(event.data);
    ws.onclose = () => {
      if (this.ws === ws) this.ws = null;
      this.opts.onConnectedChange(false);
      this.scheduleReconnect();
    };
    // 'error' is always followed by 'close', which handles reconnect.
    ws.onerror = () => {};
  }

  private onMessage(data: unknown): void {
    if (typeof data !== "string") return;
    let frame: ServerFrame;
    try {
      frame = JSON.parse(data) as ServerFrame;
    } catch {
      return;
    }
    switch (frame.t) {
      case "welcome":
        this.opts.onPresence(frame.peers);
        // welcome carries the room watermark — on connect, and again whenever the
        // server nudges us after a dropped broadcast — so we can catch up if behind.
        this.opts.onWelcome(frame.seq);
        break;
      case "presence":
        this.opts.onPresence(frame.peers);
        break;
      case "op":
        this.opts.onOps({ ops: frame.ops, fromSeq: frame.fromSeq, seq: frame.seq });
        break;
      case "ack":
        this.opts.onAck(frame.seq);
        break;
      case "error":
        this.opts.onError(frame.code);
        break;
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const backoff = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** this.attempts);
    // Jitter avoids a thundering herd when many clients drop at once.
    const delay = backoff * (0.5 + Math.random() * 0.5);
    this.attempts++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
  }
}
