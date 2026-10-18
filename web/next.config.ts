import type { NextConfig } from "next";

/**
 * Static export for Capacitor Android packaging (`out/`).
 * Playwright / local UI use `next dev` (not this export).
 */
const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  // Helps Android WebView resolve nested asset paths reliably
  trailingSlash: true,
};

export default nextConfig;
