import { describe, expect, it } from "vitest";

import { signTicket, TICKET_TTL_MS, verifyTicket } from "./ticket";

const SECRET = "test-secret-please-ignore";
const input = {
  sub: "user-1",
  doc: "doc-1",
  role: "editor" as const,
  name: "Ada",
};

describe("realtime ticket", () => {
  it("round-trips a signed ticket", () => {
    const now = 1_000_000;
    const ticket = signTicket(input, SECRET, now);
    const payload = verifyTicket(ticket, SECRET, now);
    expect(payload).toMatchObject({ ...input, iat: now, exp: now + TICKET_TTL_MS });
  });

  it("rejects a ticket signed with a different secret", () => {
    const ticket = signTicket(input, SECRET, 0);
    expect(verifyTicket(ticket, "other-secret", 0)).toBeNull();
  });

  it("rejects a tampered payload (signature no longer matches)", () => {
    const ticket = signTicket(input, SECRET, 0);
    const [body, sig] = ticket.split(".");
    const forged = Buffer.from(
      JSON.stringify({ ...input, role: "owner", iat: 0, exp: TICKET_TTL_MS }),
      "utf8"
    ).toString("base64url");
    expect(verifyTicket(`${forged}.${sig}`, SECRET, 0)).toBeNull();
    expect(body).not.toBe(forged);
  });

  it("rejects an expired ticket", () => {
    const ticket = signTicket(input, SECRET, 0);
    expect(verifyTicket(ticket, SECRET, TICKET_TTL_MS)).toBeNull(); // exactly at exp
    expect(verifyTicket(ticket, SECRET, TICKET_TTL_MS - 1)).not.toBeNull();
  });

  it("rejects malformed tickets", () => {
    expect(verifyTicket("", SECRET)).toBeNull();
    expect(verifyTicket("no-dot", SECRET)).toBeNull();
    expect(verifyTicket("a.", SECRET)).toBeNull();
    expect(verifyTicket(".b", SECRET)).toBeNull();
  });
});
