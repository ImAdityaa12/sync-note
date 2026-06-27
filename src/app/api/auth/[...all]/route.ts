import { toNextJsHandler } from "better-auth/next-js";

import { auth } from "@/lib/auth";

// Mounts every Better Auth endpoint under /api/auth/* (sign-in, sign-up,
// OAuth callbacks, session, sign-out, etc.).
export const { GET, POST } = toNextJsHandler(auth);
