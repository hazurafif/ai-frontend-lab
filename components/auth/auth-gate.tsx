"use client";

// Redirects signed-out visitors to /login. Mount-gated so the server render
// (no token yet) matches the client's first render.

import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";

import { Spinner } from "@/components/ui/spinner";
import { useAuth } from "@/hooks/use-auth";

export function AuthGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { isAuthenticated, status } = useAuth();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted && !isAuthenticated) {
      router.replace("/login");
    }
  }, [mounted, isAuthenticated, router]);

  // Not mounted yet, or the auth check is still running: render a neutral
  // fallback instead of flashing the chat UI at a signed-out visitor.
  if (!mounted || status === "loading" || !isAuthenticated) {
    return (
      <div className="flex h-dvh items-center justify-center bg-background">
        <Spinner className="size-5 text-muted-foreground" />
      </div>
    );
  }

  return children;
}
