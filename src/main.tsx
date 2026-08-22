import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/use-auth";

import "./globals.css";
import { BASE_PATH } from "@/lib/env";
import { router } from "./router";

// Port of app/layout.tsx. No React StrictMode (Vite default) — the
// prefab-app AbortController code already tolerates a single invoke, and
// two invokes were never required (docs/migration.md decision 4).

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    // Replaces the old <SerwistProvider> — the vite plugin emits sw.js at
    // the output root (docs/migration.md decision 5).
    navigator.serviceWorker.register(`${BASE_PATH}/sw.js`).catch(() => {});
  });
}

createRoot(document.getElementById("root")!).render(
  <ThemeProvider
    attribute="class"
    defaultTheme="system"
    disableTransitionOnChange
    enableSystem
  >
    <AuthProvider>
      <TooltipProvider>
        <RouterProvider router={router} />
      </TooltipProvider>
    </AuthProvider>
  </ThemeProvider>,
);
