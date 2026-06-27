interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Minimal fixed-window rate limiter.
 *
 * In-memory and therefore per-instance — fine for a single server and enough to
 * demonstrate the control; a multi-instance deployment would back this with
 * Redis/Upstash. Opportunistically prunes expired buckets to bound memory.
 */
const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  ok: boolean;
  /** Seconds until the window resets (0 when allowed). */
  retryAfter: number;
}

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): RateLimitResult {
  const now = Date.now();
  let bucket = buckets.get(key);

  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
  }
  bucket.count++;

  if (buckets.size > 5000) {
    for (const [k, v] of buckets) if (now >= v.resetAt) buckets.delete(k);
  }

  const ok = bucket.count <= limit;
  return { ok, retryAfter: ok ? 0 : Math.ceil((bucket.resetAt - now) / 1000) };
}
