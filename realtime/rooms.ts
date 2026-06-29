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
}

/** Beyond this much queued data we drop frames to a client that can't keep up,
 * rather than let a slow consumer balloon the server's memory (backpressure). */
const MAX_BUFFERED_BYTES = 1 << 20; // 1 MB

function send(socket: WebSocket, data: string): void {
  if (socket.readyState !== WebSocket.OPEN) return;
  if (socket.bufferedAmount > MAX_BUFFERED_BYTES) return;
  socket.send(data);
}

export function sendFrame(socket: WebSocket, frame: ServerFrame): void {
  send(socket, JSON.stringify(frame));
}

/** One per-document room: the set of sockets currently editing/viewing it. */
export class Room {
  readonly members = new Set<Member>();

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
      if (m !== except) send(m.socket, data);
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
