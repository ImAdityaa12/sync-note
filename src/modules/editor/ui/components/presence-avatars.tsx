"use client";

import type { Peer } from "@/lib/realtime/protocol";

const MAX_SHOWN = 4;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Stacked avatars of the other people live in this document right now. Each
 * avatar wears the collaborator's presence colour, matching their remote cursor.
 */
export function PresenceAvatars({ peers }: { peers: Peer[] }) {
  if (peers.length === 0) return null;

  const shown = peers.slice(0, MAX_SHOWN);
  const extra = peers.length - shown.length;

  return (
    <div className="flex items-center -space-x-1.5">
      {shown.map((peer) => (
        <span
          key={peer.site}
          title={peer.name}
          style={{ backgroundColor: peer.color }}
          className="grid size-6 place-items-center rounded-full text-[10px] font-semibold text-white ring-2 ring-background"
        >
          {initials(peer.name)}
        </span>
      ))}
      {extra > 0 && (
        <span className="grid size-6 place-items-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground ring-2 ring-background">
          +{extra}
        </span>
      )}
    </div>
  );
}
