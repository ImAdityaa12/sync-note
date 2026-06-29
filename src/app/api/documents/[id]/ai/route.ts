import { PayloadTooLargeError, readJsonWithLimit } from "@/lib/http/read-json";
import { rateLimit } from "@/lib/rate-limit";
import { aiConfigured, streamAiTask } from "@/modules/ai/server/generate";
import { aiTaskSchema } from "@/modules/ai/schema";
import {
  getCurrentUser,
  requireMembership,
} from "@/modules/documents/server/membership";

/**
 * AI assistant endpoint — summary / ask / title, streamed back as plain text.
 *
 * Any member (viewers included) may use it: these are read-only operations over
 * a document the user can already see, and nothing is written to document state.
 * Security mirrors the other sync routes: authenticate, rate-limit (AI is the
 * expensive resource, so the bucket is per-user), cap the body *before*
 * allocating, then zod-validate. The request's abort signal is forwarded to the
 * model so a client disconnect cancels the generation.
 */
const MAX_BODY_BYTES = 128 * 1024;
const AI_PER_MIN = 20;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: documentId } = await params;

  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  if (!aiConfigured()) {
    return new Response("AI is not configured", { status: 503 });
  }

  // AI spend is per-user, not per-document — one bucket bounds a user's total
  // generation rate across every document they touch.
  const rl = rateLimit(`ai:${user.id}`, AI_PER_MIN, 60_000);
  if (!rl.ok) {
    return new Response("Too many requests", {
      status: 429,
      headers: { "retry-after": String(rl.retryAfter) },
    });
  }

  // Fast path: reject an obviously-oversized body before any work.
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > MAX_BODY_BYTES) {
    return new Response("Payload too large", { status: 413 });
  }

  // Viewers may read; non-members get an indistinguishable 404.
  const membership = await requireMembership(documentId, user.id, "viewer");
  if (!membership) return new Response("Not found", { status: 404 });

  let body: unknown;
  try {
    body = await readJsonWithLimit(request, MAX_BODY_BYTES);
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      return new Response("Payload too large", { status: 413 });
    }
    return new Response("Invalid JSON", { status: 400 });
  }

  const parsed = aiTaskSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid request";
    return new Response(message, { status: 422 });
  }

  return streamAiTask(parsed.data, request.signal);
}
