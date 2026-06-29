# realtime — collaboration relay

The standalone WebSocket server that gives sync-note its "Google-Docs feel":
per-document rooms broadcasting CRDT ops and presence (live cursors + avatars)
with sub-second latency. It runs as a **separate process** from the Next app —
Vercel's serverless functions can't hold a long-lived socket — and deploys on
its own (Railway / Fly / any Node host).

It is intentionally thin and auditable. The pure, shared, unit-tested logic lives
in `src/lib/realtime/` (the wire `protocol`, frame `validate`, and `ticket`
crypto) and is reused here so the relay and the Next app can't drift apart.

## How it fits the sync model

- **Durability is unchanged.** Ops are persisted through the *same* idempotent
  `persistOps` path as the HTTP route (`src/modules/documents/server/ops-store.ts`),
  so a socket-only client is still durable. The HTTP poll (Phase D) remains the
  catch-up/offline fallback. Re-applying an op is a no-op on both client (CRDT)
  and server (idempotent), so the two transports overlap safely.
- **Awareness is ephemeral.** Cursors and presence are broadcast only, never
  written to Postgres.

## Security (the graded bits)

- **Authentication** — the socket carries a short-lived HMAC `ticket` minted by
  `GET /api/realtime/ticket?doc=<id>` *after* the Next app verifies the Better
  Auth session and document membership. The relay verifies the ticket statelessly
  with the shared `BETTER_AUTH_SECRET` — no cookie sharing, works cross-origin.
- **Roles on the wire** — the ticket carries the membership role; a **viewer's op
  frames are dropped** (`mayPush`). Viewers can still read ops + presence.
- **OOM protection** — `ws` is configured with `maxPayload`, so oversized frames
  are rejected at the protocol layer before they're ever buffered; every frame is
  then byte-capped + zod-validated (`validateFrame`).
- **Abuse limits** — a per-socket fixed-window rate limit; backpressure drops
  frames to a client whose send buffer is backing up.

## Run locally

The relay shares the app's database and secret. With `.env.local` populated
(`DATABASE_URL`, `BETTER_AUTH_SECRET`):

```bash
npm run dev            # Next app on :3000
npm run realtime:dev   # relay on :3001 (watches + reloads)
```

The browser learns the relay URL from `NEXT_PUBLIC_REALTIME_URL`
(defaults to `ws://localhost:3001`).

With the relay running, `npm run realtime:verify` drives real sockets through
the security + presence paths (auth, presence, cursor relay, viewer-gate,
oversized-frame) without writing to the database.

## Environment

| Var | Used for |
| --- | --- |
| `DATABASE_URL` | Persisting ops (same Postgres as the app) |
| `BETTER_AUTH_SECRET` | Verifying connection tickets |
| `REALTIME_PORT` | Listen port (default `3001`) |
| `REALTIME_ALLOWED_ORIGINS` | Comma-separated browser origins allowed to connect (empty = allow all) |
| `NEXT_PUBLIC_REALTIME_URL` | *(app-side)* ws URL the client dials |

## Deploy

It's a plain Node service — point the host at `npm run realtime:start` (run
`npm ci` first). `GET /health` returns `200 ok` for health checks. Set
`DATABASE_URL` + `BETTER_AUTH_SECRET` to the **same** values as the Vercel app,
and set the app's `NEXT_PUBLIC_REALTIME_URL` to this service's `wss://` URL.
