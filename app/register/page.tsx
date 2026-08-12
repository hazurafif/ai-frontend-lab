"use client";

// /register — standalone page (outside the (chat) route group so it never
// inherits the sidebar shell or the AuthGate). Mount-gated: the auth state
// is read from localStorage, so the first client render must match the
// server render (signed out).

import { MessageSquareIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { RegisterForm } from "@/components/auth/register-form";
import { Spinner } from "@/components/ui/spinner";
import { useAuth } from "@/hooks/use-auth";

export default function RegisterPage() {
  const router = useRouter();
  const { isAuthenticated, status } = useAuth();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Already signed in? Send the visitor back to the app.
  useEffect(() => {
    if (mounted && isAuthenticated) {
      router.replace("/");
    }
  }, [mounted, isAuthenticated, router]);

  if (!mounted || status === "loading" || isAuthenticated) {
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
      <RegisterForm />
    </div>
  );
}
