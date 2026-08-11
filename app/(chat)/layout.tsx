import { cookies } from "next/headers";
import { Suspense } from "react";
import { Toaster } from "sonner";
import { AuthGate } from "@/components/auth/auth-gate";
import { AppSidebar } from "@/components/chat/app-sidebar";
import { ChatShellRoute } from "@/components/chat/shell-route";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { ActiveChatProvider } from "@/hooks/use-active-chat";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<div className="flex h-dvh bg-sidebar" />}>
      <AuthGate>
        <SidebarShell>{children}</SidebarShell>
      </AuthGate>
    </Suspense>
  );
}

async function SidebarShell({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const isCollapsed = cookieStore.get("sidebar_state")?.value !== "true";

  return (
    <SidebarProvider defaultOpen={!isCollapsed}>
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
    </SidebarProvider>
  );
}
