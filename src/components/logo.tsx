import { NotebookPen } from "lucide-react";

import { cn } from "@/lib/utils";

export function Logo({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex size-7 items-center justify-center rounded-md bg-foreground text-background",
        className
      )}
      aria-hidden="true"
    >
      <NotebookPen className="size-4" strokeWidth={2} />
    </span>
  );
}
