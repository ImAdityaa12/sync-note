import type { ClientFrame } from "@/lib/realtime/protocol";
import { signTicket } from "@/lib/realtime/ticket";

/**
 * Live integration check for the relay's security + presence behaviour. Run the
 * server (`npm run realtime:dev`) then `npm run realtime:verify`.
 *
 * It signs tickets locally (same secret as the server) and drives real WebSocket
 * clients. Every assertion uses a non-existent document, so the relay only ever
 * SELECTs the latest seq — nothing is written to the database. The editor
 * op-persist happy path is intentionally left to the two-browser manual test.
 */
const SECRET = process.env.BETTER_AUTH_SECRET;
if (!SECRET) {
  console.error("BETTER_AUTH_SECRET is required");
  process.exit(1);
}
const BASE = process.env.REALTIME_URL ?? "ws://localhost:3001";
const DOC = "verify-relay-nonexistent-doc";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Frame {
  t: string;
  [key: string]: unknown;
}
type PeerLite = { site: string; cursor?: { head: number } };
const peersOf = (f: Frame): PeerLite[] => (f.peers as PeerLite[] | undefined) ?? [];

class Client {
  private readonly ws: WebSocket;
  private readonly received: Frame[] = [];
  private closeCode: number | null = null;

  constructor(query: string) {
    this.ws = new WebSocket(`${BASE}/?${query}`);
    this.ws.addEventListener("message", (e) => {
      try {
        this.received.push(JSON.parse(String((e as MessageEvent).data)) as Frame);
      } catch {
        /* ignore non-JSON */
      }
    });
    this.ws.addEventListener("close", (e) => {
      this.closeCode = (e as CloseEvent).code;
    });
  }

  waitOpen(ms = 2000): Promise<boolean> {
    return new Promise((resolve) => {
      if (this.ws.readyState === WebSocket.OPEN) return resolve(true);
      const timer = setTimeout(() => resolve(false), ms);
      this.ws.addEventListener(
        "open",
        () => {
          clearTimeout(timer);
          resolve(true);
        },
        { once: true }
      );
      this.ws.addEventListener(
        "close",
        () => {
          clearTimeout(timer);
          resolve(false);
        },
        { once: true }
      );
    });
  }

  async waitFrame(pred: (f: Frame) => boolean, ms = 2000): Promise<Frame | null> {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      const found = this.received.find(pred);
      if (found) return found;
      await sleep(20);
    }
    return null;
  }

  async waitClose(ms = 2000): Promise<number | null> {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (this.closeCode !== null) return this.closeCode;
      await sleep(20);
    }
    return null;
  }

  send(frame: ClientFrame): void {
    this.ws.send(JSON.stringify(frame));
  }

  sendRaw(data: string): void {
    this.ws.send(data);
  }

  close(): void {
    this.ws.close();
  }
}

const ticketFor = (role: "owner" | "editor" | "viewer", sub: string, name: string) =>
  signTicket({ sub, doc: DOC, role, name }, SECRET);

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean): void {
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}`);
  if (ok) passed++;
  else failed++;
}

async function main(): Promise<void> {
  console.log(`Verifying relay at ${BASE}\n`);

  const noTicket = new Client("site=z");
  check("rejects a connection with no ticket", (await noTicket.waitClose()) === 4401);

  const forged = new Client("ticket=not-a-real-ticket&site=z");
  check("rejects a forged ticket", (await forged.waitClose()) === 4401);

  const a = new Client(
    `ticket=${encodeURIComponent(ticketFor("editor", "userA", "Ada"))}&site=siteA`
  );
  check("accepts a valid editor", await a.waitOpen());
  check("greets the editor with a welcome frame", !!(await a.waitFrame((f) => f.t === "welcome")));

  const b = new Client(
    `ticket=${encodeURIComponent(ticketFor("editor", "userB", "Linus"))}&site=siteB`
  );
  await b.waitOpen();
  check(
    "broadcasts presence when a peer joins",
    !!(await a.waitFrame((f) => f.t === "presence" && peersOf(f).some((p) => p.site === "siteB")))
  );

  b.send({ t: "cursor", anchor: 4, head: 7 });
  check(
    "relays a peer's cursor as presence",
    !!(await a.waitFrame(
      (f) => f.t === "presence" && peersOf(f).some((p) => p.site === "siteB" && p.cursor?.head === 7)
    ))
  );

  const viewer = new Client(
    `ticket=${encodeURIComponent(ticketFor("viewer", "userV", "Vera"))}&site=siteV`
  );
  await viewer.waitOpen();
  viewer.send({
    t: "op",
    ops: [{ type: "insert", id: { counter: 0, site: "siteV" }, value: "x", originLeft: null }],
  });
  check(
    "drops a viewer's op write (read-only on the wire)",
    !!(await viewer.waitFrame((f) => f.t === "error" && f.code === "forbidden"))
  );

  const over = new Client(
    `ticket=${encodeURIComponent(ticketFor("editor", "userO", "Otto"))}&site=siteO`
  );
  await over.waitOpen();
  over.sendRaw("z".repeat(70 * 1024)); // > 64 KB frame cap
  check("rejects an oversized frame (closed 1009)", (await over.waitClose()) === 1009);

  for (const c of [noTicket, forged, a, b, viewer, over]) c.close();

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
