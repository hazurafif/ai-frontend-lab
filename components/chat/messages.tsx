"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import { ArrowDownIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMessages } from "@/hooks/use-messages";
import type { ChatMessage } from "@/lib/types";
import { Greeting } from "./greeting";
import { PreviewMessage, ThinkingMessage } from "./message";

type MessagesProps = {
  chatId: string;
  /** True when ChatShell renders the centered new-chat composer (greeting + input). */
  empty?: boolean;
  status: UseChatHelpers<ChatMessage>["status"];
  messages: ChatMessage[];
  regenerate: UseChatHelpers<ChatMessage>["regenerate"];
  isLoading?: boolean;
  onEditMessage?: (message: ChatMessage) => void;
  onRewind?: (message: ChatMessage) => void;
};

function PureMessages({
  chatId,
  empty = false,
  status,
  messages,
  regenerate,
  isLoading,
  onEditMessage,
  onRewind,
}: MessagesProps) {
  const {
    containerRef: messagesContainerRef,
    endRef: messagesEndRef,
    isAtBottom,
    scrollToBottom,
    hasSentMessage,
    reset,
  } = useMessages({
    status,
  });

  const prevChatIdRef = useRef(chatId);
  useEffect(() => {
    if (prevChatIdRef.current !== chatId) {
      prevChatIdRef.current = chatId;
      reset();
    }
  }, [chatId, reset]);

  const handleScrollToBottom = useCallback(() => {
    scrollToBottom("smooth");
  }, [scrollToBottom]);

  // Messages come from localStorage (client-only), so the tree must not be
  // rendered during SSR/hydration — otherwise server (empty) and client
  // (history) HTML differ and React logs a hydration mismatch.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <div className="relative flex-1 bg-background" />;
  }

  return (
    <div className="relative flex-1 bg-background">
      {!empty && messages.length === 0 && !isLoading && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <Greeting />
        </div>
      )}
      <div
        className="absolute inset-0 touch-pan-y overflow-y-auto"
        ref={messagesContainerRef}
      >
        <div className="mx-auto flex h-full max-w-4xl flex-col gap-4 px-4 pt-14 pb-2 md:px-4">
          {messages.map((message, index) => (
            <PreviewMessage
              chatId={chatId}
              isLoading={isLoading ?? false}
              isLast={index === messages.length - 1}
              key={message.id}
              message={message}
              onEdit={onEditMessage}
              onRegenerate={regenerate}
              onRewind={onRewind}
              status={status}
            />
          ))}

          {isLoading && messages.at(-1)?.role === "user" && <ThinkingMessage />}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {!isAtBottom && hasSentMessage && (
        <button
          className="absolute bottom-4 left-1/2 z-10 flex size-10 -translate-x-1/2 items-center justify-center rounded-full border border-border/60 bg-background/80 text-foreground shadow-[var(--shadow-float)] backdrop-blur-sm transition-opacity duration-150 hover:bg-muted"
          onClick={handleScrollToBottom}
          type="button"
        >
          <ArrowDownIcon className="size-4" />
        </button>
      )}
    </div>
  );
}

export const Messages = PureMessages;
