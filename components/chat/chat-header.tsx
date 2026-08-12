"use client";

import { PanelLeftIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/ui/sidebar";
import { useActiveChat } from "@/hooks/use-active-chat";
import { HISTORY_STORAGE_KEY } from "@/lib/constants";
import type { ChatHistoryItem } from "@/lib/types";
import { ShareIcon } from "./icons";
import { ShareChatDialog } from "./share-dialog";

function loadHistory(): ChatHistoryItem[] {
  try {
    const raw = window.localStorage.getItem(HISTORY_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ChatHistoryItem[]) : [];
  } catch {
    return [];
  }
}

function PureChatHeader({ chatId }: { chatId: string }) {
  const { state, toggleSidebar, isMobile } = useSidebar();
  const { messages, isLoading } = useActiveChat();
  const [title, setTitle] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);

  useEffect(() => {
    setTitle(loadHistory().find((chat) => chat.id === chatId)?.title ?? null);
  }, [chatId]);

  if (state === "collapsed" && !isMobile) {
    return null;
  }

  const canShare = messages.length > 0 && !isLoading;

  return (
    <header className="sticky top-0 flex h-14 items-center gap-2 bg-sidebar px-3">
      <Button
        className="md:hidden"
        onClick={toggleSidebar}
        size="icon-sm"
        variant="ghost"
      >
        <PanelLeftIcon className="size-4" />
      </Button>

      {title ? (
        <div className="min-w-0 flex-1 truncate text-[13px] font-medium text-sidebar-foreground/70">
          {title}
        </div>
      ) : (
        <div className="flex-1" />
      )}

      <Button
        aria-label="Share chat"
        disabled={!canShare}
        onClick={() => setShareOpen(true)}
        size="icon-sm"
        variant="ghost"
      >
        <ShareIcon />
      </Button>

      <ShareChatDialog
        chatId={chatId}
        onOpenChange={setShareOpen}
        open={shareOpen}
      />
    </header>
  );
}

export const ChatHeader = PureChatHeader;
