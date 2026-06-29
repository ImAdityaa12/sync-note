# Deployment

sync-note runs as **two deploys** because the WebSocket relay needs a long-lived
process that Vercel's serverless functions can't provide:

| Piece | Host | Why |
| --- | --- | --- |
| Next app + API routes | **Vercel** (serverless) | Stateless request/response; auto-scales. |
| `realtime/` WebSocket relay | **Hugging Face Space** (Docker) | Always-on process holding live sockets. |

Both talk to the **same Postgres** and share **`BETTER_AUTH_SECRET`** (so the relay
can statelessly verify the tickets the app mints). The browser loads from Vercel
and dials the relay over `wss://`.

```
Browser ──https──► Vercel (Next app + /api/*)  ──┐
   │                                             ├─► Neon Postgres (ops, snapshots)
   └──wss──► Hugging Face Space (ws relay) ───────┘
```

## 1. Database (once)

Create a Neon Postgres project and apply migrations from your machine:

```bash
DATABASE_URL="postgres://…neon…" npm run db:migrate
```

Both deploys point `DATABASE_URL` at this same database.

## 2. Next app → Vercel

Import the repo in Vercel (it auto-detects Next.js — no `vercel.json` needed).
Set these environment variables:

| Var | Value |
| --- | --- |
| `DATABASE_URL` | Neon connection string (pooled) |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` — **must match the relay** |
| `BETTER_AUTH_URL` / `NEXT_PUBLIC_APP_URL` | your `https://…vercel.app` URL |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | (optional) OAuth |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | (optional) OAuth |
| `GROQ_API_KEY` | (optional) enables the AI assistant |
| `NEXT_PUBLIC_REALTIME_URL` | `wss://<your-space>.hf.space` (from step 3) |

> Set `NEXT_PUBLIC_REALTIME_URL` after the Space exists, then redeploy — it's
> baked into the client bundle at build time.

## 3. Realtime relay → Hugging Face Space (Docker)

The repo ships a root **`Dockerfile`** that builds *only* the relay (listening on
HF's default port 7860) and a **`.dockerignore`**.

1. Create a new **Docker** Space on Hugging Face.
2. Give its `README.md` the Space frontmatter:

   ```yaml
   ---
   title: Sync Note Realtime
   emoji: 🔌
   colorFrom: indigo
   colorTo: blue
   sdk: docker
   app_port: 7860
   pinned: false
   ---
   ```

3. Push this repository to the Space's git remote (the `Dockerfile` builds from
   the repo; `.dockerignore` keeps the context lean).
4. Add these **Space secrets** (Settings → Variables and secrets):

   | Secret | Value |
   | --- | --- |
   | `DATABASE_URL` | the **same** Neon string as Vercel |
   | `BETTER_AUTH_SECRET` | the **same** secret as Vercel |
   | `REALTIME_ALLOWED_ORIGINS` | your Vercel origin, e.g. `https://sync-note.vercel.app` |

   `REALTIME_PORT` is already `7860` (set in the Dockerfile); leave it.

The Space boots `npm run realtime:start`. `GET /health` returns `200 ok`. The
public URL is `https://<space>.hf.space`; the browser dials it as
`wss://<space>.hf.space` — that's the value for Vercel's `NEXT_PUBLIC_REALTIME_URL`.

## 4. Verify the two deploys talk

- Open the Vercel app, sign in, open a document in **two browsers** (or a normal
  + incognito window) shared as collaborators.
- Type in one — the other updates live, with a remote cursor + presence avatar.
  The connection-status indicator should read **synced** (not just the HTTP
  fallback). If it only ever shows synced-via-poll and no live cursor, the
  `NEXT_PUBLIC_REALTIME_URL` / origin allowlist / shared secret are misaligned.

## Notes

- **Security model** for both transports: see [`SECURITY.md`](./SECURITY.md).
- **Secret parity is mandatory.** If `BETTER_AUTH_SECRET` differs between Vercel
  and the Space, every ticket fails verification and no socket connects (the app
  silently falls back to HTTP polling).
- **CI/CD** (GitHub Actions) is intentionally not set up yet — deploy is manual
  for now.
