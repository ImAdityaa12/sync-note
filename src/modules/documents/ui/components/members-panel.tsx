"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { UserAvatar } from "@/components/user-avatar";
import {
  changeMemberRole,
  removeMember,
} from "@/modules/documents/server/actions";
import type { DocumentMemberInfo } from "@/modules/documents/types";

import { RoleBadge } from "./role-badge";

export function MembersPanel({
  documentId,
  members,
  currentUserId,
  isOwner,
}: {
  documentId: string;
  members: DocumentMemberInfo[];
  currentUserId: string;
  isOwner: boolean;
}) {
  // Owner first, then alphabetical-ish by name as returned.
  const ordered = [...members].sort((a, b) =>
    a.role === "owner" ? -1 : b.role === "owner" ? 1 : 0
  );

  return (
    <ul className="divide-y rounded-xl border">
      {ordered.map((member) => (
        <MemberRow
          key={member.userId}
          documentId={documentId}
          member={member}
          isSelf={member.userId === currentUserId}
          canManage={isOwner && member.role !== "owner"}
        />
      ))}
    </ul>
  );
}

function MemberRow({
  documentId,
  member,
  isSelf,
  canManage,
}: {
  documentId: string;
  member: DocumentMemberInfo;
  isSelf: boolean;
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onRoleChange(role: string) {
    startTransition(async () => {
      const result = await changeMemberRole({
        documentId,
        userId: member.userId,
        role: role as "editor" | "viewer",
      });
      if (result.ok) router.refresh();
    });
  }

  function onRemove() {
    startTransition(async () => {
      const result = await removeMember({ documentId, userId: member.userId });
      if (result.ok) router.refresh();
    });
  }

  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <UserAvatar
        name={member.name}
        image={member.image}
        className="size-9"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {member.name}
          {isSelf && (
            <span className="ml-1 text-muted-foreground">(you)</span>
          )}
        </p>
        <p className="truncate text-xs text-muted-foreground">{member.email}</p>
      </div>

      {canManage ? (
        <div className="flex items-center gap-1">
          <Select
            value={member.role}
            onValueChange={onRoleChange}
            disabled={pending}
          >
            <SelectTrigger size="sm" className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="editor">Editor</SelectItem>
              <SelectItem value="viewer">Viewer</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground"
            onClick={onRemove}
            disabled={pending}
            aria-label={`Remove ${member.name}`}
          >
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <X className="size-4" />
            )}
          </Button>
        </div>
      ) : (
        <RoleBadge role={member.role} />
      )}
    </li>
  );
}
