// Chat proxy route.
//
// Forwards POST /api/chat/threads/{id}/followup to the backend's
// /threads/{id}/followup endpoint (auto-title + up to 3 suggested
// follow-up questions after a run; 404 when the thread has no messages).

import { forwardBackendRequest } from "@/lib/server-proxy";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return forwardBackendRequest(
    request,
    `/threads/${encodeURIComponent(id)}/followup`,
  );
}
