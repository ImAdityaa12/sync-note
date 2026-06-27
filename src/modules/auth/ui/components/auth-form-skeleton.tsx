// Skeleton that mirrors the AuthForm layout (Suspense fallback while the
// client form hydrates). Shape-matched, not a generic spinner.
export function AuthFormSkeleton({ mode }: { mode: "sign-in" | "sign-up" }) {
  const isSignUp = mode === "sign-up";
  return (
    <div className="space-y-6" aria-hidden="true">
      <div className="space-y-2">
        <div className="h-7 w-40 animate-pulse rounded-md bg-muted" />
        <div className="h-4 w-56 animate-pulse rounded-md bg-muted" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="h-9 animate-pulse rounded-lg bg-muted" />
        <div className="h-9 animate-pulse rounded-lg bg-muted" />
      </div>
      <div className="h-px w-full bg-border" />
      <div className="space-y-4">
        {isSignUp && <div className="h-10 animate-pulse rounded-lg bg-muted" />}
        <div className="h-10 animate-pulse rounded-lg bg-muted" />
        <div className="h-10 animate-pulse rounded-lg bg-muted" />
        <div className="h-9 animate-pulse rounded-lg bg-muted" />
      </div>
    </div>
  );
}
