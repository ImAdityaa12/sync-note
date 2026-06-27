import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { auth } from "@/lib/auth";
import { DashboardView } from "@/modules/dashboard/ui/views/dashboard-view";

export const metadata: Metadata = {
  title: "Dashboard — sync-note",
};

export default async function DashboardPage() {
  // Authoritative server-side check. The proxy only does an optimistic cookie
  // gate; this is the real validation against the session store.
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    redirect("/sign-in");
  }

  return <DashboardView user={session.user} />;
}
