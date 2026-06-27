"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { documentMembers, documents, user as userTable } from "@/db/schema";
import {
  changeRoleSchema,
  createDocumentSchema,
  documentIdSchema,
  removeMemberSchema,
  renameDocumentSchema,
  shareDocumentSchema,
} from "@/modules/documents/schema";
import type { ActionResult } from "@/modules/documents/types";

import { getMembership, requireMembership, requireUser } from "./membership";

/** Maps thrown errors (incl. UNAUTHENTICATED) to a friendly result. */
function fail(error: unknown): ActionResult<never> {
  const message =
    error instanceof Error && error.message === "UNAUTHENTICATED"
      ? "You need to sign in."
      : "Something went wrong. Please try again.";
  return { ok: false, error: message };
}

export async function createDocument(input: {
  title?: string;
}): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireUser();
    const parsed = createDocumentSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Invalid title." };

    const id = crypto.randomUUID();
    const title = parsed.data.title?.trim() || "Untitled";

    // user + owner-membership must land together.
    await db.transaction(async (tx) => {
      await tx.insert(documents).values({ id, ownerId: user.id, title });
      await tx.insert(documentMembers).values({
        documentId: id,
        userId: user.id,
        role: "owner",
      });
    });

    revalidatePath("/dashboard");
    return { ok: true, data: { id } };
  } catch (error) {
    return fail(error);
  }
}

export async function renameDocument(input: {
  documentId: string;
  title: string;
}): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = renameDocumentSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid title." };
    }
    const { documentId, title } = parsed.data;

    // Editors and owners can rename; viewers cannot.
    const membership = await requireMembership(documentId, user.id, "editor");
    if (!membership) return { ok: false, error: "You can't edit this document." };

    await db
      .update(documents)
      .set({ title, updatedAt: new Date() })
      .where(eq(documents.id, documentId));

    revalidatePath("/dashboard");
    revalidatePath(`/documents/${documentId}`);
    return { ok: true, data: undefined };
  } catch (error) {
    return fail(error);
  }
}

export async function deleteDocument(input: {
  documentId: string;
}): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = documentIdSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Missing document." };

    const membership = await requireMembership(
      parsed.data.documentId,
      user.id,
      "owner"
    );
    if (!membership) return { ok: false, error: "Only the owner can delete this document." };

    // Cascade removes members, ops and snapshots.
    await db.delete(documents).where(eq(documents.id, parsed.data.documentId));

    revalidatePath("/dashboard");
    return { ok: true, data: undefined };
  } catch (error) {
    return fail(error);
  }
}

export async function shareDocument(input: {
  documentId: string;
  email: string;
  role: "editor" | "viewer";
}): Promise<ActionResult> {
  try {
    const actor = await requireUser();
    const parsed = shareDocumentSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
    }
    const { documentId, email, role } = parsed.data;

    const membership = await requireMembership(documentId, actor.id, "owner");
    if (!membership) return { ok: false, error: "Only the owner can share this document." };

    const [target] = await db
      .select()
      .from(userTable)
      .where(eq(userTable.email, email))
      .limit(1);
    if (!target) {
      return { ok: false, error: "No account with that email has signed up yet." };
    }
    if (target.id === actor.id) {
      return { ok: false, error: "You already own this document." };
    }

    // Idempotent: re-sharing updates the existing role.
    await db
      .insert(documentMembers)
      .values({ documentId, userId: target.id, role })
      .onConflictDoUpdate({
        target: [documentMembers.documentId, documentMembers.userId],
        set: { role },
      });

    revalidatePath(`/documents/${documentId}`);
    return { ok: true, data: undefined };
  } catch (error) {
    return fail(error);
  }
}

export async function changeMemberRole(input: {
  documentId: string;
  userId: string;
  role: "editor" | "viewer";
}): Promise<ActionResult> {
  try {
    const actor = await requireUser();
    const parsed = changeRoleSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Invalid role." };
    const { documentId, userId, role } = parsed.data;

    const membership = await requireMembership(documentId, actor.id, "owner");
    if (!membership) return { ok: false, error: "Only the owner can change roles." };

    // The owner row is immutable through this path.
    const target = await getMembership(documentId, userId);
    if (!target) return { ok: false, error: "That collaborator is no longer on the document." };
    if (target.role === "owner") {
      return { ok: false, error: "The owner's role can't be changed." };
    }

    await db
      .update(documentMembers)
      .set({ role })
      .where(
        and(
          eq(documentMembers.documentId, documentId),
          eq(documentMembers.userId, userId)
        )
      );

    revalidatePath(`/documents/${documentId}`);
    return { ok: true, data: undefined };
  } catch (error) {
    return fail(error);
  }
}

export async function removeMember(input: {
  documentId: string;
  userId: string;
}): Promise<ActionResult> {
  try {
    const actor = await requireUser();
    const parsed = removeMemberSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Invalid request." };
    const { documentId, userId } = parsed.data;

    const membership = await requireMembership(documentId, actor.id, "owner");
    if (!membership) return { ok: false, error: "Only the owner can remove collaborators." };

    const target = await getMembership(documentId, userId);
    if (target?.role === "owner") {
      return { ok: false, error: "The owner can't be removed." };
    }

    await db
      .delete(documentMembers)
      .where(
        and(
          eq(documentMembers.documentId, documentId),
          eq(documentMembers.userId, userId)
        )
      );

    revalidatePath(`/documents/${documentId}`);
    return { ok: true, data: undefined };
  } catch (error) {
    return fail(error);
  }
}
