"use client";

import { LoaderCircleIcon, PencilIcon } from "lucide-react";
import Link from "next/link";
import { memo, useCallback } from "react";
import { toast } from "@/components/chat/toast";
import { createChatShare } from "@/lib/share";
import type { ThreadStatus } from "@/lib/threads";
import type { ChatHistoryItem } from "@/lib/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import {
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from "../ui/sidebar";
import { MoreHorizontalIcon, ShareIcon, TrashIcon } from "./icons";

const PureChatItem = ({
  chat,
  isActive,
  onDelete,
  onRename,
  setOpenMobile,
  status = null,
}: {
  chat: ChatHistoryItem;
  isActive: boolean;
  onDelete: (chatId: string) => void;
  onRename: (chat: ChatHistoryItem) => void;
  setOpenMobile: (open: boolean) => void;
  /** Run status from the durable-chat store; "running" shows a spinner. */
  status?: ThreadStatus;
}) => {
  const closeMobile = useCallback(() => {
    setOpenMobile(false);
  }, [setOpenMobile]);

  const handleDelete = useCallback(() => {
    onDelete(chat.id);
  }, [chat.id, onDelete]);

  const handleRename = useCallback(() => {
    onRename(chat);
  }, [chat, onRename]);

  const handleShare = useCallback(async () => {
    try {
      const result = await createChatShare(chat.id);
      await navigator.clipboard.writeText(result.url);
      closeMobile();
      toast({
        description: "Share link copied to clipboard",
        type: "success",
      });
    } catch (error) {
      closeMobile();
      toast({
        description:
          error instanceof Error
            ? error.message
            : "Couldn't share this chat. Please try again.",
        type: "error",
      });
    }
  }, [chat.id, closeMobile]);

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        className="h-8 rounded-none text-[13px] text-sidebar-foreground/50 transition-all duration-150 hover:bg-transparent hover:text-sidebar-foreground data-active:bg-transparent data-active:font-normal data-active:text-sidebar-foreground/50 data-[active=true]:text-sidebar-foreground data-[active=true]:font-medium data-[active=true]:border-b data-[active=true]:border-dashed data-[active=true]:border-sidebar-foreground/50"
        isActive={isActive}
        render={<Link href={`/chat/${chat.id}`} onClick={closeMobile} />}
      >
        {status === "running" && (
          <span
            className="mr-1 flex size-3 shrink-0 items-center text-sidebar-foreground/50"
            title="Answering in the background…"
          >
            <LoaderCircleIcon className="size-3 animate-spin" />
          </span>
        )}
        <span className="truncate">{chat.title}</span>
        {chat.shareToken && (
          <span
            className="flex size-3 shrink-0 items-center text-sidebar-foreground/40"
            title="Shared"
          >
            <ShareIcon size={12} />
          </span>
        )}
      </SidebarMenuButton>

      <DropdownMenu modal={true}>
        <DropdownMenuTrigger
          render={
            <SidebarMenuAction
              className="mr-0.5 rounded-md text-sidebar-foreground/50 ring-0 transition-colors duration-150 focus-visible:ring-0 hover:text-sidebar-foreground data-popup-open:bg-sidebar-accent data-popup-open:text-sidebar-accent-foreground"
              showOnHover={!isActive}
            />
          }
        >
          <MoreHorizontalIcon />
          <span className="sr-only">More</span>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" side="bottom">
          <DropdownMenuItem onClick={handleShare}>
            <ShareIcon />
            <span>Share</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleRename}>
            <PencilIcon />
            <span>Rename</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleDelete} variant="destructive">
            <TrashIcon />
            <span>Delete</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  );
};

export const ChatItem = memo(PureChatItem, (prevProps, nextProps) => {
  if (prevProps.isActive !== nextProps.isActive) {
    return false;
  }
  if (prevProps.chat.shareToken !== nextProps.chat.shareToken) {
    return false;
  }
  if (prevProps.status !== nextProps.status) {
    return false;
  }
  return true;
});
