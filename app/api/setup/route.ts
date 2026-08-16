// Setup / onboarding proxy route.
//
// Forwards /api/setup to the backend's /users/me/setup (GET — the user's
// setup state: admin-managed llm connection, effective model, the user's
// own MCP servers + preferences) and /users/me/onboarding (POST — one-shot
// per-user setup: preferences + MCP tool servers, idempotent upserts).
//
// Configure in .env.local:
//   BACKEND_URL="http://localhost:8000"

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8787";

export async function GET(request: Request) {
  return forward(request, "/users/me/setup");
}

export async function POST(request: Request) {
  return forward(request, "/users/me/onboarding");
}

async function forward(request: Request, path: string) {
  const target = new URL(path, BACKEND_URL);

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
      { code: "offline:setup", message: "Backend unreachable." },
      { status: 503 },
    );
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: upstream.headers,
  });
}
