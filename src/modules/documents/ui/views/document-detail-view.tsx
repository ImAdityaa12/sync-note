import Link from "next/link";
import { ArrowLeft, PenLine } from "lucide-react";

import type { DocumentDetail } from "@/modules/documents/types";
import { DocumentTitle } from "@/modules/documents/ui/components/document-title";
import { MembersPanel } from "@/modules/documents/ui/components/members-panel";
import { RoleBadge } from "@/modules/documents/ui/components/role-badge";
import { ShareDialog } from "@/modules/documents/ui/components/share-dialog";

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

      {/* Editor surface — the local-first markdown editor lands in Phase B. */}
      <section className="flex flex-col items-center rounded-xl border border-dashed px-6 py-16 text-center">
        <span className="inline-flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <PenLine className="size-5" strokeWidth={1.75} />
        </span>
        <h2 className="mt-4 text-lg font-medium">Editor coming next</h2>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">
          The local-first markdown editor, offline sync, and version history are
          the next milestone. Access and roles for this document are wired up.
        </p>
      </section>

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
