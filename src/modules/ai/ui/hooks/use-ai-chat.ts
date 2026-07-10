"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { userPromptFor } from "@/modules/ai/lib/user-prompt";
import type { AiTask } from "@/modules/ai/schema";
import type { ChatMessage } from "@/modules/ai/types";

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
 * Drives a document's private assistant chat.
 *
 * The transcript is loaded once from the server (`load`) and thereafter kept in
 * local state. A `run` optimistically appends the user's prompt and a streaming
 * assistant placeholder, then fills the placeholder token-by-token; the server
 * persists the finished turn independently, so we never refetch mid-session (no
 * flicker, no duplicate). A failed or stopped run rolls its optimistic pair back
 * out so the transcript only ever holds turns the server also kept.
 *
 * State writes are gated on the run still being current (`abortRef === ctrl`)
 * and the component still mounted, so a superseded or post-unmount run can never
 * clobber newer state.
 */
export function useAiChat(docId: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
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

  const load = useCallback(async () => {
    if (loaded) return;
    try {
      const res = await fetch(`/api/documents/${docId}/ai/messages`);
      if (!res.ok) return; // a load failure just leaves the transcript empty
      const data = (await res.json()) as { messages: ChatMessage[] };
      if (mountedRef.current) setMessages(data.messages);
    } catch {
      // Offline / transient — the user can still start a new chat.
    } finally {
      if (mountedRef.current) setLoaded(true);
    }
  }, [docId, loaded]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
  }, []);

  const run = useCallback(
    async (task: AiTask, options: RunOptions) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const isCurrent = () =>
        mountedRef.current && abortRef.current === controller;

      const userId = crypto.randomUUID();
      const assistantId = crypto.randomUUID();
      const now = Date.now();
      const userMessage: ChatMessage = {
        id: userId,
        role: "user",
        task,
        content: userPromptFor(task, options.question),
        createdAt: now,
      };
      const assistantMessage: ChatMessage = {
        id: assistantId,
        role: "assistant",
        task,
        content: "",
        createdAt: now + 1,
      };

      const rollback = () =>
        setMessages((prev) =>
          prev.filter((m) => m.id !== userId && m.id !== assistantId)
        );

      setError(null);
      setStreaming(true);
      setMessages((prev) => [...prev, userMessage, assistantMessage]);

      try {
        const res = await fetch(`/api/documents/${docId}/ai`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            task,
            content: options.content,
            question: options.question,
          }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          await res.body?.cancel();
          if (isCurrent()) {
            rollback();
            setError(STATUS_MESSAGE[res.status] ?? NETWORK_ERROR);
          }
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let full = "";
        const appendToAssistant = (chunk: string) => {
          full += chunk;
          if (isCurrent()) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, content: full } : m
              )
            );
          }
        };
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          if (chunk) appendToAssistant(chunk);
        }
        const tail = decoder.decode();
        if (tail) appendToAssistant(tail);

        // A clean but empty stream means the model produced nothing — roll the
        // turn back and surface it, matching how the server skips persistence.
        if (!full && isCurrent()) {
          rollback();
          setError(EMPTY_RESPONSE);
        }
      } catch (err) {
        if ((err as Error)?.name !== "AbortError" && isCurrent()) {
          rollback();
          setError(NETWORK_ERROR);
        }
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
          setStreaming(false);
        }
      }
    },
    [docId]
  );

  const clear = useCallback(async () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
    setError(null);
    setMessages([]);
    try {
      await fetch(`/api/documents/${docId}/ai/messages`, { method: "DELETE" });
    } catch {
      // Best-effort: the local view is already cleared; a reload re-syncs.
    }
  }, [docId]);

  return { messages, streaming, error, load, run, stop, clear };
}
