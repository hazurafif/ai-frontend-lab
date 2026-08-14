// Connections proxy route.
//
// Forwards /api/connections to the backend's /connections endpoints
// (admin-only): GET lists the saved provider connections (llm, embeddings,
// mcp, weaviate, searxng) with masked tokens; POST creates one. The backend
// resolves the default connection per kind — mutations refresh its cache
// and drop cached agent graphs, so they apply on the next run.
//
// Configure in .env.local:
//   BACKEND_URL="http://localhost:8000"

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8787";

export async function GET(request: Request) {
  return forward(request);
}

export async function POST(request: Request) {
  return forward(request);
}

async function forward(request: Request) {
  const target = new URL("/connections", BACKEND_URL);

  const headers = new Headers(request.headers);
  headers.delete("host");

  const init: RequestInit = {
    method: request.method,
    headers,
    body:
      request.method === "GET" || request.method === "HEAD"
        ? undefined
        : request.body,
  };

  let upstream: Response;
  try {
    upstream = await fetch(target, { ...init, duplex: "half" } as RequestInit);
  } catch {
    return Response.json(
      { code: "offline:connections", message: "Backend unreachable." },
      { status: 503 },
    );
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: upstream.headers,
  });
}
