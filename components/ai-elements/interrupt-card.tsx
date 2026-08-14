"use client";

import type { CustomContentUIPart } from "ai";
import {
  CheckIcon,
  LoaderCircleIcon,
  WrenchIcon,
  XIcon,
} from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useActiveChat } from "@/hooks/use-active-chat";
import type { ChatMessage } from "@/lib/types";

/**
 * Card for `custom` parts with kind "app.interrupt" — a human-in-the-loop
 * pause. The backend emits these (with providerMetadata.app.threadId +
 * .interrupts) when the agent wants approval for a sensitive tool call.
 * Styled like the tool/thinking cards.
 *
 * Each `action_requests[]` item is `{name, args}`. Resuming truncates the
 * interrupted assistant message and re-requests with a `decisions` list in
 * the body — one entry per pending tool call, or the backend errors with
 * "number of human decisions does not match number of hanging tool calls".
 * Decision types (langchain HITL middleware contract, verified live):
 *   {"type": "approve"} · {"type": "reject"}
 */

type ActionRequest = {
  name?: string;
  args?: unknown;
  // History persisted by older builds used `action` instead of `name`.
  action?: string;
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

function requestName(request: ActionRequest): string {
  return request.name ?? request.action ?? "tool";
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
  // Local decision state: while the resumed run streams, the interrupted
  // message (and this card) stays in the chat — show a resolving indicator,
  // then a settled badge, instead of the buttons.
  const [outcome, setOutcome] = useState<"approve" | "reject" | null>(null);
  const [resolving, setResolving] = useState(false);

  // providerMetadata is keyed by provider name (AI SDK v7 schema). Read the
  // `app` entry; fall back to the flat shape for history persisted before
  // the nesting fix.
  const metadata = (part.providerMetadata as Record<string, unknown>) ?? {};
  const app = (metadata.app as InterruptPayload) ?? metadata;
  const interrupts = Array.isArray(app.interrupts) ? app.interrupts : [];
  const actionRequests = interrupts[0]?.action_requests ?? [];

  // Approve/reject every pending tool call: the backend requires one
  // decision per hanging tool call, so a single approve for a two-call
  // interrupt would fail the resume.
  const submitDecisions = async (
    decision: "approve" | "reject",
  ): Promise<void> => {
    if (resolving || outcome !== null) {
      return;
    }
    setOutcome(decision);
    setResolving(true);
    try {
      // The interrupted message is NOT truncated: the provider streams the
      // resumed run into a new message after it, then this resolves.
      await resumeInterrupt(message.id, {
        decisions: actionRequests.map(() => ({ type: decision })),
      });
    } finally {
      setResolving(false);
    }
  };

  const handleAccept = () => submitDecisions("approve");
  const handleReject = () => submitDecisions("reject");

  return (
    <div className="w-full max-w-[min(560px,100%)] overflow-hidden rounded-xl border border-border/60 bg-card/50">
      <div className="flex items-center gap-2 px-3 py-2">
        <WrenchIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="text-[12px] font-medium text-foreground">
          Approval required
        </span>
        <Badge className="ml-auto" variant="secondary">
          {outcome !== null
            ? "Resolved"
            : actionRequests.length > 0
              ? `${actionRequests.length} pending`
              : "Pending"}
        </Badge>
        {outcome !== null ? (
          <Badge variant={outcome === "approve" ? "default" : "outline"}>
            {outcome === "approve" ? "Approved" : "Rejected"}
          </Badge>
        ) : (
          !active && (
            <span className="text-[11px] text-muted-foreground">
              (handled elsewhere)
            </span>
          )
        )}
      </div>

      <div className="flex flex-col gap-2 border-t border-border/60 px-3 py-2.5">
        {actionRequests.length > 0 ? (
          actionRequests.map((request, index) => {
            const args = formatArgs(request.args);
            return (
              <div
                className="flex flex-col gap-1 rounded-lg border border-border/60 bg-muted/40 px-2.5 py-1.5"
                key={index}
              >
                <span className="font-mono text-[12px] font-medium text-foreground">
                  {requestName(request)}
                </span>
                {args && (
                  <pre className="max-h-32 overflow-y-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-muted-foreground">
                    {args}
                  </pre>
                )}
              </div>
            );
          })
        ) : (
          <p className="text-[12px] text-muted-foreground">
            The agent paused to ask for your input.
          </p>
        )}

        {active && outcome === null && (
          <div className="mt-1 flex items-center gap-2">
            <Button
              className="h-7 px-2.5 text-[12px]"
              disabled={resolving}
              onClick={handleAccept}
              type="button"
            >
              <CheckIcon />
              Accept
            </Button>
            <Button
              className="h-7 px-2.5 text-[12px]"
              disabled={resolving}
              onClick={handleReject}
              type="button"
              variant="outline"
            >
              <XIcon />
              Reject
            </Button>
          </div>
        )}

        {resolving && (
          <div className="mt-1 flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <LoaderCircleIcon className="size-3.5 animate-spin" />
            {outcome === "approve" ? "Approving…" : "Rejecting…"}
          </div>
        )}

        {!resolving && outcome !== null && (
          <div className="mt-1 flex items-center gap-1.5 text-[12px] text-muted-foreground">
            {outcome === "approve" ? (
              <CheckIcon className="size-3.5 text-green-500" />
            ) : (
              <XIcon className="size-3.5 text-red-500" />
            )}
            <span>
              {outcome === "approve"
                ? "Approved — the agent continued below."
                : "Rejected — the agent continued below."}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
