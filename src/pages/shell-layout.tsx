"use client";

// Port of the Next.js (chat) route-group layout (app/(chat)/layout.tsx).
// Next specifics → client equivalents (docs/migration.md):
//   - cookies() sidebar state → localStorage
//   - <Suspense> around the shell was for SSR streaming — dropped in the SPA
//   - router children → <Outlet /> (pages render where {children} was)

import { Outlet } from "react-router";
import { AppSidebar } from "@/components/chat/app-sidebar";
import { SettingsTabsProvider } from "@/components/settings/settings-tabs-context";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner";
import { ActiveChatProvider } from "@/hooks/use-active-chat";
import { ThreadsProvider } from "@/lib/chat/chat-store";
import { NotificationListener } from "@/lib/chat/notification-stream";

function initialSidebarOpen(): boolean {
  try {
    return window.localStorage.getItem("sidebar_state") !== "false";
  } catch {
    return true;
  }
}

export function ShellLayout() {
  return (
    <SidebarProvider defaultOpen={initialSidebarOpen()}>
      <SettingsTabsProvider>
        <ThreadsProvider>
          <ActiveChatProvider>
            <AppSidebar />
            <SidebarInset>
              <Toaster position="top-center" />
              <Outlet />
            </SidebarInset>
          </ActiveChatProvider>
          {/* One run-lifecycle SSE connection per user (guests skip it). */}
          <NotificationListener />
        </ThreadsProvider>
      </SettingsTabsProvider>
    </SidebarProvider>
  );
}
