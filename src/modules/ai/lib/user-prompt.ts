import type { AiTask } from "@/modules/ai/schema";

/**
 * The user-side chat text for a task. "ask" carries the real question; the
 * button-triggered tasks have no typed prompt, so we synthesize a stable label
 * that reads naturally in the transcript. Shared by the optimistic client UI and
 * the server persistence so both sides record the same user message.
 */
export function userPromptFor(task: AiTask, question?: string | null): string {
  switch (task) {
    case "ask":
      return (question ?? "").trim();
    case "summary":
      return "Summarize this document";
    case "title":
      return "Suggest a title";
  }
}
