import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { SiteFooter } from "@/components/site-footer";

export default function Home() {
  return (
    <div className="flex min-h-[100dvh] flex-col">
      <header className="flex h-16 items-center justify-between px-6">
        <Link
          href="/"
          className="inline-flex items-center gap-2 font-medium tracking-tight"
        >
          <Logo />
          sync-note
        </Link>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Button asChild variant="ghost" size="sm">
            <Link href="/sign-in">Sign in</Link>
          </Button>
        </div>
      </header>

      <main className="flex flex-1 items-center px-6">
        <div className="mx-auto w-full max-w-5xl py-20">
          <div className="max-w-2xl space-y-7">
            <span className="inline-flex items-center rounded-full border px-3 py-1 text-xs text-muted-foreground">
              Local-first collaborative editor
            </span>
            <h1 className="text-4xl font-semibold tracking-tight md:text-6xl">
              Documents that work offline and sync themselves.
            </h1>
            <p className="max-w-xl text-lg leading-relaxed text-muted-foreground">
              Open, edit, and close without waiting on the network. Changes merge
              cleanly and every version is one click away.
            </p>
            <div className="pt-1">
              <Button asChild size="lg">
                <Link href="/sign-up">
                  Get started
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
