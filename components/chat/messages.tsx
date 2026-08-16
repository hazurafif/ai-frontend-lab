"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import { CornerDownRightIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/use-auth";
import { updateHistoryTitle } from "@/lib/chat/history";
import { storageScope } from "@/lib/storage";
import { fetchThreadFollowUps } from "@/lib/threads";
import type { ChatMessage } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Greeting } from "./greeting";
import { PreviewMessage } from "./message";

type MessagesProps = {
  chatId: string;
  /** True when ChatShell renders the centered new-chat composer (greeting + input). */
  empty?: boolean;
  /** True while the opened chat's history is fetched from the server —
   * render a skeleton instead of the greeting. */
  historyLoading?: boolean;
  status: UseChatHelpers<ChatMessage>["status"];
  messages: ChatMessage[];
  regenerate: UseChatHelpers<ChatMessage>["regenerate"];
  isLoading?: boolean;
  onEditMessage?: (message: ChatMessage) => void;
  onRewind?: (message: ChatMessage) => void;
  /** Send a suggested follow-up question as a new user message. */
  onSendPrompt?: (text: string) => void;
};

/** Placeholder conversation shown while a chat's history loads from the
 * server: mirrors the real message flow (assistant avatar + answer lines
 * alternating with right-aligned user bubbles of varying widths) and stays
 * anchored at the bottom, where the latest messages appear. */
const SKELETON_ROWS: Array<{
  role: "user" | "assistant";
  /** Answer text lines for assistant rows. */
  lines?: number;
  /** Bubble width for user rows. */
  bubble?: string;
}> = [
  { role: "assistant", lines: 3 },
  { role: "user", bubble: "w-[min(55%,320px)]" },
  { role: "assistant", lines: 2 },
  { role: "user", bubble: "w-[min(35%,220px)]" },
  { role: "assistant", lines: 3 },
  { role: "user", bubble: "w-[min(48%,280px)]" },
];

function HistoryLoadingSkeleton() {
  return (
    <div
      className="pointer-events-none absolute inset-0 z-10 flex flex-col justify-end"
      role="status"
      aria-live="polite"
    >
      <span className="sr-only">Loading conversation…</span>
      <div
        aria-hidden="true"
        className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-3 pt-4 pb-2 md:px-4"
      >
        {SKELETON_ROWS.map((row, index) =>
          row.role === "assistant" ? (
            <div className="flex items-start gap-3" key={index}>
              <div className="hidden h-[calc(13px*1.65)] shrink-0 items-center md:flex">
                <Skeleton className="motion-reduce:animate-none size-7 rounded-lg" />
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                {Array.from({ length: row.lines ?? 2 }).map((_, line) => (
                  <Skeleton
                    className={cn(
                      "motion-reduce:animate-none h-3.5 rounded-full",
                      // Last line shorter — mimics a natural answer.
                      line === (row.lines ?? 2) - 1 && "w-3/5",
                    )}
                    key={line}
                  />
                ))}
              </div>
            </div>
          ) : (
            <div className="flex w-full flex-col items-end gap-2" key={index}>
              <Skeleton
                className={cn(
                  "motion-reduce:animate-none h-9 rounded-2xl rounded-br-lg",
                  row.bubble,
                )}
              />
            </div>
          ),
        )}
      </div>
    </div>
  );
}

function PureMessages({
  chatId,
  empty = false,
  historyLoading = false,
  status,
  messages,
  regenerate,
  isLoading,
  onEditMessage,
  onRewind,
  onSendPrompt,
}: MessagesProps) {
  // Storage scope for the local history mirror (per signed-in user) — the
  // auto-generated title must land in the right account's cache.
  const scope = storageScope(useAuth().user?.username);

  const prevChatIdRef = useRef(chatId);
  useEffect(() => {
    if (prevChatIdRef.current !== chatId) {
      prevChatIdRef.current = chatId;
      setFollowUps(null);
    }
  }, [chatId]);

  // Suggested follow-up questions (backend POST /threads/{id}/followup),
  // fetched once per completed run and shown under the assistant message
  // they belong to. Re-fetches when the last message id changes.
  const lastMessage = messages.at(-1);
  const lastMessageId = lastMessage?.id ?? null;
  const [followUps, setFollowUps] = useState<{
    messageId: string;
    items: string[];
  } | null>(null);

  useEffect(() => {
    if (
      status !== "ready" ||
      lastMessageId === null ||
      lastMessage?.role !== "assistant"
    ) {
      return;
    }
    let cancelled = false;
    fetchThreadFollowUps(chatId)
      .then((data) => {
        if (cancelled || !data) {
          return;
        }
        // The backend auto-generates a title on the first run and upserts
        // it server-side; mirror it into the local history so the sidebar
        // picks it up without waiting for a reload.
        updateHistoryTitle(scope, chatId, data.title);
        if (data.followups.length === 0) {
          return;
        }
        setFollowUps({ items: data.followups, messageId: lastMessageId });
      })
      .catch(() => {
        // offline / no report — no suggestions
      });
    return () => {
      cancelled = true;
    };
  }, [chatId, lastMessage?.role, lastMessageId, scope, status]);

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
      {!empty && messages.length === 0 && !isLoading && !historyLoading && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <Greeting />
        </div>
      )}
      {/*
        MessageScroller owns scroll behavior (streaming follow, anchoring on
        the user message of each turn, jump-to-latest). Keying the provider
        on chatId resets scroll to the end when switching conversations.
      */}
      <MessageScrollerProvider autoScroll defaultScrollPosition="end">
        <MessageScroller className="absolute inset-0" key={chatId}>
          <MessageScrollerViewport className="touch-pan-y">
            <MessageScrollerContent className="mx-auto w-full max-w-4xl gap-4 px-3 pt-4 pb-2 md:px-4">
              {messages.map((message, index) => (
                <MessageScrollerItem key={message.id} messageId={message.id}>
                  <PreviewMessage
                    chatId={chatId}
                    isLoading={isLoading ?? false}
                    isLast={index === messages.length - 1}
                    message={message}
                    onEdit={onEditMessage}
                    onRegenerate={regenerate}
                    onRewind={onRewind}
                    status={status}
                  />
                </MessageScrollerItem>
              ))}

              {followUps &&
                followUps.messageId === lastMessageId &&
                lastMessage?.role === "assistant" &&
                status === "ready" &&
                !isLoading && (
                  <div className="flex flex-col gap-2 pl-3 pb-4">
                    <span className="text-[11px] text-muted-foreground">
                      Suggested
                    </span>
                    <div className="flex flex-col items-start gap-1.5">
                      {followUps.items.map((question) => (
                        <button
                          className="flex w-fit max-w-[min(480px,100%)] items-start gap-2 rounded-xl border border-border/60 bg-card/50 px-3 py-2 text-left text-[12px] text-foreground transition-colors duration-150 hover:border-foreground/30 hover:bg-muted/40"
                          key={question}
                          onClick={() => onSendPrompt?.(question)}
                          type="button"
                        >
                          <CornerDownRightIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                          {question}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton className="max-md:size-10" />
        </MessageScroller>
      </MessageScrollerProvider>

      {historyLoading && messages.length === 0 && <HistoryLoadingSkeleton />}
    </div>
  );
}

export const Messages = PureMessages;
