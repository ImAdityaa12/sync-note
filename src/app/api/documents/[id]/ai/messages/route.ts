import {
  clearChat,
  listChatMessages,
} from "@/modules/ai/server/chat-store";
import {
  getCurrentUser,
  requireMembership,
} from "@/modules/documents/server/membership";

/**
 * A user's private assistant chat for a document.
 *
 * GET returns the caller's own transcript; DELETE clears it. Both authenticate
 * and require membership (viewers included — the chat is a personal, read-only
 * companion to a document they can already see). Non-members get an
 * indistinguishable 404, matching the other document routes. The store is pinned
 * to (documentId, userId), so a member only ever touches their own chat.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: documentId } = await params;

  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const membership = await requireMembership(documentId, user.id, "viewer");
  if (!membership) return new Response("Not found", { status: 404 });

  const messages = await listChatMessages(documentId, user.id);
  return Response.json({ messages });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: documentId } = await params;

  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const membership = await requireMembership(documentId, user.id, "viewer");
  if (!membership) return new Response("Not found", { status: 404 });

  await clearChat(documentId, user.id);
  return new Response(null, { status: 204 });
}
