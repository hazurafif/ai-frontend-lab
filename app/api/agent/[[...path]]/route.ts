// Agent resources proxy route.
//
// Forwards /api/agent/* to the backend's /agent/* endpoints (skills + MCP
// tool server CRUD, reconnect) so the settings page can read and write the
// live agent configuration instead of only local state.
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

export async function PUT(request: Request) {
  return forward(request);
}

export async function DELETE(request: Request) {
  return forward(request);
}

async function forward(request: Request) {
  // Map /api/agent/skills/foo -> /agent/skills/foo (strip the /api prefix).
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
      { code: "offline:agent", message: "Agent backend unreachable." },
      { status: 503 },
    );
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: upstream.headers,
  });
}
