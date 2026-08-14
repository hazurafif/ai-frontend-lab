export const DEFAULT_CHAT_MODEL = "openai:gpt-4o-mini";

export type ChatModel = {
  id: string;
  name: string;
  description: string;
};

// The selected model id is sent to your backend as `selectedChatModel` in
// the /api/chat request body. Ids follow the backend's `provider:model`
// convention (DEEPAGENTS_MODEL, e.g. "openai:gpt-4o-mini",
// "anthropic:claude-sonnet-4-5", "google_genai:gemini-2.5-flash").
export const chatModels: ChatModel[] = [
  {
    description: "Fast and cheap, good for most conversations",
    id: "openai:gpt-4o-mini",
    name: "GPT-4o mini",
  },
  {
    description: "Flagship OpenAI model",
    id: "openai:gpt-4o",
    name: "GPT-4o",
  },
  {
    description: "Anthropic's balanced flagship",
    id: "anthropic:claude-sonnet-4-5",
    name: "Claude Sonnet 4.5",
  },
  {
    description: "Google's fast multimodal model",
    id: "google_genai:gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
  },
];

export function getChatModel(id: string): ChatModel | undefined {
  return chatModels.find((model) => model.id === id);
}

// Display name for a model id. Falls back to the raw id for models the
// backend reports but the frontend does not know (e.g. a DEEPAGENTS_MODEL
// configured outside the built-in list).
export function chatModelName(id: string): string {
  return getChatModel(id)?.name ?? id;
}
