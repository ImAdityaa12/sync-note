import type { Metadata } from "next";

import { SignInView } from "@/modules/auth/ui/views/sign-in-view";

export const metadata: Metadata = {
  title: "Sign in — sync-note",
};

export default function SignInPage() {
  return <SignInView />;
}
