"use client";

import { ChevronDownIcon, Loader2Icon, TriangleAlertIcon, WrenchIcon } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

/**
 * The AI SDK tool UI part produced from `tool-input-*` / `tool-output-*`
 * data-stream chunks. `type` is `tool-<name>`; `state` follows the tool
 * lifecycle: input-streaming -> input-available -> output-available
 * (or output-error / output-denied / interrupted — the latter when a
 * rehydrated run died before the tool returned).
 */
export type ToolUIPart = {
  type: string;
  toolCallId: string;
  state: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

type ToolStatus = {
  label: string;
  badge: "secondary" | "outline" | "destructive";
  running: boolean;
};

const RUNNING_STATES = new Set(["input-streaming", "input-available"]);

function statusOf(state: string): ToolStatus {
  if (state === "interrupted") {
    return { label: "Interrupted", badge: "secondary", running: false };
  }
  if (state === "output-error" || state === "error") {
    return { label: "Error", badge: "destructive", running: false };
  }
  if (state === "output-denied") {
    return { label: "Denied", badge: "secondary", running: false };
  }
  if (state.startsWith("approval")) {
    return { label: "Approval", badge: "secondary", running: false };
  }
  if (RUNNING_STATES.has(state)) {
    return { label: "Running", badge: "secondary", running: true };
  }
  return { label: "Completed", badge: "outline", running: false };
}

function formatValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** Tool outputs from langchain serialize as `{content, type, ...}` — show the content. */
function displayOutput(output: unknown): unknown {
  if (output && typeof output === "object" && "content" in output) {
    const content = (output as { content?: unknown }).content;
    if (content !== undefined) {
      return content;
    }
  }
  return output;
}

export function ToolCard({ part }: { part: ToolUIPart }) {
  // Collapsed by default: tool input/output JSON stays out of the way; the
  // prefab app block (inline) and text carry the visible content.
  const [open, setOpen] = useState(false);
  const status = statusOf(part.state);
  const toolName = part.type.replace(/^tool-/, "");
  const output = part.output !== undefined ? displayOutput(part.output) : undefined;

  return (
    <Collapsible
      className="w-full max-w-[min(560px,100%)] overflow-hidden rounded-xl border border-border/60 bg-card/50"
      onOpenChange={setOpen}
      open={open}
    >
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/40">
        <WrenchIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate font-mono text-[12px] font-medium text-foreground">
          {toolName}
        </span>
        <Badge className="ml-auto" variant={status.badge}>
          {status.running ? <Loader2Icon className="animate-spin" /> : null}
          {status.label}
        </Badge>
        <ChevronDownIcon
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="flex flex-col gap-3 border-t border-border/60 px-3 py-2.5">
          {part.input !== undefined && (
            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-muted-foreground">
                Input
              </span>
              <pre className="max-h-48 overflow-auto rounded-lg bg-muted/50 p-2 font-mono text-[12px] leading-relaxed text-foreground/90">
                {formatValue(part.input)}
              </pre>
            </div>
          )}
          {output !== undefined && (
            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-muted-foreground">
                Output
              </span>
              <pre className="max-h-48 overflow-auto rounded-lg bg-muted/50 p-2 font-mono text-[12px] leading-relaxed text-foreground/90">
                {formatValue(output)}
              </pre>
            </div>
          )}
          {part.errorText && (
            <div className="flex items-start gap-1.5 text-[12px] text-destructive">
              <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
              <span className="min-w-0 break-words">{part.errorText}</span>
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
