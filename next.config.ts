import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Transport-level "reject before allocating" guard for Server Actions (the
    // version-save path). Next streams and rejects bodies over this limit before
    // the action runs, bounding memory regardless of the in-action zod cap.
    // Pinned (matches the current default) so a future default change can't
    // silently widen it. Comfortably above the 512 KB snapshot content cap.
    serverActions: { bodySizeLimit: "1mb" },
  },
  images: {
    remotePatterns: [
      // OAuth avatar sources.
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      { protocol: "https", hostname: "avatars.githubusercontent.com" },
    ],
  },
};

export default nextConfig;
