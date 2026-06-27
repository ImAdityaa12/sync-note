import type { Op } from "@/lib/crdt/codec";

export class SyncError extends Error {
  constructor(readonly status: number) {
    super(`sync request failed (${status})`);
  }
}

export interface PushResult {
  ok: boolean;
  latestSeq: number;
}

export interface PullResult {
  ops: Op[];
  latestSeq: number;
  hasMore: boolean;
}

/** Push a batch of local ops to the server (editors+ only; viewers get 403). */
export async function pushOps(docId: string, ops: Op[]): Promise<PushResult> {
  const res = await fetch(`/api/documents/${docId}/ops`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ops }),
  });
  if (!res.ok) throw new SyncError(res.status);
  return res.json();
}

/** Pull ops with `seq > since`. */
export async function pullOps(
  docId: string,
  since: number
): Promise<PullResult> {
  const res = await fetch(
    `/api/documents/${docId}/ops?since=${encodeURIComponent(since)}`
  );
  if (!res.ok) throw new SyncError(res.status);
  return res.json();
}
