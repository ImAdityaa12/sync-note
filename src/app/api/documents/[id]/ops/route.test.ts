import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the DB (its module opens a Neon pool on import) and the auth helpers.
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/modules/documents/server/membership", () => ({
  getCurrentUser: vi.fn(),
  requireMembership: vi.fn(),
}));

import {
  getCurrentUser,
  requireMembership,
} from "@/modules/documents/server/membership";

import { GET, POST } from "./route";

const currentUser = vi.mocked(getCurrentUser);
const membership = vi.mocked(requireMembership);

const params = (id: string) => ({ params: Promise.resolve({ id }) });

const postReq = (body?: string) =>
  new Request("http://localhost/api/documents/d/ops", {
    method: "POST",
    ...(body !== undefined ? { body } : {}),
  });

const getReq = () => new Request("http://localhost/api/documents/d/ops");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ops route — security boundary", () => {
  it("POST → 401 when unauthenticated", async () => {
    currentUser.mockResolvedValue(null);
    expect((await POST(postReq(), params("d1"))).status).toBe(401);
  });

  it("POST → 403 for a viewer (no editor membership)", async () => {
    currentUser.mockResolvedValue({ id: "u-403" } as never);
    membership.mockResolvedValue(null);
    expect((await POST(postReq("{}"), params("d-403"))).status).toBe(403);
  });

  it("POST → 413 when the body exceeds the cap", async () => {
    currentUser.mockResolvedValue({ id: "u-413" } as never);
    membership.mockResolvedValue({ role: "editor" } as never); // pass role; reach the body cap
    const big = "x".repeat(300 * 1024); // > 256KB
    expect((await POST(postReq(big), params("d-413"))).status).toBe(413);
  });

  it("POST → 429 once the per-user/doc rate limit is exceeded", async () => {
    currentUser.mockResolvedValue({ id: "u-429" } as never);
    membership.mockResolvedValue(null); // 403 before the DB on allowed calls
    let status = 0;
    for (let i = 0; i < 305; i++) {
      status = (await POST(postReq(), params("d-429"))).status;
    }
    expect(status).toBe(429);
  });

  it("GET → 401 when unauthenticated", async () => {
    currentUser.mockResolvedValue(null);
    expect((await GET(getReq(), params("d1"))).status).toBe(401);
  });

  it("GET → 404 for a non-member (no existence leak)", async () => {
    currentUser.mockResolvedValue({ id: "u-404" } as never);
    membership.mockResolvedValue(null);
    expect((await GET(getReq(), params("d-404"))).status).toBe(404);
  });
});
