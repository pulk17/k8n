import type { NextConfig } from "next";
import path from "path";

const API_BACKEND = process.env.API_BACKEND_URL || "http://localhost:8080";

const nextConfig: NextConfig = {
  output: "standalone",

  // This app carries a stray lockfile alongside the monorepo root's, so Turbopack
  // cannot infer the workspace root on its own. It is the repo root: dependencies
  // are hoisted there by npm workspaces.
  turbopack: {
    root: path.resolve(__dirname, "../.."),
  },

  async rewrites() {
    return [
      {
        source: "/health",
        destination: `${API_BACKEND}/health`,
      },
      // The browser always calls the Next.js origin; requests are proxied to the
      // Go API from here. That keeps everything same-origin, so CORS never
      // applies in the normal setup.
      {
        source: "/api/:path*",
        destination: `${API_BACKEND}/api/:path*`,
      },
      {
        source: "/mcp/:path*",
        destination: `${API_BACKEND}/mcp/:path*`,
      },
    ];
  },
};

export default nextConfig;
