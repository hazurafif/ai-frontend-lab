// Health proxy route.
//
// Forwards GET /api/health to the backend's /health endpoint so the
// settings page can read the live backend state (model, searxng, ...).

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8787";

export async function GET() {
  let upstream: Response;
  try {
    upstream = await fetch(new URL("/health", BACKEND_URL));
  } catch {
    return Response.json(
      { code: "offline:health", message: "Backend unreachable." },
      { status: 503 },
    );
  }
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: upstream.headers,
  });
}
