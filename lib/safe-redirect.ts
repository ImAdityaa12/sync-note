/**
 * Restrict post-auth redirects to internal paths. Anything that isn't a single
 * leading-slash path — absolute URLs (`https://evil.com`) or protocol-relative
 * ones (`//evil.com`) — falls back to the default. This closes the open-redirect
 * vector opened by the `?redirect=` query param being passed to `router.push`
 * and to the OAuth `callbackURL`.
 */
export function safeInternalPath(
  path: string | null | undefined,
  fallback = "/dashboard"
): string {
  if (!path || !path.startsWith("/") || path.startsWith("//")) {
    return fallback;
  }
  return path;
}
