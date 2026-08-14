"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import type { FileUIPart } from "ai";
import {
  BrainIcon,
  ChevronDownIcon,
  CopyIcon,
  Loader2Icon,
  RefreshCwIcon,
  RotateCcwIcon,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { extractPrefabPayload } from "@/lib/prefab";
import type { ChatMessage } from "@/lib/types";
import { cn, getTextFromMessage, sanitizeText } from "@/lib/utils";
import {
  Attachment,
  AttachmentInfo,
  AttachmentPreview,
  Attachments,
} from "../ai-elements/attachments";
import { InterruptCard } from "../ai-elements/interrupt-card";
import {
  MessageAction,
  MessageActions,
  MessageContent,
  MessageResponse,
} from "../ai-elements/message";
import { PrefabAppCard } from "../ai-elements/prefab-app";
import { Shimmer } from "../ai-elements/shimmer";
import { SubagentCard } from "../ai-elements/subagent-card";
import { ToolCard, type ToolUIPart } from "../ai-elements/tool-card";
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

/**
 * Reasoning (thinking) content, rendered like a tool call card: collapsed
 * by default, auto-opened while the model is still deliberating so the
 * reasoning streams in live.
 */
function ReasoningBlock({
  isStreaming,
  text,
}: {
  isStreaming?: boolean;
  text: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Collapsible
      className="w-full max-w-[min(560px,100%)] overflow-hidden rounded-xl border border-border/60 bg-card/50"
      onOpenChange={setOpen}
      // Collapsed by default, like tool cards — the spinner badge in the
      // header shows progress while the model deliberates.
      open={open}
    >
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/40">
        <BrainIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="text-[12px] font-medium text-foreground">
          Thinking
        </span>
        {isStreaming && (
          <Badge className="ml-auto" variant="secondary">
            <Loader2Icon className="animate-spin" />
            Thinking…
          </Badge>
        )}
        <ChevronDownIcon
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform",
            // Only one ml-auto at a time — two auto margins would split the
            // free space and park the spinner mid-card (the badge owns it
            // while streaming; the chevron takes over when done).
            !isStreaming && "ml-auto",
            open && "rotate-180",
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="border-t border-border/60 px-3 py-2.5 text-[13px] leading-[1.65] whitespace-pre-wrap text-muted-foreground/80">
          {text}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function ToolPart({ part }: { part: ToolUIPart }) {
  // FastMCP Prefab apps (structuredContent envelopes) render as an inline
  // app block in the message flow; everything else keeps the tool card.
  const prefab = useMemo(
    () => extractPrefabPayload(part.output),
    [part.output],
  );
  if (prefab !== null) {
    return <PrefabAppCard part={part} prefab={prefab} />;
  }
  return <ToolCard part={part} />;
}

function PreviewMessage({
  chatId: _chatId,
  message,
  isLoading,
  isLast,
  status,
  onEdit,
  onRegenerate,
  onRewind,
}: {
  chatId: string;
  message: ChatMessage;
  isLoading: boolean;
  isLast: boolean;
  status: UseChatHelpers<ChatMessage>["status"];
  onEdit?: (message: ChatMessage) => void;
  onRegenerate?: UseChatHelpers<ChatMessage>["regenerate"];
  onRewind?: (message: ChatMessage) => void;
}) {
  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";

  // Rewind confirmation: the action drops this message and everything after
  // it — not undoable, so confirm first.
  const [rewindConfirm, setRewindConfirm] = useState(false);

  // Sent time for the user message footer. The backend doesn't emit per-
  // message timestamps, so metadata.createdAt is only present for locally
  // stamped messages; otherwise fall back to the render time (stable per
  // message via the id-keyed memo).
  const sentAt = useMemo(() => {
    if (!isUser) {
      return null;
    }
    const iso = message.metadata?.createdAt;
    const date = iso ? new Date(iso) : new Date();
    if (Number.isNaN(date.getTime())) {
      return null;
    }
    return date.toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
  }, [isUser, message.id, message.metadata?.createdAt]);

  const hasAnyContent = message.parts?.some(
    (part) =>
      (part.type === "text" && part.text?.trim().length > 0) ||
      (part.type === "reasoning" &&
        "text" in part &&
        part.text?.trim().length > 0) ||
      part.type.startsWith("tool-") ||
      part.type === "custom",
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
        return (
          <ReasoningBlock
            isStreaming={mergedReasoning.isStreaming}
            key={key}
            text={mergedReasoning.text}
          />
        );
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
      const filePart = part as unknown as FileUIPart;
      const localFile =
        "file" in part && part.file instanceof File ? part.file : undefined;
      // Locally attached file (picked in the composer): show a preview chip —
      // the backend only receives the bytes, not a URL.
      if (localFile || filePart.filename) {
        return (
          <Attachments key={key} variant="inline">
            <Attachment
              className="cursor-default hover:bg-transparent"
              data={{
                filename: filePart.filename ?? localFile?.name,
                id: `file-${key}`,
                mediaType: filePart.mediaType,
                type: "file",
                url: filePart.url ?? "",
              }}
            >
              <AttachmentPreview />
              <AttachmentInfo showMediaType={false} />
            </Attachment>
          </Attachments>
        );
      }
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

    if (type.startsWith("tool-")) {
      // Tool call card: name, status badge, input/output (AI SDK tool
      // parts) — or the inline Prefab app block when the tool returned one.
      return <ToolPart key={key} part={part as unknown as ToolUIPart} />;
    }

    if (type === "custom") {
      // Custom parts: subagent delegation cards from the backend.
      // `app.subagent` is the current kind; "subagent" matches history
      // persisted before the rename.
      const isSubagent =
        part.kind === "app.subagent" || (part.kind as string) === "subagent";
      if (isSubagent) {
        return <SubagentCard key={key} part={part} />;
      }
      // Human-in-the-loop pause: approval card. Only the card on the last
      // assistant message is actionable — resuming truncates that message.
      if (part.kind === "app.interrupt") {
        return (
          <InterruptCard
            active={isAssistant && isLast && status === "ready"}
            key={key}
            message={message}
            part={part}
          />
        );
      }
      return null;
    }

    // other tool-* / data-* parts are rendered by the backend's custom UI;
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
          isUser
            ? "flex w-full flex-col items-end gap-2"
            : "flex items-start gap-3",
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
          <>
            {parts}
            {/* MessageFooter pattern: time + actions below the bubble,
                aligned to its right edge (px-3.5 matches the bubble's
                padding). Revealed on hover, like the actions. */}
            <MessageActions className="w-full justify-end gap-2 px-3.5 pb-0.5 opacity-0 transition-opacity group-hover/message:opacity-100">
              {sentAt && (
                <span className="text-[11px] tabular-nums text-muted-foreground">
                  {sentAt}
                </span>
              )}
              <span className="flex items-center gap-1">
                {onRewind && (
                  <Popover onOpenChange={setRewindConfirm} open={rewindConfirm}>
                    <PopoverTrigger
                      render={
                        <Button
                          aria-label="Rewind"
                          size="icon-sm"
                          type="button"
                          variant="ghost"
                        >
                          <RotateCcwIcon />
                        </Button>
                      }
                    />
                    <PopoverContent
                      align="end"
                      className="w-60 p-3"
                      side="bottom"
                      sideOffset={6}
                    >
                      <div className="flex flex-col gap-2.5">
                        <p className="text-[12px] leading-relaxed text-muted-foreground">
                          Remove this message and everything after it? This
                          cannot be undone.
                        </p>
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            onClick={() => setRewindConfirm(false)}
                            size="sm"
                            type="button"
                            variant="ghost"
                          >
                            Cancel
                          </Button>
                          <Button
                            onClick={() => {
                              setRewindConfirm(false);
                              onRewind(message);
                            }}
                            size="sm"
                            type="button"
                            variant="secondary"
                          >
                            Rewind
                          </Button>
                        </div>
                      </div>
                    </PopoverContent>
                  </Popover>
                )}
                <MessageAction label="Copy" onClick={handleCopy} tooltip="Copy">
                  <CopyIcon />
                </MessageAction>
              </span>
            </MessageActions>
          </>
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
