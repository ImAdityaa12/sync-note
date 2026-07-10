import "server-only";

import { and, asc, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { documentChatMessages } from "@/db/schema";
import { userPromptFor } from "@/modules/ai/lib/user-prompt";
import type { AiTask } from "@/modules/ai/schema";
import type { AiChatRole, ChatMessage } from "@/modules/ai/types";

/**
 * Durable store for a user's private assistant chat on a document.
 *
 * Every function is scoped to (documentId, userId): callers must have already
 * checked membership, and the userId pin guarantees one collaborator can never
 * read or clear another's chat even on the same document.
 */

/** One user's chat for a document, oldest-first, mapped for the client. */
export async function listChatMessages(
  documentId: string,
  userId: string
): Promise<ChatMessage[]> {
  const rows = await db
    .select()
    .from(documentChatMessages)
    .where(
      and(
        eq(documentChatMessages.documentId, documentId),
        eq(documentChatMessages.userId, userId)
      )
    )
    // Both messages of a turn share one INSERT timestamp, so tie-break on role
    // to keep the user's prompt ahead of the assistant's reply.
    .orderBy(
      asc(documentChatMessages.createdAt),
      sql`case when ${documentChatMessages.role} = 'user' then 0 else 1 end`
    );

  return rows.map((row) => ({
    id: row.id,
    role: row.role as AiChatRole,
    task: (row.task as AiTask | null) ?? null,
    content: row.content,
    createdAt: row.createdAt.getTime(),
  }));
}

/**
 * Persist a completed exchange: the user's prompt and the assistant's reply,
 * written together so a transcript never shows a question without its answer.
 */
export async function appendChatTurn(input: {
  documentId: string;
  userId: string;
  task: AiTask;
  question?: string | null;
  answer: string;
}): Promise<void> {
  const { documentId, userId, task, question, answer } = input;
  const base = { documentId, userId, task };

  await db.insert(documentChatMessages).values([
    {
      ...base,
      id: crypto.randomUUID(),
      role: "user",
      content: userPromptFor(task, question),
    },
    {
      ...base,
      id: crypto.randomUUID(),
      role: "assistant",
      content: answer,
    },
  ]);
}

/** Delete this user's entire chat for a document. */
export async function clearChat(
  documentId: string,
  userId: string
): Promise<void> {
  await db
    .delete(documentChatMessages)
    .where(
      and(
        eq(documentChatMessages.documentId, documentId),
        eq(documentChatMessages.userId, userId)
      )
    );
}
