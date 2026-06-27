import { Suspense } from "react";

import { getEnabledSocialProviders } from "@/lib/social-providers";
import { AuthForm } from "@/modules/auth/ui/components/auth-form";
import { AuthFormSkeleton } from "@/modules/auth/ui/components/auth-form-skeleton";

export function SignInView() {
  // Server-only: which OAuth providers actually have credentials configured.
  const socialProviders = getEnabledSocialProviders();

  return (
    <Suspense fallback={<AuthFormSkeleton mode="sign-in" />}>
      <AuthForm mode="sign-in" socialProviders={socialProviders} />
    </Suspense>
  );
}
