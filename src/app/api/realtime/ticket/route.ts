import { rateLimit } from "@/lib/rate-limit";
import { signTicket } from "@/lib/realtime/ticket";
import {
  getCurrentUser,
  requireMembership,
} from "@/modules/documents/server/membership";

/**
 * Mint a short-lived signed ticket so the authenticated user can open the
 * realtime socket. This is the *only* place the socket's identity + role is
 * established: the ws server can't read a Better Auth session, so we read it
 * here, check membership, and hand back a ticket it verifies statelessly.
 *
 *   GET /api/realtime/ticket?doc=<id>  →  { ticket, url }
 */

const TICKET_PER_MIN = 120;

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const rl = rateLimit(`rt:ticket:${user.id}`, TICKET_PER_MIN, 60_000);
  if (!rl.ok) {
    return new Response("Too many requests", {
      status: 429,
      headers: { "retry-after": String(rl.retryAfter) },
    });
  }

  const documentId = new URL(request.url).searchParams.get("doc");
  if (!documentId) return new Response("Missing doc", { status: 400 });

  // Viewers may connect (read-only); non-members get an indistinguishable 404.
  const membership = await requireMembership(documentId, user.id, "viewer");
  if (!membership) return new Response("Not found", { status: 404 });

  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) return new Response("Realtime not configured", { status: 503 });

  const ticket = signTicket(
    { sub: user.id, doc: documentId, role: membership.role, name: user.name },
    secret
  );

  return Response.json({
    ticket,
    url: process.env.NEXT_PUBLIC_REALTIME_URL ?? "ws://localhost:3001",
  });
}
