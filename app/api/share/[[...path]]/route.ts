// Share proxy route.
//
// Maps the frontend share API onto the backend endpoints (ai-backend-lab):
//
//   POST   /api/share/<chat_id>             -> POST   /threads/<chat_id>/share
//   GET    /api/share/<chat_id>             -> GET    /threads/<chat_id>/share
//   DELETE /api/share/<chat_id>             -> DELETE /threads/<chat_id>/share
//   GET    /api/share/shared/<share_token>  -> GET    /shared/<share_token>  (public)
//
// Backend contract:
//   POST /threads/{thread_id}/share   (auth, no body) -> 201 { share_token, url }
//   GET  /threads/{thread_id}/share   (auth)          -> 200 { share_token, url }
//   DELETE /threads/{thread_id}/share (auth)          -> 204
//   GET  /shared/{share_token}        (public)        -> 200 { thread_id, title,
//                                                           username, created_at,
//                                                           messages }

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8787";

export async function POST(request: Request) {
  return forward(request);
}

export async function GET(request: Request) {
  return forward(request);
}

export async function DELETE(request: Request) {
  return forward(request);
}

async function forward(request: Request) {
  const pathname = new URL(request.url).pathname;
  const suffix = pathname.replace(/^\/api\/share/, "");

  // /api/share/shared/<token> -> public /shared/<token>
  // /api/share/<chat_id>      -> owner-only /threads/<chat_id>/share
  const targetPath = suffix.startsWith("/shared/")
    ? suffix
    : `/threads/${suffix.replace(/^\//, "")}/share`;

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
      { code: "offline:share", message: "Share backend unreachable." },
      { status: 503 },
    );
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: upstream.headers,
  });
}
