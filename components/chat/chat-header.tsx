"use client";

import { PanelLeftIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/ui/sidebar";
import { HISTORY_STORAGE_KEY } from "@/lib/constants";
import type { ChatHistoryItem } from "@/lib/types";

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
  const [title, setTitle] = useState<string | null>(null);

  useEffect(() => {
    setTitle(loadHistory().find((chat) => chat.id === chatId)?.title ?? null);
  }, [chatId]);

  if (state === "collapsed" && !isMobile) {
    return null;
  }

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
    </header>
  );
}

export const ChatHeader = PureChatHeader;
