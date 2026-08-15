import { spawnSync } from "node:child_process";
import { createSerwistRoute } from "@serwist/turbopack";
import type { NextRequest } from "next/server";

// A revision helps Serwist version the precached offline page, so outdated
// cached responses are never served.
const revision =
  spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf-8" }).stdout ??
  crypto.randomUUID();

const serwistRoute = createSerwistRoute({
  additionalPrecacheEntries: [{ url: "/~offline", revision }],
  swSrc: "app/sw.ts",
  // If set to `false`, Serwist will attempt to use `esbuild-wasm`.
  useNativeEsbuild: true,
});

export const { dynamic, dynamicParams, revalidate } = serwistRoute;

// Next 16 requires catch-all params to be arrays; Serwist emits strings.
// The runtime handles both — path.join flattens segments.
export const generateStaticParams = async () => {
  const params = await serwistRoute.generateStaticParams();
  return params.map((param) => ({ path: [param.path] }));
};

// Next 16 types catch-all route params as string[] (and passes arrays at
// runtime); Serwist's own types declare string and call path.extname on
// the segment — unwrap the first segment here.
export const GET = async (
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<Response> => {
  const { path } = await context.params;
  return serwistRoute.GET(request, {
    params: Promise.resolve({ path: path[0] ?? "" }),
  });
};
