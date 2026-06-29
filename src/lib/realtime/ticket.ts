import { createHmac, timingSafeEqual } from "node:crypto";

import type { DocumentRole } from "@/modules/documents/types";

/**
 * Stateless connection tickets for the realtime socket.
 *
 * The Next app is the only place that can read a Better Auth session, so it
 * authenticates the user + checks document membership, then mints a short-lived
 * HMAC ticket the standalone ws server can verify on its own — no shared cookie,
 * no auth-DB round-trip, and it works across origins (Vercel app ↔ Railway ws,
 * where a same-site session cookie would never be sent). The ticket carries the
 * already-checked role, so the socket can enforce "viewers never push" from the
 * wire alone.
 *
 * Signed with BETTER_AUTH_SECRET (already required in prod), so a ticket can't
 * be forged without the server secret.
 */
export interface TicketPayload {
  /** User id (subject). */
  sub: string;
  /** Document id this ticket grants access to. */
  doc: string;
  /** Membership role at mint time — authoritative for socket authorization. */
  role: DocumentRole;
  /** Display name, surfaced as presence to other collaborators. */
  name: string;
  /** Issued-at (ms since epoch). */
  iat: number;
  /** Expiry (ms since epoch). */
  exp: number;
}

export interface TicketInput {
  sub: string;
  doc: string;
  role: DocumentRole;
  name: string;
}

/** Tickets are redeemed immediately to open a socket, so they live briefly. */
export const TICKET_TTL_MS = 60_000;

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function hmac(data: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(data).digest();
}

/** Mint a signed ticket of the form `base64url(payload).base64url(hmac)`. */
export function signTicket(
  input: TicketInput,
  secret: string,
  now: number = Date.now()
): string {
  const payload: TicketPayload = { ...input, iat: now, exp: now + TICKET_TTL_MS };
  const body = base64url(JSON.stringify(payload));
  const sig = base64url(hmac(body, secret));
  return `${body}.${sig}`;
}

/**
 * Verify signature + expiry, returning the payload — or `null` if the ticket is
 * malformed, tampered, signed with the wrong secret, or expired. The signature
 * is compared in constant time so a forgery can't be guessed by timing.
 */
export function verifyTicket(
  ticket: string,
  secret: string,
  now: number = Date.now()
): TicketPayload | null {
  const dot = ticket.indexOf(".");
  if (dot <= 0 || dot === ticket.length - 1) return null;

  const body = ticket.slice(0, dot);
  const expected = hmac(body, secret);
  const provided = Buffer.from(ticket.slice(dot + 1), "base64url");
  // Length guard first: timingSafeEqual throws on a length mismatch.
  if (provided.length !== expected.length) return null;
  if (!timingSafeEqual(provided, expected)) return null;

  let payload: TicketPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (
    typeof payload?.sub !== "string" ||
    typeof payload?.doc !== "string" ||
    typeof payload?.role !== "string" ||
    typeof payload?.name !== "string" ||
    typeof payload?.exp !== "number"
  ) {
    return null;
  }
  if (now >= payload.exp) return null;
  return payload;
}
