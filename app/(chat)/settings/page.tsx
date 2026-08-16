"use client";

import {
  PencilIcon,
  PlusIcon,
  RefreshCcwIcon,
  ShieldCheckIcon,
  TrashIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AccountTab } from "@/components/settings/account-tab";
import { KnowledgeBaseTab } from "@/components/settings/knowledge-base-tab";
import { PermissionsTab } from "@/components/settings/permissions-tab";
import {
  SETTINGS_TABS,
  type SettingsTabId,
  settingsTabsForRole,
  useSettingsTabs,
} from "@/components/settings/settings-tabs-context";
import { UsersTab } from "@/components/settings/users-tab";
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
  FieldError,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import { useModelCatalog } from "@/hooks/use-available-models";
import { useIsMobile } from "@/hooks/use-mobile";
import type { ChatModel } from "@/lib/models";
import { fetchPreferences, updatePreferences } from "@/lib/preferences";
import {
  createSkill as apiCreateSkill,
  createToolServer as apiCreateToolServer,
  deleteSkill as apiDeleteSkill,
  deleteSkillFile as apiDeleteSkillFile,
  deleteToolServer as apiDeleteToolServer,
  updateSkill as apiUpdateSkill,
  updateToolServer as apiUpdateToolServer,
  type BackendConnection,
  backendSkillToSkill,
  backendToolToToolConfig,
  CONNECTION_NAME_RE,
  type ConnectionInput,
  createConnection,
  DEFAULT_SETTINGS,
  deleteConnection,
  fetchAppSettings,
  fetchBackendHealth,
  fetchConnections,
  fetchKnowledgeBasesWithDocuments,
  fetchSkills,
  fetchToolServers,
  hasStoredSettings,
  loadSettings,
  normalizeSkillName,
  reconnectToolServers,
  type SettingsState,
  SKILL_FILE_PATH_RE,
  SKILL_NAME_RE,
  type Skill,
  type SkillFile,
  saveSettings,
  type ToolConfig,
  updateAppSettings,
  updateConnection,
} from "@/lib/settings";
import { cn } from "@/lib/utils";

function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-border/60 bg-card p-4 shadow-[var(--shadow-card)] md:p-5",
        className,
      )}
      {...props}
    />
  );
}

// --- Skills tab ---------------------------------------------------------------

function SkillsTab({
  settings,
  setSettings,
  backendOnline,
}: {
  settings: SettingsState;
  setSettings: (updater: (current: SettingsState) => SettingsState) => void;
  backendOnline: boolean;
}) {
  const [editing, setEditing] = useState<Skill | null>(null);
  const [draft, setDraft] = useState<Skill | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  // Bundled-file paths removed in the editor: the backend PUT keeps unlisted
  // files, so each one needs an explicit DELETE afterwards.
  const [removedFiles, setRemovedFiles] = useState<string[]>([]);
  const [fileError, setFileError] = useState<{
    index: number;
    message: string;
  } | null>(null);

  const resetEditor = () => {
    setNameError(null);
    setFileError(null);
    setRemovedFiles([]);
  };

  const openNew = () => {
    const fresh: Skill = {
      name: "",
      description: "",
      content: "",
      files: [],
      updatedAt: new Date().toISOString(),
    };
    resetEditor();
    setDraft(fresh);
    setEditing(fresh);
  };

  const updateFile = (index: number, patch: Partial<SkillFile>) => {
    setFileError(null);
    setDraft((d) =>
      d
        ? {
            ...d,
            files: d.files.map((file, i) =>
              i === index ? { ...file, ...patch } : file,
            ),
          }
        : d,
    );
  };

  const addFile = () => {
    setFileError(null);
    setDraft((d) =>
      d ? { ...d, files: [...d.files, { path: "", content: "" }] } : d,
    );
  };

  const removeFile = (index: number) => {
    const removed = draft?.files[index];
    if (removed?.path) {
      setRemovedFiles((previous) => [...previous, removed.path]);
    }
    setFileError(null);
    setDraft((d) =>
      d ? { ...d, files: d.files.filter((_, i) => i !== index) } : d,
    );
  };

  const saveSkill = async () => {
    if (!draft) {
      return;
    }
    const name = normalizeSkillName(draft.name.trim());
    if (!SKILL_NAME_RE.test(name)) {
      setNameError(
        "Use lowercase letters, numbers, and hyphens (e.g. code-review).",
      );
      return;
    }
    // Validate bundled file paths against the backend pattern (SKILL.md is
    // reserved — the backend builds it from name/description/content).
    for (const [index, file] of draft.files.entries()) {
      const path = file.path.trim();
      if (!SKILL_FILE_PATH_RE.test(path) || path.toLowerCase() === "skill.md") {
        setFileError({
          index,
          message: `Invalid path "${path || "(empty)"}" — use e.g. scripts/run.py (letters, numbers, dots, underscores, hyphens, single slashes).`,
        });
        return;
      }
    }
    const originalName = editing?.name ?? "";
    // Deduplicate by path — the backend keys files by path, so the last
    // occurrence would silently win.
    const files: SkillFile[] = [];
    const seen = new Set<string>();
    for (const file of draft.files) {
      const path = file.path.trim();
      if (seen.has(path)) {
        continue;
      }
      seen.add(path);
      files.push({ path, content: file.content });
    }
    const skill: Skill = {
      ...draft,
      name,
      files,
      updatedAt: new Date().toISOString(),
    };
    const isNew = !settings.skills.some((s) => s.name === originalName);
    try {
      if (backendOnline) {
        if (isNew) {
          await apiCreateSkill(skill);
        } else {
          await apiUpdateSkill(originalName, skill);
          if (originalName !== name) {
            // Backend PUT keys the entry by body.name — drop the stale key.
            await apiDeleteSkill(originalName);
          }
          // PUT keeps unlisted bundled files — explicitly remove the ones
          // deleted in the editor.
          const failed: string[] = [];
          for (const path of new Set(removedFiles)) {
            try {
              await apiDeleteSkillFile(name, path);
            } catch {
              failed.push(path);
            }
          }
          if (failed.length > 0) {
            toast.warning(
              `Skill saved, but ${failed.length} file${failed.length > 1 ? "s" : ""} could not be removed: ${failed.join(", ")}`,
            );
          }
        }
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to save skill",
      );
      return;
    }
    setSettings((current) => {
      const rest = current.skills.filter((s) => s.name !== originalName);
      const exists = rest.some((s) => s.name === name);
      return {
        ...current,
        skills: exists
          ? rest.map((s) => (s.name === name ? skill : s))
          : [...rest, skill],
      };
    });
    setEditing(null);
    toast.success(
      backendOnline
        ? "Skill saved to backend"
        : "Skill saved locally (backend offline)",
    );
  };

  const deleteSkill = async (name: string) => {
    try {
      if (backendOnline) {
        await apiDeleteSkill(name);
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to delete skill",
      );
      return;
    }
    setSettings((current) => ({
      ...current,
      skills: current.skills.filter((s) => s.name !== name),
    }));
    toast.success(
      backendOnline
        ? "Skill deleted"
        : "Skill deleted locally (backend offline)",
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-muted-foreground">
          Reusable instruction sets the agent can follow.
        </p>
        <Button size="sm" variant="secondary" onClick={openNew}>
          <PlusIcon data-icon="inline-start" />
          New skill
        </Button>
      </div>
      {settings.skills.length === 0 && (
        <Card className="text-[13px] text-muted-foreground">
          No skills yet — create one to teach the agent a methodology.
        </Card>
      )}
      {settings.skills.map((skill) => (
        <Card
          key={skill.name}
          className="flex items-start justify-between gap-4"
        >
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{skill.name}</span>
              <Badge variant="outline">skill</Badge>
              {skill.files.length > 0 && (
                <Badge variant="outline" className="font-mono text-[11px]">
                  {skill.files.length} file
                  {skill.files.length > 1 ? "s" : ""}
                </Badge>
              )}
            </div>
            <p className="text-[13px] text-muted-foreground">
              {skill.description}
            </p>
            {skill.files.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1.5">
                {skill.files.map((file) => (
                  <code
                    key={file.path}
                    className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
                  >
                    {file.path}
                  </code>
                ))}
              </div>
            )}
          </div>
          <div className="flex shrink-0 gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                resetEditor();
                setDraft({ ...skill });
                setEditing(skill);
              }}
            >
              Edit
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label={`Delete ${skill.name}`}
              onClick={() => deleteSkill(skill.name)}
            >
              <TrashIcon data-icon="inline-start" />
            </Button>
          </div>
        </Card>
      ))}

      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setEditing(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-2xl max-h-[85dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {settings.skills.some((s) => s.name === editing?.name)
                ? "Edit skill"
                : "New skill"}
            </DialogTitle>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="skill-name">Name</FieldLabel>
              <Input
                id="skill-name"
                value={draft?.name ?? ""}
                onChange={(e) => {
                  setNameError(null);
                  setDraft((d) => (d ? { ...d, name: e.target.value } : d));
                }}
                placeholder="e.g. code-review"
              />
              <FieldDescription>
                The skill key the agent references: lowercase letters, numbers,
                and hyphens.
              </FieldDescription>
              {nameError && <FieldError>{nameError}</FieldError>}
            </Field>
            <Field>
              <FieldLabel htmlFor="skill-description">Description</FieldLabel>
              <Input
                id="skill-description"
                value={draft?.description ?? ""}
                onChange={(e) =>
                  setDraft((d) =>
                    d ? { ...d, description: e.target.value } : d,
                  )
                }
                placeholder="What is this skill for?"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="skill-content">
                Content (markdown)
              </FieldLabel>
              <Textarea
                id="skill-content"
                className="min-h-32 font-mono text-[13px]"
                value={draft?.content ?? ""}
                onChange={(e) =>
                  setDraft((d) => (d ? { ...d, content: e.target.value } : d))
                }
              />
            </Field>
            <Field data-invalid={fileError ? true : undefined}>
              <FieldLabel>Bundled files</FieldLabel>
              <div className="flex flex-col gap-3">
                {draft?.files.map((file, index) => (
                  <div
                    key={index}
                    className="flex flex-col gap-2 rounded-xl border border-border/60 p-3"
                  >
                    <div className="flex items-center gap-2">
                      <Input
                        value={file.path}
                        onChange={(e) =>
                          updateFile(index, { path: e.target.value })
                        }
                        placeholder="scripts/run.py"
                        className="font-mono text-[13px]"
                        aria-invalid={fileError?.index === index}
                        aria-label={`File ${index + 1} path`}
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Remove file ${index + 1}`}
                        onClick={() => removeFile(index)}
                      >
                        <XIcon data-icon="inline-start" />
                      </Button>
                    </div>
                    <Textarea
                      value={file.content}
                      onChange={(e) =>
                        updateFile(index, { content: e.target.value })
                      }
                      placeholder="File contents (the agent can read and execute scripts)"
                      className="min-h-20 font-mono text-[13px]"
                      aria-label={`File ${index + 1} content`}
                    />
                  </div>
                ))}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={addFile}
                  className="self-start"
                >
                  <PlusIcon data-icon="inline-start" />
                  Add file
                </Button>
                <FieldDescription>
                  Optional resources in the skill folder (scripts/, references/,
                  assets/…). SKILL.md is reserved.
                </FieldDescription>
                {fileError && (
                  <FieldError>
                    File {fileError.index + 1}: {fileError.message}
                  </FieldError>
                )}
              </div>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={saveSkill}>Save skill</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// --- Tools tab ----------------------------------------------------------------

const TOOL_TRANSPORTS = ["streamable_http", "stdio"] as const;

function ToolsTab({
  settings,
  setSettings,
  backendOnline,
}: {
  settings: SettingsState;
  setSettings: (updater: (current: SettingsState) => SettingsState) => void;
  backendOnline: boolean;
}) {
  const [editing, setEditing] = useState<ToolConfig | null>(null);
  const [draft, setDraft] = useState<ToolConfig | null>(null);

  const toggleTool = async (name: string, enabled: boolean) => {
    const tool = settings.tools.find((t) => t.name === name);
    if (!tool) {
      return;
    }
    const next = { ...tool, enabled };
    try {
      if (backendOnline) {
        await apiUpdateToolServer(name, next);
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to update tool",
      );
      return;
    }
    setSettings((current) => ({
      ...current,
      tools: current.tools.map((t) => (t.name === name ? next : t)),
    }));
    toast.success(enabled ? "Tool enabled" : "Tool disabled");
  };

  const openEditor = (tool: ToolConfig | null) => {
    const fresh: ToolConfig = tool ?? {
      name: "",
      description: "",
      transport: "streamable_http",
      url: "",
      enabled: true,
    };
    setDraft(fresh);
    setEditing(fresh);
  };

  const saveTool = async () => {
    if (!draft) {
      return;
    }
    const name = normalizeSkillName(draft.name.trim());
    if (!SKILL_NAME_RE.test(name)) {
      toast.error(
        "Invalid name — use lowercase letters, numbers, and hyphens (e.g. weather).",
      );
      return;
    }
    const originalName = editing?.name ?? "";
    const tool: ToolConfig = { ...draft, name };
    const isNew = !settings.tools.some((t) => t.name === originalName);
    try {
      if (backendOnline) {
        if (isNew) {
          await apiCreateToolServer(tool);
        } else {
          await apiUpdateToolServer(originalName, tool);
          if (originalName !== name) {
            // Backend PUT keys the entry by body.name — drop the stale key.
            await apiDeleteToolServer(originalName);
          }
        }
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to save tool",
      );
      return;
    }
    setSettings((current) => {
      const rest = current.tools.filter((t) => t.name !== originalName);
      const exists = rest.some((t) => t.name === name);
      return {
        ...current,
        tools: exists
          ? rest.map((t) => (t.name === name ? tool : t))
          : [...rest, tool],
      };
    });
    setEditing(null);
    toast.success(
      backendOnline
        ? "Tool saved to backend"
        : "Tool saved locally (backend offline)",
    );
  };

  const deleteTool = async (name: string) => {
    try {
      if (backendOnline) {
        await apiDeleteToolServer(name);
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to delete tool",
      );
      return;
    }
    setSettings((current) => ({
      ...current,
      tools: current.tools.filter((t) => t.name !== name),
    }));
    toast.success(
      backendOnline ? "Tool deleted" : "Tool deleted locally (backend offline)",
    );
  };

  const reconnect = async () => {
    try {
      const result = await reconnectToolServers();
      toast.success(
        `Reconnected ${result.connected.length > 0 ? result.connected.join(", ") : "no servers"} (${result.tools} tools)`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Reconnect failed");
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-muted-foreground">
          MCP tool servers the agent can call.
        </p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={reconnect}>
            <RefreshCcwIcon data-icon="inline-start" />
            Reconnect
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => openEditor(null)}
          >
            <PlusIcon data-icon="inline-start" />
            Add tool
          </Button>
        </div>
      </div>
      <Card className="p-0">
        <Table className="min-w-[640px]">
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Transport</TableHead>
              <TableHead className="hidden md:table-cell">Endpoint</TableHead>
              <TableHead className="w-20">Status</TableHead>
              <TableHead className="w-24 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {settings.tools.map((tool) => (
              <TableRow key={tool.name}>
                <TableCell>
                  <div className="flex flex-col">
                    <span className="font-mono text-[13px]">{tool.name}</span>
                    <span className="text-[12px] text-muted-foreground">
                      {tool.description}
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{tool.transport}</Badge>
                </TableCell>
                <TableCell className="hidden font-mono text-[12px] text-muted-foreground md:table-cell">
                  {tool.url ?? tool.command ?? "—"}
                </TableCell>
                <TableCell>
                  <Switch
                    checked={tool.enabled}
                    onCheckedChange={(checked) =>
                      toggleTool(tool.name, checked)
                    }
                    aria-label={`Toggle ${tool.name}`}
                  />
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => openEditor(tool)}
                    >
                      Edit
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Delete ${tool.name}`}
                      onClick={() => deleteTool(tool.name)}
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

      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setEditing(null);
          }
        }}
      >
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {settings.tools.some((t) => t.name === editing?.name)
                ? "Edit tool"
                : "Add tool"}
            </DialogTitle>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="tool-name">Name</FieldLabel>
              <Input
                id="tool-name"
                value={draft?.name ?? ""}
                onChange={(e) =>
                  setDraft((d) => (d ? { ...d, name: e.target.value } : d))
                }
                placeholder="e.g. weather"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="tool-description">Description</FieldLabel>
              <Input
                id="tool-description"
                value={draft?.description ?? ""}
                onChange={(e) =>
                  setDraft((d) =>
                    d ? { ...d, description: e.target.value } : d,
                  )
                }
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="tool-transport">Transport</FieldLabel>
              <Select
                value={draft?.transport ?? "streamable_http"}
                onValueChange={(value) => {
                  if (value === null) {
                    return;
                  }
                  setDraft((d) =>
                    d
                      ? {
                          ...d,
                          transport: value as (typeof TOOL_TRANSPORTS)[number],
                        }
                      : d,
                  );
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TOOL_TRANSPORTS.map((transport) => (
                    <SelectItem key={transport} value={transport}>
                      {transport}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="tool-url">URL</FieldLabel>
              <Input
                id="tool-url"
                value={draft?.url ?? ""}
                onChange={(e) =>
                  setDraft((d) => (d ? { ...d, url: e.target.value } : d))
                }
                placeholder="http://localhost:8090/mcp"
              />
              <FieldDescription>
                For streamable_http transport.
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="tool-command">Command</FieldLabel>
              <Input
                id="tool-command"
                value={draft?.command ?? ""}
                onChange={(e) =>
                  setDraft((d) => (d ? { ...d, command: e.target.value } : d))
                }
                placeholder="/path/to/mcp-server serve"
              />
              <FieldDescription>For stdio transport.</FieldDescription>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={saveTool}>Save tool</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// --- General tab --------------------------------------------------------------

function GeneralTab({
  settings,
  setSettings,
  isAdmin,
}: {
  settings: SettingsState;
  setSettings: (updater: (current: SettingsState) => SettingsState) => void;
  isAdmin: boolean;
}) {
  const [prompt, setPrompt] = useState(settings.systemPrompt);
  const [searxng, setSearxng] = useState(settings.searxngEnabled);
  // Chat display preferences (hide thinking / hide tool calls) — persisted
  // per-user on the backend; the backend filters the stream, so toggling
  // here PATCHes them live.
  const [hideReasoning, setHideReasoning] = useState(false);
  const [hideToolCalls, setHideToolCalls] = useState(false);
  // Preferences live on the backend now (per-user table): the stored values
  // win over the local cache on load, and toggling PATCHes them live — the
  // chat transport no longer sends enable_search.
  useEffect(() => {
    let cancelled = false;
    fetchPreferences()
      .then((prefs) => {
        if (!cancelled || !prefs) {
          return;
        }
        if (prefs.enableSearch !== null) {
          setSearxng(prefs.enableSearch);
        }
        setHideReasoning(prefs.hideReasoning);
        setHideToolCalls(prefs.hideToolCalls);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  // Defensive: settings.execute is normalized on load and after every
  // backend sync, but a partial value must never reach a Switch's `checked`
  // (controlled → uncontrolled React warnings) — fall back per field.
  const executeDraft = settings.execute ?? DEFAULT_SETTINGS.execute;
  // Execute tool (backend-live via admin /settings).
  const [executeEnabled, setExecuteEnabled] = useState(
    Boolean(executeDraft.enabled),
  );
  const [executeTimeout, setExecuteTimeout] = useState(
    String(executeDraft.maxTimeout),
  );
  const [executeInheritEnv, setExecuteInheritEnv] = useState(
    Boolean(executeDraft.inheritEnv),
  );
  const [savingExecute, setSavingExecute] = useState(false);
  // Human-in-the-loop gate (backend-live via admin /settings): tool name ->
  // requires approval. Draft is a copy so toggling doesn't persist until
  // "Save HITL settings".
  const [hitlDraft, setHitlDraft] = useState<Record<string, boolean>>(
    settings.hitlInterruptOn,
  );
  const [savingHitl, setSavingHitl] = useState(false);

  // Sync local draft when settings load/change from storage.
  useEffect(() => {
    const execute = settings.execute ?? DEFAULT_SETTINGS.execute;
    setPrompt(settings.systemPrompt);
    setSearxng(settings.searxngEnabled);
    setHideReasoning(Boolean(settings.hideReasoning));
    setHideToolCalls(Boolean(settings.hideToolCalls));
    setExecuteEnabled(Boolean(execute.enabled));
    setExecuteTimeout(String(execute.maxTimeout));
    setExecuteInheritEnv(Boolean(execute.inheritEnv));
    setHitlDraft(settings.hitlInterruptOn);
  }, [
    settings.systemPrompt,
    settings.searxngEnabled,
    settings.hideReasoning,
    settings.hideToolCalls,
    settings.execute,
    settings.hitlInterruptOn,
  ]);

  const save = () => {
    setSettings((current) => ({
      ...current,
      systemPrompt: prompt,
      searxngEnabled: searxng,
    }));
    toast.success("Settings saved");
  };

  // Live web-search toggle: optimistic UI + immediate PATCH to the backend
  // per-user preference (chat requests no longer carry enable_search).
  const toggleSearch = (value: boolean) => {
    setSearxng(value);
    setSettings((current) => ({ ...current, searxngEnabled: value }));
    updatePreferences({ enable_search: value }).catch(() => {
      toast.error("Couldn't save the web-search preference");
    });
  };

  // Live display toggles: optimistic UI + immediate PATCH (the backend
  // filters reasoning / tool events from the chat stream per preference)
  // + a local mirror so the message renderer's client-side filter reacts
  // instantly (SETTINGS_CHANGED_EVENT).
  const toggleHideReasoning = (value: boolean) => {
    setHideReasoning(value);
    setSettings((current) => ({ ...current, hideReasoning: value }));
    updatePreferences({ hide_reasoning: value }).catch(() => {
      toast.error("Couldn't save the display preference");
    });
  };

  const toggleHideToolCalls = (value: boolean) => {
    setHideToolCalls(value);
    setSettings((current) => ({ ...current, hideToolCalls: value }));
    updatePreferences({ hide_tool_calls: value }).catch(() => {
      toast.error("Couldn't save the display preference");
    });
  };

  const toggleHitlTool = (tool: string, enabled: boolean) => {
    setHitlDraft((current) => ({ ...current, [tool]: enabled }));
  };

  const saveHitl = async () => {
    setSavingHitl(true);
    try {
      const next = await updateAppSettings({
        hitl: { interruptOn: hitlDraft },
      });
      setSettings((current) => ({
        ...current,
        hitlInterruptOn: next.hitl.interruptOn,
      }));
      toast.success("HITL settings saved — active on the next run");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to save HITL settings",
      );
    } finally {
      setSavingHitl(false);
    }
  };

  const saveExecute = async () => {
    const seconds = Number(executeTimeout);
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 86400) {
      toast.error(
        "Max timeout must be a whole number of seconds between 1 and 86400.",
      );
      return;
    }
    setSavingExecute(true);
    try {
      const next = await updateAppSettings({
        execute: {
          enabled: executeEnabled,
          maxTimeout: seconds,
          inheritEnv: executeInheritEnv,
        },
      });
      setSettings((current) => ({
        ...current,
        execute: {
          enabled: next.execute.enabled,
          maxTimeout: next.execute.maxTimeout,
          inheritEnv: next.execute.inheritEnv,
        },
      }));
      toast.success("Execute settings saved — active on the next run");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to save execute settings",
      );
    } finally {
      setSavingExecute(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="system-prompt">System prompt</FieldLabel>
            <Textarea
              id="system-prompt"
              className="min-h-36 text-[13px]"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
            <FieldDescription>
              Sent to the model on every run. Controls the agent&apos;s
              behavior.
            </FieldDescription>
          </Field>
        </FieldGroup>
      </Card>
      <Card className="flex flex-col gap-4">
        <span className="text-sm font-medium">Human-in-the-loop</span>
        {[
          {
            label: "execute",
            description: "Shell commands on the host",
          },
          {
            label: "edit_file",
            description: "Modify an existing file",
          },
          {
            label: "write_file",
            description: "Create or overwrite a file",
          },
        ].map((tool) => (
          <div
            className="flex items-center justify-between gap-4"
            key={tool.label}
          >
            <div className="flex flex-col gap-0.5">
              <span className="font-mono text-[13px]">{tool.label}</span>
              <span className="text-[12px] text-muted-foreground">
                {tool.description}
              </span>
            </div>
            <Switch
              aria-label={`Approve ${tool.label}`}
              checked={Boolean(hitlDraft[tool.label])}
              onCheckedChange={(checked) => toggleHitlTool(tool.label, checked)}
            />
          </div>
        ))}
        <div className="flex items-center gap-3">
          <Button
            disabled={savingHitl}
            onClick={saveHitl}
            size="sm"
            type="button"
          >
            {savingHitl ? "Saving…" : "Save"}
          </Button>
        </div>
      </Card>
      <Card className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium">Web search (SearXNG)</span>
            <span className="text-[13px] text-muted-foreground">
              Let the agent search the web via your self-hosted SearXNG
              instance.
            </span>
          </div>
          <Switch
            checked={searxng}
            onCheckedChange={toggleSearch}
            aria-label="Web search"
          />
        </div>
      </Card>
      <Card className="flex flex-col gap-4">
        <span className="text-sm font-medium">Chat display</span>
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium">Hide thinking</span>
            <span className="text-[13px] text-muted-foreground">
              Don&apos;t show the model&apos;s reasoning (thinking) in the chat
              stream.
            </span>
          </div>
          <Switch
            checked={hideReasoning}
            onCheckedChange={toggleHideReasoning}
            aria-label="Hide thinking"
          />
        </div>
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium">Hide tool calls</span>
            <span className="text-[13px] text-muted-foreground">
              Don&apos;t show tool-call activity in the chat stream.
            </span>
          </div>
          <Switch
            checked={hideToolCalls}
            onCheckedChange={toggleHideToolCalls}
            aria-label="Hide tool calls"
          />
        </div>
      </Card>
      {isAdmin && (
        <Card className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">Execute tool</span>
              <span className="text-[13px] text-muted-foreground">
                Let the agent run shell commands on the host. Unrestricted —
                trusted environments only; pair with human-in-the-loop.
              </span>
            </div>
            <Switch
              checked={executeEnabled}
              onCheckedChange={setExecuteEnabled}
              aria-label="Execute tool"
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div className="flex max-w-sm flex-col gap-0.5">
              <span className="text-sm font-medium">Max timeout (seconds)</span>
              <span className="text-[13px] text-muted-foreground">
                Max runtime per command (1–86400 seconds).
              </span>
            </div>
            <Input
              aria-label="Max timeout"
              className="w-32 text-right"
              max={86400}
              min={1}
              onChange={(event) => setExecuteTimeout(event.target.value)}
              type="number"
              value={executeTimeout}
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">Inherit environment</span>
              <span className="text-[13px] text-muted-foreground">
                Expose the server&apos;s environment to executed commands.
              </span>
            </div>
            <Switch
              checked={executeInheritEnv}
              onCheckedChange={setExecuteInheritEnv}
              aria-label="Inherit environment"
            />
          </div>
          <div className="flex items-center gap-3">
            <Button
              disabled={savingExecute}
              onClick={saveExecute}
              size="sm"
              type="button"
            >
              {savingExecute ? "Saving…" : "Save"}
            </Button>
          </div>
        </Card>
      )}
      <div>
        <Button onClick={save}>Save changes</Button>
      </div>
    </div>
  );
}

// --- Connections tab ----------------------------------------------------------

function ConnectionsTab() {
  // Saved provider connections (admin /connections); null = not loaded
  // (backend offline, or still fetching).
  const [connections, setConnections] = useState<BackendConnection[] | null>(
    null,
  );
  // Connection editor dialog state.
  const [editing, setEditing] = useState<BackendConnection | null>(null);
  const [draft, setDraft] = useState<ConnectionInput | null>(null);
  const [savingConnection, setSavingConnection] = useState(false);
  // Delete confirmation target (row trash / editor delete).
  const [deleteTarget, setDeleteTarget] = useState<BackendConnection | null>(
    null,
  );
  useEffect(() => {
    let cancelled = false;
    fetchConnections()
      .then((list) => {
        if (!cancelled) {
          setConnections(list);
        }
      })
      .catch(() => {
        // Backend offline — leave the list empty.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshConnections = async () => {
    try {
      setConnections(await fetchConnections());
    } catch {
      // Backend offline — keep the cached list.
    }
  };

  const openConnectionEditor = (connection: BackendConnection | null) => {
    setEditing(connection);
    setDraft(
      connection
        ? {
            apiToken: "", // write-only — never prefill the masked token
            baseUrl: connection.baseUrl ?? "",
            // PUT is a full replace — carry provider options through so
            // saving the dialog never drops them (e.g. the embeddings
            // model name).
            extra: connection.extra,
            isDefault: connection.isDefault,
            kind: connection.kind,
            name: connection.name,
          }
        : {
            apiToken: "",
            baseUrl: "",
            extra: {},
            // First llm connection — default it so the backend unlocks chat
            // (setup.completed needs a default with a token AND a model).
            isDefault: true,
            kind: "llm",
            name: "",
          },
    );
  };

  const saveConnectionEditor = async () => {
    if (!draft) {
      return;
    }
    const name = draft.name.trim();
    if (!CONNECTION_NAME_RE.test(name)) {
      toast.error(
        "Invalid name — lowercase letters, numbers, and dots/underscores/hyphens between segments (e.g. my-vllm).",
      );
      return;
    }
    const payload: ConnectionInput = {
      ...draft,
      apiToken: draft.apiToken?.trim() || undefined,
      baseUrl: draft.baseUrl?.trim() || undefined,
      name,
    };
    if (draft.kind === "llm" && !payload.extra?.model) {
      toast.warning(
        "No default model set — chat stays locked until you add one.",
      );
    }
    setSavingConnection(true);
    try {
      if (editing) {
        await updateConnection(editing.name, payload);
      } else {
        await createConnection(payload);
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to save connection",
      );
      setSavingConnection(false);
      return;
    }
    setSavingConnection(false);
    setEditing(null);
    setDraft(null);
    await refreshConnections();
    toast.success(editing ? "Connection updated" : "Connection created");
  };

  const removeConnection = async (name: string) => {
    try {
      await deleteConnection(name);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to delete connection",
      );
      return;
    }
    setConnections((current) =>
      current ? current.filter((c) => c.name !== name) : current,
    );
    toast.success("Connection deleted");
  };

  const confirmDeleteConnection = async () => {
    if (!deleteTarget) {
      return;
    }
    await removeConnection(deleteTarget.name);
    setDeleteTarget(null);
    // The editor may be open behind the confirm — close it too.
    setEditing(null);
    setDraft(null);
  };

  const toggleConnectionEnabled = async (
    connection: BackendConnection,
    enabled: boolean,
  ) => {
    try {
      await updateConnection(connection.name, {
        baseUrl: connection.baseUrl ?? undefined,
        // Full replace — carry provider options and keep the stored token
        // (apiToken omitted on purpose).
        enabled,
        extra: connection.extra,
        isDefault: connection.isDefault,
        kind: connection.kind,
        name: connection.name,
      });
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : `Failed to ${enabled ? "enable" : "disable"} ${connection.name}`,
      );
      return;
    }
    setConnections((current) =>
      current
        ? current.map((candidate) =>
            candidate.name === connection.name
              ? { ...candidate, enabled }
              : candidate,
          )
        : current,
    );
    toast.success(`${connection.name} ${enabled ? "enabled" : "disabled"}`);
  };

  // This card is chat-completions only — the editor always saves kind=llm.
  const llmConnections = connections?.filter(
    (connection) => connection.kind === "llm",
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-muted-foreground">
          OpenAI-compatible base URL — serves /v1/models and
          /v1/chat/completions.
        </p>
        <Button
          onClick={() => openConnectionEditor(null)}
          size="sm"
          type="button"
          variant="secondary"
        >
          <PlusIcon data-icon="inline-start" />
          New connection
        </Button>
      </div>
      {llmConnections === undefined ? (
        <p className="text-[13px] text-muted-foreground">
          Loading connections…
        </p>
      ) : llmConnections.length === 0 ? null : (
        <Card className="p-0">
          <Table className="min-w-[640px]">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Base URL</TableHead>
                <TableHead>Token</TableHead>
                <TableHead className="w-44 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {llmConnections.map((connection) => (
                <TableRow key={connection.id}>
                  <TableCell>
                    <span className="font-mono text-[13px]">
                      {connection.name}
                    </span>
                  </TableCell>
                  <TableCell className="max-w-56 truncate font-mono text-[12px] text-muted-foreground">
                    {connection.baseUrl ?? "—"}
                  </TableCell>
                  <TableCell className="font-mono text-[12px] text-muted-foreground">
                    {connection.hasToken
                      ? (connection.apiToken ?? "••••")
                      : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        aria-label={`Edit ${connection.name}`}
                        onClick={() => openConnectionEditor(connection)}
                        size="icon"
                        type="button"
                        variant="ghost"
                      >
                        <PencilIcon data-icon="inline-start" />
                      </Button>
                      <Switch
                        aria-label={`Toggle ${connection.name}`}
                        checked={connection.enabled}
                        onCheckedChange={(checked) =>
                          toggleConnectionEnabled(connection, checked)
                        }
                      />
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
              {editing ? `Edit ${editing.name}` : "New connection"}
            </DialogTitle>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="connection-name">Name</FieldLabel>
              <Input
                disabled={editing !== null}
                id="connection-name"
                onChange={(event) =>
                  setDraft((current) =>
                    current
                      ? { ...current, name: event.target.value }
                      : current,
                  )
                }
                placeholder="e.g. my-vllm"
                value={draft?.name ?? ""}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="connection-base-url">Base URL</FieldLabel>
              <Input
                id="connection-base-url"
                onChange={(event) =>
                  setDraft((current) =>
                    current
                      ? { ...current, baseUrl: event.target.value }
                      : current,
                  )
                }
                placeholder="https://your-endpoint/v1"
                value={draft?.baseUrl ?? ""}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="connection-api-token">API token</FieldLabel>
              <Input
                id="connection-api-token"
                onChange={(event) =>
                  setDraft((current) =>
                    current
                      ? { ...current, apiToken: event.target.value }
                      : current,
                  )
                }
                placeholder={
                  editing?.hasToken
                    ? "Leave empty to keep the stored token"
                    : "sk-…"
                }
                type="password"
                value={draft?.apiToken ?? ""}
              />
            </Field>
            {draft?.kind === "llm" && (
              <Field>
                <FieldLabel htmlFor="connection-model">
                  Default model
                </FieldLabel>
                <Input
                  id="connection-model"
                  onChange={(event) =>
                    setDraft((current) =>
                      current
                        ? {
                            ...current,
                            extra: {
                              ...(current.extra ?? {}),
                              model: event.target.value.trim() || undefined,
                            },
                          }
                        : current,
                    )
                  }
                  placeholder="e.g. gpt-4o-mini"
                  value={
                    typeof draft?.extra?.model === "string"
                      ? draft.extra.model
                      : ""
                  }
                />
                <FieldDescription>
                  Model id from the provider&apos;s /v1/models. The backend
                  treats setup as complete only once the default llm connection
                  has a token and a model — without it chat stays locked.
                </FieldDescription>
              </Field>
            )}
            {draft?.kind === "llm" && (
              <div className="flex items-center justify-between gap-3">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">Use as default</span>
                  <span className="text-[13px] text-muted-foreground">
                    Chat uses this connection. With one llm connection this is
                    automatic — flip it when you have several.
                  </span>
                </div>
                <Switch
                  aria-label="Use as default llm connection"
                  checked={draft.isDefault ?? false}
                  onCheckedChange={(checked) =>
                    setDraft((current) =>
                      current ? { ...current, isDefault: checked } : current,
                    )
                  }
                />
              </div>
            )}
          </FieldGroup>
          <DialogFooter>
            {editing && (
              <Button
                className="mr-auto"
                onClick={() => setDeleteTarget(editing)}
                type="button"
                variant="destructive"
              >
                Delete
              </Button>
            )}
            <Button
              onClick={() => {
                setEditing(null);
                setDraft(null);
              }}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              disabled={savingConnection}
              onClick={saveConnectionEditor}
              type="button"
            >
              {savingConnection
                ? "Saving…"
                : editing
                  ? "Save"
                  : "Create connection"}
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
            <AlertDialogTitle>Delete connection?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove {deleteTarget?.name}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteConnection}
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

// --- Model tab ----------------------------------------------------------------

function ModelTab({ settings }: { settings: SettingsState }) {
  // The active model id (settings.model, seeded from the backend's default
  // llm connection) — there is no local picker anymore; model selection
  // lives in the chat input and the default connection's extra.model.
  const modelId = settings.model;
  // Per-user enabled-models preference (backend /users/me/preferences):
  // null = no restriction (every model enabled), [] = none. The backend
  // refuses chat when the effective model is not in this list, so the
  // switches below are the real gate — the picker just hides disabled
  // models. Switches stay disabled until the preference loads (prefsLoaded)
  // so a toggle can never race the initial fetch.
  const [enabledModels, setEnabledModels] = useState<string[] | null>(null);
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  // Live model catalog: the backend aggregates every saved llm connection's
  // model list (GET /connections/models); the caller's allowlist restriction
  // filters the picker for user-role accounts. Models stay null while
  // loading or on failure → callers fall back to the built-in list.
  const { models: sourceModels, allowed } = useModelCatalog();
  // The live id may come from the backend (GET /health) and not exist in
  // the list — never silently fall back to a wrong preset entry.
  // When the current id isn't in the list, surface it at the top as-is so
  // the active model stays visible. No presets: the list is only ever the
  // live catalog (aggregated connections / allowlist). While the catalog
  // is still loading (sourceModels === null) don't synthesize anything —
  // that would flash a bogus "not in the list" row for ~1s on every mount
  // even for models the catalog does advertise.
  const models: ChatModel[] = useMemo(() => {
    const base = sourceModels ?? [];
    if (base.some((m) => m.id === modelId)) {
      return base;
    }
    if (sourceModels === null) {
      return [];
    }
    return [
      {
        id: modelId,
        name: modelId,
        description:
          "Active model — reported by the backend; not advertised by any connection's /v1/models",
      },
      ...base,
    ];
  }, [modelId, sourceModels]);

  useEffect(() => {
    let cancelled = false;
    fetchPreferences().then((prefs) => {
      if (cancelled) {
        return;
      }
      setEnabledModels(prefs?.enabledModels ?? null);
      setPrefsLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Flip one model's switch: turning the first model OFF materializes the
  // full list (null = all enabled) minus that id — the restriction starts.
  const toggleModel = async (id: string, enabled: boolean) => {
    if (!prefsLoaded) {
      return;
    }
    const previous = enabledModels;
    const next = enabled
      ? [...(enabledModels ?? []), id]
      : (enabledModels ?? models.map((m) => m.id)).filter((x) => x !== id);
    setEnabledModels(next);
    try {
      await updatePreferences({ enabled_models: next });
    } catch (error) {
      setEnabledModels(previous);
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to save model switches",
      );
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Header row lives outside the card — same as the Tools tab. */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">Available models</span>
          <span className="text-[13px] text-muted-foreground">
            Models from your connections&apos; /v1/models. Disabled models are
            refused in chat.
          </span>
        </div>
      </div>
      <Card className="flex flex-col gap-3">
        {allowed?.restricted && (
          <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
            <ShieldCheckIcon className="size-4 shrink-0" />
            {allowed.models.length === 0
              ? "No models are allowed for your account yet — ask an admin to allow some."
              : `Your account may use ${allowed.models.length} model(s).`}
          </p>
        )}
        {sourceModels === null ? (
          <p className="text-[13px] text-muted-foreground">Loading models…</p>
        ) : models.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">
            No models yet — add an llm connection first.
          </p>
        ) : (
          <div className="flex max-h-[32rem] flex-col overflow-y-auto">
            {models.map((model) => (
              <div
                className="flex items-center justify-between gap-4 border-b border-border/60 py-2 last:border-b-0"
                key={model.id}
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate font-mono text-[13px]">
                    {model.name}
                  </span>
                  <span className="truncate text-[12px] text-muted-foreground">
                    {model.description}
                  </span>
                </div>
                <Switch
                  aria-label={`Enable ${model.id}`}
                  checked={
                    !prefsLoaded
                      ? false
                      : enabledModels === null ||
                        enabledModels.includes(model.id)
                  }
                  disabled={!prefsLoaded}
                  onCheckedChange={(checked) => toggleModel(model.id, checked)}
                />
              </div>
            ))}
          </div>
        )}
        {prefsLoaded &&
          enabledModels !== null &&
          !enabledModels.includes(modelId) && (
            <p className="flex items-center gap-1.5 text-[13px] text-destructive">
              <TriangleAlertIcon className="size-4 shrink-0" />
              The active model is disabled — the backend refuses chat until you
              re-enable it or pick another.
            </p>
          )}
      </Card>
    </div>
  );
}
// --- Page ---------------------------------------------------------------------

export default function SettingsPage() {
  const { activeTab, setActiveTab } = useSettingsTabs();
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const [settings, setSettings] = useState<SettingsState>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [backendOnline, setBackendOnline] = useState(false);
  const isAdmin = user?.role === "admin";

  // Deep-link support: ?tab=model jumps straight to that tab.
  useEffect(() => {
    const tab = new URLSearchParams(window.location.search).get("tab");
    if (tab) {
      setActiveTab(tab as SettingsTabId);
    }
  }, [setActiveTab]);

  useEffect(() => {
    const stored = loadSettings();
    setSettings(stored);
    setLoaded(true);
    fetchBackendHealth().then((health) => {
      if (!health) {
        return;
      }
      setBackendOnline(true);
      // Health values only seed the first-run defaults. The backend has
      // /settings endpoints for execute/HITL (DB wins); model, prompt and
      // the search toggle are still local-only, so applying health.model
      // etc. on every load would silently clobber the user's saved choices.
      const hasSaved = hasStoredSettings();
      setSettings((current) => ({
        ...current,
        model: hasSaved ? current.model : (health.model ?? current.model),
        hitlInterruptOn: hasSaved
          ? current.hitlInterruptOn
          : ((health.interrupt_on as Record<string, boolean> | undefined) ??
            {}),
        searxngEnabled: hasSaved
          ? current.searxngEnabled
          : (health.searxng?.enabled ?? current.searxngEnabled),
      }));
      // Replace the local cache with the backend's live agent resources.
      Promise.all([
        fetchSkills(),
        fetchToolServers(),
        fetchKnowledgeBasesWithDocuments(),
      ])
        .then(([skills, tools, knowledgeBases]) => {
          setSettings((current) => ({
            ...current,
            skills: skills.map(backendSkillToSkill),
            tools: tools.map((tool) =>
              backendToolToToolConfig(
                tool,
                current.tools.find((stored) => stored.name === tool.name),
              ),
            ),
            knowledgeBases,
          }));
        })
        .catch(() => {
          // Resources unreachable — keep the local (offline) cache.
        });
    });
  }, []);

  // Backend-live settings (admin-only /settings): the DB wins over .env, so
  // when the backend is online its values replace the cached ones (same
  // policy as skills/tools). Non-admins keep the cached/local defaults.
  useEffect(() => {
    if (!isAdmin) {
      return;
    }
    let cancelled = false;
    fetchAppSettings()
      .then((live) => {
        if (cancelled) {
          return;
        }
        setSettings((current) => ({
          ...current,
          execute: {
            enabled: live.execute.enabled,
            inheritEnv: live.execute.inheritEnv,
            maxTimeout: live.execute.maxTimeout,
          },
          hitlInterruptOn: live.hitl.interruptOn,
        }));
      })
      .catch(() => {
        // Backend offline / not reachable — keep the local cache.
      });
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  const update = (updater: (current: SettingsState) => SettingsState) => {
    setSettings((current) => {
      const next = updater(current);
      saveSettings(next);
      return next;
    });
  };

  // Settings load from localStorage + backend health (client-only), so the
  // tabs must not render during SSR/hydration — avoids hydration mismatches.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <div className="mx-auto flex h-dvh w-full max-w-4xl flex-col gap-6 px-4 pt-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
      <div className="flex shrink-0 items-center">
        <h1 className="text-lg font-semibold">
          {SETTINGS_TABS.find((tab) => tab.id === activeTab)?.label ??
            "Settings"}
        </h1>
      </div>

      {loaded && mounted && (
        <Tabs
          orientation={isMobile ? "horizontal" : "vertical"}
          onValueChange={(value) => setActiveTab(value as SettingsTabId)}
          value={activeTab}
          className="flex min-h-0 min-w-0 flex-1 flex-col"
        >
          {/* Mobile tab strip: horizontally scrollable; desktop keeps the
              settings navigation in the sidebar instead. */}
          <TabsList
            className="md:hidden w-full max-w-full shrink-0 justify-start gap-1 overflow-x-auto rounded-none bg-transparent p-0 group-data-horizontal/tabs:h-auto group-data-horizontal/tabs:py-2"
            variant="line"
          >
            {settingsTabsForRole(user?.role).map((tab) => (
              <TabsTrigger className="shrink-0" key={tab.id} value={tab.id}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {/* Fixed-height content panel: switching tabs never changes the
              page layout; long content scrolls inside the panel. */}
          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            <TabsContent value="general">
              <GeneralTab
                isAdmin={isAdmin}
                settings={settings}
                setSettings={update}
              />
            </TabsContent>
            {user?.role === "admin" && (
              <TabsContent value="connections">
                <ConnectionsTab />
              </TabsContent>
            )}
            <TabsContent value="model">
              <ModelTab settings={settings} />
            </TabsContent>
            {user?.role === "admin" && (
              <TabsContent value="skills">
                <SkillsTab
                  settings={settings}
                  setSettings={update}
                  backendOnline={backendOnline}
                />
              </TabsContent>
            )}
            <TabsContent value="tools">
              <ToolsTab
                settings={settings}
                setSettings={update}
                backendOnline={backendOnline}
              />
            </TabsContent>
            <TabsContent value="knowledge-base">
              <KnowledgeBaseTab
                settings={settings}
                setSettings={update}
                backendOnline={backendOnline}
              />
            </TabsContent>
            <TabsContent value="account">
              <AccountTab />
            </TabsContent>
            {user?.role === "admin" && (
              <TabsContent value="permissions">
                <PermissionsTab />
              </TabsContent>
            )}
            {user?.role === "admin" && (
              <TabsContent value="users">
                <UsersTab />
              </TabsContent>
            )}
          </div>
        </Tabs>
      )}
    </div>
  );
}
