"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  Download,
  Loader2,
  Send,
  Sparkles,
  SquarePen,
  StopCircle,
  Trash2,
  WandSparkles,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { exportChat, type ExportFormat } from "@/modules/ai/lib/export-chat";
import { sanitizeTitle } from "@/modules/ai/lib/sanitize-title";
import { MAX_AI_QUESTION_CHARS } from "@/modules/ai/schema";
import type { ChatMessage } from "@/modules/ai/types";
import { useAiChat } from "@/modules/ai/ui/hooks/use-ai-chat";
import { renameDocument } from "@/modules/documents/server/actions";

const EXPORT_FORMATS: { format: ExportFormat; label: string }[] = [
  { format: "markdown", label: "Markdown (.md)" },
  { format: "text", label: "Plain text (.txt)" },
  { format: "json", label: "JSON (.json)" },
];

/** Turn a serialized chat export into a browser download. */
function downloadFile(filename: string, mimeType: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/**
 * Right-hand assistant chat for a document: summarize it, ask questions answered
 * from its text, or suggest a title. The conversation streams in token by token
 * and is persisted per-user, so it survives reloads and is private to each
 * collaborator. `content` is the live document text (read-only input to the
 * model); the assistant never writes document state — applying a suggested title
 * goes through the normal, editor-gated rename action.
 */
export function ChatSidebar({
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
  const [appliedId, setAppliedId] = useState<string | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applying, startApply] = useTransition();

  const { messages, streaming, error, load, run, stop, clear } =
    useAiChat(docId);
  const hasContent = content.trim().length > 0;
  const scrollRef = useRef<HTMLDivElement>(null);

  // Load the persisted transcript the first time the drawer opens.
  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  // Keep the newest message in view as it streams / arrives.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  function onAsk(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const q = question.trim();
    if (!q || !hasContent || streaming) return;
    setQuestion("");
    void run("ask", { content, question: q });
  }

  const onExport = useCallback(
    (format: ExportFormat) => {
      if (messages.length === 0) return;
      const file = exportChat(messages, format, {
        documentId: docId,
        exportedAt: Date.now(),
      });
      downloadFile(file.filename, file.mimeType, file.content);
    },
    [messages, docId]
  );

  function applyTitle(message: ChatMessage) {
    const title = sanitizeTitle(message.content);
    if (!title) return;
    setApplyError(null);
    startApply(async () => {
      const result = await renameDocument({ documentId: docId, title });
      if (result.ok) {
        setAppliedId(message.id);
        router.refresh();
      } else {
        setApplyError(result.error);
      }
    });
  }

  // Offer "apply as title" only on the most recent assistant message, and only
  // when it's a finished title suggestion.
  const last = messages[messages.length - 1];
  const titleSuggestion =
    !streaming &&
    canEdit &&
    last?.role === "assistant" &&
    last.task === "title" &&
    sanitizeTitle(last.content)
      ? last
      : null;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button size="sm" variant="outline">
          <Sparkles className="size-4" />
          Assistant
        </Button>
      </SheetTrigger>

      <SheetContent className="gap-3">
        <SheetHeader>
          <SheetTitle>AI assistant</SheetTitle>
          <SheetDescription>
            Summarize, ask questions, or suggest a title. Answers are based only
            on this document&apos;s current contents. Your chat is private.
          </SheetDescription>
        </SheetHeader>

        {messages.length > 0 && (
          <div className="flex items-center justify-end gap-1">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" size="sm">
                  <Download className="size-4" />
                  Export
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {EXPORT_FORMATS.map(({ format, label }) => (
                  <DropdownMenuItem
                    key={format}
                    onSelect={() => onExport(format)}
                  >
                    {label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={clear}
            >
              <Trash2 className="size-4" />
              Clear
            </Button>
          </div>
        )}

        <div
          ref={scrollRef}
          className="min-h-0 flex-1 space-y-3 overflow-y-auto rounded-lg border bg-muted/10 p-3"
        >
          {messages.length === 0 && !streaming ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {hasContent
                ? "Ask a question or run a quick action below to start."
                : "Add some content to the document to use the assistant."}
            </p>
          ) : (
            messages.map((message) => (
              <div
                key={message.id}
                className={cn(
                  "flex",
                  message.role === "user" ? "justify-end" : "justify-start"
                )}
              >
                <div
                  className={cn(
                    "max-w-[85%] rounded-lg px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap",
                    message.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "border bg-background",
                    message.role === "assistant" &&
                      message.task === "title" &&
                      "font-medium"
                  )}
                >
                  {message.content ? (
                    message.content
                  ) : (
                    <span className="flex items-center gap-2 text-muted-foreground">
                      <Loader2 className="size-4 animate-spin" />
                      Thinking…
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {titleSuggestion && (
          <div className="space-y-1.5">
            <Button
              type="button"
              size="sm"
              variant={appliedId === titleSuggestion.id ? "outline" : "default"}
              disabled={applying || appliedId === titleSuggestion.id}
              onClick={() => applyTitle(titleSuggestion)}
            >
              {appliedId === titleSuggestion.id ? (
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
            {applyError && (
              <p className="text-sm text-destructive">{applyError}</p>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!hasContent || streaming}
            onClick={() => void run("summary", { content })}
          >
            <WandSparkles className="size-4" />
            Summarize
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!hasContent || streaming}
            onClick={() => void run("title", { content })}
          >
            <SquarePen className="size-4" />
            Suggest title
          </Button>
          {streaming && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="ml-auto"
              onClick={stop}
            >
              <StopCircle className="size-4" />
              Stop
            </Button>
          )}
        </div>

        <form onSubmit={onAsk} className="space-y-2">
          <Label htmlFor="ai-question" className="sr-only">
            Ask about this document
          </Label>
          <div className="flex items-end gap-2">
            <textarea
              id="ai-question"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder="Ask about this document…"
              maxLength={MAX_AI_QUESTION_CHARS}
              rows={2}
              disabled={streaming}
              className="min-h-[2.5rem] flex-1 resize-none rounded-lg border bg-transparent px-3 py-2 text-sm outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:opacity-60"
            />
            <Button
              type="submit"
              size="icon"
              disabled={!question.trim() || !hasContent || streaming}
            >
              <Send className="size-4" />
              <span className="sr-only">Ask</span>
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
