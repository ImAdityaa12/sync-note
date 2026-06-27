import "server-only";

import { headers } from "next/headers";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { documentMembers } from "@/db/schema";
import { auth } from "@/lib/auth";
import type { DocumentMemberRow, DocumentRole } from "@/modules/documents/types";

/**
 * Authorization core for the documents domain. EVERY read and write goes
 * through `requireMembership` so tenant isolation lives in exactly one place.
 *
 * Roles are ranked, so "at least editor" is a single comparison.
 */
const ROLE_RANK: Record<DocumentRole, number> = {
  viewer: 0,
  editor: 1,
  owner: 2,
};

export function roleSatisfies(role: DocumentRole, min: DocumentRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

export async function getCurrentUser() {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user ?? null;
}

/** Throws if unauthenticated — use inside server actions (callers catch). */
export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) throw new Error("UNAUTHENTICATED");
  return user;
}

export async function getMembership(
  documentId: string,
  userId: string
): Promise<DocumentMemberRow | null> {
  const [row] = await db
    .select()
    .from(documentMembers)
    .where(
      and(
        eq(documentMembers.documentId, documentId),
        eq(documentMembers.userId, userId)
      )
    )
    .limit(1);
  return row ?? null;
}

/**
 * Returns the membership iff `userId` has at least `minRole` on the document,
 * else `null`. Non-members and under-privileged users are treated identically
 * to a non-existent document so we never leak which documents exist — callers
 * should surface a 404, not a 403.
 */
export async function requireMembership(
  documentId: string,
  userId: string,
  minRole: DocumentRole = "viewer"
): Promise<DocumentMemberRow | null> {
  const membership = await getMembership(documentId, userId);
  if (!membership || !roleSatisfies(membership.role, minRole)) {
    return null;
  }
  return membership;
}
