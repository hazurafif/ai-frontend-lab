// /login — standalone page (outside the shell layout). The auth state
// resolves in an effect (status "loading" until then), so no SSR-era mount
// gate is needed (docs/migration.md: no SSR in this app).

import { MessageSquareIcon } from "lucide-react";
import { useEffect } from "react";
import { useNavigate } from "react-router";

import { LoginForm } from "@/components/auth/login-form";
import { Spinner } from "@/components/ui/spinner";
import { useAuth } from "@/hooks/use-auth";

export default function LoginPage() {
  const navigate = useNavigate();
  const { isAuthenticated, status } = useAuth();
  // Already signed in? Send the visitor back to the app.
  useEffect(() => {
    if (isAuthenticated) {
      navigate("/", { replace: true });
    }
  }, [isAuthenticated, navigate]);

  if (status === "loading" || isAuthenticated) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background">
        <Spinner className="size-5 text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-background p-4">
      <div className="flex flex-col items-center gap-3">
        <div className="flex size-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
          <MessageSquareIcon className="size-5" />
        </div>
        <h1 className="text-xl font-semibold tracking-tight">
          AI Frontend Lab
        </h1>
      </div>
      <LoginForm />
    </div>
  );
}
