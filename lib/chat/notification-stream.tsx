// Per-user run lifecycle listener: one long-lived SSE connection
// (GET /api/chat/notifications/stream) that keeps the ThreadsProvider
// statuses live while chats run in the background.
//
// Auth note: the backend scopes notifications per user and requires a
// Bearer token — guests (no login) get no stream and no statuses, which is
// intentional: a guest channel would leak runs between anonymous visitors.
//
// Reconnect strategy:
//   - exponential backoff (1s → 30s) on drops
//   - before each (re)connect, REST catch-up via GET /api/chat/notifications
//     (applied silently — those events are state sync, not live news)
//   - the stream reconnects with ?since=<lastSeq>, so the hub replays
//     anything published while we were away
// Multi-tab: every tab receives its own copy of the events (each listener
// dedupes by seq); statuses re-sync from GET /threads on window focus.

import { useCallback, useEffect, useRef } from "react";
import { useAuth } from "@/hooks/use-auth";
import { authHeaders } from "@/lib/auth";
import { useThreads } from "@/lib/chat/chat-store";
import { readSSE } from "@/lib/chat/sse";
import { fetchNotifications, fetchThreads } from "@/lib/threads";

const MAX_BACKOFF_MS = 30_000;
const INITIAL_BACKOFF_MS = 1_000;

export function NotificationListener() {
  const { isAuthenticated } = useAuth();
  const { applyNotification, seedThreads } = useThreads();

  const applyRef = useRef(applyNotification);
  useEffect(() => {
    applyRef.current = applyNotification;
  }, [applyNotification]);
  const seedRef = useRef(seedThreads);
  useEffect(() => {
    seedRef.current = seedThreads;
  }, [seedThreads]);

  // Catch up on missed events (silent — state sync, no toasts).
  const catchUp = useCallback(async () => {
    try {
      const events = await fetchNotifications(50);
      // Newest first from the API; apply oldest first so the seq cursor
      // advances in order.
      for (const notification of [...events].reverse()) {
        applyRef.current(notification, { silent: true });
      }
    } catch {
      // offline — the stream connect below will retry anyway
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }
    let stopped = false;
    let backoff = INITIAL_BACKOFF_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | null = null;

    const connect = async () => {
      if (stopped) {
        return;
      }
      // 1. REST catch-up (covers drops longer than the replay buffer and
      //    events published during our backoff).
      await catchUp();
      if (stopped) {
        return;
      }
      // 2. Live stream, resumed from the last seen seq.
      controller = new AbortController();
      try {
        await readSSE(
          "/api/chat/notifications/stream",
          (event, data) => {
            if (
              event === "message" ||
              typeof data !== "object" ||
              data === null
            ) {
              return;
            }
            const notification = data as Parameters<typeof applyRef.current>[0];
            applyRef.current(notification);
          },
          controller.signal,
          { headers: authHeaders() },
        );
        // Clean close (server restarted?) — reconnect promptly.
        backoff = INITIAL_BACKOFF_MS;
      } catch {
        // Network error / dropped stream — back off and retry.
      }
      controller = null;
      if (stopped) {
        return;
      }
      timer = setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
    };

    void connect();

    // Multi-tab resync: statuses can diverge between tabs (the store is
    // per-tab); re-seed from the server whenever the tab regains focus.
    const onFocus = () => {
      if (document.visibilityState !== "visible") {
        return;
      }
      fetchThreads()
        .then((threads) => seedRef.current(threads))
        .catch(() => {
          // offline — keep the current state
        });
    };
    window.addEventListener("focus", onFocus);

    return () => {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
      }
      controller?.abort();
      window.removeEventListener("focus", onFocus);
    };
  }, [catchUp, isAuthenticated]);

  return null;
}
