import type { UIMessage } from "ai";
import { z } from "zod";

export const messageMetadataSchema = z.object({
  createdAt: z.string(),
});

export type MessageMetadata = z.infer<typeof messageMetadataSchema>;

// A single chat message as managed by @ai-sdk/react useChat.
// Parts can be text, reasoning, file, or tool-* (tool parts are only
// rendered if your backend emits them).
export type ChatMessage = UIMessage<MessageMetadata>;

// A lightweight entry in the sidebar history (persisted to localStorage).
export type ChatHistoryItem = {
  id: string;
  title: string;
  createdAt: string; // ISO date, used for grouping in the sidebar
  // Present when the thread has a public share link (server-side only).
  shareToken?: string | null;
};
