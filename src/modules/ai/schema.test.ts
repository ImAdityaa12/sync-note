import { describe, expect, it } from "vitest";

import {
  aiTaskSchema,
  MAX_AI_CONTENT_CHARS,
  MAX_AI_QUESTION_CHARS,
} from "./schema";

describe("aiTaskSchema", () => {
  it("accepts a summary/title task with content", () => {
    expect(aiTaskSchema.safeParse({ task: "summary", content: "hi" }).success).toBe(true);
    expect(aiTaskSchema.safeParse({ task: "title", content: "hi" }).success).toBe(true);
  });

  it("requires a non-empty question for ask", () => {
    expect(
      aiTaskSchema.safeParse({ task: "ask", content: "hi" }).success
    ).toBe(false);
    expect(
      aiTaskSchema.safeParse({ task: "ask", content: "hi", question: "  " }).success
    ).toBe(false);
    expect(
      aiTaskSchema.safeParse({ task: "ask", content: "hi", question: "what?" }).success
    ).toBe(true);
  });

  it("rejects empty content (nothing to reason over)", () => {
    expect(aiTaskSchema.safeParse({ task: "summary", content: "" }).success).toBe(false);
  });

  it("caps content and question length", () => {
    const huge = "a".repeat(MAX_AI_CONTENT_CHARS + 1);
    expect(aiTaskSchema.safeParse({ task: "summary", content: huge }).success).toBe(false);

    const longQuestion = "q".repeat(MAX_AI_QUESTION_CHARS + 1);
    expect(
      aiTaskSchema.safeParse({ task: "ask", content: "hi", question: longQuestion }).success
    ).toBe(false);
  });

  it("rejects an unknown task", () => {
    expect(aiTaskSchema.safeParse({ task: "translate", content: "hi" }).success).toBe(false);
  });
});
