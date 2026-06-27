import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/modules/documents/server/membership";
import { listDocumentsForUser } from "@/modules/documents/server/queries";
import { DocumentsView } from "@/modules/documents/ui/views/documents-view";

export const metadata: Metadata = {
  title: "Your documents — sync-note",
};

export default async function DashboardPage() {
  // Layout already guards the session; re-read for the user id (cookie-cached).
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  const documents = await listDocumentsForUser(user.id);
  return <DocumentsView documents={documents} />;
}
