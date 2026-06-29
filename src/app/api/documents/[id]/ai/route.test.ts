import { beforeEach, describe, expect, it, vi } from "vitest";

// The DB module opens a Neon pool on import; the generate module talks to Groq.
// Mock both (and the auth helpers) so the route's security boundary can be
// exercised without a database, a network call, or an API key.
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/modules/documents/server/membership", () => ({
  getCurrentUser: vi.fn(),
  requireMembership: vi.fn(),
}));
vi.mock("@/modules/ai/server/generate", () => ({
  aiConfigured: vi.fn(() => true),
  streamAiTask: vi.fn(() => new Response("stream")),
}));

import {
  getCurrentUser,
  requireMembership,
} from "@/modules/documents/server/membership";
import { aiConfigured, streamAiTask } from "@/modules/ai/server/generate";

import { POST } from "./route";

const currentUser = vi.mocked(getCurrentUser);
const membership = vi.mocked(requireMembership);
const configured = vi.mocked(aiConfigured);
const stream = vi.mocked(streamAiTask);

const params = (id: string) => ({ params: Promise.resolve({ id }) });

const post = (body?: string) =>
  new Request("http://localhost/api/documents/d/ai", {
    method: "POST",
    ...(body !== undefined ? { body } : {}),
  });

const summary = (content: string) =>
  JSON.stringify({ task: "summary", content });

beforeEach(() => {
  vi.clearAllMocks();
  configured.mockReturnValue(true);
  stream.mockReturnValue(new Response("stream"));
});

describe("ai route — security boundary", () => {
  it("→ 401 when unauthenticated", async () => {
    currentUser.mockResolvedValue(null);
    expect((await POST(post(), params("d1"))).status).toBe(401);
    expect(stream).not.toHaveBeenCalled();
  });

  it("→ 404 for a non-member (no existence leak)", async () => {
    currentUser.mockResolvedValue({ id: "ai-u-404" } as never);
    membership.mockResolvedValue(null);
    expect((await POST(post(summary("hi")), params("d-404"))).status).toBe(404);
    expect(stream).not.toHaveBeenCalled();
  });

  it("→ 413 when the body exceeds the cap (before membership/model work)", async () => {
    currentUser.mockResolvedValue({ id: "ai-u-413" } as never);
    membership.mockResolvedValue({ role: "viewer" } as never);
    const big = summary("x".repeat(300 * 1024)); // > 256KB
    expect((await POST(post(big), params("d-413"))).status).toBe(413);
    expect(stream).not.toHaveBeenCalled();
  });

  it("→ 503 when the server has no AI key configured", async () => {
    currentUser.mockResolvedValue({ id: "ai-u-503" } as never);
    membership.mockResolvedValue({ role: "viewer" } as never);
    configured.mockReturnValue(false);
    expect((await POST(post(summary("hi")), params("d-503"))).status).toBe(503);
    expect(stream).not.toHaveBeenCalled();
  });

  it("→ 422 on a schema-invalid task", async () => {
    currentUser.mockResolvedValue({ id: "ai-u-422" } as never);
    membership.mockResolvedValue({ role: "viewer" } as never);
    const bad = JSON.stringify({ task: "translate", content: "hi" });
    expect((await POST(post(bad), params("d-422"))).status).toBe(422);
    expect(stream).not.toHaveBeenCalled();
  });

  it("→ 429 once the per-user rate limit is exceeded", async () => {
    currentUser.mockResolvedValue({ id: "ai-u-429" } as never);
    membership.mockResolvedValue(null); // 404 on allowed calls; we want the 429
    let status = 0;
    for (let i = 0; i < 25; i++) {
      status = (await POST(post(summary("hi")), params("d-429"))).status;
    }
    expect(status).toBe(429);
  });

  it("streams for a member with a valid task", async () => {
    currentUser.mockResolvedValue({ id: "ai-u-ok" } as never);
    membership.mockResolvedValue({ role: "viewer" } as never);
    const res = await POST(post(summary("hello world")), params("d-ok"));
    expect(res.status).toBe(200);
    expect(stream).toHaveBeenCalledOnce();
    // Validated input is forwarded to the model layer.
    expect(stream.mock.calls[0][0]).toMatchObject({
      task: "summary",
      content: "hello world",
    });
  });
});
