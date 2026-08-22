import type { UseChatHelpers } from "@ai-sdk/react";
import { useChat } from "@ai-sdk/react";
import {
  createContext,
  type Dispatch,
  type MutableRefObject,
  type ReactNode,
  type SetStateAction,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation, useNavigate } from "react-router";
import { toast } from "@/components/chat/toast";
import { UploadChatTransport } from "@/hooks/chat-transport";
import { useAuth } from "@/hooks/use-auth";
import { authHeaders } from "@/lib/auth";
import { useThreads } from "@/lib/chat/chat-store";
import { ChatStreamMerger, chunkString } from "@/lib/chat/chunk-merge";
import { loadHistory, saveHistory } from "@/lib/chat/history";
import { AttachMerger, isAttachTerminalEvent } from "@/lib/chat/message-merge";
import { readSSE } from "@/lib/chat/sse";
import { HISTORY_CHANGED_EVENT } from "@/lib/constants";
import { BASE_PATH } from "@/lib/env";
import { ChatbotError } from "@/lib/errors";
import { DEFAULT_CHAT_MODEL } from "@/lib/models";
import { DEFAULT_SETTINGS, type ThinkingEffort } from "@/lib/settings";
import {
  lastActiveStorageKey,
  messagesStorageKey,
  storageScope,
} from "@/lib/storage";
import {
  cancelThread,
  deleteAllThreads,
  deleteThread,
  fetchThreadMessages,
  serverMessagesToChatMessages,
} from "@/lib/threads";
import type { ChatMessage } from "@/lib/types";
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
  /** Abort-only stop: closes the client fetch without cancelling the server
   * run (durable chat). Used on chat switches / "new chat" — only the
   * explicit Stop button uses `stop` (which also cancels the run). */
  abortStream: () => void;
  regenerate: UseChatHelpers<ChatMessage>["regenerate"];
  /** Rewind to a past user message: drop it + everything after, restore its text in the input. */
  rewindMessage: (messageId: string) => void;
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  isLoading: boolean;
  /** True while the opened chat's messages are loading from the server
   * (empty local cache) — the conversation area shows a skeleton instead
   * of the new-chat greeting. */
  historyLoading: boolean;
  /** Live ref of the chat model — read by the transport at send time.
   * The reactive state lives in ChatShell (same hydration commit as the
   * model selector) and is synced into these refs. */
  currentModelIdRef: MutableRefObject<string>;
  /** Live ref of the thinking-effort level — read by the transport at send
   * time; reactive state lives in ChatShell (see currentModelIdRef). */
  thinkingEffortRef: MutableRefObject<ThinkingEffort>;
  deleteChat: (chatId: string) => void;
  deleteAllChats: () => Promise<void> | void;
  /** Start a fresh conversation, also when already on "/". */
  newChat: () => void;
  /** Resume a human-in-the-loop interrupt. Keeps the interrupted assistant
   * message in the UI and streams the resumed run into a NEW message after it
   * (the backend continues the paused thread; `decisionPayload` is passed into
   * the request body as-is — `{decision}` for a single action request,
   * `{decisions}` for several). Resolves when the resumed stream ends. */
  resumeInterrupt: (
    messageId: string,
    decisionPayload: Record<string, unknown>,
  ) => Promise<void>;
  /** Replace the message with the given id (dropping everything after it). */
  editMessage: (originalMessageId: string, newText: string) => void;
};

const ActiveChatContext = createContext<ActiveChatContextValue | null>(null);

// --- localStorage persistence -------------------------------------------------
//
// Every cache key is namespaced per user (lib/storage.ts): the sidebar must
// never render another account's (or the shared guest's) cached threads.

function loadMessages(scope: string, chatId: string): ChatMessage[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(messagesStorageKey(scope, chatId));
    return raw ? (JSON.parse(raw) as ChatMessage[]) : [];
  } catch {
    return [];
  }
}

function saveMessages(scope: string, chatId: string, messages: ChatMessage[]) {
  try {
    window.localStorage.setItem(
      messagesStorageKey(scope, chatId),
      JSON.stringify(messages),
    );
  } catch {
    // storage unavailable — ignore
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

function upsertHistory(scope: string, chatId: string, messages: ChatMessage[]) {
  if (messages.length === 0) {
    return;
  }

  const history = loadHistory(scope);
  const existing = history.find((chat) => chat.id === chatId);
  const title = titleFromMessages(messages);

  const next = existing
    ? history.map((chat) =>
        chat.id === chatId && chat.title === "New chat"
          ? { ...chat, title }
          : chat,
      )
    : [{ id: chatId, title, createdAt: new Date().toISOString() }, ...history];

  saveHistory(scope, next);
  notifyHistoryChanged();
}

function extractChatId(pathname: string): string | null {
  const match = pathname.match(/\/chat\/([^/]+)/);
  return match ? match[1] : null;
}

// --- provider ----------------------------------------------------------------

export function ActiveChatProvider({ children }: { children: ReactNode }) {
  const pathname = useLocation().pathname;
  const navigate = useNavigate();
  const { isAuthenticated, user } = useAuth();
  const { markThreadRunning, markThreadStale, setActiveThreadId, statuses } =
    useThreads();

  // localStorage scope: the signed-in username (fixed "guest" scope when
  // anonymous). All chat caches are keyed by it, so a second account on
  // the same browser never sees the first account's threads.
  const scope = storageScope(user?.username);

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

  // The model + thinking effort picked in the chat input. Only the refs
  // live here — the transport below reads them at send time. The REACTIVE
  // state deliberately lives in ChatShell, not in this provider:
  // ChatShellRoute streams as a separate SSR chunk (its own <Suspense> in
  // the layout) and hydrates in a later commit than this provider, so a
  // localStorage read in a provider effect would run between the two
  // hydration commits — the model selector would hydrate with the saved
  // model against the server HTML (default model) and throw a hydration
  // mismatch. ChatShell initializes its state from loadSettings() in its
  // own mount effect (same commit as the selector) and syncs these refs,
  // so the first render always matches the server.
  const currentModelIdRef = useRef(DEFAULT_CHAT_MODEL);
  const thinkingEffortRef = useRef<ThinkingEffort>(
    DEFAULT_SETTINGS.thinkingEffort,
  );

  const [input, setInput] = useState("");

  // True while the opened chat's history is being fetched from the server
  // (empty local cache). The conversation area shows a skeleton instead of
  // the new-chat greeting while this is set.
  const [historyLoading, setHistoryLoading] = useState(false);

  const { messages, setMessages, sendMessage, status, stop, regenerate } =
    useChat<ChatMessage>({
      generateId: generateUUID,
      id: chatId,
      messages: loadMessages(scope, chatId),
      // Official AI SDK mitigation for chunk-per-render jank: with complex
      // markdown (streamdown) + tool cards, re-rendering on every text-delta
      // blocks the main thread (citation answers showed 50-200ms long tasks).
      // Throttle UI updates to ~20fps; streaming still looks continuous
      // because deltas arrive at 20-50/s and batch into each flush.
      experimental_throttle: 50,
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
        api: `${BASE_PATH}/api/chat`,
        fetch: fetchWithErrorHandlers,
        prepareSendMessagesRequest(request) {
          return {
            headers: authHeaders(),
            body: {
              id: request.id,
              messages: request.messages,
              selectedChatModel: currentModelIdRef.current,
              thinking: thinkingEffortRef.current,
              // Web search is a backend per-user preference now (settings
              // PATCHes /users/me/preferences); no enable_search override
              // is sent, so the stored pref applies per request.
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

  // Latest messages + chat id, readable from the manual resume stream
  // (fire-and-forget callback that outlives re-renders).
  const messagesRef = useRef(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  const chatIdRef = useRef(chatId);
  useEffect(() => {
    chatIdRef.current = chatId;
  }, [chatId]);

  // Durable chat (flow A): the moment a send starts, mark the thread
  // running in the sidebar. The history row itself is NOT created locally
  // when signed in — the sidebar is server-only, and the backend upserts
  // the thread metadata at run start (the run_started notification then
  // refreshes the list). Guests keep the local row fallback.
  const sendMessageTracked = useCallback(
    (
      args: Parameters<UseChatHelpers<ChatMessage>["sendMessage"]>[0],
      options?: Parameters<UseChatHelpers<ChatMessage>["sendMessage"]>[1],
    ) => {
      if (isAuthenticated) {
        markThreadRunning(chatId);
      }
      return sendMessage(args, options);
    },
    [chatId, isAuthenticated, markThreadRunning, sendMessage],
  );

  // Account switch / sign-in: drop the previous account's in-memory
  // conversation and reload the caches for the new scope (the sidebar and
  // the message cache are keyed per user; server threads are per-user too,
  // so nothing from the old account may linger in the UI).
  const prevScopeRef = useRef(scope);
  useEffect(() => {
    const prevScope = prevScopeRef.current;
    prevScopeRef.current = scope;
    if (prevScope === scope) {
      return;
    }
    // Signed-in: server-only — no local cache to restore (the rehydrate
    // effect below fetches the conversation from the backend). Guest:
    // restore the local cache as before.
    if (isAuthenticated) {
      setMessages([]);
      setHistoryLoading(chatIdFromUrl !== null);
    } else {
      const cached = loadMessages(scope, chatId);
      setMessages(cached);
      setHistoryLoading(
        cached.length === 0 && chatIdFromUrl !== null && isAuthenticated,
      );
    }
    setInput("");
  }, [chatId, chatIdFromUrl, isAuthenticated, scope, setInput, setMessages]);

  // Load the active chat when it changes; detach a still-streaming fetch
  // when navigating away (durable chat: the run keeps going server-side,
  // history is persisted incrementally). Signed-in: the conversation is
  // rehydrated from the server below — the local cache is never consulted,
  // so stale rows from another device can't surface. Guest: restore the
  // local cache. Threads with a run in flight skip the cache path — the
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
      if (isAuthenticated) {
        setMessages([]);
        setHistoryLoading(chatIdFromUrl !== null);
      } else {
        const cached = loadMessages(scope, chatId);
        setMessages(cached);
        setHistoryLoading(
          cached.length === 0 && chatIdFromUrl !== null && isAuthenticated,
        );
      }
      setInput("");
    }
    if (!chatIdFromUrl || !isAuthenticated || threadStatus === "running") {
      return;
    }
    let cancelled = false;
    // Signed-in chats always rehydrate from the server (no local fallback).
    fetchThreadMessages(chatIdFromUrl)
      .then((server) => {
        if (cancelled) {
          return;
        }
        if (!Array.isArray(server) || server.length === 0) {
          // No server history either — genuinely empty chat.
          setHistoryLoading(false);
          return;
        }
        setMessages(
          serverMessagesToChatMessages(server, { interrupted: true }),
        );
        setHistoryLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          // Backend unreachable — nothing to show (no localStorage fallback).
          setHistoryLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    chatId,
    chatIdFromUrl,
    isAuthenticated,
    scope,
    setMessages,
    threadStatus,
  ]);

  // Durable chat (flow D): opening a thread whose run is in flight (started
  // elsewhere — another tab, or "new chat" while answering) attaches a live
  // stream to it. History is the authoritative baseline (the backend writes
  // finalized messages incrementally), then message deltas merge in by
  // message id until the run ends (done/interrupt/error → re-fetch history
  // once to reconcile). A 409 (run just finished) falls back to the same
  // history re-fetch.
  // True while a manual HITL resume stream is in flight — the attach flow
  // must not merge the same run in parallel (see attachActive below).
  const [resumeActive, setResumeActive] = useState(false);

  const attachActive =
    isAuthenticated &&
    chatIdFromUrl !== null &&
    threadStatus === "running" &&
    status !== "submitted" &&
    status !== "streaming" &&
    // A manual HITL resume owns the stream for this chat — the attach flow
    // would merge the SAME run in parallel (raw events + AI SDK chunks →
    // duplicated messages, frozen chat).
    !resumeActive;

  useEffect(() => {
    if (!attachActive) {
      return;
    }
    let cancelled = false;
    let sawTerminal = false;
    const controller = new AbortController();
    const merger = new AttachMerger();
    const refetchHistory = async (options?: { interrupted?: boolean }) => {
      try {
        const server = await fetchThreadMessages(chatIdFromUrl);
        if (cancelled || !Array.isArray(server) || server.length === 0) {
          return;
        }
        setMessages(serverMessagesToChatMessages(server, options));
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
      } finally {
        // Baseline settled — the skeleton (if any) is done either way.
        if (!cancelled) {
          setHistoryLoading(false);
        }
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
      } catch (error) {
        // 409 (no active run — the thread's `running` status is a stale
        // leftover of a dead process) / stream error — fall through to
        // history. On 409, un-stick the thread status (sidebar spinner,
        // composer background-run mode) and render dangling tool calls as
        // interrupted instead of spinning forever.
        const conflict =
          error instanceof Error && error.message.includes("(409)");
        if (conflict) {
          markThreadStale(chatIdFromUrl);
        }
        if (!cancelled) {
          void refetchHistory(conflict ? { interrupted: true } : undefined);
        }
        return;
      }
      if (!cancelled && !sawTerminal) {
        void refetchHistory();
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
      // Detached (chat switch / stop): don't leave the skeleton stuck —
      // the next load effect sets the correct value on a switch.
      setHistoryLoading(false);
    };
  }, [attachActive, chatIdFromUrl, markThreadStale, setMessages]);

  // The thread the user is currently looking at — the notification store
  // suppresses completion toasts for it (the user is watching it already).
  useEffect(() => {
    setActiveThreadId(chatIdFromUrl ?? newChatId);
  }, [chatIdFromUrl, newChatId, setActiveThreadId]);

  // Remember the last opened conversation, so "Back to chat" from /settings
  // can restore it (the / route always starts a fresh new chat).
  useEffect(() => {
    if (chatIdFromUrl) {
      try {
        window.localStorage.setItem(lastActiveStorageKey(scope), chatIdFromUrl);
      } catch {
        // ignore
      }
    }
  }, [chatIdFromUrl, scope]);

  // Persist messages after streaming finishes (and on any non-streaming
  // change). Signed-in: server-only — the backend writes finalized messages
  // incrementally, so nothing is mirrored to localStorage (and the local
  // mirror is never read); when a run ends, nudge the sidebar to refetch
  // (covers a missed completion notification while the SSE stream is down).
  // Guest: the localStorage cache stays.
  const prevStatusRef = useRef(status);
  useEffect(() => {
    const statusChanged = prevStatusRef.current !== status;
    prevStatusRef.current = status;

    if (status === "streaming") {
      return;
    }

    if (isAuthenticated) {
      if (statusChanged && (status === "ready" || status === "error")) {
        notifyHistoryChanged();
      }
      return;
    }

    saveMessages(scope, chatId, messages);

    if (statusChanged && (status === "ready" || status === "error")) {
      upsertHistory(scope, chatId, messages);
    }
  }, [chatId, isAuthenticated, messages, scope, status]);

  const deleteChat = useCallback(
    (chatIdToDelete: string) => {
      const history = loadHistory(scope).filter(
        (chat) => chat.id !== chatIdToDelete,
      );
      saveHistory(scope, history);
      try {
        window.localStorage.removeItem(
          messagesStorageKey(scope, chatIdToDelete),
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
    [isAuthenticated, scope],
  );

  const deleteAllChats = useCallback(() => {
    for (const chat of loadHistory(scope)) {
      try {
        window.localStorage.removeItem(messagesStorageKey(scope, chat.id));
      } catch {
        // ignore
      }
    }
    saveHistory(scope, []);
    notifyHistoryChanged();
    if (isAuthenticated) {
      // Delete every server thread in one request; notify again once the
      // dust settles so the sidebar doesn't briefly re-show threads from
      // the server. Rejects when the backend call fails (offline / error)
      // so the caller can surface it.
      return deleteAllThreads().finally(() => notifyHistoryChanged());
    }
  }, [isAuthenticated, scope]);

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
      navigate("/");
      return;
    }
    setNewChatId(generateUUID());
    setMessages([]);
    setInput("");
    setHistoryLoading(false);
  }, [chatIdFromUrl, navigate, setInput, setMessages]);

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

  // Abort-only stop for chat switches / "new chat": closes the client fetch
  // WITHOUT cancelling the server run (durable chat). Only the explicit Stop
  // button uses `stop` (stopGeneration), which also cancels the run.
  const abortStream = useCallback(() => stopRef.current(), []);

  const isLoading = status === "submitted" || status === "streaming";

  // Rewind to a past user message: drop it and everything after it, and
  // put its text back into the input so the user can rephrase and resend.
  // The next send carries the truncated message list, so the backend
  // thread follows the same state (same mechanism as edits).
  // Deliberately not depedent on `messages` (read through messagesRef):
  // the sidebar's onRewind callback must stay referentially stable so
  // the memoized PreviewMessage rows don't re-render on every flush.
  const rewindMessage = useCallback(
    (messageId: string) => {
      const list = messagesRef.current;
      const index = list.findIndex((m) => m.id === messageId);
      if (index === -1) {
        return;
      }
      const text = getTextFromMessage(list[index]);
      if (text) {
        setInput(text);
      }
      stopRef.current();
      setMessages(list.slice(0, index));
    },
    [setInput, setMessages],
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

  // Resume a human-in-the-loop interrupt WITHOUT truncating the interrupted
  // message (regenerate() would drop it — the AI's partial reply, tool cards
  // and the approval card would all vanish from the UI). Instead the resume
  // is streamed manually through the AI SDK data-stream protocol: the paused
  // message stays put, the resumed run's continuation lands as a new
  // assistant message after it, and the final list is persisted. The request
  // body mirrors the normal chat contract plus the decision payload
  // (`{decision}` / `{decisions}`); the backend resumes the paused thread
  // via the `id` field and ignores `messages` on this path.
  const resumeInterrupt = useCallback(
    async (messageId: string, decisionPayload: Record<string, unknown>) => {
      const chatIdAtResume = chatId;
      const controller = new AbortController();
      const merger = new ChatStreamMerger();
      let streamError: string | null = null;
      setResumeActive(true);

      // Stamp the outcome on the interrupted message's interrupt part so
      // the card renders as settled (collapsed Approved/Rejected) in the
      // live chat AND in persisted history after a reload.
      const firstDecision =
        (Array.isArray(decisionPayload.decisions)
          ? decisionPayload.decisions[0]
          : undefined) ?? decisionPayload.decision;
      const resolved =
        firstDecision !== null &&
        typeof firstDecision === "object" &&
        "type" in firstDecision
          ? String((firstDecision as { type?: unknown }).type) === "approve"
            ? "approve"
            : "reject"
          : null;
      if (resolved) {
        setMessages((current) =>
          current.map((message) =>
            message.id === messageId
              ? {
                  ...message,
                  parts: message.parts.map((part) =>
                    part.type === "custom" && part.kind === "app.interrupt"
                      ? ({
                          ...part,
                          providerMetadata: {
                            ...part.providerMetadata,
                            app: {
                              ...((
                                part.providerMetadata as
                                  | Record<string, unknown>
                                  | undefined
                              )?.app as Record<string, unknown> | undefined),
                              resolved,
                            },
                          },
                        } as ChatMessage["parts"][number])
                      : part,
                  ),
                }
              : message,
          ),
        );
      }

      try {
        await readSSE(
          `${BASE_PATH}/api/chat`,
          (_event, data) => {
            // Chat switched while resuming — stop merging (the server run
            // keeps going; history is persisted server-side).
            if (chatIdRef.current !== chatIdAtResume) {
              controller.abort();
              return;
            }
            if (typeof data !== "object" || data === null) {
              return;
            }
            const chunk = data as Record<string, unknown>;
            if (chunk.type === "error") {
              streamError =
                chunkString(chunk, "errorText") || "Failed to resume the run";
              return;
            }
            if (chunk.type === "finish") {
              return;
            }
            setMessages((current) => merger.merge(current, chunk) ?? current);
          },
          controller.signal,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", ...authHeaders() },
            body: JSON.stringify({
              id: chatId,
              messages: messagesRef.current,
              selectedChatModel: currentModelIdRef.current,
              thinking: thinkingEffortRef.current,
              ...decisionPayload,
            }),
          },
        );
      } catch (error) {
        // Own disconnect (chat switch): leave silently.
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          streamError =
            error instanceof Error ? error.message : "Failed to resume the run";
        }
      } finally {
        setResumeActive(false);
        if (chatIdRef.current === chatIdAtResume) {
          // Persist the merged conversation (the useChat status-change
          // effect never fires for this manual stream).
          const current = messagesRef.current;
          saveMessages(scope, chatId, current);
          upsertHistory(scope, chatId, current);
        }
        if (streamError) {
          toast({ description: streamError, type: "error" });
        }
      }
    },
    [chatId, scope, setMessages],
  );

  const value = useMemo<ActiveChatContextValue>(
    () => ({
      chatId,
      currentModelIdRef,
      deleteAllChats,
      deleteChat,
      editMessage,
      historyLoading,
      input,
      isLoading,
      messages,
      newChat,
      regenerate,
      resumeInterrupt,
      rewindMessage,
      sendMessage: sendMessageTracked,
      setInput,
      setMessages,
      status,
      stop: stopGeneration,
      abortStream,
      thinkingEffortRef,
    }),
    [
      chatId,
      currentModelIdRef,
      deleteAllChats,
      deleteChat,
      editMessage,
      historyLoading,
      input,
      isLoading,
      messages,
      newChat,
      regenerate,
      resumeInterrupt,
      rewindMessage,
      sendMessageTracked,
      setInput,
      setMessages,
      status,
      stopGeneration,
      abortStream,
      thinkingEffortRef,
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
