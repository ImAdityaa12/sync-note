import { betterAuth, type BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";

import { db } from "@/db";
import { account, session, user, verification } from "@/db/schema";

/**
 * Better Auth owns identity (sign-up, sign-in, sessions, OAuth). Documents
 * themselves are local-first; this is only the auth/authorization backbone.
 *
 * Server-side session checks (the real authority) use `auth.api.getSession`.
 * The proxy does only an optimistic cookie check, never a DB read.
 */

// Sessions are signed with BETTER_AUTH_SECRET. A missing secret in production
// would silently fall back to an ephemeral one, invalidating sessions on every
// restart and weakening cookie signing — fail fast instead.
if (!process.env.BETTER_AUTH_SECRET && process.env.NODE_ENV === "production") {
  throw new Error(
    "BETTER_AUTH_SECRET is not set. Generate one with `openssl rand -base64 32` and add it to your environment."
  );
}

// Register a social provider only when both its id and secret are present.
// Registering with empty strings would surface broken buttons that fail at the
// provider; instead the UI hides any provider missing from this list.
const socialProviders: BetterAuthOptions["socialProviders"] = {};
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  socialProviders.google = {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  };
}
if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
  socialProviders.github = {
    clientId: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
  };
}

export const auth = betterAuth({
  secret: process.env.BETTER_AUTH_SECRET,

  database: drizzleAdapter(db, {
    provider: "pg",
    schema: { user, session, account, verification },
  }),

  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    autoSignIn: true,
  },

  socialProviders,

  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // refresh the session daily
    cookieCache: {
      // Lets the proxy read a fresh, signed session cookie without a DB hit.
      enabled: true,
      maxAge: 5 * 60,
    },
  },

  // nextCookies() MUST be the last plugin so Set-Cookie headers emitted from
  // server actions are forwarded correctly.
  plugins: [nextCookies()],
});

export type Session = typeof auth.$Infer.Session;
