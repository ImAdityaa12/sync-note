import type { Metadata } from "next";

import { SignUpView } from "@/modules/auth/ui/views/sign-up-view";

export const metadata: Metadata = {
  title: "Create your account — sync-note",
};

export default function SignUpPage() {
  return <SignUpView />;
}
