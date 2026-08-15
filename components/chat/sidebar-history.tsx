"use client";

import { isToday, isYesterday, subMonths, subWeeks } from "date-fns";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  useSidebar,
} from "@/components/ui/sidebar";
import { useAuth } from "@/hooks/use-auth";
import { useThreads } from "@/lib/chat/chat-store";
import {
  loadHistory,
  saveHistory,
  scrubLocalCacheOnce,
  serverThreadToHistoryItem,
} from "@/lib/chat/history";
import { HISTORY_CHANGED_EVENT } from "@/lib/constants";
import { storageScope } from "@/lib/storage";
import {
  deleteThread,
  fetchThreads,
  renameThread,
  type ServerThread,
} from "@/lib/threads";
import type { ChatHistoryItem } from "@/lib/types";
import { ChatItem } from "./sidebar-history-item";

type GroupedChats = {
  today: ChatHistoryItem[];
  yesterday: ChatHistoryItem[];
  lastWeek: ChatHistoryItem[];
  lastMonth: ChatHistoryItem[];
  older: ChatHistoryItem[];
};

/**
 * Merge server threads into the local (localStorage) history. The server is
 * the source of truth for threads it knows; local-only entries (guest chats,
 * offline) are kept so nothing disappears. The one-time scrub in
 * refreshServer (scrubLocalCacheOnce) replaces the whole list with the
 * server rows on the first successful fetch per scope, which is what heals
 * caches from the shared pre-scoping era.
 */
function mergeHistory(
  local: ChatHistoryItem[],
  threads: ServerThread[],
): ChatHistoryItem[] {
  const byId = new Map(local.map((chat) => [chat.id, chat]));
  for (const thread of threads) {
    byId.set(thread.thread_id, serverThreadToHistoryItem(thread));
  }
  return [...byId.values()];
}

const groupChatsByDate = (chats: ChatHistoryItem[]): GroupedChats => {
  const now = new Date();
  const oneWeekAgo = subWeeks(now, 1);
  const oneMonthAgo = subMonths(now, 1);

  return chats.reduce(
    (groups, chat) => {
      const chatDate = new Date(chat.createdAt);

      if (isToday(chatDate)) {
        groups.today.push(chat);
      } else if (isYesterday(chatDate)) {
        groups.yesterday.push(chat);
      } else if (chatDate > oneWeekAgo) {
        groups.lastWeek.push(chat);
      } else if (chatDate > oneMonthAgo) {
        groups.lastMonth.push(chat);
      } else {
        groups.older.push(chat);
      }

      return groups;
    },
    {
      lastMonth: [],
      lastWeek: [],
      older: [],
      today: [],
      yesterday: [],
    } as GroupedChats,
  );
};

export function SidebarHistory({
  searchQuery = "",
}: {
  /** Filters the list by chat title (from the sidebar search input). */
  searchQuery?: string;
}) {
  const { setOpenMobile } = useSidebar();
  const pathname = usePathname();
  const router = useRouter();
  const { isAuthenticated, user } = useAuth();
  const { seedThreads, statuses } = useThreads();
  // localStorage scope for the sidebar cache (per signed-in user; "guest"
  // while anonymous) — switching accounts must never show the previous
  // account's cached threads.
  const scope = storageScope(user?.username);
  const id = pathname?.startsWith("/chat/") ? pathname.split("/")[2] : null;

  const [history, setHistory] = useState<ChatHistoryItem[]>([]);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [renameTarget, setRenameTarget] = useState<ChatHistoryItem | null>(
    null,
  );
  const [renameDraft, setRenameDraft] = useState("");
  const [renamePending, setRenamePending] = useState(false);

  // History comes from localStorage + server threads (client-only): wait for
  // mount so SSR (empty) and client (history) HTML match during hydration.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const refreshServer = useCallback(() => {
    if (!isAuthenticated) {
      return;
    }
    fetchThreads()
      .then((threads) => {
        // Keep the durable-chat store in sync (run statuses restore on
        // reload, multi-tab resync, notification-driven refreshes).
        seedThreads(threads);
        // One-time per-scope scrub: the first successful fetch treats the
        // server list as authoritative, dropping local-only rows and message
        // caches from the shared-cache era (other accounts' / guest threads).
        const scrubbed = scrubLocalCacheOnce(scope, threads);
        setHistory((current) => {
          if (scrubbed) {
            return threads.map(serverThreadToHistoryItem);
          }
          const merged = mergeHistory(current, threads);
          saveHistory(scope, merged);
          return merged;
        });
      })
      .catch(() => {
        // offline / backend error — keep the local cache
      });
  }, [isAuthenticated, scope, seedThreads]);

  useEffect(() => {
    if (!mounted) {
      return;
    }
    const refresh = () => {
      setHistory(loadHistory(scope));
      refreshServer();
    };

    refresh();
    window.addEventListener(HISTORY_CHANGED_EVENT, refresh);
    window.addEventListener("storage", refresh);

    return () => {
      window.removeEventListener(HISTORY_CHANGED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [mounted, refreshServer, scope]);

  const handleDelete = useCallback(() => {
    const chatToDelete = deleteId;
    const isCurrentChat = pathname === `/chat/${chatToDelete}`;

    setShowDeleteDialog(false);

    if (isCurrentChat) {
      router.replace("/");
    }

    setHistory((current) => current.filter((chat) => chat.id !== chatToDelete));
    saveHistory(
      scope,
      history.filter((chat) => chat.id !== chatToDelete),
    );

    // Also delete the thread server-side (best-effort).
    if (isAuthenticated && chatToDelete) {
      deleteThread(chatToDelete).catch(() => {
        // offline / already gone — the local removal stands
      });
    }

    toast.success("Chat deleted");
  }, [deleteId, history, isAuthenticated, pathname, router, scope]);

  const handleShowDeleteDialog = useCallback((chatId: string) => {
    setDeleteId(chatId);
    setShowDeleteDialog(true);
  }, []);

  const handleShowRename = useCallback((chat: ChatHistoryItem) => {
    setRenameTarget(chat);
    setRenameDraft(chat.title);
  }, []);

  const handleRename = useCallback(() => {
    const target = renameTarget;
    const title = renameDraft.trim();
    if (!target || !title) {
      return;
    }

    setRenamePending(true);
    const apply = (updated: ChatHistoryItem) => {
      setHistory((current) =>
        current.map((chat) => (chat.id === updated.id ? updated : chat)),
      );
      saveHistory(
        scope,
        history.map((chat) => (chat.id === updated.id ? updated : chat)),
      );
      window.dispatchEvent(new Event(HISTORY_CHANGED_EVENT));
      toast.success("Chat renamed");
    };

    if (isAuthenticated) {
      renameThread(target.id, title)
        .then((thread) => {
          apply({
            id: thread.thread_id,
            title: thread.title || title,
            createdAt: thread.created_at,
          });
        })
        .catch(() => {
          // Offline / backend error: keep the rename local-only.
          apply({ ...target, title });
        })
        .finally(() => setRenamePending(false));
    } else {
      apply({ ...target, title });
      setRenamePending(false);
    }

    setRenameTarget(null);
  }, [history, isAuthenticated, renameDraft, renameTarget, scope]);

  // Filter by title when the sidebar search is active; the date groups are
  // kept so matching chats still read as a timeline.
  const query = searchQuery.trim().toLowerCase();
  const visibleHistory = query
    ? history.filter((chat) => chat.title.toLowerCase().includes(query))
    : history;
  const groupedChats = groupChatsByDate(visibleHistory);

  return (
    <>
      <SidebarGroup className="group-data-[collapsible=icon]:hidden">
        <SidebarGroupLabel className="text-[10px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/70">
          History
        </SidebarGroupLabel>
        <SidebarGroupContent>
          {visibleHistory.length === 0 ? (
            <div className="flex w-full flex-row items-center justify-center gap-2 px-2 text-[13px] text-sidebar-foreground/60">
              {query
                ? "No chats match your search."
                : "Your conversations will appear here once you start chatting!"}
            </div>
          ) : (
            <SidebarMenu>
              <div className="flex flex-col gap-4">
                {groupedChats.today.length > 0 && (
                  <div>
                    <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/70">
                      Today
                    </div>
                    {groupedChats.today.map((chat) => (
                      <ChatItem
                        chat={chat}
                        isActive={chat.id === id}
                        key={chat.id}
                        onDelete={handleShowDeleteDialog}
                        onRename={handleShowRename}
                        setOpenMobile={setOpenMobile}
                        status={statuses[chat.id] ?? null}
                      />
                    ))}
                  </div>
                )}

                {groupedChats.yesterday.length > 0 && (
                  <div>
                    <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/70">
                      Yesterday
                    </div>
                    {groupedChats.yesterday.map((chat) => (
                      <ChatItem
                        chat={chat}
                        isActive={chat.id === id}
                        key={chat.id}
                        onDelete={handleShowDeleteDialog}
                        onRename={handleShowRename}
                        setOpenMobile={setOpenMobile}
                        status={statuses[chat.id] ?? null}
                      />
                    ))}
                  </div>
                )}

                {groupedChats.lastWeek.length > 0 && (
                  <div>
                    <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/70">
                      Last 7 days
                    </div>
                    {groupedChats.lastWeek.map((chat) => (
                      <ChatItem
                        chat={chat}
                        isActive={chat.id === id}
                        key={chat.id}
                        onDelete={handleShowDeleteDialog}
                        onRename={handleShowRename}
                        setOpenMobile={setOpenMobile}
                        status={statuses[chat.id] ?? null}
                      />
                    ))}
                  </div>
                )}

                {groupedChats.lastMonth.length > 0 && (
                  <div>
                    <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/70">
                      Last 30 days
                    </div>
                    {groupedChats.lastMonth.map((chat) => (
                      <ChatItem
                        chat={chat}
                        isActive={chat.id === id}
                        key={chat.id}
                        onDelete={handleShowDeleteDialog}
                        onRename={handleShowRename}
                        setOpenMobile={setOpenMobile}
                        status={statuses[chat.id] ?? null}
                      />
                    ))}
                  </div>
                )}

                {groupedChats.older.length > 0 && (
                  <div>
                    <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/70">
                      Older
                    </div>
                    {groupedChats.older.map((chat) => (
                      <ChatItem
                        chat={chat}
                        isActive={chat.id === id}
                        key={chat.id}
                        onDelete={handleShowDeleteDialog}
                        onRename={handleShowRename}
                        setOpenMobile={setOpenMobile}
                        status={statuses[chat.id] ?? null}
                      />
                    ))}
                  </div>
                )}
              </div>
            </SidebarMenu>
          )}
        </SidebarGroupContent>
      </SidebarGroup>

      <AlertDialog onOpenChange={setShowDeleteDialog} open={showDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete this
              chat
              {isAuthenticated ? " from your account" : " from your browser"}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>
              Continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        onOpenChange={(open) => {
          if (!open) {
            setRenameTarget(null);
          }
        }}
        open={renameTarget !== null}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Rename chat</DialogTitle>
            <DialogDescription>
              Give this conversation a more memorable title.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="rename-title">Title</FieldLabel>
              <Input
                id="rename-title"
                value={renameDraft}
                onChange={(event) => setRenameDraft(event.target.value)}
                maxLength={120}
                autoFocus
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !renamePending) {
                    handleRename();
                  }
                }}
              />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRenameTarget(null)}
              disabled={renamePending}
            >
              Cancel
            </Button>
            <Button onClick={handleRename} disabled={renamePending}>
              {renamePending ? "Renaming…" : "Rename"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
