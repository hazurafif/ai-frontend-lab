// Auth proxy route (admin).
//
// Forwards GET/PUT/DELETE /api/auth/allowed-models to the backend's
// /allowed-models endpoints — the global, role-based model allowlist that
// restricts which models `user`-role accounts may use (admins are never
// restricted). PUT body: { models: string[] } (empty = allow none);
// DELETE clears the restriction.

import { forwardBackendRequest } from "@/lib/server-proxy";

export async function GET(request: Request) {
  return forwardBackendRequest(request, "/allowed-models");
}

export async function PUT(request: Request) {
  return forwardBackendRequest(request, "/allowed-models");
}

export async function DELETE(request: Request) {
  return forwardBackendRequest(request, "/allowed-models");
}
