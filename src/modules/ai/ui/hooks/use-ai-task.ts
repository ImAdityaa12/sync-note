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

const EMPTY_RESPONSE = "The assistant didn't return a response. Please try again.";
const NETWORK_ERROR = "Something went wrong reaching the assistant.";

/**
 * Drives one AI task at a time against `/api/documents/[id]/ai`, appending the
 * streamed tokens to `output` as they arrive. A new run (or `stop`) aborts the
 * previous request; the controller is also aborted on unmount.
 *
 * State updates are gated on the run still being current (`abortRef === ctrl`)
 * and the component still mounted, so a superseded or post-unmount run can never
 * clobber newer output or set state after unmount.
 */
export function useAiTask(docId: string) {
  const [task, setTask] = useState<AiTask | null>(null);
  const [output, setOutput] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  // Stop clears `running` itself — it must not rely on the run's `finally`, which
  // only fires for the *current* controller and would otherwise leave the flag
  // (and every disabled control) stuck after a manual stop / dialog close.
  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setRunning(false);
  }, []);

  const run = useCallback(
    async (next: AiTask, options: RunOptions) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const isCurrent = () =>
        mountedRef.current && abortRef.current === controller;

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
          await res.body?.cancel(); // don't leak the error response stream
          if (isCurrent()) {
            setError(STATUS_MESSAGE[res.status] ?? NETWORK_ERROR);
          }
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let received = false;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          if (chunk) {
            received = true;
            if (isCurrent()) setOutput((prev) => prev + chunk);
          }
        }
        const tail = decoder.decode(); // flush any trailing multibyte bytes
        if (tail) {
          received = true;
          if (isCurrent()) setOutput((prev) => prev + tail);
        }

        // A clean but empty stream means the model produced nothing — typically a
        // mid-stream provider error that `streamText` swallowed server-side.
        if (!received && isCurrent()) setError(EMPTY_RESPONSE);
      } catch (err) {
        // An abort (new run / stop / unmount) is expected — don't surface it.
        if ((err as Error)?.name !== "AbortError" && isCurrent()) {
          setError(NETWORK_ERROR);
        }
      } finally {
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
