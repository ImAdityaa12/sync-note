@AGENTS.md

# sync-note

A **local-first, collaborative document editor**. Users open, edit, and close documents with
zero network latency in the UI; the client is the source of truth. Edits sync to the server in
the background, merge deterministically with other collaborators' changes (no data loss), and
every document keeps a navigable version history users can time-travel through.

The hard part — and the focus of this codebase — is the distributed-systems work: client-side
storage, a background sync engine, conflict-free merging over a real-time channel, and safe
version restore. It is deliberately **not** a CRUD app.

## Tech Stack

- **Framework:** Next.js 16 (App Router) + React 19 + TypeScript (strict). ⚠️ Next.js 16 has
  breaking changes vs. training data — see `AGENTS.md` and read `node_modules/next/dist/docs/`
  before writing framework code.
- **Styling:** Tailwind CSS v4. shadcn / radix-ui are fine for components.
- **Database:** PostgreSQL, accessed through an ORM with strict tenant scoping (or Row Level
  Security). The DB is a sync peer/durable store, not what the editor UI waits on.
- **AI:** AI-SDK / OpenAI / Gemini / Groq for assistive features (summaries, etc.).

## Commands

```bash
npm run dev     # dev server at http://localhost:3000
npm run build   # production build
npm run start   # serve production build
npm run lint    # eslint
```

## Core concepts

How the pieces fit together — keep this model in mind for every feature:

- **Local store = source of truth.** Documents live client-side (e.g. IndexedDB). All reads/edits
  hit local storage first; the network never blocks open/edit/close. The app must be fully usable
  offline.
- **Sync engine (background).** A durable, ordered change queue. While offline it accumulates local
  ops; on reconnect it pushes local changes and pulls remote ones, reconciling both directions
  without overwriting offline work. Must survive interrupted/partial syncs.
- **Conflict resolution.** Concurrent edits merge deterministically — same ops on any peer produce
  the same document. (CRDT or OT; pick one approach and apply it consistently.) Typing stays
  responsive even during rapid input.
- **Version history.** Documents capture snapshots over time. Users browse a timeline and restore a
  past version as a new state, without corrupting the live document other collaborators are editing.
- **Connection status.** The UI always reflects sync state (offline / syncing / synced / conflict).

## Roles & access

Every document has per-user roles enforced **on the server** (never trust the client):

- **Owner** — full control, manage collaborators.
- **Editor** — read + push edits.
- **Viewer** — read only; **must not** be able to push state updates to the real-time server.

## Security constraints (build these in, don't retrofit)

- Validate every incoming sync payload server-side: schema-check and **cap size before allocating**,
  so a massive/malformed payload can't OOM or crash the collab server.
- Enforce tenant isolation via RLS or strict ORM scoping — a user only ever touches their own docs.
- Authenticate all API routes; rate-limit sync endpoints.

## Things to watch

- Don't let sync/merge logic block the editor thread — rapid typing must not lag.
- Document state grows over time (op logs, version snapshots); plan compaction/pruning.
- The app footer must credit the developer (name, GitHub, LinkedIn) — wire this up once built.
