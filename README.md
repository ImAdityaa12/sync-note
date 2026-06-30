# sync-note

A **local-first, collaborative markdown editor**. Open, edit, and close documents
with zero network latency — the browser is the source of truth. Edits sync to the
server in the background, merge deterministically with other collaborators' edits
(no data loss) over a real-time channel, and every document keeps a navigable
version history you can time-travel through.

It is deliberately **not** a CRUD app. The focus is the distributed-systems work:
client-side storage, a background sync engine, a hand-built conflict-free merge,
live collaboration, and safe version restore.

## The hard parts (and how they're solved)

| Problem | Approach |
| --- | --- |
| **Browser memory management** | Documents live in IndexedDB (`idb`); a durable op-log + version snapshots with a documented pruning/compaction path. Merge work never blocks the editor thread. |
| **State-synchronization races** | Edits push over the **websocket** straight from a durable oplog (one batch in flight, pruned only on the relay's ack); a **pull-only** catch-up reconciles on (re)connect or a detected gap → merge → persist → advance cursor. Serialized and offline-safe; interrupted/partial syncs replay without dupes or loss. **No periodic poll.** |
| **Conflict-free merging** | A **hand-built CRDT** — an RGA (replicated growable array) over the text sequence, in `src/lib/crdt`. Property-tested for convergence, idempotency, and commutativity (1000-run randomized suites). No merge library. |
| **The Google-Docs feel** | A self-hosted `ws` relay persists + broadcasts ops and awareness for live co-editing, **remote cursors**, and **presence avatars** on top of the CRDT — the socket is both the durability path and the live channel. |

## Architecture

```
Browser (source of truth)
  RGA (in-memory)  ──keystroke──►  diff → ops → apply (instant repaint)
       │                                  │
       │                                  └─► IndexedDB oplog (durable queue)
       │                                          │  push over the socket
       │                                          ▼  (one batch in flight)
  ws relay (separate Node process) ──persists ops──►  Postgres (durable op log)
   • broadcasts ops (+fromSeq) to peers                     ▲
   • acks the sender ──► client prunes the oplog            │ HTTP pull
       ▼                                                    │ (catch-up only)
  SyncEngine ──on connect / reconnect / gap──►  /api/documents/[id]/ops
   pull-only reconcile — no periodic poll; idle docs make no requests
```

- **Local store = source of truth.** Reads/edits hit IndexedDB first; the network
  never blocks open/edit/close. Fully usable offline.
- **Durability rides the websocket.** Edits push over the socket and leave the
  oplog only when the relay acks them; a pull-only catch-up (HTTP) reconciles
  missed ops on (re)connect or when a frame's `fromSeq` reveals a gap. The pull
  cursor advances only *after* the merged snapshot is persisted, so a reload is
  always consistent — and an idle, in-sync document polls nothing.
- **Versions** capture a snapshot + cursor; **restore emits forward CRDT ops**
  (never a destructive overwrite), so collaborators editing concurrently converge.
- **AI** add-ons (summary / ask / title) stream from Groq, authenticated and
  rate-limited, and write no document state.

## Tech stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript** (strict)
- **Tailwind CSS v4**, shadcn / radix-ui
- **PostgreSQL** (Neon) via **Drizzle**, strict tenant scoping
- **Better Auth** (email + Google/GitHub OAuth)
- Custom **CRDT** (`src/lib/crdt`) + self-hosted **`ws`** relay (`realtime/`)
- **AI-SDK** + **Groq** for assistive features
- **Vitest** + **fast-check** for unit/property tests

## Getting started

```bash
cp .env.example .env.local      # fill in DATABASE_URL, BETTER_AUTH_SECRET, etc.
npm install
npm run db:migrate              # apply Drizzle migrations to your Neon database
npm run dev                     # app at http://localhost:3000
npm run realtime:dev            # (separate terminal) live-collab relay on :3001
```

`GROQ_API_KEY` is optional — without it the AI assistant returns a graceful
"not configured" message and everything else works.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | App dev server |
| `npm run realtime:dev` | WebSocket collaboration relay |
| `npm run build` / `start` | Production build / serve |
| `npm run lint` / `typecheck` | ESLint / `tsc --noEmit` |
| `npm test` | Vitest unit + property suite |
| `npm run realtime:verify` | Live relay harness (auth, presence, cursor relay, viewer-gate, oversized-frame) |
| `npm run db:generate` / `migrate` / `studio` | Drizzle workflow |

## Project structure

```
src/
  lib/
    crdt/      # the custom RGA CRDT (rga, clock, codec) — the core IP
    local/     # IndexedDB persistence (documents, oplog, meta)
    sync/      # ws push queue (outbound), pull-only catch-up engine, realtime client, status
    realtime/  # shared ws protocol, frame validation, HMAC tickets
    http/      # streaming body-size guard
  modules/
    documents/ # domain: roles, membership funnel, server actions
    editor/    # editing surface; binds crdt + local + sync
    versions/  # snapshots + restore-as-forward-ops time travel
    ai/        # summary / ask / title (Groq, streamed)
  app/api/     # ops sync, ai, realtime ticket routes
realtime/      # standalone ws relay (rooms, authz, hardening)
```

## Security

Multi-tenant with two untrusted sync transports — the security model is written
up in detail in **[SECURITY.md](./SECURITY.md)**: authentication on every route,
tenant isolation through a single membership funnel (no existence leaks),
viewers that can never push state, payload validation with **size caps before
allocating** (HTTP + WS), rate limiting on every sync endpoint, and WebSocket
OOM/abuse hardening. The boundary is covered by tests (see that doc).

## Testing

`npm test` runs the Vitest suite: CRDT convergence/idempotency/commutativity
(property-based, `fast-check`), restore convergence under concurrent edits, the
sync engine, the HTTP route security boundaries (ops + AI), realtime frame/ticket
validation, and the streaming body cap.

## Deployment

The Next app deploys to Vercel from `main`; the `realtime/` relay deploys
separately as a long-running Node service — a **Hugging Face Docker Space** — with
an origin allowlist. Both share `DATABASE_URL` + `BETTER_AUTH_SECRET`; full
click-by-click steps are in **[DEPLOY.md](./DEPLOY.md)**. Developed and run on
Node 22.

## Credit

Built by **Aditya** — [GitHub](https://github.com/ImAdityaa12) ·
[LinkedIn](https://www.linkedin.com/in/imadityaa12)
