// Attach-mode delta merging for background runs (GET /threads/{id}/stream).
//
// The attach stream speaks the same raw event contract as the backend's
// POST /chat: `message_delta`/`reasoning_delta` stream the in-flight
// message's text, `message` events carry the full finalized message (text +
// reasoning + tool calls), and the run ends with `done` (or `interrupt` /
// `error`). Deltas merge into the message list by the backend's stable
// message id; `message` events replace placeholders with the authoritative
// version (tool outputs are matched to their tool calls by `tool_call_id`).
//
// Terminal events are not merged here — the caller re-fetches the thread
// history (GET /threads/{id}/messages), which is the durable record.

import {
  contentToText,
  type ServerMessage,
  serverMessageToChatMessage,
} from "@/lib/threads";
import type { ChatMessage } from "@/lib/types";
import { generateUUID } from "@/lib/utils";
import { isToolPart } from "./chunk-merge";

export const ATTACH_TERMINAL_EVENTS = ["done", "interrupt", "error"] as const;

/** True when the attach stream has ended (caller should re-fetch history). */
export function isAttachTerminalEvent(event: string): boolean {
  return (ATTACH_TERMINAL_EVENTS as readonly string[]).includes(event);
}

/**
 * Stateful merger for one attach session. Keeps the backend message id →
 * UIMessage id mapping (backend ids are stable per message; UIMessage ids
 * are generated UUIDs) and the tool_call_id → output map, so a tool output
 * `message` event can patch the tool part of the ai message that owns it.
 */
export class AttachMerger {
  private readonly idByAttachId = new Map<string, string>();
  private readonly toolOutputs = new Map<string, string>();
  private readonly messageByToolCall = new Map<string, string>();

  /**
   * Merge one stream event into `messages`. Returns a new list, or null
   * when the event changes nothing (unknown event / no-op payload).
   */
  merge(
    messages: ChatMessage[],
    event: string,
    data: Record<string, unknown>,
  ): ChatMessage[] | null {
    switch (event) {
      case "message_delta": {
        return this.delta(
          messages,
          String(data.id ?? ""),
          String(data.delta ?? ""),
          "text",
        );
      }
      case "reasoning_delta": {
        return this.delta(
          messages,
          String(data.id ?? ""),
          String(data.delta ?? ""),
          "reasoning",
        );
      }
      case "message": {
        return this.full(messages, String(data.id ?? ""), data.message);
      }
      default:
        return null;
    }
  }

  /** Append a text/reasoning delta to the message with `attachId`. */
  private delta(
    messages: ChatMessage[],
    attachId: string,
    text: string,
    kind: "text" | "reasoning",
  ): ChatMessage[] | null {
    if (!attachId || !text) {
      return null;
    }
    const messageId = this.idByAttachId.get(attachId);
    const index = messageId
      ? messages.findIndex((message) => message.id === messageId)
      : -1;

    if (index === -1) {
      // Unknown id: a message we haven't seen yet — create a live
      // placeholder that the `message` event will replace (or history
      // re-fetch reconcile).
      const created: ChatMessage = {
        id: generateUUID(),
        role: "assistant",
        parts:
          kind === "text"
            ? [{ type: "text", text }]
            : [{ type: "reasoning", text }],
      };
      this.idByAttachId.set(attachId, created.id);
      return [...messages, created];
    }

    return messages.map((message, i) => {
      if (i !== index) {
        return message;
      }
      const parts = message.parts;
      const last = parts.length - 1;
      if (last >= 0 && parts[last].type === kind) {
        const head = parts[last];
        return {
          ...message,
          parts: parts.map((part, pi) =>
            pi === last ? { ...part, text: head.text + text } : part,
          ),
        };
      }
      return {
        ...message,
        parts: [
          ...parts,
          kind === "text"
            ? { type: "text", text }
            : { type: "reasoning", text },
        ],
      };
    });
  }

  /** Apply a full finalized `message` event (serialized backend message). */
  private full(
    messages: ChatMessage[],
    attachId: string,
    raw: unknown,
  ): ChatMessage[] | null {
    const msg = raw as ServerMessage | undefined;
    if (!msg || !attachId) {
      return null;
    }

    // Tool result: record the output and patch the owning ai message's
    // tool part (the tool output event arrives right after its tool call).
    if (msg.type === "tool") {
      const callId = msg.tool_call_id;
      if (!callId) {
        return null;
      }
      const output = contentToText(msg.content);
      this.toolOutputs.set(callId, output);
      const ownerId = this.messageByToolCall.get(callId);
      const placeholderId = this.idByAttachId.get(attachId);
      const ownerIndex = ownerId
        ? messages.findIndex((message) => message.id === ownerId)
        : -1;
      const dropPlaceholder =
        placeholderId && placeholderId !== ownerId
          ? messages.findIndex((message) => message.id === placeholderId)
          : -1;
      if (ownerIndex === -1 && dropPlaceholder === -1) {
        return null;
      }
      this.idByAttachId.delete(attachId);
      let next = messages;
      if (ownerIndex !== -1) {
        next = next.map((message, i) =>
          i === ownerIndex
            ? {
                ...message,
                parts: message.parts.map((part) =>
                  isToolPart(part) && part.toolCallId === callId
                    ? ({
                        ...part,
                        state: "output-available",
                        output,
                      } as ChatMessage["parts"][number])
                    : part,
                ),
              }
            : message,
        );
      }
      if (dropPlaceholder !== -1) {
        next = next.filter((_, i) => i !== dropPlaceholder);
      }
      return next;
    }

    // Full message (human/ai): convert and replace (or append).
    const converted = serverMessageToChatMessage(msg, this.toolOutputs);
    if (!converted) {
      return null;
    }
    for (const part of converted.parts) {
      if (isToolPart(part)) {
        this.messageByToolCall.set(part.toolCallId, converted.id);
      }
    }
    const existingId = this.idByAttachId.get(attachId);
    const index = existingId
      ? messages.findIndex((message) => message.id === existingId)
      : -1;
    this.idByAttachId.set(attachId, converted.id);
    if (index !== -1) {
      return messages.map((message, i) => (i === index ? converted : message));
    }
    return [...messages, converted];
  }
}
