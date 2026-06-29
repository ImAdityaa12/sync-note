# Realtime WebSocket relay for sync-note, packaged for a Hugging Face Docker Space.
#
# Vercel's serverless functions can't hold a long-lived socket, so the relay runs
# here as its own always-on container. The Next app deploys separately on Vercel;
# this image builds ONLY the relay (it just reuses the shared lib/ + modules/).
FROM node:22-slim

# node:22-slim already ships a non-root `node` user at uid 1000 — the exact uid
# Hugging Face Spaces run containers as — so reuse it. Creating a second uid-1000
# user fails the build with `useradd: UID 1000 is not unique`. WORKDIR-created dirs
# are root-owned by default, so chown the workdir to node before switching, giving
# npm ci and tsx's runtime caches (under $HOME) a writable home.
ENV HOME=/home/node \
    PATH=/home/node/.local/bin:$PATH
WORKDIR /home/node/app
RUN chown node:node /home/node/app
USER node

# Install dependencies first for layer caching. The relay runs TypeScript through
# tsx (a devDependency) and resolves the "@/…" path alias from tsconfig.json, so
# install the FULL dependency set (not --omit=dev) and keep tsconfig.json.
COPY --chown=node:node package.json package-lock.json tsconfig.json ./
RUN npm ci

# The relay imports the shared wire protocol, ticket crypto, and idempotent
# op-store from the app source — copy that alongside the relay itself.
COPY --chown=node:node src ./src
COPY --chown=node:node realtime ./realtime

# HF routes external traffic to 7860 by default; make the relay listen there.
# (The server reads REALTIME_PORT — see realtime/server.ts.)
ENV REALTIME_PORT=7860
EXPOSE 7860

# Starts `node --import tsx realtime/server.ts`. GET /health returns 200 for the
# platform health check; everything else upgrades to a WebSocket.
CMD ["npm", "run", "realtime:start"]
