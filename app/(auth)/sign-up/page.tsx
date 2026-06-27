import { Suspense } from "react";
import type { Metadata } from "next";

import { AuthForm } from "@/components/auth/auth-form";
import { AuthFormSkeleton } from "@/components/auth/auth-form-skeleton";
import { getEnabledSocialProviders } from "@/lib/social-providers";

export const metadata: Metadata = {
  title: "Create your account — sync-note",
};

export default function SignUpPage() {
  const socialProviders = getEnabledSocialProviders();
  return (
    <Suspense fallback={<AuthFormSkeleton mode="sign-up" />}>
      <AuthForm mode="sign-up" socialProviders={socialProviders} />
    </Suspense>
  );
}
