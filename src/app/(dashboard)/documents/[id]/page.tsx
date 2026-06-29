import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { getCurrentUser } from "@/modules/documents/server/membership";
import { getDocumentDetail } from "@/modules/documents/server/queries";
import { DocumentDetailView } from "@/modules/documents/ui/views/document-detail-view";

export const metadata: Metadata = {
  title: "Document — sync-note",
};

export default async function DocumentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  // Non-members get an indistinguishable 404 (no existence leak).
  const detail = await getDocumentDetail(id, user.id);
  if (!detail) notFound();

  return <DocumentDetailView detail={detail} currentUserId={user.id} />;
}
