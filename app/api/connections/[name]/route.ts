// Connections item proxy route.
//
// Forwards /api/connections/{name} to the backend's /connections/{name}
// endpoints (admin-only): GET one connection, PUT full replace (an omitted
// api_token keeps the stored token), DELETE remove. Mutations refresh the
// backend's resolved-connection cache and drop cached agent graphs.

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8787";

export async function GET(
  request: Request,
  ctx: { params: Promise<{ name: string }> },
) {
  return forward(request, ctx);
}

export async function PUT(
  request: Request,
  ctx: { params: Promise<{ name: string }> },
) {
  return forward(request, ctx);
}

export async function DELETE(
  request: Request,
  ctx: { params: Promise<{ name: string }> },
) {
  return forward(request, ctx);
}

async function forward(
  request: Request,
  ctx: { params: Promise<{ name: string }> },
) {
  const { name } = await ctx.params;
  const target = new URL(
    `/connections/${encodeURIComponent(name)}`,
    BACKEND_URL,
  );

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
