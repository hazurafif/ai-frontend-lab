// Auth proxy route (admin).
//
// Forwards GET/POST /api/auth/users to the backend's /users endpoints
// (list users / create a user with an optional admin role).

import { forwardBackendRequest } from "@/lib/server-proxy";

export async function GET(request: Request) {
  return forwardBackendRequest(request, "/users");
}

export async function POST(request: Request) {
  return forwardBackendRequest(request, "/users");
}
