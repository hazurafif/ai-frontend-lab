"use client";

// Startup / onboarding screen.
//
// Shows until the backend reports the user's setup as complete (a default
// `llm` connection saved by an admin). Collects the per-user data the
// backend supports: display/search preferences and MCP tool servers. The
// model connection itself is admin-managed and never edited here.
//
// A backend that is unreachable (setup fetch fails) is treated as complete
// so an offline backend never blocks the chat UI.

import { PlusIcon, Trash2Icon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { normalizeSkillName, SKILL_NAME_RE } from "@/lib/settings";
import {
  fetchSetupState,
  type OnboardingInput,
  type SetupState,
  type SetupToolServer,
  submitOnboarding,
} from "@/lib/setup";

type PendingServer = {
  name: string;
  transport: "streamable_http" | "stdio";
  url: string;
  command: string;
  enabled: boolean;
};

export function SetupGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<"loading" | "ready" | "onboarding">(
    "loading",
  );
  const [setup, setSetup] = useState<SetupState | null>(null);

  // Mount-gated fetch (hydration rule): the server render must match the
  // client's first render — only then do we know the real setup state.
  useEffect(() => {
    let cancelled = false;
    fetchSetupState()
      .then((data) => {
        if (cancelled) {
          return;
        }
        setSetup(data);
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

  if (state === "loading") {
    return null;
  }
  if (state === "ready") {
    return children;
  }
  return (
    <OnboardingScreen
      setup={setup}
      onDone={() => setState("ready")}
      onUpdated={(next) => {
        setSetup(next);
        if (next.completed) {
          setState("ready");
        }
      }}
    />
  );
}

function OnboardingScreen({
  setup,
  onDone,
  onUpdated,
}: {
  setup: SetupState | null;
  onDone: () => void;
  onUpdated: (next: SetupState) => void;
}) {
  const [enableSearch, setEnableSearch] = useState(
    setup?.preferences.enable_search ?? false,
  );
  const [hideReasoning, setHideReasoning] = useState(
    setup?.preferences.hide_reasoning ?? false,
  );
  const [hideToolCalls, setHideToolCalls] = useState(
    setup?.preferences.hide_tool_calls ?? false,
  );
  const [servers, setServers] = useState<PendingServer[]>(() =>
    (setup?.mcp_servers ?? []).map((server: SetupToolServer) => ({
      command: server.command ?? "",
      enabled: server.enabled,
      name: server.name,
      transport: server.transport === "stdio" ? "stdio" : "streamable_http",
      url: server.url ?? "",
    })),
  );
  // Add-server form draft.
  const [draftName, setDraftName] = useState("");
  const [draftTransport, setDraftTransport] = useState<
    "streamable_http" | "stdio"
  >("streamable_http");
  const [draftEndpoint, setDraftEndpoint] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const addServer = () => {
    const name = normalizeSkillName(draftName.trim());
    if (!SKILL_NAME_RE.test(name)) {
      toast.error(
        "Invalid server name — use lowercase letters, numbers, and hyphens (e.g. weather).",
      );
      return;
    }
    if (servers.some((server) => server.name === name)) {
      toast.error(`Server "${name}" is already on the list.`);
      return;
    }
    const endpoint = draftEndpoint.trim();
    if (!endpoint) {
      toast.error(
        draftTransport === "stdio"
          ? "Enter the command to launch the server."
          : "Enter the server URL.",
      );
      return;
    }
    setServers((current) => [
      ...current,
      {
        command: draftTransport === "stdio" ? endpoint : "",
        enabled: true,
        name,
        transport: draftTransport,
        url: draftTransport === "streamable_http" ? endpoint : "",
      },
    ]);
    setDraftName("");
    setDraftEndpoint("");
  };

  const removeServer = (name: string) => {
    setServers((current) => current.filter((server) => server.name !== name));
  };

  const start = async () => {
    setSubmitting(true);
    const input: OnboardingInput = {
      preferences: {
        enable_search: enableSearch,
        hide_reasoning: hideReasoning,
        hide_tool_calls: hideToolCalls,
      },
      mcp_servers: servers.map((server) => ({
        args: [],
        command: server.transport === "stdio" ? server.command : null,
        enabled: server.enabled,
        env: {},
        headers: {},
        name: server.name,
        transport: server.transport,
        url: server.transport === "streamable_http" ? server.url : null,
      })),
    };
    try {
      const next = await submitOnboarding(input);
      toast.success(
        next.completed
          ? "Setup complete — welcome!"
          : "Preferences saved. Chat unlocks once an admin configures the model connection.",
      );
      onUpdated(next);
      onDone();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Setup failed — try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex h-full min-h-dvh items-center justify-center overflow-y-auto p-6">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>Welcome</CardTitle>
          <CardDescription>
            Your workspace isn&apos;t fully configured yet — an admin still
            needs to add the model connection. While you wait, set your
            preferences and bring your own MCP tool servers (they&apos;re
            per-user; the agent can call them once the model is live).
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-3">
            <span className="text-sm font-medium">Preferences</span>
            <div className="flex items-center justify-between gap-4">
              <div className="flex flex-col gap-0.5">
                <span className="text-[13px]">Web search</span>
                <span className="text-[12px] text-muted-foreground">
                  Let the agent search the web (self-hosted SearXNG).
                </span>
              </div>
              <Switch
                aria-label="Web search"
                checked={enableSearch}
                onCheckedChange={setEnableSearch}
              />
            </div>
            <div className="flex items-center justify-between gap-4">
              <div className="flex flex-col gap-0.5">
                <span className="text-[13px]">Hide thinking</span>
                <span className="text-[12px] text-muted-foreground">
                  Don&apos;t show the model&apos;s reasoning in chat.
                </span>
              </div>
              <Switch
                aria-label="Hide thinking"
                checked={hideReasoning}
                onCheckedChange={setHideReasoning}
              />
            </div>
            <div className="flex items-center justify-between gap-4">
              <div className="flex flex-col gap-0.5">
                <span className="text-[13px]">Hide tool calls</span>
                <span className="text-[12px] text-muted-foreground">
                  Don&apos;t show tool activity in chat.
                </span>
              </div>
              <Switch
                aria-label="Hide tool calls"
                checked={hideToolCalls}
                onCheckedChange={setHideToolCalls}
              />
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <span className="text-sm font-medium">Your MCP tool servers</span>
            {servers.length === 0 ? (
              <p className="text-[12px] text-muted-foreground">
                None yet — add streamable-HTTP or stdio servers below, or skip
                and add them later in Settings → Tools.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {servers.map((server) => (
                  <div
                    className="flex items-center justify-between gap-3 rounded-md border bg-card px-3 py-2"
                    key={server.name}
                  >
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="truncate font-mono text-[13px]">
                        {server.name}
                      </span>
                      <span className="truncate text-[12px] text-muted-foreground">
                        {server.transport === "stdio"
                          ? server.command
                          : server.url}
                      </span>
                    </div>
                    <Button
                      aria-label={`Remove ${server.name}`}
                      className="size-7 shrink-0"
                      onClick={() => removeServer(server.name)}
                      size="icon"
                      type="button"
                      variant="ghost"
                    >
                      <Trash2Icon className="size-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                <Input
                  aria-label="Server name"
                  className="flex-1"
                  onChange={(event) => setDraftName(event.target.value)}
                  placeholder="Server name (e.g. weather)"
                  value={draftName}
                />
                <Select
                  onValueChange={(value) =>
                    setDraftTransport(value as "streamable_http" | "stdio")
                  }
                  value={draftTransport}
                >
                  <SelectTrigger aria-label="Transport" className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="streamable_http">
                      Streamable HTTP
                    </SelectItem>
                    <SelectItem value="stdio">stdio</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex gap-2">
                <Input
                  aria-label="Endpoint"
                  className="flex-1"
                  onChange={(event) => setDraftEndpoint(event.target.value)}
                  placeholder={
                    draftTransport === "stdio"
                      ? "Command (e.g. npx -y @some/mcp-server)"
                      : "URL (e.g. https://mcp.example.com/mcp)"
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addServer();
                    }
                  }}
                  value={draftEndpoint}
                />
                <Button
                  className="shrink-0"
                  onClick={addServer}
                  size="sm"
                  type="button"
                  variant="secondary"
                >
                  <PlusIcon data-icon="inline-start" />
                  Add
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
        <CardFooter className="flex items-center justify-between gap-3">
          <Button onClick={onDone} type="button" variant="ghost">
            Skip for now
          </Button>
          <Button disabled={submitting} onClick={start} type="button">
            {submitting ? "Saving…" : "Get started"}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
