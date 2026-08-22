"use client";

// React Router tree — ports the Next.js App Router structure
// (docs/migration.md):
//
//   /login, /register       standalone (outside the shell, no AuthGate)
//   /share/:shareId         public read-only shared chat
//   /offline                PWA offline fallback page
//   |- ShellLayout          sidebar shell (SidebarProvider + providers),
//   |  |- AuthGate          signed-out visitors → /login
//   |  |  |- /              chat shell (SetupGate → ChatShell)
//   |  |  |- /chat/:chatId  chat shell for an existing thread
//   |  |  |- /settings      settings page (renders its own content)
//   *                        → redirect /

import { lazy, Suspense } from "react";
import { createBrowserRouter, Navigate, Outlet } from "react-router";
import { AuthGate } from "@/components/auth/auth-gate";

const SettingsPage = lazy(() => import("./pages/settings"));

import { SetupGate } from "@/components/chat/onboarding";
import { ChatShell } from "@/components/chat/shell";
import { BASE_PATH } from "@/lib/env";
import LoginPage from "./pages/login";
import OfflinePage from "./pages/offline";
import RegisterPage from "./pages/register";
import SharedChatPage from "./pages/shared-chat";
import { ShellLayout } from "./pages/shell-layout";

export const router = createBrowserRouter(
  [
    {
      path: "/login",
      element: <LoginPage />,
    },
    {
      path: "/register",
      element: <RegisterPage />,
    },
    {
      path: "/share/:shareId",
      element: <SharedChatPage />,
    },
    {
      path: "/offline",
      element: <OfflinePage />,
    },
    {
      element: <ShellLayout />,
      children: [
        {
          // Login gate for app pages: spinner while auth initializes,
          // redirect to /login when signed out.
          element: (
            <AuthGate>
              <Outlet />
            </AuthGate>
          ),
          children: [
            {
              path: "/",
              element: (
                <SetupGate>
                  <ChatShell />
                </SetupGate>
              ),
            },
            {
              path: "/chat/:chatId",
              element: (
                <SetupGate>
                  <ChatShell />
                </SetupGate>
              ),
            },
            {
              path: "/settings",
              // Code-split: the settings page pulls the admin surface + tables;
              // keep it out of the chat entry chunk (docs/migration.md).
              element: (
                <Suspense fallback={null}>
                  <SettingsPage />
                </Suspense>
              ),
            },
          ],
        },
      ],
    },
    {
      path: "*",
      element: <Navigate to="/" replace />,
    },
  ],
  {
    basename: BASE_PATH,
  },
);
