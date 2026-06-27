import "server-only";

import { desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { documentMembers, documents, user } from "@/db/schema";
import type {
  DocumentDetail,
  DocumentSummary,
} from "@/modules/documents/types";

import { getMembership } from "./membership";

/**
 * Documents the user can see, newest-edited first. Scoped through the
 * membership join, so a user only ever gets their own documents.
 */
export async function listDocumentsForUser(
  userId: string
): Promise<DocumentSummary[]> {
  return db
    .select({
      id: documents.id,
      title: documents.title,
      role: documentMembers.role,
      createdAt: documents.createdAt,
      updatedAt: documents.updatedAt,
    })
    .from(documentMembers)
    .innerJoin(documents, eq(documents.id, documentMembers.documentId))
    .where(eq(documentMembers.userId, userId))
    .orderBy(desc(documents.updatedAt));
}

/**
 * Full document detail including the collaborator list, or `null` if the user
 * has no access (caller should 404). The member list is visible to anyone with
 * access so collaborators can see who else is in the document.
 */
export async function getDocumentDetail(
  documentId: string,
  userId: string
): Promise<DocumentDetail | null> {
  const membership = await getMembership(documentId, userId);
  if (!membership) return null;

  const [doc] = await db
    .select()
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1);
  if (!doc) return null;

  const members = await db
    .select({
      userId: documentMembers.userId,
      role: documentMembers.role,
      name: user.name,
      email: user.email,
      image: user.image,
    })
    .from(documentMembers)
    .innerJoin(user, eq(user.id, documentMembers.userId))
    .where(eq(documentMembers.documentId, documentId));

  return {
    id: doc.id,
    title: doc.title,
    ownerId: doc.ownerId,
    role: membership.role,
    members,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}
