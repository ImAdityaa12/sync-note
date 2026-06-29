import type { ReactNode } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";

import { Logo } from "@/components/logo";
import { SiteFooter } from "@/components/site-footer";
import { ThemeToggle } from "@/components/theme-toggle";
import { UserAvatar } from "@/components/user-avatar";
import { auth } from "@/lib/auth";
import { SignOutButton } from "@/modules/auth/ui/components/sign-out-button";

/**
 * Shared chrome + authoritative auth guard for every dashboard route
 * (`/dashboard`, `/documents/[id]`, …). The proxy does an optimistic cookie
 * gate; this is the real session check against the store.
 */
export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  const { user } = session;

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <header className="flex h-16 items-center justify-between border-b px-6">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 font-medium tracking-tight"
        >
          <Logo />
          sync-note
        </Link>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <SignOutButton />
          <UserAvatar name={user.name} image={user.image} className="size-8" />
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
        {children}
      </main>

      <SiteFooter />
    </div>
  );
}
