// User preferences proxy route.
//
// Forwards /api/preferences to the backend's /users/me/preferences
// endpoints: GET returns the effective per-user preference
// (`{enable_search: boolean | null}` — stored value, else the server
// SEARXNG_ENABLED default), PATCH stores it (`{"enable_search": true}`
// or `null` to clear and revert to the server default).
//
// Configure in .env.local:
//   BACKEND_URL="http://localhost:8000"

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8787";

export async function GET(request: Request) {
  return forward(request);
}

export async function PATCH(request: Request) {
  return forward(request);
}

async function forward(request: Request) {
  const target = new URL("/users/me/preferences", BACKEND_URL);

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
      { code: "offline:preferences", message: "Backend unreachable." },
      { status: 503 },
    );
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: upstream.headers,
  });
}
