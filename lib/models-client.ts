// Client-side model listing — replaces the removed Next.js /api/models route
// (docs/migration.md decision 2). Nothing here holds a server secret:
//
//   - POST source ({ provider, baseUrl, apiKey }) — the apiKey is
//     client-provided (settings connection form), so the browser may call the
//     completion source's /v1/models directly; only the "default" provider
//     (server env MODELS_BASE_URL/MODELS_API_KEY) is gone.
//   - Default-source fallback — reads the backend's current default `llm`
//     connection (GET /connections, admin) and lists ITS /v1/models. The
//     frontend speaks to the backend same-origin via the /api proxy, so no
//     CORS; the model endpoint itself is called without a bearer key
//     (local OpenAI-compatible servers serve the list without auth), the same
//     assumption the Next route made.

import { fetchWithAuth } from "@/lib/auth";
import {
  type CompletionProviderId,
  completionProvider,
  type SourceModel,
} from "@/lib/models";

export type ModelsRequest = {
  provider?: CompletionProviderId;
  baseUrl?: string;
  apiKey?: string;
};

async function listModels(
  baseUrl: string,
  apiKey?: string,
): Promise<SourceModel[]> {
  const url = `${baseUrl.replace(/\/+$/, "")}/models`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
  });
  if (!response.ok) {
    let detail = `Completion source returned ${response.status}.`;
    try {
      const body = (await response.json()) as {
        error?: { message?: string };
      };
      if (body.error?.message) {
        detail = body.error.message;
      }
    } catch {
      // non-JSON error body — keep the default message
    }
    throw new Error(detail);
  }
  const body = (await response.json()) as {
    data?: Array<{ id?: string; name?: string }>;
  };
  return (body.data ?? [])
    .map((model) => ({ id: model.id, name: model.name ?? model.id }))
    .filter((model): model is SourceModel => Boolean(model.id));
}

/**
 * Lists the models of a user-configured completion source (the old POST
 * /api/models). Throws on invalid config or upstream errors — callers fall
 * back to the built-in list. Returns the `provider:` prefix to build
 * backend-style ids.
 */
export async function fetchModelsFromSource(
  input: ModelsRequest,
): Promise<{ models: SourceModel[]; provider: string }> {
  const source = completionProvider(input.provider ?? "default");
  if (source.id === "default") {
    throw new Error(
      "The server-configured model source was removed in the Vite migration — " +
        "save an llm connection in Settings → Model instead.",
    );
  }
  const baseUrl = input.baseUrl?.trim() || source.defaultBaseUrl;
  if (!baseUrl) {
    throw new Error("A base URL is required for this source.");
  }
  const apiKey = input.apiKey?.trim();
  if (!apiKey) {
    throw new Error("An API key is required for this source.");
  }
  const models = await listModels(baseUrl, apiKey);
  return { models, provider: source.prefix };
}

/**
 * Lists the models of the backend's current default `llm` connection —
 * the old GET /api/models fallback branch. Returns null when there is no
 * connection, the backend is unreachable, or the list cannot be fetched
 * (the caller then falls back to the built-in list).
 */
export async function fetchDefaultConnectionModels(): Promise<{
  models: SourceModel[];
  provider: string;
} | null> {
  const response = await fetchWithAuth("/api/connections", {
    headers: { Accept: "application/json" },
  }).catch(() => null);
  if (!response?.ok) {
    return null;
  }
  const connections = (await response.json()) as Array<{
    kind: string;
    base_url: string | null;
    is_default: boolean;
    created_at?: string;
  }>;
  // Mirror the backend's get_default(): is_default first, then first created.
  const llm = connections
    .filter((connection) => connection.kind === "llm")
    .sort(
      (a, b) =>
        Number(b.is_default) - Number(a.is_default) ||
        String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")),
    )[0];
  if (!llm?.base_url) {
    return null;
  }
  try {
    const models = await listModels(llm.base_url);
    return { models, provider: "openai" };
  } catch {
    return null;
  }
}
