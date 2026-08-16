"use client";

import { usePathname } from "next/navigation";
import { SetupGate } from "./onboarding";
import { ChatShell } from "./shell";

/**
 * Renders the chat shell only on conversation routes (`/` and `/chat/[id]`).
 * Non-chat pages (e.g. `/settings`) render their own content instead of a
 * full-height chat UI above them. The setup gate shows the onboarding
 * screen until the user's setup is complete (admin-managed model
 * connection), then renders the chat shell.
 */
export function ChatShellRoute() {
  const pathname = usePathname();
  const isChatRoute = pathname === "/" || pathname.startsWith("/chat/");
  return isChatRoute ? (
    <SetupGate>
      <ChatShell />
    </SetupGate>
  ) : null;
}
