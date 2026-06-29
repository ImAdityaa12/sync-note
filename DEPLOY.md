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

The repo ships a root **`Dockerfile`** that builds *only* the relay (it reuses the
shared `src/lib` + `src/modules`), runs it via `tsx`, and listens on HF's default
port **7860**. A `.dockerignore` keeps the build context lean.

Do step 1 (the database) first — the relay reads/writes the **same** tables.

### 3.1 Create the Space

1. Sign in at <https://huggingface.co> → top-right **+ New** → **Space**.
2. **Owner**: your account. **Space name**: e.g. `sync-note-realtime`.
3. **Select the SDK**: **Docker** → template **Blank**.
4. **Hardware**: *CPU basic* (free) is enough.
5. **Visibility**: **Public**. The browser must be able to open the socket, and a
   *private* Space requires a Hugging Face token to reach — which would break
   clients. This is safe: the relay is gated by signed tickets + the origin
   allowlist, not by HF access control (see [`SECURITY.md`](./SECURITY.md)).
6. Click **Create Space**. HF makes an (empty) git repo with a `README.md` whose
   frontmatter says `sdk: docker`.

### 3.2 Get a write token

You'll authenticate the git push with a token, not your password:
<https://huggingface.co/settings/tokens> → **New token** → type **Write** →
create and copy it. When `git push` prompts, use your **HF username** and paste
this token as the **password**.

### 3.3 Push this repo to the Space

HF Spaces are git repositories. From your local clone of **this** project, add the
Space as a remote and push the branch that carries the `Dockerfile` — that's
**`main`** — to the Space's `main` (HF builds from `main`). The `Dockerfile` +
`.dockerignore` mean only the relay is built, even though the whole repo is pushed:

```bash
# replace <owner> and the space name with yours
git remote add space https://huggingface.co/spaces/<owner>/sync-note-realtime
git push space main:main --force   # local main : Space's main
```

`--force` is required the first time: creating the Space seeded its `main` with an
`initial commit` (a stub `README.md`), so your branch and the Space share no
history and a plain push is rejected as a non-fast-forward. You're deliberately
replacing that stub — §3.4 restores the config frontmatter this overwrites.

> If the push fails with a protocol error like `fatal: expected 'acknowledgments'`,
> this HF endpoint is choking on git's protocol v2 — prefix the command with
> `-c protocol.version=0`, e.g. `git -c protocol.version=0 push space main:main --force`.

### 3.4 Confirm the Space's Docker config

HF reads the Space config from the **frontmatter of `README.md`**, and pushing
this repo overwrote that README with the project one (no frontmatter). Fix it
**in the Space** (this does not touch your GitHub repo): open the Space →
**Files** → `README.md` → **edit** (pencil) → make sure it *starts* with:

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

Leave the rest of the file below it. **Commit changes to main** — that triggers a
build. (`app_port: 7860` matches the Dockerfile's `REALTIME_PORT`.)

> Prefer not to edit it in the UI? Instead push to a clean Space repo: `git clone`
> the empty Space, copy in `Dockerfile`, `.dockerignore`, `package.json`,
> `package-lock.json`, `tsconfig.json`, `src/`, `realtime/`, prepend the
> frontmatter above to its `README.md`, then commit + push.

### 3.5 Add the Space secrets

Space → **Settings** → **Variables and secrets** → **New secret**, three of them:

| Secret | Value |
| --- | --- |
| `DATABASE_URL` | the **same** Neon connection string as Vercel |
| `BETTER_AUTH_SECRET` | the **same** value as Vercel (ticket verification depends on it) |
| `REALTIME_ALLOWED_ORIGINS` | your Vercel origin only, e.g. `https://sync-note.vercel.app` |

Don't set `REALTIME_PORT` (the Dockerfile pins it to `7860`) and don't set
`NEXT_PUBLIC_REALTIME_URL` here — that one lives on **Vercel**. After adding
secrets, use **Settings → Factory rebuild** so the running container picks them up.

### 3.6 Watch the build and get the URL

- The Space's **Logs** tab streams the Docker build, then the runtime. Success
  looks like `[realtime] listening on :7860`, and the Space badge flips to
  **Running**.
- The public URL is `https://<owner>-<space-name>.hf.space` (lowercase; any
  non-alphanumeric character in the names becomes `-`). For owner `imadityaa12`
  and space `sync-note-realtime` that's
  `https://imadityaa12-sync-note-realtime.hf.space`.
- Health check: opening that URL (or `…/health`) returns plain `ok`.

### 3.7 Wire it back to Vercel

The browser dials the **same host over `wss://`**. Set, on Vercel (Project →
Settings → Environment Variables):

```
NEXT_PUBLIC_REALTIME_URL = wss://<owner>-<space-name>.hf.space
```

`NEXT_PUBLIC_*` is inlined at build time, so **redeploy the Vercel app** after
setting it. Confirm `REALTIME_ALLOWED_ORIGINS` on the Space exactly matches your
Vercel origin (scheme + host, no trailing slash).

> **Free-tier note:** an idle free Space may pause; the first connection wakes it
> (a few seconds of cold start) while the app keeps working over the HTTP-poll
> fallback, then live cursors resume once the socket is up. For always-on, use a
> paid Space tier.

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
