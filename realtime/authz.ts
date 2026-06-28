import { verifyTicket, type TicketPayload } from "@/lib/realtime/ticket";

/**
 * Socket authentication for the relay.
 *
 * The Next app mints HMAC tickets (see `src/lib/realtime/ticket.ts`); here we
 * verify one statelessly with the shared secret. No DB or cookie is needed — a
 * valid ticket *is* proof of an authenticated, membership-checked user, and it
 * carries the role the socket must enforce.
 */
function requireSecret(): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    throw new Error(
      "BETTER_AUTH_SECRET is not set — the realtime server can't verify tickets."
    );
  }
  return secret;
}

const SECRET = requireSecret();

export function authenticate(ticket: string | undefined): TicketPayload | null {
  if (!ticket) return null;
  return verifyTicket(ticket, SECRET);
}
