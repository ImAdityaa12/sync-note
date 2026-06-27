"use client";

import { createAuthClient } from "better-auth/react";

/**
 * Browser-side Better Auth client. With no baseURL it targets the current
 * origin; NEXT_PUBLIC_APP_URL lets us pin it explicitly when needed.
 */
export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_APP_URL,
});

export const { signIn, signUp, signOut, useSession, getSession } = authClient;
