// Chat proxy route.
//
// Forwards PATCH/DELETE /api/chat/threads/{id} to the backend's
// /threads/{id} endpoints (rename / delete a thread server-side).

import { forwardBackendRequest } from "@/lib/server-proxy";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return forwardBackendRequest(request, `/threads/${encodeURIComponent(id)}`);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return forwardBackendRequest(request, `/threads/${encodeURIComponent(id)}`);
}
