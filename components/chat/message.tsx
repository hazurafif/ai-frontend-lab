"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import { CopyIcon, RefreshCwIcon } from "lucide-react";
import { useCallback, useState } from "react";
import type { ChatMessage } from "@/lib/types";
import { cn, getTextFromMessage, sanitizeText } from "@/lib/utils";
import {
  MessageAction,
  MessageActions,
  MessageContent,
  MessageResponse,
} from "../ai-elements/message";
import { Shimmer } from "../ai-elements/shimmer";
import { SparklesIcon } from "./icons";

function ThinkingText() {
  return (
    <div className="flex min-h-[calc(13px*1.65)] min-w-0 items-center text-[13px] leading-[1.65]">
      <Shimmer
        as="span"
        className="font-medium whitespace-normal break-words"
        duration={1}
      >
        Thinking...
      </Shimmer>
    </div>
  );
}

function ReasoningBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex flex-col">
      <button
        className="flex w-fit items-center gap-1.5 text-[11px] text-muted-foreground/60 transition-colors hover:text-muted-foreground"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <svg
          className={cn("size-3 transition-transform", open && "rotate-90")}
          fill="none"
          viewBox="0 0 24 24"
        >
          <path
            d="m9 18 6-6-6-6"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
          />
        </svg>
        <span>{open ? "Hide reasoning" : "Reasoning"}</span>
      </button>
      {open && (
        <div className="mt-1 border-l-2 border-border/60 pl-3 text-[13px] leading-[1.65] whitespace-pre-wrap text-muted-foreground/70">
          {text}
        </div>
      )}
    </div>
  );
}

function PreviewMessage({
  chatId: _chatId,
  message,
  isLoading,
  isLast,
  status,
  onEdit,
  onRegenerate,
}: {
  chatId: string;
  message: ChatMessage;
  isLoading: boolean;
  isLast: boolean;
  status: UseChatHelpers<ChatMessage>["status"];
  onEdit?: (message: ChatMessage) => void;
  onRegenerate?: UseChatHelpers<ChatMessage>["regenerate"];
}) {
  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";

  const hasAnyContent = message.parts?.some(
    (part) =>
      (part.type === "text" && part.text?.trim().length > 0) ||
      (part.type === "reasoning" &&
        "text" in part &&
        part.text?.trim().length > 0) ||
      part.type.startsWith("tool-"),
  );
  const isThinking = isAssistant && isLoading && !hasAnyContent;

  const mergedReasoning = message.parts?.reduce(
    (acc, part) => {
      if (part.type === "reasoning" && part.text?.trim().length > 0) {
        return {
          isStreaming: "state" in part ? part.state === "streaming" : false,
          rendered: false,
          text: acc.text ? `${acc.text}\n\n${part.text}` : part.text,
        };
      }
      return acc;
    },
    { isStreaming: false, rendered: false, text: "" },
  ) ?? { isStreaming: false, rendered: false, text: "" };

  const parts = message.parts?.map((part, index) => {
    const key = `message-${message.id}-part-${index}`;
    const { type } = part;

    if (type === "reasoning") {
      if (!mergedReasoning.rendered && mergedReasoning.text) {
        mergedReasoning.rendered = true;
        return <ReasoningBlock key={key} text={mergedReasoning.text} />;
      }
      return null;
    }

    if (type === "text") {
      return (
        <MessageContent
          className={cn("text-[13px] leading-[1.65]", {
            "w-fit max-w-[min(80%,56ch)] overflow-hidden break-words rounded-2xl rounded-br-lg border border-border/30 bg-gradient-to-br from-secondary to-muted px-3.5 py-2 shadow-[var(--shadow-card)]":
              message.role === "user",
          })}
          data-testid="message-content"
          key={key}
        >
          <MessageResponse>{sanitizeText(part.text)}</MessageResponse>
        </MessageContent>
      );
    }

    if (type === "file") {
      // Attachments sent by the backend (e.g. generated images).
      const isImage = part.mediaType?.startsWith("image/");
      if (isImage) {
        return (
          <img
            alt={part.filename ?? "attachment"}
            className="max-h-64 rounded-lg border border-border/40 object-cover"
            key={key}
            src={part.url}
          />
        );
      }
      return (
        <a
          className="text-[13px] text-foreground underline underline-offset-2"
          href={part.url}
          key={key}
        >
          {part.filename ?? part.url}
        </a>
      );
    }

    // tool-* parts are rendered by the backend's data stream / custom UI;
    // they are intentionally not rendered here.
    return null;
  });

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(getTextFromMessage(message));
  }, [message]);

  const content = isThinking ? (
    <ThinkingText />
  ) : (
    <>
      {parts}
      {isAssistant && isLast && status === "ready" && onRegenerate && (
        <MessageActions className="pt-1 opacity-0 transition-opacity group-hover/message:opacity-100">
          <MessageAction label="Copy" onClick={handleCopy} tooltip="Copy">
            <CopyIcon />
          </MessageAction>
          <MessageAction
            label="Regenerate"
            onClick={() => onRegenerate()}
            tooltip="Regenerate"
          >
            <RefreshCwIcon />
          </MessageAction>
          {onEdit && (
            <MessageAction
              label="Edit"
              onClick={() => onEdit(message)}
              tooltip="Edit"
            >
              <svg className="size-3.5" fill="none" viewBox="0 0 24 24">
                <path
                  d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                />
              </svg>
            </MessageAction>
          )}
        </MessageActions>
      )}
    </>
  );

  return (
    <div
      className={cn(
        "group/message w-full",
        !isAssistant && "animate-[fade-up_0.25s_cubic-bezier(0.22,1,0.36,1)]",
      )}
      data-role={message.role}
      data-testid={`message-${message.role}`}
    >
      <div
        className={cn(
          isUser ? "flex flex-col items-end gap-2" : "flex items-start gap-3",
        )}
      >
        {isAssistant && (
          <div className="flex h-[calc(13px*1.65)] shrink-0 items-center">
            <div className="flex size-7 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground ring-1 ring-border/50">
              <SparklesIcon size={13} />
            </div>
          </div>
        )}
        {isAssistant ? (
          <div className="flex min-w-0 flex-1 flex-col gap-2">{content}</div>
        ) : (
          content
        )}
      </div>
    </div>
  );
}

export { PreviewMessage };

export const ThinkingMessage = () => (
  <div
    className="group/message w-full"
    data-role="assistant"
    data-testid="message-assistant-loading"
  >
    <div className="flex items-start gap-3">
      <div className="flex h-[calc(13px*1.65)] shrink-0 items-center">
        <div className="flex size-7 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground ring-1 ring-border/50">
          <SparklesIcon size={13} />
        </div>
      </div>

      <ThinkingText />
    </div>
  </div>
);
