import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";

import * as schema from "./schema";

/**
 * Drizzle client backed by Neon (PostgreSQL).
 *
 * We use the WebSocket-based serverless driver (Pool) rather than the HTTP one
 * so Better Auth gets real transaction support (sign-up writes user + account
 * atomically). Edge/serverless runtimes expose a global WebSocket; Node needs
 * the `ws` shim, which we wire up only when one isn't already present.
 */
if (!neonConfig.webSocketConstructor) {
  neonConfig.webSocketConstructor = ws;
}

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env.local and add your Neon connection string."
  );
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export const db = drizzle(pool, { schema });
