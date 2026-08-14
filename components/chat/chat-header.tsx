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
  const { toggleSidebar } = useSidebar();
  const [title, setTitle] = useState<string | null>(null);

  useEffect(() => {
    setTitle(loadHistory().find((chat) => chat.id === chatId)?.title ?? null);
  }, [chatId]);

  return (
    <header className="absolute inset-x-0 top-0 z-20 flex h-14 items-center gap-2 border-b border-border/40 bg-sidebar/70 px-3 backdrop-blur-md">
      <Button
        className="md:hidden"
        onClick={toggleSidebar}
        size="icon-sm"
        variant="ghost"
      >
        <PanelLeftIcon className="size-4" />
      </Button>

      {title ? (
        <div className="min-w-0 flex-1 truncate text-sm font-semibold text-sidebar-foreground">
          {title}
        </div>
      ) : (
        <div className="min-w-0 flex-1 truncate text-sm font-medium text-sidebar-foreground/40">
          New chat
        </div>
      )}
    </header>
  );
}

export const ChatHeader = PureChatHeader;
