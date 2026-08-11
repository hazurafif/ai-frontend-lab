// Auth proxy route.
//
// Forwards GET /api/auth/me to the backend's /users/me/ endpoint. The
// client attaches the Bearer token; this route passes it through so the
// backend can validate it.

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8787";

export async function GET(request: Request) {
  const target = new URL("/users/me/", BACKEND_URL);

  const headers = new Headers(request.headers);
  headers.delete("host");

  let upstream: Response;
  try {
    upstream = await fetch(target, { headers });
  } catch {
    return Response.json(
      { code: "offline:auth", message: "Auth backend unreachable." },
      { status: 503 },
    );
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: upstream.headers,
  });
}
