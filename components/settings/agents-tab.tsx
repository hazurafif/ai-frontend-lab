import { BugIcon, PencilIcon, PlusIcon, TrashIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useModelCatalog } from "@/hooks/use-available-models";
import type { BackendConnection } from "@/lib/settings";
import {
  AGENT_NAME_RE,
  type AgentInput,
  type AgentScope,
  type AgentSkillScope,
  type AgentTestResult,
  type BackendAgent,
  createAgent,
  deleteAgent,
  fetchAgents,
  fetchConnections,
  fetchSkills,
  fetchToolServers,
  THINKING_EFFORTS,
  type ThinkingEffort,
  testAgent,
  updateAgent,
} from "@/lib/settings";

const THINKING_EFFORT_LABELS: Record<ThinkingEffort, string> = {
  high: "High",
  low: "Low",
  max: "Max",
  medium: "Medium",
  minimal: "Minimal",
  none: "None",
  xhigh: "Extra high",
};

// Sentinel for Select (radix rejects empty-string item values).
const UNSET = "__unset__";

type AgentDraft = {
  name: string;
  description: string;
  model: string;
  connection: string;
  systemPrompt: string;
  skills: string[];
  tools: string[];
  temperature: string;
  thinking: string;
  interruptOn: Record<string, boolean>;
  scope: AgentScope;
};

// --- Agents tab ----------------------------------------------------------------
//
// Customizable agent profiles (backend /agents, proxied at /api/agents).
// Any user manages their own user-scoped agents; global agents + the
// built-in "default" are admin-only / read-only on the backend.

export function AgentsTab({
  isAdmin,
  skillScope,
}: {
  isAdmin: boolean;
  skillScope: AgentSkillScope;
}) {
  const { models } = useModelCatalog();
  const [agents, setAgents] = useState<BackendAgent[] | null>(null);
  const [editing, setEditing] = useState<BackendAgent | null>(null);
  const [draft, setDraft] = useState<AgentDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<BackendAgent | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  // Availability flags: null = not yet loaded (or not permitted — e.g.
  // connections are admin-only, so non-admins skip that picker).
  const [connections, setConnections] = useState<BackendConnection[] | null>(
    null,
  );
  const [skillNames, setSkillNames] = useState<string[] | null>(null);
  const [toolNames, setToolNames] = useState<string[] | null>(null);

  const refreshAgents = async () => {
    try {
      setAgents(await fetchAgents());
    } catch {
      // Backend offline — keep the cached list.
    }
  };

  useEffect(() => {
    let cancelled = false;
    fetchAgents().then((list) => {
      if (!cancelled) {
        setAgents(list);
      }
    });
    // The editor's checklists: the caller's own skills (scope depends on
    // role) and tool servers (per-user on the backend now).
    fetchSkills(skillScope)
      .then((skills) => {
        if (!cancelled) {
          setSkillNames(skills.map((skill) => skill.name).sort());
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSkillNames([]);
        }
      });
    fetchToolServers()
      .then((servers) => {
        if (!cancelled) {
          setToolNames(servers.map((server) => server.name).sort());
        }
      })
      .catch(() => {
        if (!cancelled) {
          setToolNames([]);
        }
      });
    // Admin-only: the connection picker disappears for everyone else.
    fetchConnections()
      .then((list) => {
        if (!cancelled) {
          setConnections(
            list.filter((connection) => connection.kind === "llm"),
          );
        }
      })
      .catch(() => {
        if (!cancelled) {
          setConnections(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [skillScope]);

  // Model ids for the picker (aggregated discovery). Surface the saved id
  // even when the catalog doesn't advertise it (old/backend-only models).
  const modelIds = useMemo(() => {
    const base = models?.map((model) => model.id) ?? [];
    const set = new Set(base);
    if (draft?.model && !set.has(draft.model)) {
      return [draft.model, ...base];
    }
    return base;
  }, [models, draft?.model]);

  const openEditor = (agent: BackendAgent | null) => {
    setEditing(agent);
    setDraft(
      agent
        ? {
            name: agent.name,
            description: agent.description ?? "",
            model: agent.model ?? "",
            connection: agent.connection ?? "",
            systemPrompt: agent.system_prompt ?? "",
            skills: agent.skills ?? [],
            tools: agent.tools ?? [],
            temperature: agent.temperature?.toString() ?? "",
            thinking: agent.thinking ?? "",
            interruptOn: agent.interrupt_on ?? {},
            scope: agent.scope,
          }
        : {
            name: "",
            description: "",
            model: "",
            connection: "",
            systemPrompt: "",
            skills: [],
            tools: [],
            temperature: "",
            thinking: "",
            interruptOn: {},
            scope: "user",
          },
    );
  };

  const saveAgent = async () => {
    if (!draft) {
      return;
    }
    const name = draft.name.trim();
    if (!AGENT_NAME_RE.test(name)) {
      toast.error(
        "Invalid name — lowercase letters, numbers, and hyphens between segments (e.g. research-agent). 'default' is reserved.",
      );
      return;
    }
    const temperature =
      draft.temperature.trim() === "" ? null : Number(draft.temperature);
    if (
      temperature !== null &&
      (Number.isNaN(temperature) || temperature < 0 || temperature > 2)
    ) {
      toast.error("Temperature must be between 0 and 2.");
      return;
    }
    const payload: AgentInput = {
      name,
      description: draft.description.trim() || null,
      model: draft.model || null,
      connection: draft.connection || null,
      system_prompt: draft.systemPrompt || null,
      skills: draft.skills.length > 0 ? draft.skills : null,
      tools: draft.tools.length > 0 ? draft.tools : null,
      temperature,
      thinking: (draft.thinking as ThinkingEffort) || null,
      interrupt_on:
        Object.keys(draft.interruptOn).length > 0 ? draft.interruptOn : null,
      // Backend rejects global scope for non-admins — force it off.
      scope: isAdmin ? draft.scope : "user",
    };
    setSaving(true);
    try {
      if (editing) {
        await updateAgent(editing.name, payload);
      } else {
        await createAgent(payload);
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to save agent",
      );
      setSaving(false);
      return;
    }
    setSaving(false);
    setEditing(null);
    setDraft(null);
    await refreshAgents();
    toast.success(editing ? "Agent updated" : "Agent created");
  };

  const confirmDeleteAgent = async () => {
    if (!deleteTarget) {
      return;
    }
    try {
      await deleteAgent(deleteTarget.name);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to delete agent",
      );
      return;
    }
    setDeleteTarget(null);
    setAgents((current) =>
      current
        ? current.filter((agent) => agent.name !== deleteTarget.name)
        : current,
    );
    toast.success("Agent deleted");
  };

  const runTest = async (agent: BackendAgent) => {
    setTesting(agent.name);
    try {
      const result: AgentTestResult = await testAgent(agent.name);
      toast.success(
        `"${agent.name}" ${result.graph_built ? "builds" : "does NOT build"} — model ${result.model ?? "default"}, ${result.skills?.length ?? 0} skills, ${result.tools?.length ?? 0} tools`,
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : `Failed to test "${agent.name}"`,
      );
    } finally {
      setTesting(null);
    }
  };

  const toggleInList = (
    key: "skills" | "tools",
    name: string,
    checked: boolean,
  ) => {
    setDraft((current) => {
      if (!current) {
        return current;
      }
      const list = checked
        ? [...current[key], name]
        : current[key].filter((item) => item !== name);
      return { ...current, [key]: list };
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-muted-foreground">
          Custom agent profiles — each agent binds a model, a prompt and a
          tool/skill selection. The built-in{" "}
          <span className="font-mono">default</span> is read-only.
        </p>
        <Button
          onClick={() => openEditor(null)}
          size="sm"
          type="button"
          variant="secondary"
        >
          <PlusIcon data-icon="inline-start" />
          New agent
        </Button>
      </div>

      {agents === null ? (
        <p className="text-[13px] text-muted-foreground">Loading agents…</p>
      ) : agents.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">
          No agents yet — create your first profile above.
        </p>
      ) : (
        <Card className="p-0">
          <Table className="min-w-[720px]">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Model</TableHead>
                <TableHead>Scope</TableHead>
                <TableHead className="hidden lg:table-cell">
                  Description
                </TableHead>
                <TableHead className="w-40 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {agents.map((agent) => (
                <TableRow key={agent.name}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[13px]">
                        {agent.name}
                      </span>
                      {agent.builtin && (
                        <Badge variant="outline">built-in</Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="max-w-48 truncate font-mono text-[12px] text-muted-foreground">
                    {agent.model ?? "default"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{agent.scope}</Badge>
                  </TableCell>
                  <TableCell className="hidden max-w-64 truncate text-[12px] text-muted-foreground lg:table-cell">
                    {agent.description ?? "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        aria-label={`Test ${agent.name}`}
                        disabled={testing === agent.name}
                        onClick={() => runTest(agent)}
                        size="icon"
                        type="button"
                        variant="ghost"
                      >
                        <BugIcon data-icon="inline-start" />
                      </Button>
                      <Button
                        aria-label={`Edit ${agent.name}`}
                        disabled={agent.builtin}
                        onClick={() => openEditor(agent)}
                        size="icon"
                        type="button"
                        variant="ghost"
                      >
                        <PencilIcon data-icon="inline-start" />
                      </Button>
                      <Button
                        aria-label={`Delete ${agent.name}`}
                        disabled={agent.builtin}
                        onClick={() => setDeleteTarget(agent)}
                        size="icon"
                        type="button"
                        variant="ghost"
                      >
                        <TrashIcon data-icon="inline-start" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <Dialog
        open={draft !== null}
        onOpenChange={(open) => {
          if (!open) {
            setEditing(null);
            setDraft(null);
          }
        }}
      >
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editing ? `Edit ${editing.name}` : "New agent"}
            </DialogTitle>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="agent-name">Name</FieldLabel>
              <Input
                disabled={editing !== null}
                id="agent-name"
                onChange={(event) =>
                  setDraft((current) =>
                    current
                      ? { ...current, name: event.target.value }
                      : current,
                  )
                }
                placeholder="e.g. research-agent"
                value={draft?.name ?? ""}
              />
              <FieldDescription>
                Lowercase letters, numbers, and hyphens. Referenced as{" "}
                <span className="font-mono">agent</span> in chat requests; used
                in the URL for the editor. The name{" "}
                <span className="font-mono">default</span> is reserved.
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="agent-description">Description</FieldLabel>
              <Input
                id="agent-description"
                onChange={(event) =>
                  setDraft((current) =>
                    current
                      ? { ...current, description: event.target.value }
                      : current,
                  )
                }
                placeholder="What is this agent for?"
                value={draft?.description ?? ""}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="agent-model">Model</FieldLabel>
                <Select
                  value={draft?.model || UNSET}
                  onValueChange={(value) =>
                    setDraft((current) =>
                      current
                        ? {
                            ...current,
                            model:
                              value === null || value === UNSET ? "" : value,
                          }
                        : current,
                    )
                  }
                >
                  <SelectTrigger id="agent-model">
                    <SelectValue placeholder="Default (agent's model)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={UNSET}>
                      Default (agent&apos;s model)
                    </SelectItem>
                    {modelIds.map((id) => (
                      <SelectItem key={id} value={id}>
                        {id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldDescription>
                  Provider:model id from the aggregated catalog, e.g.{" "}
                  <span className="font-mono">openai:hy3</span>.
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="agent-thinking">
                  Thinking effort
                </FieldLabel>
                <Select
                  value={draft?.thinking || UNSET}
                  onValueChange={(value) =>
                    setDraft((current) =>
                      current
                        ? {
                            ...current,
                            thinking:
                              value === null || value === UNSET ? "" : value,
                          }
                        : current,
                    )
                  }
                >
                  <SelectTrigger id="agent-thinking">
                    <SelectValue placeholder="Default" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={UNSET}>Default</SelectItem>
                    {THINKING_EFFORTS.map((level) => (
                      <SelectItem key={level} value={level}>
                        {THINKING_EFFORT_LABELS[level]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            {connections !== null && (
              <Field>
                <FieldLabel htmlFor="agent-connection">Connection</FieldLabel>
                <Select
                  value={draft?.connection || UNSET}
                  onValueChange={(value) =>
                    setDraft((current) =>
                      current
                        ? {
                            ...current,
                            connection:
                              value === null || value === UNSET ? "" : value,
                          }
                        : current,
                    )
                  }
                >
                  <SelectTrigger id="agent-connection">
                    <SelectValue placeholder="Default connection" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={UNSET}>Default connection</SelectItem>
                    {connections.map((connection) => (
                      <SelectItem key={connection.name} value={connection.name}>
                        {connection.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldDescription>
                  Saved llm connection serving this agent&apos;s model; empty =
                  the default connection.
                </FieldDescription>
              </Field>
            )}
            {isAdmin && (
              <Field>
                <FieldLabel htmlFor="agent-scope">Scope</FieldLabel>
                <Select
                  value={draft?.scope ?? "user"}
                  onValueChange={(value) =>
                    setDraft((current) =>
                      current
                        ? { ...current, scope: (value ?? "user") as AgentScope }
                        : current,
                    )
                  }
                >
                  <SelectTrigger id="agent-scope">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">User</SelectItem>
                    <SelectItem value="global">Global</SelectItem>
                  </SelectContent>
                </Select>
                <FieldDescription>
                  Global agents are managed by admins and available to every
                  user.
                </FieldDescription>
              </Field>
            )}
            <Field>
              <FieldLabel htmlFor="agent-prompt">System prompt</FieldLabel>
              <Textarea
                className="min-h-36 font-mono text-[13px]"
                id="agent-prompt"
                onChange={(event) =>
                  setDraft((current) =>
                    current
                      ? { ...current, systemPrompt: event.target.value }
                      : current,
                  )
                }
                placeholder="Instructions for this agent… (empty = the default prompt)"
                value={draft?.systemPrompt ?? ""}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="agent-temperature">Temperature</FieldLabel>
              <Input
                id="agent-temperature"
                max="2"
                min="0"
                onChange={(event) =>
                  setDraft((current) =>
                    current
                      ? { ...current, temperature: event.target.value }
                      : current,
                  )
                }
                placeholder="0–2 (empty = default)"
                step="0.1"
                type="number"
                value={draft?.temperature ?? ""}
              />
            </Field>
            <Field>
              <FieldLabel>Skills</FieldLabel>
              {skillNames === null ? (
                <p className="text-[13px] text-muted-foreground">
                  Loading skills…
                </p>
              ) : skillNames.length === 0 ? (
                <p className="text-[13px] text-muted-foreground">
                  No skills yet — create some in the Skills tab.
                </p>
              ) : (
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {skillNames.map((name) => (
                    <div
                      className="flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2"
                      key={name}
                    >
                      <span className="min-w-0 truncate font-mono text-[12px]">
                        {name}
                      </span>
                      <Switch
                        aria-label={`Include skill ${name}`}
                        checked={draft?.skills.includes(name) ?? false}
                        onCheckedChange={(checked) =>
                          toggleInList("skills", name, checked)
                        }
                      />
                    </div>
                  ))}
                </div>
              )}
            </Field>
            <Field>
              <FieldLabel>Tools</FieldLabel>
              {toolNames === null ? (
                <p className="text-[13px] text-muted-foreground">
                  Loading tools…
                </p>
              ) : toolNames.length === 0 ? (
                <p className="text-[13px] text-muted-foreground">
                  No tool servers yet — add some in the Tools tab.
                </p>
              ) : (
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {toolNames.map((name) => (
                    <div
                      className="flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2"
                      key={name}
                    >
                      <span className="min-w-0 truncate font-mono text-[12px]">
                        {name}
                      </span>
                      <Switch
                        aria-label={`Include tool ${name}`}
                        checked={draft?.tools.includes(name) ?? false}
                        onCheckedChange={(checked) =>
                          toggleInList("tools", name, checked)
                        }
                      />
                    </div>
                  ))}
                </div>
              )}
            </Field>
            <Field>
              <FieldLabel>Human approval</FieldLabel>
              {draft && draft.tools.length === 0 ? (
                <p className="text-[13px] text-muted-foreground">
                  Select tools above to pause them for human approval when the
                  agent wants to run them.
                </p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {draft?.tools.map((name) => (
                    <div
                      className="flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2"
                      key={name}
                    >
                      <span className="min-w-0 truncate font-mono text-[12px]">
                        {name}
                      </span>
                      <Switch
                        aria-label={`Pause tool ${name} for approval`}
                        checked={draft.interruptOn[name] ?? false}
                        onCheckedChange={(checked) =>
                          setDraft((current) =>
                            current
                              ? {
                                  ...current,
                                  interruptOn: {
                                    ...current.interruptOn,
                                    [name]: checked,
                                  },
                                }
                              : current,
                          )
                        }
                      />
                    </div>
                  ))}
                </div>
              )}
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button
              onClick={() => {
                setEditing(null);
                setDraft(null);
              }}
              type="button"
              variant="ghost"
            >
              Cancel
            </Button>
            <Button disabled={saving} onClick={saveAgent} type="button">
              {saving ? "Saving…" : editing ? "Save agent" : "Create agent"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete agent?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove {deleteTarget?.name}. Chats already
              run with this agent keep their messages.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteAgent}
              variant="destructive"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
