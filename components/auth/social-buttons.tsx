"use client";

import * as React from "react";

import { authClient } from "@/lib/auth-client";
import type { SocialProvider } from "@/lib/social-providers";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { GitHubIcon, GoogleIcon } from "@/components/auth/provider-icons";

const PROVIDER_META: Record<
  SocialProvider,
  { label: string; Icon: typeof GoogleIcon }
> = {
  google: { label: "Google", Icon: GoogleIcon },
  github: { label: "GitHub", Icon: GitHubIcon },
};

type Props = {
  providers: SocialProvider[];
  pending: boolean;
  setPending: (value: boolean) => void;
  setError: (value: string | null) => void;
  redirectTo: string;
};

export function SocialButtons({
  providers,
  pending,
  setPending,
  setError,
  redirectTo,
}: Props) {
  const [active, setActive] = React.useState<SocialProvider | null>(null);

  async function signInWith(provider: SocialProvider) {
    setError(null);
    setPending(true);
    setActive(provider);
    try {
      // Full-page redirect to the provider; on success the browser navigates
      // away, so there is no success branch to handle here.
      await authClient.signIn.social({ provider, callbackURL: redirectTo });
    } catch {
      setError("Could not start sign-in with that provider. Please try again.");
      setPending(false);
      setActive(null);
    }
  }

  if (providers.length === 0) {
    return null;
  }

  return (
    <div
      className={cn(
        "grid gap-3",
        providers.length === 1 ? "grid-cols-1" : "grid-cols-2"
      )}
    >
      {providers.map((provider) => {
        const { label, Icon } = PROVIDER_META[provider];
        return (
          <Button
            key={provider}
            type="button"
            variant="outline"
            size="lg"
            disabled={pending}
            data-loading={active === provider}
            onClick={() => signInWith(provider)}
          >
            <Icon className="size-4" />
            {label}
          </Button>
        );
      })}
    </div>
  );
}
