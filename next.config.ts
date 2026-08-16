import { withSerwist } from "@serwist/turbopack";
import type { NextConfig } from "next";

const basePath = process.env.IS_DEMO === "1" ? "/demo" : "";

const nextConfig: NextConfig = {
  output: "standalone",
  ...(basePath
    ? {
        assetPrefix: "/demo-assets",
        basePath,
        redirects: async () => [
          {
            basePath: false,
            destination: basePath,
            permanent: false,
            source: "/",
          },
        ],
      }
    : {}),
  devIndicators: false,
  // Allow the dev server to be used from LAN devices (e.g. the phone at
  // 192.168.1.7). Next 16 blocks cross-origin dev resources (including the
  // HMR websocket) by default — without this the page serves SSR-only HTML
  // and never hydrates, so login never appears. Update when the device IP
  // changes.
  allowedDevOrigins: ["192.168.1.7"],
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
  experimental: {
    appNewScrollHandler: true,
    inlineCss: true,
    prefetchInlining: true,
    turbopackFileSystemCacheForDev: true,
  },
  logging: {
    fetches: {
      fullUrl: false,
    },
    incomingRequests: false,
  },
  poweredByHeader: false,
  reactCompiler: true,
};

export default withSerwist(nextConfig);
