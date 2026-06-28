import { createServer, type IncomingMessage } from "node:http";

import { WebSocketServer, type RawData, type WebSocket } from "ws";

import { rateLimit } from "@/lib/rate-limit";
import { MAX_FRAME_BYTES, mayPush } from "@/lib/realtime/protocol";
import { validateFrame } from "@/lib/realtime/validate";
import { latestSeqFor, persistOps } from "@/modules/documents/server/ops-store";

import { authenticate } from "./authz";
import { colorFor, Rooms, sendFrame, type Member } from "./rooms";

/**
 * Standalone realtime relay (Phase E). A separate Node process from the Next app
 * — Vercel can't hold a long-lived socket — that owns the "Google-Docs feel":
 * per-document rooms broadcasting ops + presence with sub-second latency.
 *
 * The security-critical bits live here and are deliberately simple to audit:
 *   • `maxPayload` rejects oversized frames before they're ever buffered (OOM).
 *   • every frame is byte-capped + zod-validated (`validateFrame`).
 *   • the socket is authenticated by a signed ticket (`authenticate`); a viewer
 *     ticket can read presence/ops but its op writes are dropped (`mayPush`).
 *   • a per-socket rate limit bounds CPU/DB load from a hostile client.
 *
 * Durability is shared with the HTTP path: ops are persisted via `persistOps`
 * (idempotent), so a ws-only client is still durable and the HTTP poll remains a
 * catch-up/offline fallback.
 */

const PORT = Number(process.env.REALTIME_PORT ?? 3001);
/** Per-socket frame budget. Generous for real typing, fatal to a flood. */
const FRAMES_PER_SEC = 60;
/** Ping idle sockets this often; a pong not seen by the next tick = terminate. */
const HEARTBEAT_MS = 30_000;

/**
 * Origin allowlist — defence-in-depth (the signed ticket is the real gate).
 * Non-browser clients send no Origin and are allowed (they still need a valid
 * ticket); when REALTIME_ALLOWED_ORIGINS is unset, all origins are allowed (dev).
 */
function originAllowed(origin: string | undefined): boolean {
  if (!origin) return true;
  const allowed = (process.env.REALTIME_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  return allowed.length === 0 || allowed.includes(origin);
}

const rooms = new Rooms();
let connCounter = 0;

const httpServer = createServer((req, res) => {
  // A plain HTTP GET is only ever a health check; everything else upgrades.
  if (req.method === "GET" && (req.url === "/health" || req.url === "/")) {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
    return;
  }
  res.writeHead(426, { "content-type": "text/plain" });
  res.end("Upgrade Required");
});

const wss = new WebSocketServer({
  server: httpServer,
  maxPayload: MAX_FRAME_BYTES,
  verifyClient: (info: { origin: string; secure: boolean; req: IncomingMessage }) =>
    originAllowed(info.origin),
});

// Heartbeat: terminate sockets that stop answering pings, so a half-open
// connection (and its room membership) can't leak.
const alive = new WeakMap<WebSocket, boolean>();
const heartbeat = setInterval(() => {
  for (const client of wss.clients) {
    if (alive.get(client) === false) {
      client.terminate();
      continue;
    }
    alive.set(client, false);
    client.ping();
  }
}, HEARTBEAT_MS);
wss.on("close", () => clearInterval(heartbeat));

wss.on("connection", (socket: WebSocket, req: IncomingMessage) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const auth = authenticate(url.searchParams.get("ticket") ?? undefined);
  if (!auth) {
    socket.close(4401, "unauthorized");
    return;
  }

  alive.set(socket, true);
  socket.on("pong", () => alive.set(socket, true));

  const documentId = auth.doc;
  // The client passes its CRDT site id so its cursor correlates with its ops.
  const site = url.searchParams.get("site") || `srv-${++connCounter}`;
  const rlKey = `ws:${auth.sub}:${++connCounter}`;

  const member: Member = {
    socket,
    site,
    userId: auth.sub,
    name: auth.name,
    color: colorFor(auth.sub),
    role: auth.role,
  };

  const room = rooms.get(documentId);
  room.members.add(member);

  // Greet the newcomer with the server cursor + who's already here, then announce
  // the join to everyone else.
  latestSeqFor(documentId)
    .then((seq) => sendFrame(socket, { t: "welcome", seq, peers: room.peers() }))
    .catch(() => sendFrame(socket, { t: "welcome", seq: 0, peers: room.peers() }));
  room.broadcast({ t: "presence", peers: room.peers() }, member);

  socket.on("message", (data: RawData) => {
    if (!rateLimit(rlKey, FRAMES_PER_SEC, 1000).ok) {
      sendFrame(socket, { t: "error", code: "rate_limited" });
      return;
    }

    const result = validateFrame(toBytes(data));
    if (!result.ok) {
      sendFrame(socket, { t: "error", code: result.code });
      return;
    }
    const frame = result.frame;

    if (frame.t === "cursor") {
      // Awareness is broadcast-only — never persisted.
      member.cursor = { anchor: frame.anchor, head: frame.head };
      room.broadcast({ t: "presence", peers: room.peers() }, member);
      return;
    }

    // frame.t === "op" — viewers are read-only on the wire.
    if (!mayPush(member.role)) {
      sendFrame(socket, { t: "error", code: "forbidden" });
      return;
    }

    persistOps(documentId, member.userId, frame.ops)
      .then((seq) => {
        room.broadcast({ t: "op", ops: frame.ops, seq, from: site }, member);
        sendFrame(socket, { t: "ack", seq });
      })
      .catch(() => {
        // Persist failed (e.g. a DB blip): the client still holds these ops in
        // its durable oplog and the HTTP sync path retries, so just signal error.
        sendFrame(socket, { t: "error", code: "server_error" });
      });
  });

  socket.on("error", () => socket.close());

  socket.on("close", () => {
    room.members.delete(member);
    if (room.members.size > 0) {
      room.broadcast({ t: "presence", peers: room.peers() });
    } else {
      rooms.drop(documentId);
    }
  });
});

/** Normalize a ws frame to bytes for validation (ignores text/binary framing). */
function toBytes(data: RawData): Uint8Array {
  if (Array.isArray(data)) return Buffer.concat(data);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return data as Buffer;
}

httpServer.listen(PORT, () => {
  console.log(`[realtime] listening on :${PORT}`);
});

// Clean shutdown so a redeploy doesn't leave sockets hanging.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    wss.close();
    httpServer.close(() => process.exit(0));
  });
}
