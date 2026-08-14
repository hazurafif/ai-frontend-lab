// Models proxy route.
//
// Lists the models available on a completion source and maps them to the
// backend's `provider:model` convention:
//
//   GET  /api/models → the server-configured source (MODELS_BASE_URL /
//                      MODELS_API_KEY in .env.local, mirroring the backend's
//                      OPENAI_BASE_URL / OPENAI_API_KEY). When that is not
//                      configured, falls back to the backend's current
//                      default `llm` connection (GET /connections) and
//                      lists ITS /v1/models — so the chat input always
//                      reflects the connection the agent actually uses.
//   POST /api/models → the source from the request body (settings page
//                      connection): { provider, baseUrl, apiKey } with
//                      provider ∈ "openai" | "gemini" | "custom" | "default".
//
// Calls GET {baseUrl}/models (OpenAI-compatible /v1 endpoint; Gemini's
// OpenAI-compatibility layer works too) with the bearer key and returns a
// trimmed { provider, models: [...] } payload — provider is the backend
// `provider:` prefix for the source ("openai" | "google_genai"). The raw key
// and the upstream shape never reach the client beyond this route.

import { type CompletionProviderId, completionProvider } from "@/lib/models";

const MODELS_BASE_URL = process.env.MODELS_BASE_URL;
const MODELS_API_KEY = process.env.MODELS_API_KEY;
const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8000";

type ModelsRequest = {
  provider?: CompletionProviderId;
  baseUrl?: string;
  apiKey?: string;
};

// Backend /connections rows (admin; tokens are masked server-side, so a
// local /v1/models endpoint — e.g. vLLM — serves the list without auth).
type BackendConnection = {
  name: string;
  kind: "llm" | "embeddings" | string;
  base_url: string | null;
  is_default: boolean;
  created_at?: string;
};

export async function GET(request: Request) {
  // No env source: ask the backend for the connection the agent currently
  // uses and list ITS models. `fetchWithAuth` on the client attaches the
  // Bearer token; forward it so the backend accepts the read.
  if (!MODELS_BASE_URL || !MODELS_API_KEY) {
    const fromBackend = await modelsFromBackendConnection(
      request.headers.get("authorization"),
    );
    if (fromBackend) {
      return fromBackend;
    }
  }
  return handle({ provider: "default" });
}

export async function POST(request: Request) {
  let body: ModelsRequest = {};
  try {
    body = (await request.json()) as ModelsRequest;
  } catch {
    return Response.json(
      { code: "models:invalid-request", message: "Invalid JSON body." },
      { status: 400 },
    );
  }
  return handle(body);
}

async function handle({
  provider = "default",
  baseUrl = "",
  apiKey = "",
}: ModelsRequest) {
  const source = completionProvider(provider);

  let resolvedBase: string;
  let resolvedKey: string;
  if (source.id === "default") {
    if (!MODELS_BASE_URL || !MODELS_API_KEY) {
      return Response.json(
        {
          code: "models:not-configured",
          message:
            "MODELS_BASE_URL / MODELS_API_KEY not set in .env.local (mirror the backend's OPENAI_BASE_URL / OPENAI_API_KEY), and no connection saved in settings.",
        },
        { status: 503 },
      );
    }
    resolvedBase = MODELS_BASE_URL;
    resolvedKey = MODELS_API_KEY;
  } else {
    resolvedBase = baseUrl.trim() || source.defaultBaseUrl;
    if (!resolvedBase) {
      return Response.json(
        {
          code: "models:base-url-required",
          message: "A base URL is required for this source.",
        },
        { status: 400 },
      );
    }
    resolvedKey = apiKey.trim();
    if (!resolvedKey) {
      return Response.json(
        {
          code: "models:key-required",
          message: "An API key is required for this source.",
        },
        { status: 400 },
      );
    }
  }

  let upstream: Response;
  try {
    // OpenAI-compatible convention: the base URL ends in /v1 and the model
    // list lives at {base}/models — append, don't resolve from the origin.
    const modelsUrl = `${resolvedBase.replace(/\/+$/, "")}/models`;
    upstream = await fetch(modelsUrl, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${resolvedKey}`,
      },
      cache: "no-store",
    });
  } catch {
    return Response.json(
      { code: "offline:models", message: "Completion source unreachable." },
      { status: 502 },
    );
  }

  if (!upstream.ok) {
    let detail = `Completion source returned ${upstream.status}.`;
    try {
      const body = (await upstream.json()) as { error?: { message?: string } };
      if (body.error?.message) {
        detail = body.error.message;
      }
    } catch {
      // non-JSON error body — keep the default message
    }
    return Response.json(
      { code: "models:upstream-error", message: detail },
      { status: 502 },
    );
  }

  const body = (await upstream.json()) as {
    data?: Array<{ id?: string; name?: string }>;
  };
  const models = (body.data ?? [])
    .map((model) => ({ id: model.id, name: model.name ?? model.id }))
    .filter((model): model is { id: string; name: string } =>
      Boolean(model.id),
    );

  return Response.json({ models, provider: source.prefix });
}

/**
 * Lists the models of the backend's current default `llm` connection
 * (GET /connections — the admin store the agent resolves at startup).
 * The connection's api_token is masked server-side, so the /v1/models call
 * is made without a bearer key — local OpenAI-compatible servers (vLLM,
 * LM Studio) serve the list without auth. Returns null when there is no
 * connection, the backend is unreachable, or the list cannot be fetched
 * (the caller then falls back to the env source / built-in list).
 */
async function modelsFromBackendConnection(
  authorization: string | null,
): Promise<Response | null> {
  let connections: BackendConnection[];
  try {
    const res = await fetch(`${BACKEND_URL}/connections`, {
      headers: {
        Accept: "application/json",
        ...(authorization ? { Authorization: authorization } : {}),
      },
      cache: "no-store",
    });
    if (!res.ok) {
      return null;
    }
    connections = (await res.json()) as BackendConnection[];
  } catch {
    return null;
  }

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

  let upstream: Response;
  try {
    upstream = await fetch(`${llm.base_url.replace(/\/+$/, "")}/models`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
  } catch {
    return null;
  }
  if (!upstream.ok) {
    return null;
  }

  const body = (await upstream.json()) as {
    data?: Array<{ id?: string; name?: string }>;
  };
  const models = (body.data ?? [])
    .map((model) => ({ id: model.id, name: model.name ?? model.id }))
    .filter((model): model is { id: string; name: string } =>
      Boolean(model.id),
    );
  if (models.length === 0) {
    return null;
  }

  return Response.json({ models, provider: "openai" });
}
