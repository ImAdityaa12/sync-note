import "server-only";

import { groq } from "@ai-sdk/groq";
import { createTextStreamResponse, streamText } from "ai";

import type { AiTaskInput } from "@/modules/ai/schema";

/**
 * Groq-backed AI generation for the assistant features. Each task streams plain
 * text back to the browser so the response renders token-by-token.
 *
 * Models (Groq): the 70B model for summary/ask (quality), the 8B "instant" model
 * for title (short, latency-sensitive). Provider is swappable behind the AI-SDK
 * interface — only this file references `@ai-sdk/groq`.
 */
const SMART_MODEL = "llama-3.3-70b-versatile";
const FAST_MODEL = "llama-3.1-8b-instant";

/** Whether the server is configured to talk to Groq at all. */
export function aiConfigured(): boolean {
  return Boolean(process.env.GROQ_API_KEY);
}

interface Plan {
  model: string;
  system: string;
  prompt: string;
  maxOutputTokens: number;
  temperature: number;
}

function plan(input: AiTaskInput): Plan {
  switch (input.task) {
    case "summary":
      return {
        model: SMART_MODEL,
        system:
          "You are a precise writing assistant. Summarize the user's document " +
          "faithfully and concisely. Output plain prose with no preamble, no " +
          "headings, and no bullet points unless the document itself is a list.",
        prompt: `Summarize this markdown document in 3-5 sentences:\n\n${input.content}`,
        maxOutputTokens: 512,
        temperature: 0.3,
      };
    case "ask":
      return {
        model: SMART_MODEL,
        system:
          "You answer questions strictly from the provided document. If the " +
          "answer is not in the document, say you couldn't find it rather than " +
          "guessing. Be concise and quote the document where helpful.",
        prompt:
          `Document:\n"""\n${input.content}\n"""\n\n` +
          `Question: ${input.question}`,
        maxOutputTokens: 700,
        temperature: 0.2,
      };
    case "title":
      return {
        model: FAST_MODEL,
        system:
          "You suggest a single concise document title. Output only the title " +
          "text: 3 to 6 words, in Title Case, with no surrounding quotes and no " +
          "trailing punctuation.",
        prompt: `Suggest a title for this document:\n\n${input.content}`,
        maxOutputTokens: 32,
        temperature: 0.5,
      };
  }
}

/**
 * Stream a task's response as a `text/plain` HTTP stream. `signal` is the
 * request's abort signal, so a client disconnect cancels the upstream LLM call
 * (no wasted tokens).
 *
 * `streamText` deliberately does NOT throw on a mid-stream provider failure (the
 * 200 response has already begun) — it routes the error to `onError` and closes
 * the text stream. Without `onError` the failure would vanish silently, so we log
 * it server-side; the client treats an empty stream as a failed generation.
 *
 * `onComplete` runs once, server-side, with the full generated text when the
 * stream finishes cleanly — the caller uses it to persist the turn. It is
 * skipped when the request was aborted or nothing was produced, so an
 * interrupted generation never lands in the durable chat.
 */
export function streamAiTask(
  input: AiTaskInput,
  signal: AbortSignal,
  onComplete?: (text: string) => void | Promise<void>
): Response {
  const { model, system, prompt, maxOutputTokens, temperature } = plan(input);
  const result = streamText({
    model: groq(model),
    system,
    prompt,
    maxOutputTokens,
    temperature,
    abortSignal: signal,
    onError: ({ error }) => {
      console.error("[ai] generation failed:", error);
    },
    onFinish: ({ text }) => {
      if (!onComplete || signal.aborted) return;
      const trimmed = text.trim();
      if (!trimmed) return;
      // Persistence must not break or delay the response stream.
      void Promise.resolve(onComplete(trimmed)).catch((error) => {
        console.error("[ai] failed to persist chat turn:", error);
      });
    },
  });
  // `toTextStreamResponse()` is deprecated in ai@7; the standalone helper over
  // `result.textStream` is the supported path.
  return createTextStreamResponse({ stream: result.textStream });
}
