"use client";

import { useLayoutEffect, useState, type RefObject } from "react";

import type { Peer } from "@/lib/realtime/protocol";
import { caretRectAt, type CaretRect } from "@/modules/editor/lib/caret";

interface Placed {
  peer: Peer;
  rect: CaretRect;
}

/**
 * Overlays remote collaborators' carets onto the editor, positioned by measuring
 * each peer's string offset against the live textarea. Re-measures when peers or
 * content change and follows scroll/resize. Purely presentational — it never
 * blocks input (`pointer-events-none`).
 */
export function RemoteCursors({
  peers,
  textareaRef,
  content,
}: {
  peers: Peer[];
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  content: string;
}) {
  const [placed, setPlaced] = useState<Placed[]>([]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    const withCursor = peers.filter((p) => p.cursor);
    if (!textarea || withCursor.length === 0) {
      setPlaced([]);
      return;
    }

    const measure = () => {
      const max = textarea.value.length;
      setPlaced(
        withCursor.map((peer) => {
          const head = Math.min(Math.max(peer.cursor!.head, 0), max);
          return { peer, rect: caretRectAt(textarea, head) };
        })
      );
    };

    measure();
    textarea.addEventListener("scroll", measure);
    window.addEventListener("resize", measure);
    return () => {
      textarea.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
    // `content` re-measures after the text (and thus offsets) shift.
  }, [peers, content, textareaRef]);

  if (placed.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {placed.map(({ peer, rect }) => {
        const labelBelow = rect.top < 16;
        return (
          <div
            key={peer.site}
            className="absolute left-0 top-0"
            style={{ transform: `translate(${rect.left}px, ${rect.top}px)` }}
          >
            <div
              className="w-px rounded-full"
              style={{ height: rect.height, backgroundColor: peer.color }}
            />
            <span
              className="absolute left-0 whitespace-nowrap rounded px-1 py-px text-[10px] font-medium leading-none text-white shadow-sm"
              style={{
                backgroundColor: peer.color,
                top: labelBelow ? rect.height + 2 : -14,
              }}
            >
              {peer.name}
            </span>
          </div>
        );
      })}
    </div>
  );
}
