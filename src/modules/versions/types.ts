/**
 * A saved snapshot's metadata as it appears in the timeline. The materialized
 * content is deliberately *not* here — the list query stays lean and the full
 * text is fetched on demand (preview / restore) by id.
 */
export type VersionSummary = {
  id: string;
  label: string | null;
  /** Server op cursor at capture — recorded for compaction/auditing. */
  uptoSeq: number;
  createdAt: Date;
  authorId: string;
  authorName: string;
  authorImage: string | null;
};

/** The materialized document stored in a snapshot's `state` JSONB. */
export type SnapshotState = {
  content: string;
};
