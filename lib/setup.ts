// Setup / onboarding client.
//
// Mirrors the backend's /users/me/setup + /users/me/onboarding contract
// (proxied at /api/setup). The frontend shows a startup screen until
// `completed` — i.e. until an admin has saved a default `llm` connection.
// Connections are admin-managed (never submitted by users); onboarding only
// configures the user's own data: preferences + MCP tool servers.

import { fetchWithAuth } from "@/lib/auth";
import type { PreferencesPayload } from "@/lib/preferences";

export type SetupToolServer = {
  name: string;
  transport: string;
  url: string | null;
  command: string | null;
  args: string[];
  headers: Record<string, string>;
  env: Record<string, string>;
  enabled: boolean;
};

export type SetupState = {
  // True once a default llm connection (admin-managed) is configured.
  completed: boolean;
  llm_connection: {
    name: string;
    kind: string;
    base_url: string | null;
    has_token: boolean;
    is_default: boolean;
    extra: Record<string, unknown>;
  } | null;
  model: string | null;
  mcp_servers: SetupToolServer[];
  preferences: {
    enable_search: boolean | null;
    hide_reasoning: boolean;
    hide_tool_calls: boolean;
  };
};

export type OnboardingInput = {
  preferences?: PreferencesPayload;
  mcp_servers?: {
    name: string;
    transport: "streamable_http" | "stdio";
    url?: string | null;
    command?: string | null;
    args?: string[];
    headers?: Record<string, string>;
    env?: Record<string, string>;
    enabled?: boolean;
  }[];
};

/**
 * The current setup state, or null when the backend is unreachable —
 * callers must treat that as "assume complete" so an offline backend never
 * blocks the chat UI.
 */
export async function fetchSetupState(): Promise<SetupState | null> {
  try {
    const res = await fetchWithAuth("/api/setup", { cache: "no-store" });
    if (!res.ok) {
      return null;
    }
    return (await res.json()) as SetupState;
  } catch {
    return null;
  }
}

/**
 * One-shot per-user setup: preferences + MCP tool servers (idempotent
 * upserts). Returns the refreshed setup state. Throws on failure so
 * callers can surface errors.
 */
export async function submitOnboarding(
  input: OnboardingInput,
): Promise<SetupState> {
  const res = await fetchWithAuth("/api/setup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(`onboarding failed: ${res.status}`);
  }
  return (await res.json()) as SetupState;
}
