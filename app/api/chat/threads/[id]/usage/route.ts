// Chat proxy route.
//
// Forwards GET /api/chat/threads/{id}/usage to the backend's
// /threads/{id}/usage endpoint (context window + cumulative token usage
// report; 404 for threads without a report yet).

import { forwardBackendRequest } from "@/lib/server-proxy";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return forwardBackendRequest(
    request,
    `/threads/${encodeURIComponent(id)}/usage`,
  );
}
