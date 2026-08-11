"use client";

import { usePathname } from "next/navigation";
import { ChatShell } from "./shell";

/**
 * Renders the chat shell only on conversation routes (`/` and `/chat/[id]`).
 * Non-chat pages (e.g. `/settings`) render their own content instead of a
 * full-height chat UI above them.
 */
export function ChatShellRoute() {
  const pathname = usePathname();
  const isChatRoute = pathname === "/" || pathname.startsWith("/chat/");
  return isChatRoute ? <ChatShell /> : null;
}
