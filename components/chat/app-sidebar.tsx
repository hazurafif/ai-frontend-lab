"use client";

import {
  ChevronsUpDownIcon,
  LogOutIcon,
  MessageSquareIcon,
  MoonIcon,
  PanelLeftIcon,
  PenSquareIcon,
  SearchIcon,
  SettingsIcon,
  SunIcon,
  TrashIcon,
  XIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { SidebarHistory } from "@/components/chat/sidebar-history";
import {
  type SettingsTabId,
  settingsCategoriesForRole,
  useSettingsTabs,
} from "@/components/settings/settings-tabs-context";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { useActiveChat } from "@/hooks/use-active-chat";
import { useAuth } from "@/hooks/use-auth";
import type { AuthUser } from "@/lib/auth";
import { HISTORY_STORAGE_KEY, LAST_ACTIVE_CHAT_KEY } from "@/lib/constants";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";

/** First letters of the display name (e.g. "Ada Lovelace" → "AL"). */
function accountInitials(user: AuthUser): string {
  const name = user.full_name?.trim() || user.username;
  const parts = name.split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

export function AppSidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const { setOpenMobile, toggleSidebar } = useSidebar();
  const { resolvedTheme, setTheme } = useTheme();
  const { deleteAllChats, newChat } = useActiveChat();
  const { user, logout } = useAuth();
  const { activeTab, setActiveTab } = useSettingsTabs();
  const [mounted, setMounted] = useState(false);
  const [showDeleteAllDialog, setShowDeleteAllDialog] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);

  // On /settings the sidebar becomes the settings navigation instead of the
  // chat history — the settings page renders its content in the main area.
  const isSettings = pathname.startsWith("/settings");
  const settingsCategories = settingsCategoriesForRole(user?.role);

  const handleTabSelect = useCallback(
    (tab: SettingsTabId) => {
      setActiveTab(tab);
      setOpenMobile(false);
    },
    [setActiveTab, setOpenMobile],
  );

  useEffect(() => {
    setMounted(true);
  }, []);

  // Closing the search modal (or opening a chat from it) clears the query
  // so the sidebar history is never left filtered.
  useEffect(() => {
    setSearchOpen(false);
    setSearchQuery("");
  }, [pathname]);

  const closeMobile = useCallback(() => {
    setOpenMobile(false);
  }, [setOpenMobile]);

  const handleToggleSidebar = useCallback(() => {
    toggleSidebar();
  }, [toggleSidebar]);

  const handleNewChat = useCallback(() => {
    setOpenMobile(false);
    newChat();
  }, [newChat, setOpenMobile]);

  // Settings sidebar: return to the chat UI. The / route always starts a
  // new chat, so restore the last opened conversation (tracked in
  // use-active-chat) when it still exists; fall back to the home composer.
  const handleBackToChat = useCallback(() => {
    setOpenMobile(false);
    try {
      const lastId = window.localStorage.getItem(LAST_ACTIVE_CHAT_KEY);
      const history = JSON.parse(
        window.localStorage.getItem(HISTORY_STORAGE_KEY) ?? "[]",
      ) as { id?: string }[];
      if (lastId && history.some((chat) => chat.id === lastId)) {
        router.push(`/chat/${lastId}`);
        return;
      }
    } catch {
      // malformed cache — fall through to the home composer
    }
    router.push("/");
  }, [router, setOpenMobile]);

  const handleShowDeleteAllDialog = useCallback(() => {
    setShowDeleteAllDialog(true);
  }, []);

  const handleDeleteAll = useCallback(() => {
    setShowDeleteAllDialog(false);
    router.replace("/");
    deleteAllChats();
    toast.success("All chats deleted");
  }, [deleteAllChats, router]);

  const handleToggleTheme = useCallback(() => {
    setTheme(resolvedTheme === "dark" ? "light" : "dark");
  }, [resolvedTheme, setTheme]);

  const handleGoToSettings = useCallback(() => {
    setOpenMobile(false);
    router.push("/settings");
  }, [router, setOpenMobile]);

  const handleLogout = useCallback(() => {
    logout();
    router.push("/login");
  }, [logout, router]);

  return (
    <>
      <Sidebar collapsible="icon">
        <SidebarHeader className="pb-0 pt-3">
          <SidebarMenu>
            <SidebarMenuItem className="flex flex-row items-center justify-between">
              <div className="group/logo relative flex items-center justify-center">
                <SidebarMenuButton
                  className="size-8 !px-0 items-center justify-center group-data-[collapsible=icon]:invisible"
                  render={<Link href="/" onClick={closeMobile} />}
                  tooltip="Chatbot"
                >
                  <MessageSquareIcon className="size-4 text-sidebar-foreground/50" />
                </SidebarMenuButton>
                <SidebarMenuButton
                  className="pointer-events-none absolute inset-0 size-8 opacity-0 group-data-[collapsible=icon]:pointer-events-auto group-data-[collapsible=icon]:opacity-100"
                  onClick={handleToggleSidebar}
                  tooltip={{
                    children: "Open sidebar",
                    className: "hidden md:block",
                    side: "right",
                  }}
                >
                  <PanelLeftIcon className="size-4 text-sidebar-foreground/60" />
                </SidebarMenuButton>
              </div>
              <div className="group-data-[collapsible=icon]:hidden flex items-center gap-0.5">
                <Button
                  aria-label="Search chats"
                  className="text-sidebar-foreground/60 transition-colors duration-150 hover:text-sidebar-foreground"
                  onClick={() => setSearchOpen(true)}
                  size="icon-sm"
                  variant="ghost"
                >
                  <SearchIcon className="size-4" />
                </Button>
                <SidebarTrigger className="text-sidebar-foreground/60 transition-colors duration-150 hover:text-sidebar-foreground" />
              </div>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          {isSettings ? (
            <>
              <SidebarGroup className="pt-1">
                <SidebarGroupContent>
                  <SidebarMenu>
                    <SidebarMenuItem>
                      <SidebarMenuButton
                        className="h-8 rounded-lg border border-sidebar-border text-[13px] text-sidebar-foreground/70 transition-colors duration-150 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                        onClick={handleBackToChat}
                        tooltip="Back to chat"
                      >
                        <MessageSquareIcon className="size-4" />
                        <span className="font-medium">Back to chat</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>

              <SidebarSeparator className="mx-1" />

              {settingsCategories.map((category) => (
                <SidebarGroup key={category.id} className="pt-1">
                  <SidebarGroupLabel className="px-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/50">
                    {category.label}
                  </SidebarGroupLabel>
                  <SidebarGroupContent>
                    <SidebarMenu>
                      {category.tabs.map((tab) => {
                        const Icon = tab.icon;
                        return (
                          <SidebarMenuItem key={tab.id}>
                            <SidebarMenuButton
                              className="h-8 rounded-lg text-[13px] text-sidebar-foreground/60 transition-colors duration-150 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground data-active:bg-sidebar-accent/80 data-active:text-sidebar-accent-foreground"
                              isActive={activeTab === tab.id}
                              onClick={() => handleTabSelect(tab.id)}
                              tooltip={tab.label}
                            >
                              <Icon className="size-4" />
                              <span>{tab.label}</span>
                            </SidebarMenuButton>
                          </SidebarMenuItem>
                        );
                      })}
                    </SidebarMenu>
                  </SidebarGroupContent>
                </SidebarGroup>
              ))}
            </>
          ) : (
            <>
              <SidebarGroup className="pt-1">
                <SidebarGroupContent>
                  <SidebarMenu>
                    <SidebarMenuItem>
                      <SidebarMenuButton
                        className="h-8 rounded-lg border border-sidebar-border text-[13px] text-sidebar-foreground/70 transition-colors duration-150 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                        onClick={handleNewChat}
                        tooltip="New Chat"
                      >
                        <PenSquareIcon className="size-4" />
                        <span className="font-medium">New chat</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                    {/* Collapsed (icon) mode: search icon below New chat —
                        opens the search-chats modal. */}
                    <SidebarMenuItem className="hidden group-data-[collapsible=icon]:block">
                      <SidebarMenuButton
                        className="h-8 rounded-lg text-sidebar-foreground/60 transition-colors duration-150 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                        onClick={() => setSearchOpen(true)}
                        tooltip="Search chats"
                      >
                        <SearchIcon className="size-4" />
                        <span className="text-[13px]">Search</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                    <SidebarMenuItem>
                      <SidebarMenuButton
                        className="rounded-lg text-sidebar-foreground/40 transition-colors duration-150 hover:bg-destructive/10 hover:text-destructive"
                        onClick={handleShowDeleteAllDialog}
                        tooltip="Delete All Chats"
                      >
                        <TrashIcon className="size-4" />
                        <span className="text-[13px]">Delete all</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
              <SidebarHistory searchQuery={searchQuery} />

              {/* Search-chats modal (opened from the collapsed sidebar icon):
                  a focused search input over the same filtered history. */}
              <Dialog
                onOpenChange={(open) => {
                  setSearchOpen(open);
                  if (!open) {
                    setSearchQuery("");
                  }
                }}
                open={searchOpen}
              >
                <DialogContent className="sm:max-w-2xl">
                  <DialogHeader>
                    <DialogTitle>Search chats</DialogTitle>
                  </DialogHeader>
                  <InputGroup className="rounded-lg">
                    <InputGroupAddon align="inline-start">
                      <SearchIcon className="text-muted-foreground/40" />
                    </InputGroupAddon>
                    <InputGroupInput
                      aria-label="Search chats"
                      autoFocus
                      className="text-[13px]"
                      onChange={(event) => setSearchQuery(event.target.value)}
                      placeholder="Search chats"
                      value={searchQuery}
                    />
                    {searchQuery && (
                      <InputGroupAddon align="inline-end">
                        <InputGroupButton
                          aria-label="Clear search"
                          onClick={() => setSearchQuery("")}
                          size="icon-xs"
                        >
                          <XIcon className="size-3.5" />
                        </InputGroupButton>
                      </InputGroupAddon>
                    )}
                  </InputGroup>
                  <div className="max-h-[50dvh] overflow-y-auto">
                    <SidebarHistory searchQuery={searchQuery} />
                  </div>
                </DialogContent>
              </Dialog>
            </>
          )}
        </SidebarContent>
        <SidebarFooter className="border-t border-sidebar-border pt-2 pb-3">
          {mounted && user ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <button
                    className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left transition-colors duration-150 hover:bg-sidebar-accent/50 data-popup-open:bg-sidebar-accent group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
                    type="button"
                  >
                    <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-sidebar-accent text-[11px] font-semibold text-sidebar-foreground">
                      {accountInitials(user)}
                    </div>
                    <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
                      <div className="truncate text-[13px] font-medium text-sidebar-foreground">
                        {user.full_name?.trim() || user.username}
                      </div>
                      <div className="truncate text-[11px] text-sidebar-foreground/50">
                        {user.full_name?.trim()
                          ? `@${user.username}`
                          : (user.email ?? null)}
                      </div>
                    </div>
                    <ChevronsUpDownIcon className="size-3.5 shrink-0 text-sidebar-foreground/40 group-data-[collapsible=icon]:hidden" />
                  </button>
                }
              >
                <span className="sr-only">Account menu</span>
              </DropdownMenuTrigger>

              <DropdownMenuContent
                align="start"
                className="min-w-56"
                side="top"
                sideOffset={8}
              >
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="flex flex-col gap-0.5 py-2 text-sidebar-foreground">
                    <span className="text-[13px] font-medium">
                      {user.full_name?.trim() || user.username}
                    </span>
                    <span className="text-[11px] font-normal text-sidebar-foreground/50">
                      {user.full_name?.trim()
                        ? `@${user.username}`
                        : (user.email ?? null)}
                    </span>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleGoToSettings}>
                    <SettingsIcon className="size-4" />
                    <span>Settings</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleToggleTheme}>
                    {mounted && resolvedTheme === "dark" ? (
                      <SunIcon className="size-4" />
                    ) : (
                      <MoonIcon className="size-4" />
                    )}
                    <span>
                      {mounted && resolvedTheme === "dark"
                        ? "Light mode"
                        : "Dark mode"}
                    </span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={handleLogout}
                    variant="destructive"
                  >
                    <LogOutIcon className="size-4" />
                    <span>Sign out</span>
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  className="h-8 rounded-lg text-sidebar-foreground/60 transition-colors duration-150 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                  render={<Link href="/settings" onClick={closeMobile} />}
                  tooltip="Settings"
                >
                  <SettingsIcon className="size-4" />
                  <span className="text-[13px]">Settings</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  className="h-8 rounded-lg text-sidebar-foreground/60 transition-colors duration-150 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                  onClick={handleToggleTheme}
                  tooltip={
                    mounted && resolvedTheme === "dark"
                      ? "Light mode"
                      : "Dark mode"
                  }
                >
                  {mounted && resolvedTheme === "dark" ? (
                    <SunIcon className="size-4" />
                  ) : (
                    <MoonIcon className="size-4" />
                  )}
                  <span className="text-[13px]">
                    {mounted && resolvedTheme === "dark"
                      ? "Light mode"
                      : "Dark mode"}
                  </span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  className="h-8 rounded-lg text-sidebar-foreground/60 transition-colors duration-150 hover:bg-destructive/10 hover:text-destructive"
                  onClick={handleLogout}
                  tooltip="Sign out"
                >
                  <LogOutIcon className="size-4" />
                  <span className="text-[13px]">Sign out</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          )}
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>

      <AlertDialog
        onOpenChange={setShowDeleteAllDialog}
        open={showDeleteAllDialog}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete all chats?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete all
              your chats from this browser.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteAll}>
              Delete All
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
