// Auth proxy route.
//
// Forwards POST /api/auth/login to the backend's /login endpoint
// (OAuth2 password form: application/x-www-form-urlencoded username +
// password). Returns the backend response unchanged so the client can
// distinguish 401 (bad credentials) from other failures.

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8787";

export async function POST(request: Request) {
  const target = new URL("/login", BACKEND_URL);

  const headers = new Headers(request.headers);
  headers.delete("host");

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: "POST",
      headers,
      body: request.body,
      duplex: "half",
    } as RequestInit);
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
