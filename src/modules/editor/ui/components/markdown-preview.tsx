import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/utils";

/**
 * Renders markdown to HTML. Raw HTML in the source is intentionally NOT enabled
 * (no rehype-raw), so user content can't inject markup — safe by default.
 */
export function MarkdownPreview({
  source,
  className,
}: {
  source: string;
  className?: string;
}) {
  if (!source.trim()) {
    return (
      <p className={cn("text-sm text-muted-foreground", className)}>
        Nothing to preview yet.
      </p>
    );
  }

  return (
    <div className={cn("md-preview", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{source}</ReactMarkdown>
    </div>
  );
}
