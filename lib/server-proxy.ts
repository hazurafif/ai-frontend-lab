// Server-only helper for the /api/* proxy routes.
//
// Forwards a request to the FastAPI backend at BACKEND_URL, preserving
// method, headers and body, so the client can keep talking to /api/* while
// the backend endpoints live at the root (/login, /threads, /users, ...).

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8787";

export async function forwardBackendRequest(
  request: Request,
  targetPath: string,
): Promise<Response> {
  const target = new URL(targetPath, BACKEND_URL);
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
      { code: "offline:proxy", message: "Backend unreachable." },
      { status: 503 },
    );
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: upstream.headers,
  });
}
