"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import { useChat } from "@ai-sdk/react";
import { usePathname } from "next/navigation";
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
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  isLoading: boolean;
  currentModelId: string;
  setCurrentModelId: (id: string) => void;
  thinkingEffort: ThinkingEffort;
  setThinkingEffort: (effort: ThinkingEffort) => void;
  deleteChat: (chatId: string) => void;
  deleteAllChats: () => void;
  /** Resume a human-in-the-loop interrupt with a decision (approve/reject/...). */
  resumeInterrupt: (
    messageId: string,
    decision: Record<string, unknown>,
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

function titleFromMessages(messages: ChatMessage[]): string {
  const firstUserText = messages
    .filter((m) => m.role === "user")
    .map((m) => getTextFromMessage(m).trim())
    .find((t) => t.length > 0);

  if (!firstUserText) {
    return "New chat";
  }

  return firstUserText.length > 40
    ? `${firstUserText.slice(0, 40)}…`
    : firstUserText;
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
  const { isAuthenticated } = useAuth();

  const chatIdFromUrl = extractChatId(pathname);
  const isNewChat = !chatIdFromUrl;
  const newChatIdRef = useRef(generateUUID());
  const prevPathnameRef = useRef(pathname);

  if (isNewChat && prevPathnameRef.current !== pathname) {
    newChatIdRef.current = generateUUID();
  }
  prevPathnameRef.current = pathname;

  const chatId = chatIdFromUrl ?? newChatIdRef.current;

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

  // Set when the user edits a past message; consumed by the transport when
  // the next request is prepared.
  const pendingEditRef = useRef<string | null>(null);

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
          let messages = request.messages;

          // For edits: truncate the conversation at the edited message and
          // swap in the replacement (the last message, just appended).
          const pendingEdit = pendingEditRef.current;
          if (pendingEdit) {
            pendingEditRef.current = null;
            const index = messages.findIndex((m) => m.id === pendingEdit);
            if (index !== -1) {
              const replacement = messages.at(-1);
              if (replacement) {
                messages = [...messages.slice(0, index), replacement];
              }
            }
          }

          return {
            headers: authHeaders(),
            body: {
              id: request.id,
              messages,
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

  // Load persisted messages when the active chat changes. When the local
  // cache is empty (new device / cleared cache), rehydrate the conversation
  // from the server so history survives across browsers.
  useEffect(() => {
    setMessages(loadMessages(chatId));
    setInput("");
    if (!chatIdFromUrl || !isAuthenticated) {
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
  }, [chatId, chatIdFromUrl, isAuthenticated, setMessages]);

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

  // Resume a human-in-the-loop interrupt: truncate the interrupted assistant
  // message and re-request. The transport merges `decision` into the request
  // body; the backend sees it and resumes the paused thread.
  const resumeInterrupt = useCallback(
    (messageId: string, decision: Record<string, unknown>) => {
      regenerate({ messageId, body: { decision } });
    },
    [regenerate],
  );

  // Edit a past user message: truncate the conversation at that point and
  // resend. The transport rewrites the outgoing payload (see above).
  const editMessage = useCallback(
    (originalMessageId: string, newText: string) => {
      pendingEditRef.current = originalMessageId;
      const replacement: ChatMessage = {
        id: generateUUID(),
        parts: [{ text: newText, type: "text" }],
        role: "user",
      };
      setMessages((current) => {
        const index = current.findIndex((m) => m.id === originalMessageId);
        return index === -1
          ? [...current, replacement]
          : [...current.slice(0, index), replacement];
      });
      sendMessage(replacement);
    },
    [sendMessage, setMessages],
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
      regenerate,
      resumeInterrupt,
      sendMessage,
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
      regenerate,
      resumeInterrupt,
      sendMessage,
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
