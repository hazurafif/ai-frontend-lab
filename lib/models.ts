export const DEFAULT_CHAT_MODEL = "openai:gpt-4o-mini";

export type ChatModel = {
  id: string;
  name: string;
  description: string;
};

// --- Live models from the completion source (GET/POST /api/models) --------

// The completion source (backend's OPENAI_BASE_URL / OPENAI_API_KEY, e.g.
// opencode.ai/zen/go/v1) is consumed through langchain-openai, so every
// model it serves is reachable with the backend's `openai:` provider prefix.

export type SourceModel = { id: string; name: string };

// Maps raw ids from the completion source's GET /v1/models to backend-style
// `provider:model` ids (e.g. "deepseek-v4-flash" → "openai:deepseek-v4-flash",
// "gemini-2.5-flash" → "google_genai:gemini-2.5-flash").
export function chatModelsFromSource(
  providerPrefix: string,
  models: SourceModel[],
): ChatModel[] {
  const prefixLabel =
    { google_genai: "Gemini", openai: "OpenAI" }[providerPrefix] ??
    providerPrefix;
  return models.map((model) => ({
    description: `Available via ${prefixLabel}`,
    id: `${providerPrefix}:${model.id}`,
    name: model.name,
  }));
}

// --- Completion source presets (settings → /api/models) -------------------

export type CompletionProviderId = "default" | "openai" | "gemini" | "custom";

export type CompletionProvider = {
  id: CompletionProviderId;
  label: string;
  // Prefilled base URL (OpenAI-compatible /v1 endpoint). Empty = user must
  // provide one (custom) or it's the server-configured env source (default).
  defaultBaseUrl: string;
  // Backend `provider:` prefix for ids of this source.
  prefix: string;
  needsKey: boolean;
};

export const COMPLETION_PROVIDERS: CompletionProvider[] = [
  {
    defaultBaseUrl: "",
    id: "default",
    label: "Server default",
    needsKey: false,
    prefix: "openai",
  },
  {
    defaultBaseUrl: "https://api.openai.com/v1",
    id: "openai",
    label: "OpenAI Chat Completions",
    needsKey: true,
    prefix: "openai",
  },
  {
    // OpenAI-compatible endpoint, so the same /models code path works.
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    id: "gemini",
    label: "Google Gemini",
    needsKey: true,
    prefix: "google_genai",
  },
  {
    defaultBaseUrl: "",
    id: "custom",
    label: "Custom (OpenAI-compatible)",
    needsKey: true,
    prefix: "openai",
  },
];

export function completionProvider(
  id: CompletionProviderId,
): CompletionProvider {
  return (
    COMPLETION_PROVIDERS.find((provider) => provider.id === id) ??
    COMPLETION_PROVIDERS[0]
  );
}

// User-configured connection to a completion source (settings page). When
// null the /api/models route falls back to the server env (MODELS_BASE_URL /
// MODELS_API_KEY in .env.local).
export type ModelConnection = {
  provider: CompletionProviderId;
  baseUrl: string;
  apiKey: string;
};
