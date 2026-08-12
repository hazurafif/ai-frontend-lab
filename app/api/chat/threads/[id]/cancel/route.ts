// Chat proxy route.
//
// Forwards POST /api/chat/threads/{id}/cancel to the backend's
// /threads/{id}/cancel endpoint (abort the thread's active run).

import { forwardBackendRequest } from "@/lib/server-proxy";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return forwardBackendRequest(
    request,
    `/threads/${encodeURIComponent(id)}/cancel`,
  );
}
