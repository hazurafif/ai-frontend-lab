import { cookies } from "next/headers";
import { Suspense } from "react";
import { AuthGate } from "@/components/auth/auth-gate";
import { AppSidebar } from "@/components/chat/app-sidebar";
import { ChatShellRoute } from "@/components/chat/shell-route";
import { SettingsTabsProvider } from "@/components/settings/settings-tabs-context";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner";
import { ActiveChatProvider } from "@/hooks/use-active-chat";
import { ThreadsProvider } from "@/lib/chat/chat-store";
import { NotificationListener } from "@/lib/chat/notification-stream";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<div className="flex h-dvh bg-sidebar" />}>
      {/* SidebarShell awaits cookies() — it must sit directly under the
          Suspense boundary (a client component in between, like AuthGate,
          makes the dynamic access block the whole route). */}
      <SidebarShell>
        <AuthGate>{children}</AuthGate>
      </SidebarShell>
    </Suspense>
  );
}

async function SidebarShell({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const isCollapsed = cookieStore.get("sidebar_state")?.value !== "true";

  return (
    <SidebarProvider defaultOpen={!isCollapsed}>
      <SettingsTabsProvider>
        <ThreadsProvider>
          <ActiveChatProvider>
            <AppSidebar />
            <SidebarInset>
              <Toaster position="top-center" />
              <Suspense fallback={<div className="flex h-dvh" />}>
                <ChatShellRoute />
              </Suspense>
              {children}
            </SidebarInset>
          </ActiveChatProvider>
          {/* One run-lifecycle SSE connection per user (guests skip it). */}
          <NotificationListener />
        </ThreadsProvider>
      </SettingsTabsProvider>
    </SidebarProvider>
  );
}
