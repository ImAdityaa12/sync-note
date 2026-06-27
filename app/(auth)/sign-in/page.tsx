import { Suspense } from "react";
import type { Metadata } from "next";

import { AuthForm } from "@/components/auth/auth-form";
import { AuthFormSkeleton } from "@/components/auth/auth-form-skeleton";
import { getEnabledSocialProviders } from "@/lib/social-providers";

export const metadata: Metadata = {
  title: "Sign in — sync-note",
};

export default function SignInPage() {
  const socialProviders = getEnabledSocialProviders();
  return (
    <Suspense fallback={<AuthFormSkeleton mode="sign-in" />}>
      <AuthForm mode="sign-in" socialProviders={socialProviders} />
    </Suspense>
  );
}
