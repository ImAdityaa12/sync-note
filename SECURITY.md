# Security model

sync-note is a multi-tenant, collaborative editor: many users, many documents,
per-document roles, and two sync transports (HTTP + a WebSocket relay) that both
accept untrusted, attacker-controllable payloads. This document is the threat
model and the catalogue of controls, with pointers to where each is enforced.

The three named hard problems the design owns — browser memory management,
state-synchronization races, and conflict-free merging — are addressed in the
architecture (see `README.md`); this file is specifically the **security**
posture: who is trusted, what is rejected, and where.

## Trust boundaries

| Boundary | Trusted? | Consequence |
| --- | --- | --- |
| Browser / client code | **No** | Every payload is re-validated server-side; the client is convenient, never authoritative. |
| Authenticated session (Better Auth) | Identity only | Being signed in proves *who*, never *what they may touch* — that's the membership check. |
| A document **editor** | Partially | May write ops. May self-assign op ids (accepted assumption, below). |
| A document **viewer** | Read-only | Must never push state — enforced on every write path, HTTP and socket. |
| The realtime relay | Separate process | Authenticates sockets statelessly via signed tickets; shares no cookies/DB session. |

## Controls

### 1. Authentication on every route
Each API route resolves the session and rejects anonymous callers with `401`
before any work. Server actions go through `requireUser()`.
- HTTP: `src/app/api/documents/[id]/ops/route.ts`, `.../ai/route.ts`,
  `.../realtime/ticket/route.ts` — all call `getCurrentUser()` first.
- Actions: `src/modules/documents/server/membership.ts` (`requireUser`).

### 2. Tenant isolation through one funnel
Authorization lives in a single function, `requireMembership(documentId, userId,
minRole)` (`src/modules/documents/server/membership.ts`). Roles are ranked
(`viewer < editor < owner`), so "at least editor" is one comparison. A
non-member or under-privileged user is treated **identically to a non-existent
document**: read paths answer `404`, write paths answer `403`, but in each case
the response is the same whether the document is missing or simply isn't yours —
so the API can't be used to enumerate which documents exist. Every read and
write routes through it.

### 3. Role enforcement — viewers can never push state
- **HTTP:** `POST /ops` requires `editor` (`403` otherwise); `GET /ops` requires
  `viewer`. (`ops/route.ts`)
- **Realtime:** the signed ticket carries the membership role; the relay drops
  `op` frames from a viewer via `mayPush(role)` and only broadcasts their
  presence/cursor. (`realtime/server.ts`, `src/lib/realtime/protocol.ts`)
- **Restore (version time-travel):** runs as ordinary forward CRDT ops, so it is
  gated by the same editor checks both client-side and on the wire — it is never
  a privileged "overwrite". (`src/modules/versions/lib/restore.ts`)

### 4. Payload validation + size caps **before** allocating
A malformed or oversized body must be rejected before it is buffered into memory
or parsed into an object tree — the OOM defence.
- **HTTP sync/AI:** a `content-length` fast path plus `readJsonWithLimit`, which
  enforces a hard byte ceiling **while the body streams** (a lying/missing
  `content-length` can't get us to buffer an unbounded body), then Zod validates
  the parsed shape. (`src/lib/http/read-json.ts`; `ops/route.ts` 256 KB;
  `ai/route.ts` 256 KB)
- **Versions:** content is Zod-capped by **UTF-8 bytes** (512 KB), and Next's
  `serverActions.bodySizeLimit` is the transport-level pre-allocation guard.
  (`src/modules/versions/schema.ts`, `next.config.ts`)
- **Realtime:** `validateFrame` checks `MAX_FRAME_BYTES` **before** `JSON.parse`,
  and `ws` is configured with `maxPayload` so oversized frames are rejected
  before they are ever buffered. (`src/lib/realtime/validate.ts`,
  `realtime/server.ts`)

### 5. Rate limiting on every sync endpoint
A fixed-window limiter (`src/lib/rate-limit.ts`) caps request rate and returns
`429` with `retry-after`. Keys are scoped to the resource being protected:
- ops push / pull: `ops:push|pull:${user}:${doc}` (per user **and** document)
- AI: `ai:${user}` (per user — AI spend is the scarce resource)
- realtime ticket mint: `rt:ticket:${user}`
- version save: `version:save:${user}:${doc}`
- per-socket frame rate inside the relay: `FRAMES_PER_SEC` (`realtime/server.ts`)

### 6. WebSocket relay hardening (OOM + abuse)
`realtime/server.ts`: `maxPayload` + per-frame ceiling (reject before buffer),
per-socket frame rate limit, **send backpressure** (watch `bufferedAmount` so a
slow consumer can't make us buffer unbounded), a **heartbeat** that terminates
half-open sockets, and an **origin allowlist** as defence-in-depth (the signed
ticket is the real gate).

### 7. Stateless socket authentication
The Next app mints a short-lived **HMAC ticket** only after a full session +
membership check (`/api/realtime/ticket`); the relay verifies it with the shared
secret and needs no cookie or DB lookup. The ticket carries the
already-authorized role, so the socket enforces authorization from the first
frame. (`src/lib/realtime/ticket.ts`, `realtime/authz.ts`)

### 8. Idempotency / integrity
Ops use the client op uuid as the primary key and persist with
`onConflictDoNothing`, so a retried or duplicated push never double-applies — an
interrupted sync is safe to replay. Both transports persist through **one**
shared op-store so they cannot drift. (`src/modules/documents/server/ops-store.ts`)

### 9. AI assistant is read-only
The assistant endpoint is `viewer+` (a read over a document the user can already
see) and **writes no document state**. A suggested title is applied through the
normal, editor-gated `renameDocument` action — never a direct write. The
request's abort signal is forwarded to the model so a disconnect cancels
generation (no runaway spend). (`src/app/api/documents/[id]/ai/route.ts`)

### 10. Fail-fast configuration
Missing `DATABASE_URL` throws at startup; missing `BETTER_AUTH_SECRET` throws in
production rather than silently signing sessions with an ephemeral key.
(`src/db/index.ts`, `src/lib/auth.ts`)

## Accepted assumptions (documented, not accidental)

- **Editors can self-assign op ids.** Clients generate their own op/node ids, so
  a *malicious editor* could pre-claim an id to suppress another client's future
  op. Editors are trusted collaborators on a document they already have write
  access to, so this is an accepted trust boundary, not a fixable flaw without a
  server-authoritative id scheme. Documented at the source in `ops-store.ts`.
- **In-memory rate limiter is per-instance.** Fine for a single app instance and
  enough to demonstrate the control; a multi-instance deployment would back it
  with Redis/Upstash. Documented in `rate-limit.ts`.

## Verifying the controls

The security boundary is exercised by tests, not just asserted here:

- `src/lib/http/read-json.test.ts` — the streaming byte cap rejects an oversized
  body with `PayloadTooLargeError` (bounded memory; the reader is cancelled).
- `src/app/api/documents/[id]/ops/route.test.ts` — ops route: `401` / `403`
  (viewer) / `413` (oversize) / `429` / `404` (no leak).
- `src/app/api/documents/[id]/ai/route.test.ts` — AI route: `401` / `404` /
  `413` / `503` / `422` / `429` / streams for a member.
- `src/lib/realtime/validate.test.ts`, `ticket.test.ts` — frame size/shape
  rejection and ticket signing/verification.

Run them with `npm test`.

## Reporting

This is a course assignment, not a production service. For a real deployment,
report vulnerabilities privately to the maintainer (see the footer credit in the
app / `src/components/site-footer.tsx`) rather than opening a public issue.
