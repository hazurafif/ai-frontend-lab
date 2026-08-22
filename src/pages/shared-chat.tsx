import { formatDistanceToNow } from "date-fns";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import {
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import { LoaderIcon, SparklesIcon } from "@/components/chat/icons";
import { BASE_PATH } from "@/lib/env";
import { cn, generateUUID } from "@/lib/utils";

// ---------------------------------------------------------------------------
// The backend stores LangChain message objects (type "human" | "ai", string
// or block `content`, `tool_calls`), not the AI SDK UIMessage shape. This
// page normalizes them into a read-only view.
// ---------------------------------------------------------------------------

type SharedRawMessage = {
  id?: string;
  type?: string;
  role?: string;
  content?: string | Array<Record<string, unknown>>;
  tool_calls?: Array<{ id?: string; name?: string; args?: unknown }>;
};

type SharedChat = {
  thread_id: string;
  title: string | null;
  username: string;
  created_at: string | null;
  messages: SharedRawMessage[];
};

type NormalizedMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  reasoning: string;
  toolCalls: Array<{ id: string; name: string; args: unknown }>;
};

function textFromContent(content: SharedRawMessage["content"]): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .filter(
        (block) => block.type === "text" && typeof block.text === "string",
      )
      .map((block) => block.text as string)
      .join("\n");
  }
  return "";
}

function reasoningFromContent(content: SharedRawMessage["content"]): string {
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .filter((block) => block.type === "reasoning")
    .map((block) => {
      if (typeof block.reasoning === "string") {
        return block.reasoning;
      }
      if (typeof block.text === "string") {
        return block.text;
      }
      const extras = block.extras as { content?: unknown } | undefined;
      if (Array.isArray(extras?.content)) {
        return extras.content
          .filter(
            (chunk) =>
              typeof chunk === "object" &&
              chunk !== null &&
              "text" in chunk &&
              typeof (chunk as { text?: unknown }).text === "string",
          )
          .map((chunk) => (chunk as { text: string }).text)
          .join("\n");
      }
      return "";
    })
    .filter((text) => text.length > 0)
    .join("\n\n");
}

function normalizeMessage(raw: SharedRawMessage): NormalizedMessage {
  const isUser = raw.role === "user" || raw.type === "human";
  const toolCalls = (raw.tool_calls ?? []).map((call) => ({
    args: call.args,
    id: call.id ?? generateUUID(),
    name: call.name ?? "tool",
  }));

  const text =
    isUser || raw.role === "assistant" || raw.type === "ai"
      ? textFromContent(raw.content)
      : "";

  return {
    id: raw.id ?? generateUUID(),
    reasoning: isUser ? "" : reasoningFromContent(raw.content),
    role: isUser ? "user" : "assistant",
    text,
    toolCalls,
  };
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

function SharedMessage({ message }: { message: NormalizedMessage }) {
  const isUser = message.role === "user";

  return (
    <div
      className={cn(
        "w-full",
        isUser ? "flex flex-col items-end gap-2" : "flex items-start gap-3",
      )}
      data-role={message.role}
    >
      {!isUser && (
        <div className="flex h-[calc(13px*1.65)] shrink-0 items-center">
          <div className="flex size-7 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground ring-1 ring-border/50">
            <SparklesIcon size={13} />
          </div>
        </div>
      )}
      <div className={cn("flex min-w-0 flex-col gap-2", isUser && "items-end")}>
        {message.text && (
          <MessageContent
            className={cn("text-[13px] leading-[1.65]", {
              "w-fit max-w-[min(80%,56ch)] overflow-hidden break-words rounded-2xl rounded-br-lg border border-border/30 bg-gradient-to-br from-secondary to-muted px-3.5 py-2 shadow-[var(--shadow-card)]":
                isUser,
            })}
          >
            <MessageResponse>{message.text}</MessageResponse>
          </MessageContent>
        )}
        {message.reasoning && <ReasoningBlock text={message.reasoning} />}
        {message.toolCalls.length > 0 && (
          <div className="flex flex-col gap-1">
            {message.toolCalls.map((call) => (
              <div
                className="rounded-lg bg-muted/40 px-3 py-1.5 font-mono text-[12px] text-muted-foreground ring-1 ring-border/40"
                key={call.id}
              >
                {call.name}({JSON.stringify(call.args)})
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function SharedChatPage() {
  const params = useParams<{ shareId: string }>();
  const shareId = params.shareId ?? "";
  const [chat, setChat] = useState<SharedChat | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch(`${BASE_PATH}/api/share/shared/${shareId}`)
      .then(async (response) => {
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as {
            detail?: string;
          } | null;
          throw new Error(body?.detail ?? "Share link not found");
        }
        return response.json() as Promise<SharedChat>;
      })
      .then((data) => {
        if (!cancelled) {
          setChat(data);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "This share link is invalid or has been revoked.",
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [shareId]);

  if (error) {
    return (
      <main className="flex h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="text-lg font-medium">Shared chat unavailable</h1>
        <p className="max-w-sm text-sm text-muted-foreground">{error}</p>
        <Link
          className="text-sm text-foreground underline underline-offset-3 transition-colors hover:text-muted-foreground"
          to="/"
        >
          Go to AI Chat
        </Link>
      </main>
    );
  }

  if (!chat) {
    return (
      <main className="flex h-dvh items-center justify-center gap-2 text-sm text-muted-foreground">
        <span className="animate-spin">
          <LoaderIcon />
        </span>
        Loading shared chat…
      </main>
    );
  }

  const messages = chat.messages.map(normalizeMessage);

  return (
    <main className="flex min-h-dvh flex-col bg-background">
      <header className="sticky top-0 z-10 border-b border-border/50 bg-background/80 backdrop-blur">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-1 px-4 py-4 md:px-4">
          <h1 className="truncate text-[15px] font-medium">
            {chat.title ?? "Shared chat"}
          </h1>
          <p className="text-[13px] text-muted-foreground">
            Shared by {chat.username}
            {chat.created_at
              ? ` · ${formatDistanceToNow(new Date(chat.created_at), { addSuffix: true })}`
              : null}
          </p>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-4 px-4 py-6 md:px-4">
        {messages.map((message) => (
          <SharedMessage key={message.id} message={message} />
        ))}
      </div>

      <footer className="border-t border-border/50">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between px-4 py-3 md:px-4">
          <span className="text-xs text-muted-foreground">
            Shared conversation
          </span>
          <Link
            className="text-xs text-muted-foreground underline underline-offset-3 transition-colors hover:text-foreground"
            to="/"
          >
            Create your own with AI Chat
          </Link>
        </div>
      </footer>
    </main>
  );
}
