// Knowledge base proxy route.
//
// Forwards /api/kb/* to the backend's /kb/* endpoints (per-user KB CRUD,
// document upload + ingest, reindex, search) so the settings page can manage
// RAG documents against the live backend. Unlike the /api/agent proxy, KB
// routes are owner-scoped (get_current_user), not admin-only.
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

export async function PATCH(request: Request) {
  return forward(request);
}

export async function DELETE(request: Request) {
  return forward(request);
}

async function forward(request: Request) {
  // Map /api/kb/foo -> /kb/foo (strip the /api prefix).
  const target = new URL(
    new URL(request.url).pathname.replace(/^\/api/, ""),
    BACKEND_URL,
  );
  target.search = new URL(request.url).search;

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
      { code: "offline:kb", message: "Knowledge base backend unreachable." },
      { status: 503 },
    );
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: upstream.headers,
  });
}
