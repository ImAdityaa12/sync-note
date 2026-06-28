import type { Op } from "@/lib/crdt/codec";
import type { ClientFrame, Peer, ServerFrame } from "@/lib/realtime/protocol";

interface TicketResponse {
  ticket: string;
  url: string;
}

export interface RealtimeClientOptions {
  docId: string;
  /** This replica's CRDT site id, so our cursor correlates with our ops. */
  site: string;
  /** Remote ops to apply to the local CRDT. */
  onOps: (ops: Op[]) => void;
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

  /** Broadcast locally-produced ops to peers (no-op if the socket is down). */
  sendOps(ops: Op[]): void {
    if (ops.length > 0) this.send({ t: "op", ops });
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

  private send(frame: ClientFrame): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(frame));
    }
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
      case "presence":
        this.opts.onPresence(frame.peers);
        break;
      case "op":
        this.opts.onOps(frame.ops);
        break;
      // 'ack' / 'error' are advisory — durability + retries live in the HTTP path.
      case "ack":
      case "error":
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
