"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import { useChat } from "@ai-sdk/react";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "@/components/chat/toast";
import { UploadChatTransport } from "@/hooks/chat-transport";
import { useAuth } from "@/hooks/use-auth";
import { authHeaders } from "@/lib/auth";
import { useThreads } from "@/lib/chat/chat-store";
import { AttachMerger, isAttachTerminalEvent } from "@/lib/chat/message-merge";
import { readSSE } from "@/lib/chat/sse";
import {
  CHAT_STORAGE_PREFIX,
  HISTORY_CHANGED_EVENT,
  HISTORY_STORAGE_KEY,
  SETTINGS_CHANGED_EVENT,
} from "@/lib/constants";
import { ChatbotError } from "@/lib/errors";
import { DEFAULT_CHAT_MODEL } from "@/lib/models";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  type ThinkingEffort,
} from "@/lib/settings";
import {
  cancelThread,
  deleteThread,
  fetchThreadMessages,
  fetchThreads,
  serverMessagesToChatMessages,
} from "@/lib/threads";
import type { ChatHistoryItem, ChatMessage } from "@/lib/types";
import {
  fetchWithErrorHandlers,
  generateUUID,
  getTextFromMessage,
} from "@/lib/utils";

type ActiveChatContextValue = {
  chatId: string;
  messages: ChatMessage[];
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
  sendMessage: UseChatHelpers<ChatMessage>["sendMessage"];
  status: UseChatHelpers<ChatMessage>["status"];
  stop: UseChatHelpers<ChatMessage>["stop"];
  regenerate: UseChatHelpers<ChatMessage>["regenerate"];
  /** Rewind to a past user message: drop it + everything after, restore its text in the input. */
  rewindMessage: (messageId: string) => void;
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  isLoading: boolean;
  currentModelId: string;
  setCurrentModelId: (id: string) => void;
  thinkingEffort: ThinkingEffort;
  setThinkingEffort: (effort: ThinkingEffort) => void;
  deleteChat: (chatId: string) => void;
  deleteAllChats: () => void;
  /** Start a fresh conversation, also when already on "/". */
  newChat: () => void;
  /** Resume a human-in-the-loop interrupt with a decision payload
   * (`{decision}` for a single action request, `{decisions}` for several).
   * Passed straight into the request body — wrapping it again would nest
   * the decision and break the backend's HITL resume ("'type'" error). */
  resumeInterrupt: (
    messageId: string,
    decisionPayload: Record<string, unknown>,
  ) => void;
  /** Replace the message with the given id (dropping everything after it). */
  editMessage: (originalMessageId: string, newText: string) => void;
};

const ActiveChatContext = createContext<ActiveChatContextValue | null>(null);

// --- localStorage persistence -------------------------------------------------

function loadMessages(chatId: string): ChatMessage[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(`${CHAT_STORAGE_PREFIX}${chatId}`);
    return raw ? (JSON.parse(raw) as ChatMessage[]) : [];
  } catch {
    return [];
  }
}

function saveMessages(chatId: string, messages: ChatMessage[]) {
  try {
    window.localStorage.setItem(
      `${CHAT_STORAGE_PREFIX}${chatId}`,
      JSON.stringify(messages),
    );
  } catch {
    // storage unavailable — ignore
  }
}

function loadHistory(): ChatHistoryItem[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(HISTORY_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ChatHistoryItem[]) : [];
  } catch {
    return [];
  }
}

function saveHistory(history: ChatHistoryItem[]) {
  try {
    window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
  } catch {
    // ignore
  }
}

function notifyHistoryChanged() {
  window.dispatchEvent(new Event(HISTORY_CHANGED_EVENT));
}

/** First-user-text title, truncated to 40 chars. */
function truncateTitle(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return "New chat";
  }
  return trimmed.length > 40 ? `${trimmed.slice(0, 40)}…` : trimmed;
}

function titleFromMessages(messages: ChatMessage[]): string {
  const firstUserText = messages
    .filter((m) => m.role === "user")
    .map((m) => getTextFromMessage(m).trim())
    .find((t) => t.length > 0);

  return firstUserText ? truncateTitle(firstUserText) : "New chat";
}

/**
 * Add a sidebar row for a thread before the backend confirms it (durable
 * chat: the row appears the moment you hit send, marked running). No-op
 * when the row already exists.
 */
function ensureHistoryRow(chatId: string, title: string) {
  const history = loadHistory();
  if (history.some((chat) => chat.id === chatId)) {
    return;
  }
  saveHistory([
    { id: chatId, title, createdAt: new Date().toISOString() },
    ...history,
  ]);
  notifyHistoryChanged();
}

function upsertHistory(chatId: string, messages: ChatMessage[]) {
  if (messages.length === 0) {
    return;
  }

  const history = loadHistory();
  const existing = history.find((chat) => chat.id === chatId);
  const title = titleFromMessages(messages);

  const next = existing
    ? history.map((chat) =>
        chat.id === chatId && chat.title === "New chat"
          ? { ...chat, title }
          : chat,
      )
    : [{ id: chatId, title, createdAt: new Date().toISOString() }, ...history];

  saveHistory(next);
  notifyHistoryChanged();
}

function extractChatId(pathname: string): string | null {
  const match = pathname.match(/\/chat\/([^/]+)/);
  return match ? match[1] : null;
}

// --- provider ----------------------------------------------------------------

export function ActiveChatProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { isAuthenticated } = useAuth();
  const { markThreadRunning, setActiveThreadId, statuses } = useThreads();

  const chatIdFromUrl = extractChatId(pathname);
  const isNewChat = !chatIdFromUrl;
  // The id of the ad-hoc "new chat" session on "/". Regenerated on every
  // visit to "/" (pathname change) and on explicit "New chat" clicks.
  // State (not a ref) so a click can regenerate it in place while already
  // on "/" — there router.push("/") is a no-op and the pathname check
  // below never fires, which made the sidebar button do nothing.
  const [newChatId, setNewChatId] = useState(generateUUID());
  const prevPathnameRef = useRef(pathname);

  if (isNewChat && prevPathnameRef.current !== pathname) {
    setNewChatId(generateUUID());
  }
  prevPathnameRef.current = pathname;

  const chatId = chatIdFromUrl ?? newChatId;
  // Previous active chat (for the load effect: reset on switch + detach a
  // still-streaming fetch without cancelling its server run).
  const prevChatIdRef = useRef(chatId);

  // The chat starts with the model saved in /settings; the selector in the
  // chat input overrides it per conversation. Mount-gated so the server
  // render (default model) matches the client's first render — the saved
  // model is applied in the effect below (see settings-change subscription).
  const [currentModelId, setCurrentModelIdState] = useState(DEFAULT_CHAT_MODEL);
  const currentModelIdRef = useRef(currentModelId);
  useEffect(() => {
    currentModelIdRef.current = currentModelId;
  }, [currentModelId]);

  // The chat input and /settings share one model setting. Initialize from
  // the saved settings (localStorage) on mount and follow any changes made
  // elsewhere (e.g. the Model tab in /settings) via the settings-changed
  // event. Mount-gated so the server render matches the client's first
  // render.
  useEffect(() => {
    setCurrentModelIdState(loadSettings().model);
    const handleSettingsChanged = () => {
      setCurrentModelIdState(loadSettings().model);
    };
    window.addEventListener(SETTINGS_CHANGED_EVENT, handleSettingsChanged);
    return () => {
      window.removeEventListener(SETTINGS_CHANGED_EVENT, handleSettingsChanged);
    };
  }, []);

  // Persist picks made in the chat input so /settings reflects them too.
  const setCurrentModelId = useCallback((id: string) => {
    setCurrentModelIdState(id);
    saveSettings({ ...loadSettings(), model: id });
  }, []);

  const [input, setInput] = useState("");

  // The thinking-effort level chosen next to the model selector. Persisted
  // to settings and sent with every chat request as `thinking` (the backend's
  // agent-config field name + level set).
  const [thinkingEffort, setThinkingEffortState] = useState<ThinkingEffort>(
    DEFAULT_SETTINGS.thinkingEffort,
  );
  const thinkingEffortRef = useRef(thinkingEffort);
  useEffect(() => {
    thinkingEffortRef.current = thinkingEffort;
  }, [thinkingEffort]);

  useEffect(() => {
    setThinkingEffortState(loadSettings().thinkingEffort);
    const handleSettingsChanged = () => {
      setThinkingEffortState(loadSettings().thinkingEffort);
    };
    window.addEventListener(SETTINGS_CHANGED_EVENT, handleSettingsChanged);
    return () => {
      window.removeEventListener(SETTINGS_CHANGED_EVENT, handleSettingsChanged);
    };
  }, []);

  // Persist picks made in the chat input so /settings reflects them too.
  const setThinkingEffort = useCallback((effort: ThinkingEffort) => {
    setThinkingEffortState(effort);
    saveSettings({ ...loadSettings(), thinkingEffort: effort });
  }, []);

  const { messages, setMessages, sendMessage, status, stop, regenerate } =
    useChat<ChatMessage>({
      generateId: generateUUID,
      id: chatId,
      messages: loadMessages(chatId),
      onError: (error) => {
        if (error instanceof ChatbotError) {
          toast({ description: error.message, type: "error" });
        } else {
          toast({
            description: error.message || "Oops, an error occurred!",
            type: "error",
          });
        }
      },
      transport: new UploadChatTransport({
        api: `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/chat`,
        fetch: fetchWithErrorHandlers,
        prepareSendMessagesRequest(request) {
          return {
            headers: authHeaders(),
            body: {
              id: request.id,
              messages: request.messages,
              selectedChatModel: currentModelIdRef.current,
              thinking: thinkingEffortRef.current,
              // Web-search toggle from /settings; the backend overrides its
              // SEARXNG_ENABLED config per request (enableSearch alias).
              enableSearch: loadSettings().searxngEnabled,
              ...request.body,
            },
          };
        },
        prepareReconnectToStreamRequest() {
          return { headers: authHeaders() };
        },
      }),
    });

  // The run status of the thread in the URL (absent for the ad-hoc new
  // chat on "/"). Drives the attach stream (flow D) and the rehydrate
  // effect below.
  const threadStatus = chatIdFromUrl ? (statuses[chatIdFromUrl] ?? null) : null;

  // Latest status, readable from callbacks without re-creating them.
  const statusRef = useRef(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  // Durable chat (flow A): the moment a send starts, mark the thread
  // running in the sidebar and make sure it has a history row. The backend
  // confirms both within milliseconds (thread metadata is upserted at run
  // start, status "running"), and the notification stream keeps statuses
  // live from there on.
  const sendMessageTracked = useCallback(
    (
      args: Parameters<UseChatHelpers<ChatMessage>["sendMessage"]>[0],
      options?: Parameters<UseChatHelpers<ChatMessage>["sendMessage"]>[1],
    ) => {
      if (isAuthenticated) {
        // The SDK's message type is a messy union — extract the sent text
        // through a minimal structural shape.
        const draft = args as
          | { parts?: { text?: unknown }[]; content?: unknown }
          | undefined;
        const sentText =
          (draft && Array.isArray(draft.parts)
            ? draft.parts
                .map((part) => (typeof part.text === "string" ? part.text : ""))
                .join(" ")
            : typeof draft?.content === "string"
              ? draft.content
              : "") || input;
        markThreadRunning(chatId);
        ensureHistoryRow(chatId, truncateTitle(sentText));
      }
      return sendMessage(args, options);
    },
    [chatId, input, isAuthenticated, markThreadRunning, sendMessage],
  );

  // Load persisted messages when the active chat changes; detach a still-
  // streaming fetch when navigating away (durable chat: the run keeps going
  // server-side, history is persisted incrementally). When the local cache
  // is empty (new device / cleared cache), rehydrate the conversation from
  // the server. Threads with a run in flight skip the cache path — the
  // attach effect below owns the authoritative live baseline.
  useEffect(() => {
    const changed = prevChatIdRef.current !== chatId;
    prevChatIdRef.current = chatId;
    if (changed) {
      // Abort-only: does NOT cancel the server run.
      if (
        statusRef.current === "submitted" ||
        statusRef.current === "streaming"
      ) {
        stopRef.current();
      }
      setMessages(loadMessages(chatId));
      setInput("");
    }
    if (!chatIdFromUrl || !isAuthenticated || threadStatus === "running") {
      return;
    }
    let cancelled = false;
    fetchThreadMessages(chatIdFromUrl)
      .then((server) => {
        if (cancelled || !Array.isArray(server) || server.length === 0) {
          return;
        }
        setMessages((current) =>
          current.length === 0 ? serverMessagesToChatMessages(server) : current,
        );
      })
      .catch(() => {
        // offline/backend error — keep whatever the local cache has
      });
    return () => {
      cancelled = true;
    };
  }, [chatId, chatIdFromUrl, isAuthenticated, setMessages, threadStatus]);

  // Durable chat (flow D): opening a thread whose run is in flight (started
  // elsewhere — another tab, or "new chat" while answering) attaches a live
  // stream to it. History is the authoritative baseline (the backend writes
  // finalized messages incrementally), then message deltas merge in by
  // message id until the run ends (done/interrupt/error → re-fetch history
  // once to reconcile). A 409 (run just finished) falls back to the same
  // history re-fetch.
  const attachActive =
    isAuthenticated &&
    chatIdFromUrl !== null &&
    threadStatus === "running" &&
    status !== "submitted" &&
    status !== "streaming";

  useEffect(() => {
    if (!attachActive) {
      return;
    }
    let cancelled = false;
    let sawTerminal = false;
    const controller = new AbortController();
    const merger = new AttachMerger();
    const refetchHistory = async () => {
      try {
        const server = await fetchThreadMessages(chatIdFromUrl);
        if (cancelled || !Array.isArray(server) || server.length === 0) {
          return;
        }
        setMessages(serverMessagesToChatMessages(server));
      } catch {
        // offline — keep the merged list
      }
    };
    void (async () => {
      // Baseline: the backend writes finalized messages incrementally, so
      // history at attach time is the authoritative starting point (the
      // local cache may predate this run).
      try {
        const server = await fetchThreadMessages(chatIdFromUrl);
        if (!cancelled && Array.isArray(server) && server.length > 0) {
          setMessages(serverMessagesToChatMessages(server));
        }
      } catch {
        // offline — attach on top of whatever we have
      }
      if (cancelled) {
        return;
      }
      try {
        await readSSE(
          `/api/chat/threads/${encodeURIComponent(chatIdFromUrl)}/stream`,
          (event, data) => {
            if (cancelled) {
              return;
            }
            if (isAttachTerminalEvent(event)) {
              sawTerminal = true;
              void refetchHistory();
              return;
            }
            if (typeof data !== "object" || data === null) {
              return;
            }
            setMessages(
              (current) =>
                merger.merge(current, event, data as Record<string, unknown>) ??
                current,
            );
          },
          controller.signal,
          { headers: authHeaders() },
        );
      } catch {
        // 409 (no active run) / stream error — fall through to history
      }
      if (!cancelled && !sawTerminal) {
        void refetchHistory();
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [attachActive, chatIdFromUrl, setMessages]);

  // The thread the user is currently looking at — the notification store
  // suppresses completion toasts for it (the user is watching it already).
  useEffect(() => {
    setActiveThreadId(chatIdFromUrl ?? newChatId);
  }, [chatIdFromUrl, newChatId, setActiveThreadId]);

  // Persist messages after streaming finishes (and on any non-streaming change).
  const prevStatusRef = useRef(status);
  useEffect(() => {
    const statusChanged = prevStatusRef.current !== status;
    prevStatusRef.current = status;

    if (status === "streaming") {
      return;
    }

    saveMessages(chatId, messages);

    if (statusChanged && (status === "ready" || status === "error")) {
      upsertHistory(chatId, messages);
    }
  }, [chatId, messages, status]);

  const deleteChat = useCallback(
    (chatIdToDelete: string) => {
      const history = loadHistory().filter(
        (chat) => chat.id !== chatIdToDelete,
      );
      saveHistory(history);
      try {
        window.localStorage.removeItem(
          `${CHAT_STORAGE_PREFIX}${chatIdToDelete}`,
        );
      } catch {
        // ignore
      }
      notifyHistoryChanged();
      // Also delete the thread server-side (best-effort, scoped to the user).
      if (isAuthenticated) {
        deleteThread(chatIdToDelete).catch(() => {
          // offline / already gone — the local removal stands
        });
      }
    },
    [isAuthenticated],
  );

  const deleteAllChats = useCallback(() => {
    for (const chat of loadHistory()) {
      try {
        window.localStorage.removeItem(`${CHAT_STORAGE_PREFIX}${chat.id}`);
      } catch {
        // ignore
      }
    }
    saveHistory([]);
    notifyHistoryChanged();
    if (isAuthenticated) {
      // Delete every server thread; notify again once the dust settles so
      // the sidebar doesn't briefly re-show threads from the server.
      fetchThreads()
        .then((threads) =>
          Promise.allSettled(threads.map((t) => deleteThread(t.thread_id))),
        )
        .catch(() => {
          // offline — nothing to delete server-side
        })
        .finally(() => notifyHistoryChanged());
    }
  }, [isAuthenticated]);

  // "New chat" from the sidebar: navigate to "/" from a chat route (the
  // pathname change regenerates the new-chat id above); while already on
  // "/" regenerate the id in place and drop the current draft so the
  // conversation area resets immediately.
  const newChat = useCallback(() => {
    // Abort the fetch WITHOUT cancelling the run (durable chat): the run
    // finishes server-side, history is persisted incrementally, and the
    // thread keeps its running spinner until the completion notification.
    if (
      statusRef.current === "submitted" ||
      statusRef.current === "streaming"
    ) {
      stopRef.current();
    }
    if (chatIdFromUrl) {
      router.push("/");
      return;
    }
    setNewChatId(generateUUID());
    setMessages([]);
    setInput("");
  }, [chatIdFromUrl, router, setInput, setMessages]);

  // Stop generation client-side AND abort the server-side run, so the agent
  // actually stops (the client abort alone only closes the stream).
  const stopRef = useRef(stop);
  useEffect(() => {
    stopRef.current = stop;
  }, [stop]);

  const stopGeneration = useCallback(() => {
    cancelThread(chatId).catch(() => {
      // 409 = no active run; offline — nothing to cancel
    });
    return stopRef.current();
  }, [chatId]);

  const isLoading = status === "submitted" || status === "streaming";

  // Rewind to a past user message: drop it and everything after it, and
  // put its text back into the input so the user can rephrase and resend.
  // The next send carries the truncated message list, so the backend
  // thread follows the same state (same mechanism as edits).
  const rewindMessage = useCallback(
    (messageId: string) => {
      const index = messages.findIndex((m) => m.id === messageId);
      if (index === -1) {
        return;
      }
      const text = getTextFromMessage(messages[index]);
      if (text) {
        setInput(text);
      }
      stopRef.current();
      setMessages(messages.slice(0, index));
    },
    [messages, setInput, setMessages],
  );

  // Edit the last turn: truncate the conversation at the edited message
  // (dropping it and everything after) and let sendMessage append the new
  // user message exactly once. Appending it here too would double-add the
  // replacement (two children with the same key in the message list).
  const editMessage = useCallback(
    (originalMessageId: string, newText: string) => {
      setMessages((current) => {
        const index = current.findIndex((m) => m.id === originalMessageId);
        return index === -1 ? current : current.slice(0, index);
      });
      sendMessageTracked({
        parts: [{ text: newText, type: "text" }],
        role: "user",
      });
    },
    [sendMessageTracked, setMessages],
  );

  // Resume a human-in-the-loop interrupt: truncate the interrupted assistant
  // message and re-request. The payload (`{decision}` / `{decisions}`) is
  // merged into the request body as-is; the backend sees it and resumes the
  // paused thread.
  const resumeInterrupt = useCallback(
    (messageId: string, decisionPayload: Record<string, unknown>) => {
      regenerate({ messageId, body: decisionPayload });
    },
    [regenerate],
  );

  const value = useMemo<ActiveChatContextValue>(
    () => ({
      chatId,
      currentModelId,
      deleteAllChats,
      deleteChat,
      editMessage,
      input,
      isLoading,
      messages,
      newChat,
      regenerate,
      resumeInterrupt,
      rewindMessage,
      sendMessage: sendMessageTracked,
      setCurrentModelId,
      setInput,
      setMessages,
      setThinkingEffort,
      status,
      stop: stopGeneration,
      thinkingEffort,
    }),
    [
      chatId,
      currentModelId,
      deleteAllChats,
      deleteChat,
      editMessage,
      input,
      isLoading,
      messages,
      newChat,
      regenerate,
      resumeInterrupt,
      rewindMessage,
      sendMessageTracked,
      setCurrentModelId,
      setInput,
      setMessages,
      setThinkingEffort,
      status,
      stopGeneration,
      thinkingEffort,
    ],
  );

  return (
    <ActiveChatContext.Provider value={value}>
      {children}
    </ActiveChatContext.Provider>
  );
}

export function useActiveChat() {
  const context = useContext(ActiveChatContext);
  if (!context) {
    throw new Error("useActiveChat must be used within ActiveChatProvider");
  }
  return context;
}
