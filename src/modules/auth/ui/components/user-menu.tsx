"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, LogOut } from "lucide-react";

import { UserAvatar } from "@/components/user-avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

/**
 * Avatar in the header that opens a profile card: identity (name, email,
 * verification state, member-since) plus the sign-out action. Sign-out lives
 * here now instead of as a standalone header button, so the chrome stays tidy.
 */
export function UserMenu({
  name,
  email,
  image,
  createdAt,
}: {
  name?: string | null;
  email?: string | null;
  image?: string | null;
  createdAt?: Date | string | null;
}) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);

  async function onSignOut() {
    setPending(true);
    await authClient.signOut();
    router.push("/sign-in");
    router.refresh();
  }

  const memberSince = formatMemberSince(createdAt);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Account menu"
        className="rounded-full outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <UserAvatar name={name} image={image} className="size-8" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="w-72">
        <div className="flex items-center gap-3 p-2">
          <UserAvatar name={name} image={image} className="size-10 shrink-0" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{name ?? "Your account"}</p>
            {email ? (
              <p className="truncate text-xs text-muted-foreground">{email}</p>
            ) : null}
          </div>
        </div>

        {memberSince ? (
          <div className="px-2 pb-2 text-xs text-muted-foreground">
            Member since {memberSince}
          </div>
        ) : null}

        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          disabled={pending}
          onSelect={(event) => {
            // Keep the menu logic in control of navigation; don't let the
            // default select-close race the async sign-out.
            event.preventDefault();
            void onSignOut();
          }}
        >
          {pending ? (
            <Loader2 className="animate-spin" />
          ) : (
            <LogOut />
          )}
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function formatMemberSince(value?: Date | string | null) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
  });
}
