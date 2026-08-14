// MCP apps tools/call proxy route.
//
// Forwards /api/mcp/* to the backend's /mcp/* endpoints (prefab app tool
// calls: POST /mcp/tools/call). The chat host (components/ai-elements/
// prefab-app.tsx) forwards renderer `tools/call` messages here so interactive
// FastMCP prefab apps can reach their server tools through the backend —
// auth headers never leave the backend process.
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
  // Map /api/mcp/tools/call -> /mcp/tools/call (strip the /api prefix).
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
      { code: "offline:mcp", message: "MCP backend unreachable." },
      { status: 503 },
    );
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: upstream.headers,
  });
}
