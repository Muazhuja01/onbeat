import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cross-origin isolation lets the in-browser models (voice and captions) use several
  // processor threads instead of one. Models download from Hugging Face, which allows it;
  // "credentialless" keeps those downloads working without them sending a CORP header.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
        ],
      },
    ];
  },
};

export default nextConfig;
