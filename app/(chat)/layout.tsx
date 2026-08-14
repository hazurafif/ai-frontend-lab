import { cookies } from "next/headers";
import { Suspense } from "react";
import { Toaster } from "sonner";
import { AuthGate } from "@/components/auth/auth-gate";
import { AppSidebar } from "@/components/chat/app-sidebar";
import { ChatShellRoute } from "@/components/chat/shell-route";
import { SettingsTabsProvider } from "@/components/settings/settings-tabs-context";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { ActiveChatProvider } from "@/hooks/use-active-chat";

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
        <ActiveChatProvider>
          <AppSidebar />
          <SidebarInset>
            <Toaster
              position="top-center"
              theme="system"
              toastOptions={{
                className:
                  "!bg-card !text-foreground !border-border/50 !shadow-[var(--shadow-float)]",
              }}
            />
            <Suspense fallback={<div className="flex h-dvh" />}>
              <ChatShellRoute />
            </Suspense>
            {children}
          </SidebarInset>
        </ActiveChatProvider>
      </SettingsTabsProvider>
    </SidebarProvider>
  );
}
