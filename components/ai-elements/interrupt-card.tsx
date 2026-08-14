"use client";

import type { CustomContentUIPart } from "ai";
import { CheckIcon, CornerDownLeftIcon, PencilIcon, XIcon } from "lucide-react";
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
 * Each `action_requests[]` item is `{name, args}`. Resuming truncates the
 * interrupted assistant message and re-requests with a `decision` in the
 * body; the backend resumes the paused thread. Decision types (langchain
 * HITL middleware contract, verified live):
 *   {"type": "approve"} · {"type": "reject"}
 *   {"type": "edit", "edited_action": {"name", "args"}}
 *   {"type": "respond", "message": "..."}
 * A single request accepts `decision`; multiple requests require a full
 * `decisions` list (one entry per action_request).
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
  const [responding, setResponding] = useState(false);
  const [response, setResponse] = useState("");
  // Edit mode: one JSON draft per action_request (pre-filled with its args).
  const [editing, setEditing] = useState(false);
  const [drafts, setDrafts] = useState<string[] | null>(null);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // providerMetadata is keyed by provider name (AI SDK v7 schema). Read the
  // `app` entry; fall back to the flat shape for history persisted before
  // the nesting fix.
  const metadata = (part.providerMetadata as Record<string, unknown>) ?? {};
  const app = (metadata.app as InterruptPayload) ?? metadata;
  const interrupts = Array.isArray(app.interrupts) ? app.interrupts : [];
  const actionRequests = interrupts[0]?.action_requests ?? [];
  const description = interrupts[0]?.description;

  const primaryAction = requestName(actionRequests[0]);
  const hasActionRequests = actionRequests.length > 0;

  const submitDecisions = (decisions: Record<string, unknown>[]) => {
    setPending(true);
    // Fire and forget: the request streams a new assistant message; the
    // interrupted message (and this card) is truncated by the SDK.
    resumeInterrupt(
      message.id,
      decisions.length <= 1
        ? { decision: decisions[0] }
        : { decisions },
    );
  };

  const handleApprove = () => submitDecisions([{ type: "approve" }]);
  const handleReject = () => submitDecisions([{ type: "reject" }]);

  const handleRespond = () => {
    const text = response.trim();
    if (!text) {
      return;
    }
    submitDecisions([{ type: "respond", message: text }]);
  };

  const startEdit = () => {
    setDrafts(actionRequests.map((request) => formatArgs(request.args) || "{}"));
    setJsonError(null);
    setEditing(true);
  };

  const handleEdit = () => {
    if (!drafts) {
      return;
    }
    const updatedInputs: unknown[] = [];
    for (const [index, draft] of drafts.entries()) {
      try {
        updatedInputs.push(JSON.parse(draft));
      } catch {
        setJsonError(`Request ${index + 1}: invalid JSON`);
        return;
      }
    }
    // One `edit` decision per action_request; `edited_action` carries the
    // full action (name kept, args replaced with the edited values).
    submitDecisions(
      updatedInputs.map((args, index) => ({
        edited_action: {
          args,
          name: requestName(actionRequests[index]),
        },
        type: "edit",
      })),
    );
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
                  {requestName(request)}
                </p>
                {editing ? (
                  <Textarea
                    aria-label={`Args for ${requestName(request)}`}
                    className="mt-1.5 min-h-16 font-mono text-[11px]"
                    onChange={(event) =>
                      setDrafts((current) =>
                        current
                          ? current.map((draft, i) =>
                              i === index ? event.target.value : draft,
                            )
                          : current,
                      )
                    }
                    value={drafts?.[index] ?? ""}
                  />
                ) : (
                  args && (
                    <pre className="max-h-32 overflow-y-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-muted-foreground">
                      {args}
                    </pre>
                  )
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

      {jsonError && (
        <p className="text-[12px] text-destructive">{jsonError}</p>
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
              onClick={() => {
                setEditing(false);
                setResponding((current) => !current);
              }}
              variant="ghost"
              disabled={pending}
            >
              {responding ? "Cancel" : "Respond"}
            </Button>
            <Button
              className="h-7 px-2.5 text-[12px]"
              onClick={() => {
                setResponding(false);
                if (editing) {
                  setEditing(false);
                } else {
                  startEdit();
                }
              }}
              variant="ghost"
              disabled={pending}
            >
              <PencilIcon />
              {editing ? "Cancel" : "Edit"}
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
            {editing && (
              <Button
                className="h-7 px-2.5 text-[12px]"
                onClick={handleEdit}
                variant="secondary"
                disabled={pending}
              >
                <CheckIcon />
                Apply edits
              </Button>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
