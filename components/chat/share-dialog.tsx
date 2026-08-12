"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "@/components/chat/toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { createChatShare, revokeChatShare } from "@/lib/share";
import { CopyIcon, LoaderIcon, ShareIcon } from "./icons";

type ShareState =
  | { status: "idle" }
  | { status: "creating" }
  | { status: "ready"; url: string }
  | { status: "error"; message: string };

export function ShareChatDialog({
  chatId,
  open,
  onOpenChange,
}: {
  chatId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [state, setState] = useState<ShareState>({ status: "idle" });

  // Reset whenever a different chat is opened.
  useEffect(() => {
    setState({ status: "idle" });
  }, [chatId]);

  // Create the share once per open. Reopening shows the cached link.
  useEffect(() => {
    if (!open || state.status !== "idle") {
      return;
    }

    setState({ status: "creating" });
    createChatShare(chatId)
      .then((result) => setState({ status: "ready", url: result.url }))
      .catch((error: unknown) =>
        setState({
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "Couldn't share this chat. Please try again.",
        }),
      );
  }, [chatId, open, state.status]);

  const handleCopy = useCallback(async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast({ description: "Share link copied to clipboard", type: "success" });
    } catch {
      toast({ description: "Couldn't copy the link", type: "error" });
    }
  }, []);

  const handleStopSharing = useCallback(async () => {
    // Reset first so reopening the dialog creates a fresh link.
    setState({ status: "idle" });
    try {
      await revokeChatShare(chatId);
      toast({ description: "Sharing stopped", type: "success" });
    } catch (error) {
      toast({
        description:
          error instanceof Error
            ? error.message
            : "Couldn't stop sharing. Please try again.",
        type: "error",
      });
    }
    onOpenChange(false);
  }, [chatId, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Share chat</DialogTitle>
          <DialogDescription>
            Anyone with the link can view this conversation.
          </DialogDescription>
        </DialogHeader>

        {state.status === "creating" && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="animate-spin">
              <LoaderIcon />
            </span>
            Creating share link…
          </div>
        )}

        {state.status === "ready" && (
          <div className="flex flex-col gap-3">
            <div className="flex gap-2">
              <Input
                className="font-mono text-[13px]"
                onFocus={(e) => e.currentTarget.select()}
                readOnly
                value={state.url}
              />
              <Button
                aria-label="Copy share link"
                onClick={() => handleCopy(state.url)}
                variant="outline"
              >
                <CopyIcon data-icon="inline-start" />
                Copy
              </Button>
            </div>
            <div className="flex items-center justify-between gap-2">
              <a
                className="text-sm text-muted-foreground underline underline-offset-3 transition-colors hover:text-foreground"
                href={state.url}
                rel="noreferrer"
                target="_blank"
              >
                Open shared chat
              </a>
              <Button onClick={handleStopSharing} size="xs" variant="ghost">
                Stop sharing
              </Button>
            </div>
          </div>
        )}

        {state.status === "error" && (
          <div className="flex flex-col items-start gap-3">
            <p className="text-sm text-muted-foreground">{state.message}</p>
            <Button
              onClick={() => setState({ status: "idle" })}
              variant="outline"
            >
              <ShareIcon data-icon="inline-start" />
              Try again
            </Button>
          </div>
        )}

        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  );
}
