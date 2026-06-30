import { WebSocket } from "ws";

import type { Cursor, Peer, ServerFrame } from "@/lib/realtime/protocol";
import type { DocumentRole } from "@/modules/documents/types";

/** A live socket participating in one document's room. */
export interface Member {
  socket: WebSocket;
  /** The client's CRDT site id, so a remote cursor lines up with its ops. */
  site: string;
  userId: string;
  name: string;
  color: string;
  role: DocumentRole;
  cursor?: Cursor;
  /**
   * Set when a broadcast was dropped to this member under backpressure. Without
   * the old HTTP poll a silent drop would leave the peer permanently behind, so
   * we nudge it to re-pull (via a fresh `welcome`) once its socket drains.
   */
  missed?: boolean;
}

/** Beyond this much queued data we drop frames to a client that can't keep up,
 * rather than let a slow consumer balloon the server's memory (backpressure). */
const MAX_BUFFERED_BYTES = 1 << 20; // 1 MB

/** Returns whether the frame was actually written (false = closed or backpressured). */
function send(socket: WebSocket, data: string): boolean {
  if (socket.readyState !== WebSocket.OPEN) return false;
  if (socket.bufferedAmount > MAX_BUFFERED_BYTES) return false;
  socket.send(data);
  return true;
}

export function sendFrame(socket: WebSocket, frame: ServerFrame): boolean {
  return send(socket, JSON.stringify(frame));
}

/** One per-document room: the set of sockets currently editing/viewing it. */
export class Room {
  readonly members = new Set<Member>();

  /**
   * Highest op seq this room has broadcast (the relay's view of the document
   * watermark). Lazy-initialized from the database on first use. Op frames carry
   * `fromSeq = lastSeq` so a peer can verify it received a contiguous stream.
   */
  lastSeq?: number;

  /** Tail of the per-room serialization chain (see `runExclusive`). */
  private tail: Promise<void> = Promise.resolve();

  /**
   * Run `fn` with exclusive access to this room, serialized against every other
   * `runExclusive` call. Persisting ops and broadcasting them must be atomic per
   * room, or two concurrent authors could interleave and emit `fromSeq`/`seq`
   * ranges that look like gaps to peers.
   */
  runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(fn, fn);
    this.tail = run.then(
      () => {},
      () => {}
    );
    return run;
  }

  /** A presence snapshot of everyone in the room. */
  peers(): Peer[] {
    return [...this.members].map((m) => ({
      site: m.site,
      userId: m.userId,
      name: m.name,
      color: m.color,
      cursor: m.cursor,
    }));
  }

  /** Send a frame to every member except `except`. */
  broadcast(frame: ServerFrame, except?: Member): void {
    const data = JSON.stringify(frame);
    for (const m of this.members) {
      if (m === except) continue;
      // A dropped frame on a still-open socket means backpressure: flag the
      // member so the next sweep tells it to re-pull what it missed.
      if (!send(m.socket, data) && m.socket.readyState === WebSocket.OPEN) {
        m.missed = true;
      }
    }
  }

  /**
   * Re-greet members that dropped a broadcast under backpressure and have since
   * drained. The `welcome` frame's seq is ahead of their cursor, which the client
   * treats as a catch-up trigger — recovering the dropped ops over HTTP without
   * any periodic polling.
   */
  resyncMissed(): void {
    if (this.lastSeq === undefined) return;
    for (const m of this.members) {
      if (!m.missed || m.socket.bufferedAmount > MAX_BUFFERED_BYTES) continue;
      if (sendFrame(m.socket, { t: "welcome", seq: this.lastSeq, peers: this.peers() })) {
        m.missed = false;
      }
    }
  }
}

/**
 * Registry of rooms keyed by document id. Rooms are created lazily and dropped
 * when empty, so memory tracks *active* documents, not every document ever opened.
 */
export class Rooms {
  private readonly rooms = new Map<string, Room>();

  get(documentId: string): Room {
    let room = this.rooms.get(documentId);
    if (!room) {
      room = new Room();
      this.rooms.set(documentId, room);
    }
    return room;
  }

  drop(documentId: string): void {
    this.rooms.delete(documentId);
  }

  /** Visit every live room (used by the heartbeat to sweep backpressured peers). */
  forEach(fn: (room: Room) => void): void {
    for (const room of this.rooms.values()) fn(room);
  }
}

const PALETTE = [
  "#ef4444", // red
  "#f97316", // orange
  "#eab308", // yellow
  "#22c55e", // green
  "#06b6d4", // cyan
  "#3b82f6", // blue
  "#8b5cf6", // violet
  "#ec4899", // pink
];

/** Deterministic, stable presence colour from a user id. */
export function colorFor(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) {
    h = (h * 31 + userId.charCodeAt(i)) | 0;
  }
  return PALETTE[Math.abs(h) % PALETTE.length];
}
