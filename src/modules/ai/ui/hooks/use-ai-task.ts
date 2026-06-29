"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { AiTask } from "@/modules/ai/schema";

interface RunOptions {
  content: string;
  question?: string;
}

const STATUS_MESSAGE: Record<number, string> = {
  401: "Please sign in again.",
  404: "You don't have access to this document.",
  413: "This document is too long for the assistant.",
  422: "The assistant couldn't read this request.",
  429: "You're using the assistant too quickly. Try again shortly.",
  503: "The AI assistant isn't configured on this server.",
};

/**
 * Drives one AI task at a time against `/api/documents/[id]/ai`, appending the
 * streamed tokens to `output` as they arrive. A new run (or `stop`) aborts the
 * previous request, and the controller is aborted on unmount so a backgrounded
 * stream doesn't keep generating.
 */
export function useAiTask(docId: string) {
  const [task, setTask] = useState<AiTask | null>(null);
  const [output, setOutput] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  useEffect(() => () => abortRef.current?.abort(), []);

  const run = useCallback(
    async (next: AiTask, options: RunOptions) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setTask(next);
      setOutput("");
      setError(null);
      setRunning(true);

      try {
        const res = await fetch(`/api/documents/${docId}/ai`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            task: next,
            content: options.content,
            question: options.question,
          }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          setError(STATUS_MESSAGE[res.status] ?? "The assistant is unavailable.");
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          if (chunk) setOutput((prev) => prev + chunk);
        }
      } catch (err) {
        // An abort (new run / stop / unmount) is expected — don't surface it.
        if ((err as Error)?.name !== "AbortError") {
          setError("Something went wrong reaching the assistant.");
        }
      } finally {
        // Only the most recent run clears the flag (an aborted older run won't).
        if (abortRef.current === controller) {
          abortRef.current = null;
          setRunning(false);
        }
      }
    },
    [docId]
  );

  return { task, output, running, error, run, stop };
}
