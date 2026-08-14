"use client";

// Durable-chat run store: one place for thread run statuses, the recent
// lifecycle notifications, and the notification-stream cursor.
//
// The active chat stream and the run lifecycle are separate things — a send
// is a fetch you may abort freely, while the thread object in the sidebar is
// the source of truth for whether a run is still going. Sources that feed
// this store:
//   - GET /threads (seedThreads — statuses survive reload)
//   - the per-user notification stream (applyNotification — live updates)
//   - the chat input (markThreadRunning — optimistic, before the server
//     confirms the run started)
// The sidebar renders spinners from `statuses`; the notification listener
// toasts terminal events of background threads.

import { useRouter } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "@/components/chat/toast";
import { useAuth } from "@/hooks/use-auth";
import {
  HISTORY_CHANGED_EVENT,
  NOTIFICATION_SEQ_PREFIX,
  THREAD_ACTIVITY_EVENT,
} from "@/lib/constants";
import type {
  ServerThread,
  ThreadNotification,
  ThreadStatus,
} from "@/lib/threads";

type ThreadsContextValue = {
  /** thread_id → run status (absent = unknown / not tracked). */
  statuses: Record<string, ThreadStatus>;
  /** Threads currently running (derived from `statuses`), newest first. */
  runningThreads: { threadId: string; title: string | null }[];
  /** Lifecycle events seen this session, newest first (capped at 50). */
  notifications: ThreadNotification[];
  /** The chat the user is currently looking at (toast suppression). */
  activeThreadId: string | null;
  setActiveThreadId: (threadId: string | null) => void;
  /** Optimistically mark a thread running (right after a send). */
  markThreadRunning: (threadId: string) => void;
  /** Overwrite the status of one thread. */
  setThreadStatus: (threadId: string, status: ThreadStatus) => void;
  /** Merge statuses from GET /threads (server wins per thread). */
  seedThreads: (threads: ServerThread[]) => void;
  /**
   * Apply a lifecycle event: advances the seq cursor (deduped), updates the
   * thread status, dispatches THREAD_ACTIVITY_EVENT, and — for terminal
   * events of background threads — shows a completion toast. Pass
   * `silent: true` for catch-up events (missed while disconnected) to
   * update state without toasting.
   */
  applyNotification: (
    notification: ThreadNotification,
    options?: { silent?: boolean },
  ) => void;
};

const ThreadsContext = createContext<ThreadsContextValue | null>(null);

const NOTIFICATIONS_CAP = 50;

function loadSeq(username: string): number {
  try {
    const raw = window.localStorage.getItem(
      `${NOTIFICATION_SEQ_PREFIX}${username}`,
    );
    const parsed = raw ? Number.parseInt(raw, 10) : 0;
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return 0;
  }
}

function saveSeq(username: string, seq: number) {
  try {
    window.localStorage.setItem(
      `${NOTIFICATION_SEQ_PREFIX}${username}`,
      String(seq),
    );
  } catch {
    // storage unavailable — cursor just won't survive a reload
  }
}

const TERMINAL_TYPES = new Set([
  "run_completed",
  "run_interrupted",
  "run_cancelled",
  "run_failed",
]);

/** Toast copy per terminal lifecycle event type. */
function terminalToast(notification: ThreadNotification): {
  type: "success" | "error";
  title: string;
  description: string;
} {
  const title = notification.title?.trim()
    ? notification.title.trim()
    : "A chat";
  switch (notification.type) {
    case "run_failed":
      return {
        type: "error",
        title: "Chat failed",
        description: `“${title}” hit an error while running in the background.`,
      };
    case "run_cancelled":
      return {
        type: "success",
        title: "Chat stopped",
        description: `“${title}” was stopped before it finished.`,
      };
    case "run_interrupted":
      return {
        type: "success",
        title: "Chat waiting for approval",
        description: `“${title}” paused and is waiting for your input.`,
      };
    default:
      return {
        type: "success",
        title: "Chat finished",
        description: `“${title}” finished running in the background.`,
      };
  }
}

export function ThreadsProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { user } = useAuth();
  const username = user?.username ?? null;

  const [statuses, setStatuses] = useState<Record<string, ThreadStatus>>({});
  const [notifications, setNotifications] = useState<ThreadNotification[]>([]);
  const [activeThreadId, setActiveThreadIdState] = useState<string | null>(
    null,
  );

  // The seq cursor: state (renders) + ref (event handlers) + per-user
  // localStorage (survives reload so `?since=` skips nothing).
  const [lastSeq, setLastSeq] = useState(0);
  const lastSeqRef = useRef(lastSeq);
  useEffect(() => {
    lastSeqRef.current = lastSeq;
  }, [lastSeq]);
  useEffect(() => {
    if (!username) {
      return;
    }
    const seq = loadSeq(username);
    setLastSeq(seq);
    lastSeqRef.current = seq;
  }, [username]);

  // The thread the user is currently looking at (toast suppression).
  const activeThreadIdRef = useRef(activeThreadId);
  useEffect(() => {
    activeThreadIdRef.current = activeThreadId;
  }, [activeThreadId]);

  const setActiveThreadId = useCallback((threadId: string | null) => {
    setActiveThreadIdState(threadId);
  }, []);

  const setThreadStatus = useCallback(
    (threadId: string, status: ThreadStatus) => {
      setStatuses((current) => ({ ...current, [threadId]: status }));
    },
    [],
  );

  const markThreadRunning = useCallback(
    (threadId: string) => {
      setThreadStatus(threadId, "running");
      window.dispatchEvent(new Event(THREAD_ACTIVITY_EVENT));
    },
    [setThreadStatus],
  );

  const seedThreads = useCallback((threads: ServerThread[]) => {
    setStatuses((current) => {
      const next = { ...current };
      for (const thread of threads) {
        if (thread.status) {
          next[thread.thread_id] = thread.status;
        }
      }
      return next;
    });
  }, []);

  const applyNotification = useCallback(
    (notification: ThreadNotification, options?: { silent?: boolean }) => {
      // Dedupe + advance the cursor (stream replay and the REST catch-up
      // may deliver the same event twice).
      const seq = notification.seq;
      if (!Number.isFinite(seq) || seq <= lastSeqRef.current) {
        return;
      }
      lastSeqRef.current = seq;
      setLastSeq(seq);
      if (username) {
        saveSeq(username, seq);
      }

      setStatuses((current) => ({
        ...current,
        [notification.thread_id]: notification.status as ThreadStatus,
      }));
      setNotifications((current) =>
        [notification, ...current].slice(0, NOTIFICATIONS_CAP),
      );
      window.dispatchEvent(new Event(THREAD_ACTIVITY_EVENT));
      // Refresh the sidebar history (server titles / updated_at ordering
      // win once the run metadata lands).
      window.dispatchEvent(new Event(HISTORY_CHANGED_EVENT));

      // Completion of a background run → toast (silent for catch-up).
      if (options?.silent || !TERMINAL_TYPES.has(notification.type)) {
        return;
      }
      if (notification.thread_id === activeThreadIdRef.current) {
        return; // the user is watching this thread — no toast needed
      }
      const threadId = notification.thread_id;
      const openThread = () =>
        router.push(`/chat/${encodeURIComponent(threadId)}`);
      toast({
        ...terminalToast(notification),
        action: { label: "Open", onClick: openThread },
      });
    },
    [router, username],
  );

  const runningThreads = useMemo(
    () =>
      Object.entries(statuses)
        .filter(([, status]) => status === "running")
        .map(([threadId]) => ({ threadId, title: null }))
        .slice(0, 50),
    [statuses],
  );

  const value = useMemo<ThreadsContextValue>(
    () => ({
      activeThreadId,
      applyNotification,
      markThreadRunning,
      notifications,
      runningThreads,
      seedThreads,
      setActiveThreadId,
      setThreadStatus,
      statuses,
    }),
    [
      activeThreadId,
      applyNotification,
      markThreadRunning,
      notifications,
      runningThreads,
      seedThreads,
      setActiveThreadId,
      setThreadStatus,
      statuses,
    ],
  );

  return (
    <ThreadsContext.Provider value={value}>{children}</ThreadsContext.Provider>
  );
}

export function useThreads(): ThreadsContextValue {
  const context = useContext(ThreadsContext);
  if (!context) {
    throw new Error("useThreads must be used within ThreadsProvider");
  }
  return context;
}
