// Vite configuration — replaces next.config.ts + the Next route-handler
// proxy layer. See docs/migration.md for the path-mapping source of truth.

import { fileURLToPath } from "node:url";
import { serwist } from "@serwist/vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type ProxyOptions } from "vite";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8000";
const BACKEND_CHAT_PATH = process.env.BACKEND_CHAT_PATH ?? "/api/chat";
const BASE_PATH = process.env.VITE_BASE_PATH ?? "";

/**
 * Mirrors the old Next.js route handlers' backend targets (docs/migration.md
 * table). The client keeps talking to same-origin `/api/*`; only this path
 * changes in dev. Production uses the identical table in nginx.conf.
 */
function rewriteApiPath(pathname: string): string {
  // Chat (threads/notifications must sort before plain /api/chat).
  if (pathname.startsWith("/api/chat/threads")) {
    return pathname.slice("/api/chat".length);
  }
  if (pathname.startsWith("/api/chat/notifications")) {
    return pathname.slice("/api/chat".length);
  }
  if (pathname === "/api/chat") {
    return BACKEND_CHAT_PATH;
  }
  // Auth root paths.
  if (pathname.startsWith("/api/auth/login")) return "/login";
  if (pathname.startsWith("/api/auth/refresh")) return "/refresh";
  if (pathname.startsWith("/api/auth/register")) return "/register";
  if (pathname.startsWith("/api/auth/me")) return "/users/me";
  if (pathname.startsWith("/api/auth/users")) {
    return pathname.slice("/api/auth".length);
  }
  if (pathname.startsWith("/api/auth/allowed-models")) return "/allowed-models";
  // Share: /api/share/shared/<token> is public; /api/share/<id> owner-only.
  if (pathname.startsWith("/api/share")) {
    const suffix = pathname.slice("/api/share".length);
    return suffix.startsWith("/shared/")
      ? suffix
      : `/threads/${suffix.replace(/^\//, "")}/share`;
  }
  // Preferences + setup (GET maps to /users/me/setup; the POST variant is
  // fixed in the proxyReq hook below — /users/me/onboarding).
  if (pathname.startsWith("/api/preferences")) {
    return "/users/me/preferences";
  }
  if (pathname.startsWith("/api/setup")) {
    return "/users/me/setup";
  }
  // Everything else under /api/* maps 1:1 minus the prefix (/agent,
  // /agents, /skills, /knowledge, /mcp, /connections, /settings, /health).
  if (pathname.startsWith("/api/")) {
    return pathname.slice("/api".length);
  }
  return pathname;
}

const backendProxy: ProxyOptions = {
  target: BACKEND_URL,
  changeOrigin: true,
  // SSE (chat stream, notification stream) must pass through untouched —
  // http-proxy does not buffer by default.
  rewrite: rewriteApiPath,
  configure(proxy) {
    proxy.on("proxyReq", (proxyReq, req) => {
      // POST /api/setup → backend /users/me/onboarding (the Next route
      // split GET/POST across two targets). Note: Vite mutates req.url to
      // the REWRITTEN path before proxyReq fires, so test for the target.
      if (req.method === "POST" && req.url?.startsWith("/users/me/setup")) {
        proxyReq.path = "/users/me/onboarding";
      }
    });
    // Backend down → 503 with the same shape the old routes returned.
    proxy.on("error", (err, _req, res) => {
      const isResponse = "writeHead" in res;
      if (!isResponse) {
        console.error("[vite-proxy] websocket error:", err.message);
        return;
      }
      res.writeHead(503, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          code: "offline:proxy",
          message: `Backend unreachable (${BACKEND_URL}).`,
        }),
      );
      console.error("[vite-proxy]", err.message);
    });
  },
};

export default defineConfig({
  base: BASE_PATH ? `/${BASE_PATH.replace(/^\/+|\/+$/g, "")}/` : "/",
  plugins: [
    react(),
    tailwindcss(),
    serwist({
      swSrc: "sw.ts",
      swDest: "sw.js",
      globDirectory: "dist",
      globPatterns: ["**/*.{js,css,html,woff2,svg,png,ico,webmanifest}"],
      // streamdown / tokenlens / mermaid all ship large chunks.
      maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
      disable: false,
    }),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  server: {
    // Keep the old Next dev-server entry points alive under Vite.
    port: 3000,
    strictPort: true,
    proxy: {
      "/api": backendProxy,
    },
  },
  preview: {
    port: 3000,
    strictPort: true,
    // `vite preview` does not inherit `server.proxy` — mirror the dev proxy
    // so `pnpm build && pnpm start` works standalone.
    proxy: {
      "/api": backendProxy,
    },
  },
  build: {
    // Chat UI ships a lot of editor/token-lens surface — keep chunks
    // human-scaled for first paint.
    chunkSizeWarningLimit: 900,
  },
});
