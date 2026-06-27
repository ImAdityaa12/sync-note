import Link from "next/link";
import { FilePlus2 } from "lucide-react";

import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { SiteFooter } from "@/components/site-footer";
import { UserAvatar } from "@/components/user-avatar";
import { SignOutButton } from "@/modules/auth/ui/components/sign-out-button";

type DashboardViewProps = {
  user: {
    name: string;
    email: string;
    image?: string | null;
  };
};

export function DashboardView({ user }: DashboardViewProps) {
  const firstName = user.name?.split(" ")[0] || "there";

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
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <SignOutButton />
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-12">
        <div className="flex items-center gap-4">
          <UserAvatar name={user.name} image={user.image} />
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold tracking-tight">
              Welcome, {firstName}
            </h1>
            <p className="truncate text-sm text-muted-foreground">
              {user.email}
            </p>
          </div>
        </div>

        {/* Empty state — the document store and editor land in the next milestone */}
        <section className="mt-10 flex flex-col items-center rounded-xl border border-dashed px-6 py-16 text-center">
          <span className="inline-flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <FilePlus2 className="size-5" strokeWidth={1.75} />
          </span>
          <h2 className="mt-4 text-lg font-medium">No documents yet</h2>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            Authentication is wired up. The local-first document store, sync
            engine, and version history are the next milestone.
          </p>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
