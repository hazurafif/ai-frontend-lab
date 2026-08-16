"use client";

// Startup screen.
//
// Shows until the backend reports a default `llm` connection (admin-managed)
// — without it there's no model to chat with, so the chat UI stays locked.
// Polls the setup state and unlocks automatically once an admin configures
// the connection. Preferences and MCP tool servers live in Settings.
//
// A backend that is unreachable (setup fetch fails) is treated as complete
// so an offline backend never blocks the chat UI.

import { RefreshCcwIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";
import { fetchSetupState } from "@/lib/setup";

const POLL_INTERVAL_MS = 10_000;

export function SetupGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<"loading" | "ready" | "onboarding">(
    "loading",
  );

  // Mount-gated fetch (hydration rule): the server render must match the
  // client's first render — only then do we know the real setup state.
  useEffect(() => {
    let cancelled = false;
    fetchSetupState()
      .then((data) => {
        if (cancelled) {
          return;
        }
        setState(!data || data.completed ? "ready" : "onboarding");
      })
      .catch(() => {
        if (!cancelled) {
          setState("ready");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // While onboarding, keep polling so the screen clears itself as soon as
  // an admin saves the model connection.
  useEffect(() => {
    if (state !== "onboarding") {
      return;
    }
    const id = setInterval(() => {
      fetchSetupState()
        .then((data) => {
          if (data?.completed) {
            setState("ready");
          }
        })
        .catch(() => {});
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [state]);

  const checkAgain = () => {
    fetchSetupState()
      .then((data) => {
        if (data?.completed) {
          setState("ready");
        }
      })
      .catch(() => {});
  };

  if (state === "loading") {
    return null;
  }
  if (state === "ready") {
    return children;
  }
  return (
    <OnboardingScreen
      onCheckAgain={checkAgain}
      onDone={() => setState("ready")}
    />
  );
}

function OnboardingScreen({
  onCheckAgain,
  onDone,
}: {
  onCheckAgain: () => void;
  onDone: () => void;
}) {
  const { user } = useAuth();
  const router = useRouter();
  const isAdmin = user?.role === "admin";

  return (
    <div className="flex h-full min-h-dvh items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Welcome</CardTitle>
          <CardDescription>
            {isAdmin
              ? "No model connection yet — add one to unlock chat."
              : "Chat unlocks once an admin adds the model connection."}
          </CardDescription>
        </CardHeader>
        <CardFooter className="flex items-center justify-between gap-3">
          {isAdmin ? (
            <>
              <Button onClick={onDone} type="button" variant="ghost">
                Later
              </Button>
              <Button
                onClick={() => router.push("/settings?tab=model")}
                type="button"
              >
                Add the model connection
              </Button>
            </>
          ) : (
            <>
              <Button onClick={onDone} type="button" variant="ghost">
                Enter the app
              </Button>
              <Button onClick={onCheckAgain} type="button">
                <RefreshCcwIcon data-icon="inline-start" />
                Check again
              </Button>
            </>
          )}
        </CardFooter>
      </Card>
    </div>
  );
}
