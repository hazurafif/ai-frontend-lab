
import type { CustomContentUIPart } from "ai";
import { CheckIcon, Loader2Icon, TriangleAlertIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { BotIcon } from "@/components/chat/icons";

/**
 * Card for `custom` parts with kind "subagent" — a delegated task the
 * deep agent spawned. The backend emits these while subagents run.
 */
export function SubagentCard({ part }: { part: CustomContentUIPart }) {
  // providerMetadata is keyed by provider name (AI SDK v7 schema). Read the
  // `app` entry; fall back to the flat shape used before the nesting fix so
  // history persisted in localStorage still renders.
  const metadata =
    (part.providerMetadata as Record<string, Record<string, unknown>>) ?? {};
  const meta = metadata.app ?? metadata;
  const name = String(meta.name ?? "subagent");
  const status = String(meta.status ?? "started");
  const error = meta.error ? String(meta.error) : undefined;
  const running = status === "started";

  return (
    <div className="flex w-fit max-w-[min(480px,100%)] items-center gap-2 rounded-xl border border-border/60 bg-card/50 px-3 py-2">
      <BotIcon />
      <span className="min-w-0 truncate text-[12px] font-medium text-foreground">
        {name}
      </span>
      <Badge
        className="ml-auto"
        variant={error ? "destructive" : running ? "secondary" : "outline"}
      >
        {running ? <Loader2Icon className="animate-spin" /> : null}
        {error ? "Error" : running ? "Running" : "Completed"}
      </Badge>
      {error && <TriangleAlertIcon className="size-3.5 shrink-0 text-destructive" />}
      {!running && !error && <CheckIcon className="size-3.5 text-muted-foreground" />}
    </div>
  );
}
