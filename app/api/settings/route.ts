// App settings proxy route.
//
// Forwards /api/settings to the backend's /settings endpoints (admin-only):
// GET reads the effective runtime settings (execute tool, connection
// policy) with their source (db | env); PUT persists a partial update to
// the app_settings store. Mutations take effect on the next run — no
// restart needed (the backend rebuilds its agent graphs immediately).
//
// Configure in .env.local:
//   BACKEND_URL="http://localhost:8000"

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8787";

export async function GET(request: Request) {
  return forward(request);
}

export async function PUT(request: Request) {
  return forward(request);
}

async function forward(request: Request) {
  const target = new URL("/settings", BACKEND_URL);

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
      { code: "offline:settings", message: "Backend unreachable." },
      { status: 503 },
    );
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: upstream.headers,
  });
}
