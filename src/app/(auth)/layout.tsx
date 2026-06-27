import Link from "next/link";
import { History, RefreshCw, WifiOff } from "lucide-react";

import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { SiteFooter } from "@/components/site-footer";

const HIGHLIGHTS = [
  { icon: WifiOff, label: "Edit fully offline, zero network latency" },
  { icon: RefreshCw, label: "Background sync that never drops your work" },
  { icon: History, label: "Time-travel through every version" },
];

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="grid min-h-[100dvh] lg:grid-cols-[1.05fr_1fr]">
      {/* Brand panel — hidden below lg, single theme (dark) by design intent */}
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-zinc-950 p-10 text-zinc-50 lg:flex">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.05] [background-image:linear-gradient(to_right,white_1px,transparent_1px),linear-gradient(to_bottom,white_1px,transparent_1px)] [background-size:40px_40px]"
        />
        <div className="relative">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm font-medium tracking-tight"
          >
            <Logo />
            sync-note
          </Link>
        </div>

        <div className="relative max-w-md space-y-8">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight">
            Write offline. Sync without losing a keystroke.
          </h2>
          <ul className="space-y-4">
            {HIGHLIGHTS.map(({ icon: Icon, label }) => (
              <li key={label} className="flex items-center gap-3 text-zinc-300">
                <span className="inline-flex size-9 items-center justify-center rounded-lg border border-white/10 bg-white/5">
                  <Icon className="size-4" strokeWidth={1.75} />
                </span>
                <span className="text-sm">{label}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-zinc-500">
          Your documents live on your device first and sync in the background.
        </p>
      </aside>

      {/* Form column */}
      <div className="flex flex-col">
        <div className="flex items-center justify-between px-6 pt-6">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm font-medium tracking-tight lg:invisible"
          >
            <Logo />
            sync-note
          </Link>
          <ThemeToggle />
        </div>

        <main className="flex flex-1 items-center justify-center px-6 py-12">
          <div className="w-full max-w-sm">{children}</div>
        </main>

        <SiteFooter />
      </div>
    </div>
  );
}
