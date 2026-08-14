// Models proxy route.
//
// Lists the models available on a completion source and maps them to the
// backend's `provider:model` convention:
//
//   GET  /api/models → the server-configured source (MODELS_BASE_URL /
//                      MODELS_API_KEY in .env.local, mirroring the backend's
//                      OPENAI_BASE_URL / OPENAI_API_KEY).
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

type ModelsRequest = {
  provider?: CompletionProviderId;
  baseUrl?: string;
  apiKey?: string;
};

export async function GET() {
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
