export const DEFAULT_CHAT_MODEL = "gpt-4o-mini";

export type ChatModel = {
  id: string;
  name: string;
  description: string;
};

// The selected model id is sent to your backend as `selectedChatModel` in
// the /api/chat request body. Adjust this list to match the models your
// backend actually supports.
export const chatModels: ChatModel[] = [
  {
    description: "Fast and cheap, good for most conversations",
    id: "gpt-4o-mini",
    name: "GPT-4o mini",
  },
  {
    description: "Flagship OpenAI model",
    id: "gpt-4o",
    name: "GPT-4o",
  },
  {
    description: "Anthropic's balanced flagship",
    id: "claude-3-5-sonnet-latest",
    name: "Claude 3.5 Sonnet",
  },
  {
    description: "Google's fast multimodal model",
    id: "gemini-2.0-flash",
    name: "Gemini 2.0 Flash",
  },
];
