"use client";

import type { CustomContentUIPart } from "ai";
import { CheckIcon, CornerDownLeftIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useActiveChat } from "@/hooks/use-active-chat";
import type { ChatMessage } from "@/lib/types";

/**
 * Card for `custom` parts with kind "app.interrupt" — a human-in-the-loop
 * pause. The backend emits these (with providerMetadata.app.threadId +
 * .interrupts) when the agent wants approval for a sensitive tool call.
 *
 * Resuming truncates the interrupted assistant message and re-requests with
 * a `decision` in the body; the backend resumes the paused thread.
 */

type ActionRequest = {
  action?: string;
  args?: unknown;
};

type InterruptPayload = {
  threadId?: unknown;
  interrupts?: {
    action_requests?: ActionRequest[];
    description?: string;
  }[];
};

function formatArgs(args: unknown): string {
  if (args === undefined || args === null) {
    return "";
  }
  if (typeof args === "string") {
    return args;
  }
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
}

export function InterruptCard({
  part,
  message,
  active,
}: {
  part: CustomContentUIPart;
  message: ChatMessage;
  active: boolean;
}) {
  const { resumeInterrupt } = useActiveChat();
  const [responding, setResponding] = useState(false);
  const [response, setResponse] = useState("");
  const [pending, setPending] = useState(false);

  // providerMetadata is keyed by provider name (AI SDK v7 schema). Read the
  // `app` entry; fall back to the flat shape for history persisted before
  // the nesting fix.
  const metadata = (part.providerMetadata as Record<string, unknown>) ?? {};
  const app = (metadata.app as InterruptPayload) ?? metadata;
  const interrupts = Array.isArray(app.interrupts) ? app.interrupts : [];
  const actionRequests = interrupts[0]?.action_requests ?? [];
  const description = interrupts[0]?.description;

  const primaryAction = actionRequests[0]?.action ?? "run a tool";
  const hasActionRequests = actionRequests.length > 0;

  const decide = (base: Record<string, unknown>) => {
    // One decision per action_request when there are several; the backend
    // accepts a single `decision` otherwise.
    return actionRequests.length <= 1
      ? { decision: base }
      : { decisions: actionRequests.map(() => base) };
  };

  const submit = (decision: Record<string, unknown>) => {
    setPending(true);
    // Fire and forget: the request streams a new assistant message; the
    // interrupted message (and this card) is truncated by the SDK.
    resumeInterrupt(message.id, decide(decision));
  };

  const handleApprove = () => submit({ action: "approve" });
  const handleReject = () => submit({ action: "reject" });

  const handleRespond = () => {
    const text = response.trim();
    if (!text) {
      return;
    }
    submit({ action: "respond", args: { response: text } });
  };

  return (
    <div className="flex w-fit max-w-[min(480px,100%)] flex-col gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 px-3.5 py-3">
      <div className="flex items-center gap-2">
        <span className="flex size-5 items-center justify-center rounded-md bg-amber-500/15 text-amber-600">
          <CheckIcon className="size-3" />
        </span>
        <span className="text-[12px] font-medium text-foreground">
          Approval required
        </span>
        {!active && (
          <span className="text-[11px] text-muted-foreground">
            (handled elsewhere)
          </span>
        )}
      </div>

      {description ? (
        <p className="text-[12px] leading-relaxed text-muted-foreground">
          {description}
        </p>
      ) : null}

      {hasActionRequests && (
        <div className="flex flex-col gap-1.5">
          {actionRequests.map((request, index) => {
            const args = formatArgs(request.args);
            return (
              <div
                className="rounded-lg border border-border/60 bg-card/60 px-2.5 py-1.5"
                key={index}
              >
                <p className="font-mono text-[11px] font-medium text-foreground">
                  {request.action ?? "tool"}
                </p>
                {args && (
                  <pre className="max-h-32 overflow-y-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-muted-foreground">
                    {args}
                  </pre>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!hasActionRequests && (
        <p className="text-[12px] text-muted-foreground">
          The agent paused to ask for your input ({primaryAction}).
        </p>
      )}

      {active ? (
        <div className="flex flex-col gap-2">
          {responding ? (
            <Textarea
              className="min-h-16 text-[12px]"
              placeholder="Reply to the agent…"
              value={response}
              onChange={(event) => setResponse(event.target.value)}
              autoFocus
            />
          ) : null}
          <div className="flex items-center gap-2">
            <Button
              className="h-7 px-2.5 text-[12px]"
              onClick={handleApprove}
              disabled={pending}
            >
              Approve
            </Button>
            <Button
              className="h-7 px-2.5 text-[12px]"
              onClick={handleReject}
              variant="outline"
              disabled={pending}
            >
              <XIcon />
              Reject
            </Button>
            <Button
              className="h-7 px-2.5 text-[12px]"
              onClick={() => setResponding((current) => !current)}
              variant="ghost"
              disabled={pending}
            >
              {responding ? "Cancel" : "Respond"}
            </Button>
            {responding && (
              <Button
                className="h-7 px-2.5 text-[12px]"
                onClick={handleRespond}
                variant="secondary"
                disabled={pending || !response.trim()}
              >
                <CornerDownLeftIcon />
                Send
              </Button>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
