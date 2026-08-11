"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
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
import { authHeaders } from "@/lib/auth";
import {
  CHAT_STORAGE_PREFIX,
  HISTORY_CHANGED_EVENT,
  HISTORY_STORAGE_KEY,
} from "@/lib/constants";
import { ChatbotError } from "@/lib/errors";
import { DEFAULT_CHAT_MODEL } from "@/lib/models";
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
  deleteChat: (chatId: string) => void;
  deleteAllChats: () => void;
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

  const chatIdFromUrl = extractChatId(pathname);
  const isNewChat = !chatIdFromUrl;
  const newChatIdRef = useRef(generateUUID());
  const prevPathnameRef = useRef(pathname);

  if (isNewChat && prevPathnameRef.current !== pathname) {
    newChatIdRef.current = generateUUID();
  }
  prevPathnameRef.current = pathname;

  const chatId = chatIdFromUrl ?? newChatIdRef.current;

  const [currentModelId, setCurrentModelId] = useState(DEFAULT_CHAT_MODEL);
  const currentModelIdRef = useRef(currentModelId);
  useEffect(() => {
    currentModelIdRef.current = currentModelId;
  }, [currentModelId]);

  const [input, setInput] = useState("");

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
      transport: new DefaultChatTransport({
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
              ...request.body,
            },
          };
        },
        prepareReconnectToStreamRequest() {
          return { headers: authHeaders() };
        },
      }),
    });

  // Load persisted messages when the active chat changes.
  useEffect(() => {
    setMessages(loadMessages(chatId));
    setInput("");
  }, [chatId, setMessages]);

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

  const deleteChat = useCallback((chatIdToDelete: string) => {
    const history = loadHistory().filter((chat) => chat.id !== chatIdToDelete);
    saveHistory(history);
    try {
      window.localStorage.removeItem(`${CHAT_STORAGE_PREFIX}${chatIdToDelete}`);
    } catch {
      // ignore
    }
    notifyHistoryChanged();
  }, []);

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
  }, []);

  const isLoading = status === "submitted" || status === "streaming";

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
      sendMessage,
      setCurrentModelId,
      setInput,
      setMessages,
      status,
      stop,
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
      sendMessage,
      setCurrentModelId,
      setInput,
      setMessages,
      status,
      stop,
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
