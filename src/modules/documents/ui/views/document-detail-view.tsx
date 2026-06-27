import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import type { DocumentDetail } from "@/modules/documents/types";
import { DocumentTitle } from "@/modules/documents/ui/components/document-title";
import { MembersPanel } from "@/modules/documents/ui/components/members-panel";
import { RoleBadge } from "@/modules/documents/ui/components/role-badge";
import { ShareDialog } from "@/modules/documents/ui/components/share-dialog";
import { MarkdownEditor } from "@/modules/editor/ui/components/markdown-editor";

export function DocumentDetailView({
  detail,
  currentUserId,
}: {
  detail: DocumentDetail;
  currentUserId: string;
}) {
  const isOwner = detail.role === "owner";
  const canEdit = detail.role === "owner" || detail.role === "editor";

  return (
    <div className="space-y-10">
      <div>
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Documents
        </Link>

        <div className="mt-4 min-w-0">
          <DocumentTitle
            documentId={detail.id}
            title={detail.title}
            canEdit={canEdit}
          />
          <div className="mt-2">
            <RoleBadge role={detail.role} />
          </div>
        </div>
      </div>

      {/* Local-first markdown editor — IndexedDB is the source of truth.
          Background sync to other collaborators arrives in Phase D.
          Keyed by id so switching documents remounts with fresh local state. */}
      <MarkdownEditor key={detail.id} docId={detail.id} canEdit={canEdit} />

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">
            Collaborators
            <span className="ml-2 text-muted-foreground">
              {detail.members.length}
            </span>
          </h2>
          {isOwner && <ShareDialog documentId={detail.id} />}
        </div>
        <MembersPanel
          documentId={detail.id}
          members={detail.members}
          currentUserId={currentUserId}
          isOwner={isOwner}
        />
      </section>
    </div>
  );
}
