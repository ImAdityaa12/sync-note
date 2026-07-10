"use server";

import { clearChat, listChatMessages } from "@/modules/ai/server/chat-store";
import type { ChatMessage } from "@/modules/ai/types";
import {
  requireMembership,
  requireUser,
} from "@/modules/documents/server/membership";
import type { ActionResult } from "@/modules/documents/types";

/**
 * Server actions for a user's private assistant chat.
 *
 * Reading and clearing the transcript are plain RPCs — no streaming — so they
 * live here rather than in an API route. Both authenticate and require
 * membership (viewers included, matching the read-only nature of the assistant);
 * the store is pinned to (documentId, userId), so a member only ever touches
 * their own chat. Generation stays a route handler because it streams tokens.
 */

/** Maps thrown errors (incl. UNAUTHENTICATED) to a friendly result. */
function fail(error: unknown): ActionResult<never> {
  const message =
    error instanceof Error && error.message === "UNAUTHENTICATED"
      ? "You need to sign in."
      : "Something went wrong. Please try again.";
  return { ok: false, error: message };
}

export async function getChatMessages(
  documentId: string
): Promise<ActionResult<ChatMessage[]>> {
  try {
    const user = await requireUser();
    const membership = await requireMembership(documentId, user.id, "viewer");
    if (!membership) {
      return { ok: false, error: "You don't have access to this document." };
    }
    const messages = await listChatMessages(documentId, user.id);
    return { ok: true, data: messages };
  } catch (error) {
    return fail(error);
  }
}

export async function clearChatMessages(
  documentId: string
): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const membership = await requireMembership(documentId, user.id, "viewer");
    if (!membership) {
      return { ok: false, error: "You don't have access to this document." };
    }
    await clearChat(documentId, user.id);
    return { ok: true, data: undefined };
  } catch (error) {
    return fail(error);
  }
}
