import { z } from "zod";

/**
 * Request validation for the AI assistant endpoint.
 *
 * `content` is the live document text the client sends to be reasoned over. It's
 * capped here (and the route caps the raw body before allocating) so a huge doc
 * can't blow up the prompt or the request. `question` is only present for "ask".
 */
export const MAX_AI_CONTENT_CHARS = 24_000; // ~6k tokens of context
export const MAX_AI_QUESTION_CHARS = 500;

const content = z
  .string()
  .min(1, "There's nothing in this document yet")
  .max(MAX_AI_CONTENT_CHARS, "This document is too long for the assistant");

export const aiTaskSchema = z.discriminatedUnion("task", [
  z.object({ task: z.literal("summary"), content }),
  z.object({ task: z.literal("title"), content }),
  z.object({
    task: z.literal("ask"),
    content,
    question: z
      .string()
      .trim()
      .min(1, "Ask a question")
      .max(MAX_AI_QUESTION_CHARS, "That question is too long"),
  }),
]);

export type AiTaskInput = z.infer<typeof aiTaskSchema>;
export type AiTask = AiTaskInput["task"];
