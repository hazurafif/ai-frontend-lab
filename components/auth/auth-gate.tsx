// Redirects signed-out visitors to /login. The auth state resolves in an
// effect ("loading" until then), so no SSR-era mount gate is needed — the
// status check already prevents flashing the chat UI at a signed-out
// visitor (docs/migration.md: no SSR in this app).

import { type ReactNode, useEffect } from "react";
import { useNavigate } from "react-router";

import { Spinner } from "@/components/ui/spinner";
import { useAuth } from "@/hooks/use-auth";

export function AuthGate({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { isAuthenticated, status } = useAuth();

  useEffect(() => {
    if (!isAuthenticated) {
      navigate("/login", { replace: true });
    }
  }, [isAuthenticated, navigate]);

  // The auth check is still running: render a neutral fallback instead of
  // flashing the chat UI at a signed-out visitor.
  if (status === "loading" || !isAuthenticated) {
    return (
      <div className="flex h-dvh items-center justify-center bg-background">
        <Spinner className="size-5 text-muted-foreground" />
      </div>
    );
  }

  return children;
}
