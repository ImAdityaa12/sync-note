import { cn } from "@/lib/utils";
import type { DocumentRole } from "@/modules/documents/types";

const LABEL: Record<DocumentRole, string> = {
  owner: "Owner",
  editor: "Editor",
  viewer: "Viewer",
};

export function RoleBadge({
  role,
  className,
}: {
  role: DocumentRole;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium text-muted-foreground",
        className
      )}
    >
      {LABEL[role]}
    </span>
  );
}
