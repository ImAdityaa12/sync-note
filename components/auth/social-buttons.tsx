"use client";

import * as React from "react";

import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { GitHubIcon, GoogleIcon } from "@/components/auth/provider-icons";

type Provider = "google" | "github";

type Props = {
  pending: boolean;
  setPending: (value: boolean) => void;
  setError: (value: string | null) => void;
  redirectTo: string;
};

export function SocialButtons({
  pending,
  setPending,
  setError,
  redirectTo,
}: Props) {
  const [active, setActive] = React.useState<Provider | null>(null);

  async function signInWith(provider: Provider) {
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

  return (
    <div className="grid grid-cols-2 gap-3">
      <Button
        type="button"
        variant="outline"
        size="lg"
        disabled={pending}
        data-loading={active === "google"}
        onClick={() => signInWith("google")}
      >
        <GoogleIcon className="size-4" />
        Google
      </Button>
      <Button
        type="button"
        variant="outline"
        size="lg"
        disabled={pending}
        data-loading={active === "github"}
        onClick={() => signInWith("github")}
      >
        <GitHubIcon className="size-4" />
        GitHub
      </Button>
    </div>
  );
}
