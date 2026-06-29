# End-to-end testing

Phase I has two layers. The **logic layer is implemented and runs in `npm test`**;
the **browser layer is specified here** and is authored against a live stack
(it needs a real app + database + relay, so it lands with deployment, Phase J).

## Layer 1 — multi-client integration tests (done, in CI)

`src/lib/sync/convergence.test.ts` drives **two real `SyncEngine` clients** over a
shared in-memory server with isolated IndexedDB stores (`fake-indexeddb`). It
proves the distributed definition of done without a browser:

- two clients edit **offline**, reconnect, and **converge with no data loss**;
- the converged state **survives a reload** from the persisted snapshot;
- re-syncing is **idempotent** (no duplicate ops);
- a sync **interrupted mid-batch** (ack lost) recovers with no dupes/loss;
- a **viewer's** edits never reach the server.

Run with `npm test`. This is the highest-value coverage — the merge/sync
correctness the project is graded on — and it runs anywhere, no infra.

## Layer 2 — Playwright browser e2e (specified; run against a live stack)

These cover what a headless test can't: the rendered UI, real IndexedDB in a real
browser, two browser contexts over the actual WebSocket relay, and the
role-gated UI. To be authored and run **against a deployed stack** (or a local
one with a throwaway database), because the selectors and timings must be
verified against the running app — shipping un-run browser specs would be
guesswork.

### Scenarios to implement

| Spec | Asserts |
| --- | --- |
| `viewer-readonly.spec.ts` | A viewer opens a shared doc → no editable textarea, only the rendered preview; the "Assistant" works (read-only) but no "Apply as title"; no ops reach the server. |
| `version-restore.spec.ts` | Save a version → edit further → restore the version → the editor content matches the snapshot, and a second context sees the restore arrive as edits (converges, no overwrite). |
| `collab-converge.spec.ts` | Two browser contexts (owner + editor) type concurrently → both converge to the same text; each sees the other's **remote cursor + presence avatar**. |
| `offline-reconnect.spec.ts` | Context A goes offline (block the network), edits; context B edits; A reconnects → both converge; the connection-status indicator reflects offline → syncing → synced. |

### Prerequisites

1. **Database** — a throwaway Postgres (a Neon branch, or local). Run
   `npm run db:migrate` against it. Never point e2e at real data.
2. **Services** — the app (`npm run dev`) **and** the relay (`npm run realtime:dev`)
   both running; `NEXT_PUBLIC_REALTIME_URL` pointing at the relay.
3. **Auth** — email/password sign-in is enabled (`src/lib/auth.ts`), so a fixture
   can sign up two test users and share a document between them (owner shares to
   editor/viewer via the existing share action). Use Playwright **storage state**
   per user so each browser context is authenticated independently.
4. `GROQ_API_KEY` only for the assistant assertion in `viewer-readonly` (optional).

### Wiring (when implemented)

- `npm i -D @playwright/test && npx playwright install`
- `playwright.config.ts` with a `webServer` that boots the app, `baseURL`, and a
  `projects` entry per browser; exclude `e2e/` from the app `tsconfig` so the
  specs typecheck under Playwright's own runner, not `npm run typecheck`.
- Add `"e2e": "playwright test"` to `package.json` scripts.
- In CI (deferred with the rest of CI/CD), run these only on `main` after the app
  + relay + a disposable database are up — they're too heavy for every PR.

> Why this is a plan and not code yet: the merge/sync correctness is already
> verified headlessly (Layer 1). The browser specs depend on a running stack to
> author selectors/timings reliably, which arrives with Phase J deployment. They
> are intentionally not committed un-run.
