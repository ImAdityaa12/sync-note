# Realtime WebSocket relay for sync-note, packaged for a Hugging Face Docker Space.
#
# Vercel's serverless functions can't hold a long-lived socket, so the relay runs
# here as its own always-on container. The Next app deploys separately on Vercel;
# this image builds ONLY the relay (it just reuses the shared lib/ + modules/).
FROM node:22-slim

# Hugging Face Spaces run the container as a non-root user (uid 1000) and expect a
# writable HOME — follow their recommended layout so npm and tsx can write caches.
RUN useradd --create-home --uid 1000 user
USER user
ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH
WORKDIR /home/user/app

# Install dependencies first for layer caching. The relay runs TypeScript through
# tsx (a devDependency) and resolves the "@/…" path alias from tsconfig.json, so
# install the FULL dependency set (not --omit=dev) and keep tsconfig.json.
COPY --chown=user package.json package-lock.json tsconfig.json ./
RUN npm ci

# The relay imports the shared wire protocol, ticket crypto, and idempotent
# op-store from the app source — copy that alongside the relay itself.
COPY --chown=user src ./src
COPY --chown=user realtime ./realtime

# HF routes external traffic to 7860 by default; make the relay listen there.
# (The server reads REALTIME_PORT — see realtime/server.ts.)
ENV REALTIME_PORT=7860
EXPOSE 7860

# Starts `node --import tsx realtime/server.ts`. GET /health returns 200 for the
# platform health check; everything else upgrades to a WebSocket.
CMD ["npm", "run", "realtime:start"]
