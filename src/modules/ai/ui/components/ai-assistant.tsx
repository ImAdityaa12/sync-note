"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  Loader2,
  Send,
  Sparkles,
  SquarePen,
  StopCircle,
  WandSparkles,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { MAX_AI_QUESTION_CHARS } from "@/modules/ai/schema";
import { useAiTask } from "@/modules/ai/ui/hooks/use-ai-task";
import { renameDocument } from "@/modules/documents/server/actions";

const TASK_LABEL = {
  summary: "Summary",
  ask: "Answer",
  title: "Suggested title",
} as const;

/**
 * AI assistant for a document: summarize it, ask questions answered from its
 * text, or suggest a title an editor can apply. Responses stream in token by
 * token. `content` is the live document text (read-only input to the model);
 * the assistant never writes document state — applying a title goes through the
 * normal, editor-gated rename action.
 */
export function AiAssistant({
  docId,
  canEdit,
  content,
}: {
  docId: string;
  canEdit: boolean;
  content: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [applied, setApplied] = useState(false);
  const [applying, startApply] = useTransition();

  const { task, output, running, error, run, stop } = useAiTask(docId);
  const hasContent = content.trim().length > 0;

  function reset() {
    stop();
    setQuestion("");
    setApplied(false);
  }

  function onAsk(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const q = question.trim();
    if (!q || !hasContent) return;
    setApplied(false);
    void run("ask", { content, question: q });
  }

  function applyTitle() {
    const title = output.trim();
    if (!title) return;
    startApply(async () => {
      const result = await renameDocument({ documentId: docId, title });
      if (result.ok) {
        setApplied(true);
        router.refresh();
      }
    });
  }

  const showOutput = running || output.length > 0 || error !== null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Sparkles className="size-4" />
          Assistant
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>AI assistant</DialogTitle>
          <DialogDescription>
            Summarize, ask questions, or suggest a title for this document.
            Responses are based only on its current contents.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!hasContent || running}
            onClick={() => {
              setApplied(false);
              void run("summary", { content });
            }}
          >
            <WandSparkles className="size-4" />
            Summarize
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!hasContent || running}
            onClick={() => {
              setApplied(false);
              void run("title", { content });
            }}
          >
            <SquarePen className="size-4" />
            Suggest title
          </Button>
        </div>

        <form onSubmit={onAsk} className="space-y-2">
          <Label htmlFor="ai-question">Ask about this document</Label>
          <div className="flex items-start gap-2">
            <textarea
              id="ai-question"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="What is this document about?"
              maxLength={MAX_AI_QUESTION_CHARS}
              rows={2}
              disabled={running}
              className="min-h-[2.5rem] flex-1 resize-none rounded-lg border bg-transparent px-3 py-2 text-sm outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:opacity-60"
            />
            <Button type="submit" disabled={!question.trim() || !hasContent || running}>
              <Send className="size-4" />
              Ask
            </Button>
          </div>
        </form>

        {!hasContent && (
          <p className="text-sm text-muted-foreground">
            Add some content to the document to use the assistant.
          </p>
        )}

        {showOutput && (
          <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-muted-foreground">
                {task ? TASK_LABEL[task] : "Result"}
              </span>
              {running && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={stop}
                >
                  <StopCircle className="size-3.5" />
                  Stop
                </Button>
              )}
            </div>

            {error ? (
              <p className="text-sm text-destructive">{error}</p>
            ) : output ? (
              <p
                className={cn(
                  "text-sm leading-relaxed whitespace-pre-wrap",
                  task === "title" && "font-medium"
                )}
              >
                {output}
              </p>
            ) : (
              <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Thinking…
              </div>
            )}

            {task === "title" && !running && output.trim() && canEdit && (
              <Button
                type="button"
                size="sm"
                variant={applied ? "outline" : "default"}
                disabled={applying || applied}
                onClick={applyTitle}
              >
                {applied ? (
                  <>
                    <Check className="size-4" />
                    Applied
                  </>
                ) : (
                  <>
                    {applying && <Loader2 className="size-4 animate-spin" />}
                    Apply as title
                  </>
                )}
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
