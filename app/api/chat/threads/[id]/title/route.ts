// Chat proxy route.
//
// Forwards POST /api/chat/threads/{id}/title to the backend's
// /threads/{id}/title endpoint (LLM-generated title upserted on the thread;
// 404 when the thread has no messages). Response: ThreadOut.

import { forwardBackendRequest } from "@/lib/server-proxy";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return forwardBackendRequest(
    request,
    `/threads/${encodeURIComponent(id)}/title`,
  );
}
