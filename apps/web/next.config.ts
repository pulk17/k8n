import type { NextConfig } from "next";
import path from "path";

const API_BACKEND = process.env.API_BACKEND_URL || "http://localhost:8080";

// K8N_EXPORT=1 builds plain static files for the Go binary to embed and serve
// itself. The page is then the same origin as the API, so the rewrites below
// are unnecessary — and a static export cannot have them.
const EXPORT = !!process.env.K8N_EXPORT;

const nextConfig: NextConfig = {
  output: EXPORT ? "export" : "standalone",
  // canvas/index.html rather than canvas.html, which a plain file server resolves.
  trailingSlash: EXPORT,

  // This app carries a stray lockfile alongside the monorepo root's, so Turbopack
  // cannot infer the workspace root on its own. It is the repo root: dependencies
  // are hoisted there by npm workspaces.
  turbopack: {
    root: path.resolve(__dirname, "../.."),
  },

  rewrites: EXPORT ? undefined : async () => {
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
