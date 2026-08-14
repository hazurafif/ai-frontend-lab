// Merges AI SDK data-stream chunks (the /api/chat SSE protocol) into a
// ChatMessage list. Used for streams the useChat hook does not own — HITL
// resume, where the interrupted assistant message must stay in the UI while
// the resumed run streams a continuation into a NEW message.
//
// Chunk semantics mirror the SDK's UIMessageStreamParser (ai/dist/index.js):
// `start` names the message being built; `text-start/delta/end` and
// `reasoning-*` stream text; `tool-input-*` build a typed `tool-<name>` part
// and `tool-output-*` finish it; `custom` appends a custom part (subagent
// cards, nested interrupt cards). `error`/`finish` are handled by the caller.

import type { ChatMessage } from "@/lib/types";

type Chunk = Record<string, unknown>;

function chunkString(chunk: Chunk, key: string): string {
  return typeof chunk[key] === "string" ? (chunk[key] as string) : "";
}

export { chunkString };

function isToolPart(
  part: ChatMessage["parts"][number],
): part is ChatMessage["parts"][number] & { toolCallId: string } {
  return "toolCallId" in part && typeof part.toolCallId === "string";
}

export class ChatStreamMerger {
  /** The assistant message id from the `start` chunk (resp-…). */
  private messageId: string | null = null;
  /** chunk id (backend message id) → index of the text part in the message. */
  private readonly textPartByChunkId = new Map<string, number>();
  /** chunk id → index of the reasoning part in the message. */
  private readonly reasoningPartByChunkId = new Map<string, number>();
  /** toolCallId → accumulated raw input text (tool-input-delta). */
  private readonly toolInputText = new Map<string, string>();

  /** Merge one chunk into `messages`. Returns a new list, or null on no-op. */
  merge(messages: ChatMessage[], chunk: Chunk): ChatMessage[] | null {
    switch (chunk.type) {
      case "start": {
        const id = chunkString(chunk, "messageId");
        if (!id) {
          return null;
        }
        this.messageId = id;
        return this.ensureMessage(messages);
      }
      case "text-start": {
        const id = chunkString(chunk, "id");
        if (!id) {
          return null;
        }
        return this.withMessage(messages, (message) => {
          this.textPartByChunkId.set(id, message.parts.length);
          return {
            ...message,
            parts: [...message.parts, { type: "text", text: "" }],
          };
        });
      }
      case "text-delta": {
        const id = chunkString(chunk, "id");
        const delta = chunkString(chunk, "delta");
        const index = this.textPartByChunkId.get(id);
        if (index === undefined || !delta) {
          return null;
        }
        return this.withMessage(messages, (message) => ({
          ...message,
          parts: message.parts.map((part, i) =>
            i === index && part.type === "text"
              ? { ...part, text: part.text + delta }
              : part,
          ),
        }));
      }
      case "text-end": {
        this.textPartByChunkId.delete(chunkString(chunk, "id"));
        return null;
      }
      case "reasoning-start": {
        const id = chunkString(chunk, "id");
        if (!id) {
          return null;
        }
        return this.withMessage(messages, (message) => {
          this.reasoningPartByChunkId.set(id, message.parts.length);
          return {
            ...message,
            parts: [...message.parts, { type: "reasoning", text: "" }],
          };
        });
      }
      case "reasoning-delta": {
        const id = chunkString(chunk, "id");
        const delta = chunkString(chunk, "delta");
        const index = this.reasoningPartByChunkId.get(id);
        if (index === undefined || !delta) {
          return null;
        }
        return this.withMessage(messages, (message) => ({
          ...message,
          parts: message.parts.map((part, i) =>
            i === index && part.type === "reasoning"
              ? { ...part, text: part.text + delta }
              : part,
          ),
        }));
      }
      case "reasoning-end": {
        this.reasoningPartByChunkId.delete(chunkString(chunk, "id"));
        return null;
      }
      case "tool-input-start": {
        const toolCallId = chunkString(chunk, "toolCallId");
        const toolName = chunkString(chunk, "toolName") || "unknown";
        if (!toolCallId) {
          return null;
        }
        this.toolInputText.set(toolCallId, "");
        return this.withMessage(messages, (message) => ({
          ...message,
          parts: [
            ...message.parts,
            {
              type: `tool-${toolName}`,
              toolCallId,
              state: "input-streaming",
            } as ChatMessage["parts"][number],
          ],
        }));
      }
      case "tool-input-delta": {
        const toolCallId = chunkString(chunk, "toolCallId");
        const delta = chunkString(chunk, "inputTextDelta");
        if (!toolCallId) {
          return null;
        }
        const text = `${this.toolInputText.get(toolCallId) ?? ""}${delta}`;
        this.toolInputText.set(toolCallId, text);
        let input: unknown;
        try {
          input = JSON.parse(text) as unknown;
        } catch {
          input = undefined; // partial JSON — keep streaming
        }
        return this.patchTool(messages, toolCallId, (part) => ({
          ...part,
          ...(input !== undefined ? { input } : {}),
        }));
      }
      case "tool-input-available": {
        const toolCallId = chunkString(chunk, "toolCallId");
        this.toolInputText.delete(toolCallId);
        return this.patchTool(
          messages,
          toolCallId,
          (part) =>
            ({
              ...part,
              state: "input-available",
              input: chunk.input,
            }) as ChatMessage["parts"][number],
        );
      }
      case "tool-output-available": {
        const toolCallId = chunkString(chunk, "toolCallId");
        return this.patchTool(
          messages,
          toolCallId,
          (part) =>
            ({
              ...part,
              state: "output-available",
              output: chunk.output,
            }) as ChatMessage["parts"][number],
        );
      }
      case "tool-output-error": {
        const toolCallId = chunkString(chunk, "toolCallId");
        return this.patchTool(
          messages,
          toolCallId,
          (part) =>
            ({
              ...part,
              state: "output-error",
              errorText: chunkString(chunk, "errorText") || "Tool failed",
            }) as ChatMessage["parts"][number],
        );
      }
      case "custom": {
        const kind = chunkString(chunk, "kind") || "unknown";
        return this.withMessage(messages, (message) => ({
          ...message,
          parts: [
            ...message.parts,
            {
              type: "custom",
              kind,
              providerMetadata: chunk.providerMetadata,
            } as ChatMessage["parts"][number],
          ],
        }));
      }
      default:
        return null;
    }
  }

  /** Create the streamed assistant message if it isn't in the list yet. */
  private ensureMessage(messages: ChatMessage[]): ChatMessage[] | null {
    const id = this.messageId;
    if (!id || messages.some((message) => message.id === id)) {
      return null;
    }
    return [...messages, { id, role: "assistant", parts: [] }];
  }

  /** Apply `update` to the streamed assistant message. */
  private withMessage(
    messages: ChatMessage[],
    update: (message: ChatMessage) => ChatMessage,
  ): ChatMessage[] | null {
    const id = this.messageId;
    if (!id) {
      return null;
    }
    const index = messages.findIndex((message) => message.id === id);
    if (index === -1) {
      // No `start` chunk seen yet (defensive) — create the message now.
      return [...messages, update({ id, role: "assistant", parts: [] })];
    }
    return messages.map((message, i) =>
      i === index ? update(message) : message,
    );
  }

  /** Patch the tool part owned by `toolCallId` on the streamed message. */
  private patchTool(
    messages: ChatMessage[],
    toolCallId: string,
    patch: (part: ChatMessage["parts"][number]) => ChatMessage["parts"][number],
  ): ChatMessage[] | null {
    if (!toolCallId) {
      return null;
    }
    return this.withMessage(messages, (message) => ({
      ...message,
      parts: message.parts.map((part) =>
        isToolPart(part) && part.toolCallId === toolCallId
          ? (patch(part) as ChatMessage["parts"][number])
          : part,
      ),
    }));
  }
}
