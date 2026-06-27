/**
 * Single source of truth for which OAuth providers are actually configured.
 *
 * Credentials live in non-public env vars, so this can only be read on the
 * server. Pages compute the enabled list and pass it down to the auth UI, so we
 * never render a sign-in button for a provider that has no credentials (which
 * would fail at the provider with an opaque error).
 */
export type SocialProvider = "google" | "github";

export function getEnabledSocialProviders(): SocialProvider[] {
  const enabled: SocialProvider[] = [];
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    enabled.push("google");
  }
  if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
    enabled.push("github");
  }
  return enabled;
}
