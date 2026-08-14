"use client";

import {
  ChevronsUpDownIcon,
  PlusIcon,
  RefreshCcwIcon,
  SettingsIcon,
  TrashIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ModelSelector,
  ModelSelectorContent,
  ModelSelectorEmpty,
  ModelSelectorGroup,
  ModelSelectorInput,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorTrigger,
} from "@/components/ai-elements/model-selector";
import { AccountTab } from "@/components/settings/account-tab";
import { KnowledgeBaseTab } from "@/components/settings/knowledge-base-tab";
import { UsersTab } from "@/components/settings/users-tab";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  ComboboxValue,
} from "@/components/ui/combobox";
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
import { useAvailableModels } from "@/hooks/use-available-models";
import {
  type ChatModel,
  COMPLETION_PROVIDERS,
  type CompletionProviderId,
  chatModels,
  completionProvider,
  findChatModel,
  type ModelConnection,
} from "@/lib/models";
import {
  createSkill as apiCreateSkill,
  createToolServer as apiCreateToolServer,
  deleteSkill as apiDeleteSkill,
  deleteSkillFile as apiDeleteSkillFile,
  deleteToolServer as apiDeleteToolServer,
  updateSkill as apiUpdateSkill,
  updateToolServer as apiUpdateToolServer,
  backendSkillToSkill,
  backendToolToToolConfig,
  DEFAULT_SETTINGS,
  fetchBackendHealth,
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
} from "@/lib/settings";
import { cn } from "@/lib/utils";

function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-border/60 bg-card p-5 shadow-[var(--shadow-card)]",
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
          Reusable instruction sets the agent can follow. Stored as{" "}
          <code className="rounded bg-muted px-1 font-mono text-[12px]">
            SKILL.md
          </code>{" "}
          plus optional bundled files (scripts/, references/, assets/) in the
          backend; changes apply on the next run.
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
        <DialogContent className="max-h-[85dvh] overflow-y-auto">
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
          MCP tool servers the agent can call, persisted in the backend&apos;s
          store. Changes apply after reconnect.
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
        <Table>
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
        <DialogContent>
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
              <Combobox
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
                <ComboboxTrigger>
                  <ComboboxValue />
                </ComboboxTrigger>
                <ComboboxContent>
                  <ComboboxInput placeholder="Search transport…" />
                  <ComboboxList>
                    {TOOL_TRANSPORTS.map((transport) => (
                      <ComboboxItem key={transport} value={transport}>
                        {transport}
                      </ComboboxItem>
                    ))}
                  </ComboboxList>
                </ComboboxContent>
              </Combobox>
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
}: {
  settings: SettingsState;
  setSettings: (updater: (current: SettingsState) => SettingsState) => void;
}) {
  const [prompt, setPrompt] = useState(settings.systemPrompt);
  const [interruptOn, setInterruptOn] = useState(settings.interruptOn);
  const [searxng, setSearxng] = useState(settings.searxngEnabled);

  // Sync local draft when settings load/change from storage.
  useEffect(() => {
    setPrompt(settings.systemPrompt);
    setInterruptOn(settings.interruptOn);
    setSearxng(settings.searxngEnabled);
  }, [settings.systemPrompt, settings.interruptOn, settings.searxngEnabled]);

  const save = () => {
    setSettings((current) => ({
      ...current,
      systemPrompt: prompt,
      interruptOn,
      searxngEnabled: searxng,
    }));
    toast.success("Settings saved");
  };

  return (
    <div className="flex max-w-2xl flex-col gap-4">
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
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium">Human-in-the-loop</span>
            <span className="text-[13px] text-muted-foreground">
              Pause before sensitive tool calls (write_file, edit_file) for
              approval.
            </span>
          </div>
          <Switch
            checked={interruptOn}
            onCheckedChange={setInterruptOn}
            aria-label="Human-in-the-loop"
          />
        </div>
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
            onCheckedChange={setSearxng}
            aria-label="Web search"
          />
        </div>
      </Card>
      <div>
        <Button onClick={save}>Save changes</Button>
      </div>
    </div>
  );
}

// --- Model tab ----------------------------------------------------------------

function ModelTab({
  settings,
  setSettings,
}: {
  settings: SettingsState;
  setSettings: (updater: (current: SettingsState) => SettingsState) => void;
}) {
  const [modelId, setModelId] = useState(settings.model);
  const [open, setOpen] = useState(false);
  // Connection to the completion source that feeds the model list.
  const [connDraft, setConnDraft] = useState<ModelConnection>({
    apiKey: "",
    baseUrl: "",
    provider: "default",
  });
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  // Sync the draft whenever a saved connection arrives/changes (settings
  // load from localStorage after mount; saves persist via the update()
  // wrapper in the page).
  useEffect(() => {
    setConnDraft(
      settings.modelConnection ?? {
        apiKey: "",
        baseUrl: "",
        provider: "default",
      },
    );
  }, [settings.modelConnection]);
  // Live models from the completion source (GET /api/models); null while
  // loading or when the fetch fails → fall back to the built-in list.
  const sourceModels = useAvailableModels();
  // The live id may come from the backend (GET /health) and not exist in
  // the list — never silently fall back to a wrong preset entry.
  const model: ChatModel | undefined = useMemo(
    () => findChatModel(modelId),
    [modelId],
  );
  // When the current id isn't in the list, surface it at the top as-is so
  // the active model stays visible and re-selectable.
  const models: ChatModel[] = useMemo(() => {
    const base = sourceModels ?? chatModels;
    if (base.some((m) => m.id === modelId)) {
      return base;
    }
    return [
      {
        id: modelId,
        name: modelId,
        description: "Model reported by the backend — not in the list",
      },
      ...base,
    ];
  }, [modelId, sourceModels]);

  useEffect(() => {
    setModelId(settings.model);
  }, [settings.model]);

  const save = () => {
    setSettings((current) => ({ ...current, model: modelId }));
    toast.success(`Model set to ${modelId}`);
  };

  const applyProvider = (id: CompletionProviderId) => {
    const provider = completionProvider(id);
    setConnDraft((current) => ({
      ...current,
      baseUrl: provider.defaultBaseUrl || current.baseUrl,
      provider: id,
      apiKey: provider.needsKey ? current.apiKey : "",
    }));
    setTestResult(null);
  };

  const testConnection = async () => {
    if (
      completionProvider(connDraft.provider).needsKey &&
      !connDraft.apiKey.trim()
    ) {
      toast.error("Enter an API key first.");
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/models", {
        body: JSON.stringify(connDraft),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const body = (await res.json()) as {
        message?: string;
        models?: unknown[];
      };
      if (res.ok && body.models?.length) {
        setTestResult({
          ok: true,
          message: `Connected — ${body.models.length} models available`,
        });
      } else {
        setTestResult({
          ok: false,
          message: body.message ?? `Request failed (${res.status})`,
        });
      }
    } catch {
      setTestResult({ ok: false, message: "Network error." });
    } finally {
      setTesting(false);
    }
  };

  const saveConnection = () => {
    if (
      completionProvider(connDraft.provider).needsKey &&
      !connDraft.apiKey.trim()
    ) {
      toast.error("Enter an API key first.");
      return;
    }
    const connection: ModelConnection | null =
      connDraft.provider === "default" ? null : connDraft;
    setSettings((current) => ({ ...current, modelConnection: connection }));
    toast.success(
      connection
        ? "Connection saved — model list refreshed."
        : "Using the server default source.",
    );
  };

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <Card>
        <FieldGroup>
          <Field>
            <FieldLabel>Completion source</FieldLabel>
            <Select
              onValueChange={(value) =>
                applyProvider(value as CompletionProviderId)
              }
              value={connDraft.provider}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COMPLETION_PROVIDERS.map((provider) => (
                  <SelectItem key={provider.id} value={provider.id}>
                    {provider.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription>
              Where the model list below comes from. Server default uses the
              source configured in the server environment (.env.local); the
              others use your key to list models via the source&apos;s
              /v1/models endpoint.
            </FieldDescription>
          </Field>
          {connDraft.provider !== "default" && (
            <>
              <Field>
                <FieldLabel htmlFor="model-connection-base-url">
                  Base URL
                </FieldLabel>
                <Input
                  id="model-connection-base-url"
                  onChange={(event) => {
                    setConnDraft((current) => ({
                      ...current,
                      baseUrl: event.target.value,
                    }));
                    setTestResult(null);
                  }}
                  placeholder={
                    completionProvider(connDraft.provider).defaultBaseUrl ||
                    "https://your-endpoint/v1"
                  }
                  value={connDraft.baseUrl}
                />
                <FieldDescription>
                  OpenAI-compatible /v1 endpoint (Gemini&apos;s
                  OpenAI-compatibility layer included).
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="model-connection-api-key">
                  API key
                </FieldLabel>
                <Input
                  id="model-connection-api-key"
                  onChange={(event) => {
                    setConnDraft((current) => ({
                      ...current,
                      apiKey: event.target.value,
                    }));
                    setTestResult(null);
                  }}
                  placeholder="sk-…"
                  type="password"
                  value={connDraft.apiKey}
                />
              </Field>
            </>
          )}
          <div className="flex items-center gap-3">
            <Button
              disabled={testing}
              onClick={testConnection}
              type="button"
              variant="outline"
            >
              {testing ? "Testing…" : "Test connection"}
            </Button>
            {testResult && (
              <span
                className={cn(
                  "text-[13px]",
                  testResult.ok ? "text-green-600" : "text-destructive",
                )}
              >
                {testResult.message}
              </span>
            )}
            <Button className="ml-auto" onClick={saveConnection} type="button">
              Save connection
            </Button>
          </div>
        </FieldGroup>
      </Card>
      <Card>
        <FieldGroup>
          <Field>
            <FieldLabel>Chat model</FieldLabel>
            <ModelSelector open={open} onOpenChange={setOpen}>
              <ModelSelectorTrigger
                render={
                  <Button
                    className="w-full justify-between font-medium"
                    variant="outline"
                  >
                    <span className="truncate">
                      {model?.name ??
                        models.find((m) => m.id === modelId)?.name ??
                        modelId}
                    </span>
                    <ChevronsUpDownIcon
                      className="size-4 shrink-0 text-muted-foreground"
                      data-icon="inline-end"
                    />
                  </Button>
                }
              />
              <ModelSelectorContent
                align="start"
                commandDefaultValue={modelId}
                side="bottom"
              >
                <ModelSelectorInput placeholder="Search models…" />
                <ModelSelectorList>
                  <ModelSelectorEmpty>No models found.</ModelSelectorEmpty>
                  <ModelSelectorGroup>
                    {models.map((m) => {
                      // Only the appended backend-reported entry is "raw";
                      // live source models get their normal (non-mono) name.
                      const isRaw =
                        m.id === modelId &&
                        !(sourceModels ?? chatModels).some(
                          (x) => x.id === m.id,
                        );
                      return (
                        <ModelSelectorItem
                          key={m.id}
                          value={m.id}
                          data-checked={modelId === m.id || undefined}
                          onSelect={() => {
                            setOpen(false);
                            setModelId(m.id);
                          }}
                        >
                          <div className="flex flex-col gap-0.5">
                            <span
                              className={cn(
                                "font-medium",
                                isRaw && "font-mono text-[12px]",
                              )}
                            >
                              {m.name}
                            </span>
                            <span className="text-[12px] text-muted-foreground">
                              {m.description}
                            </span>
                          </div>
                        </ModelSelectorItem>
                      );
                    })}
                  </ModelSelectorGroup>
                </ModelSelectorList>
              </ModelSelectorContent>
            </ModelSelector>
            <FieldDescription>
              Sent as{" "}
              <code className="rounded bg-muted px-1 font-mono text-[12px]">
                selectedChatModel
              </code>{" "}
              in chat requests; the backend resolves the actual model. The chat
              opens with this model — change it per conversation from the input
              toolbar.
            </FieldDescription>
          </Field>
        </FieldGroup>
      </Card>
      <div>
        <Button onClick={save}>Save model</Button>
      </div>
    </div>
  );
}

// --- Page ---------------------------------------------------------------------

export default function SettingsPage() {
  const { user } = useAuth();
  const [settings, setSettings] = useState<SettingsState>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [backendOnline, setBackendOnline] = useState(false);

  useEffect(() => {
    const stored = loadSettings();
    setSettings(stored);
    setLoaded(true);
    fetchBackendHealth().then((health) => {
      if (!health) {
        return;
      }
      setBackendOnline(true);
      // Health values only seed the first-run defaults. The backend has no
      // /settings endpoints yet (model, prompt, toggles are local-only), so
      // applying health.model etc. on every load would silently clobber the
      // user's saved choices.
      const hasSaved = hasStoredSettings();
      setSettings((current) => ({
        ...current,
        model: hasSaved ? current.model : (health.model ?? current.model),
        interruptOn: hasSaved
          ? current.interruptOn
          : Boolean(
              health.interrupt_on && Object.keys(health.interrupt_on).length,
            ),
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
    <div className="mx-auto flex h-dvh w-full max-w-4xl flex-col gap-6 px-4 py-6">
      <div className="flex shrink-0 items-center gap-3">
        <div className="flex size-9 items-center justify-center rounded-xl border border-border/60 bg-card">
          <SettingsIcon className="size-4 text-muted-foreground" />
        </div>
        <div className="flex flex-col">
          <h1 className="text-lg font-semibold">Settings</h1>
          <p className="text-[13px] text-muted-foreground">
            {backendOnline
              ? "Connected to backend — skills, tools and knowledge bases are the live configuration; model, prompt and toggles are saved locally."
              : "Backend offline — showing saved local values."}
          </p>
        </div>
      </div>

      {loaded && mounted && (
        <Tabs
          orientation="vertical"
          defaultValue="general"
          className="flex min-h-0 flex-1 items-start gap-6"
        >
          <TabsList className="w-44 shrink-0 flex-col">
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="model">Model</TabsTrigger>
            {user?.role === "admin" && (
              <TabsTrigger value="skills">Skills</TabsTrigger>
            )}
            {user?.role === "admin" && (
              <TabsTrigger value="tools">Tools</TabsTrigger>
            )}
            <TabsTrigger value="knowledge-base">Knowledge base</TabsTrigger>
            <TabsTrigger value="account">Account</TabsTrigger>
            {user?.role === "admin" && (
              <TabsTrigger value="users">Users</TabsTrigger>
            )}
          </TabsList>
          {/* Fixed-height content panel: switching tabs never changes the
              page layout; long content scrolls inside the panel. */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col self-stretch">
            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
              <TabsContent value="general">
                <GeneralTab settings={settings} setSettings={update} />
              </TabsContent>
              <TabsContent value="model">
                <ModelTab settings={settings} setSettings={update} />
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
              {user?.role === "admin" && (
                <TabsContent value="tools">
                  <ToolsTab
                    settings={settings}
                    setSettings={update}
                    backendOnline={backendOnline}
                  />
                </TabsContent>
              )}
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
                <TabsContent value="users">
                  <UsersTab />
                </TabsContent>
              )}
            </div>
          </div>
        </Tabs>
      )}
    </div>
  );
}
