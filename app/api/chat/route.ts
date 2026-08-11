// Chat proxy route.
//
// The frontend speaks the Vercel AI SDK streaming protocol (useChat from
// @ai-sdk/react). This route forwards every request to YOUR backend, which is
// responsible for the actual model calls, tool execution, auth, rate limiting,
// etc. The AI SDK stream from your backend is piped straight back to the
// browser, so the chat UI stays fully streaming.
//
// Configure in .env.local:
//   BACKEND_URL="http://localhost:8787"
//   BACKEND_CHAT_PATH="/api/chat"   (optional, defaults to /api/chat)

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8787";
const BACKEND_CHAT_PATH = process.env.BACKEND_CHAT_PATH ?? "/api/chat";

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
  const target = new URL(BACKEND_CHAT_PATH, BACKEND_URL);
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
      { code: "offline:chat", message: "Chat backend unreachable." },
      { status: 503 },
    );
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: upstream.headers,
  });
}
