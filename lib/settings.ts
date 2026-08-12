// Settings state for the /settings page.
//
// Skills and MCP tool servers are backed by the backend's /agent/* CRUD
// endpoints (via the /api/agent proxy) — the backend persists them in the
// LangGraph store and applies them to the agent on the next run. The same
// data is also mirrored to localStorage as an offline fallback/cache, and
// the remaining settings (model, prompt, toggles) are still local-only
// until the backend /settings endpoints exist.

import { fetchWithAuth } from "@/lib/auth";

export type SkillFile = {
  // Relative path under the skill root (skill-creator layout), e.g.
  // "scripts/run.py". Must match SKILL_FILE_PATH_RE (backend validates).
  path: string;
  content: string;
};

export type Skill = {
  // Backend key: lowercase alphanumeric + hyphens (Agent Skills spec).
  name: string;
  description: string;
  content: string;
  // Bundled resources the agent can read/execute (scripts/, references/, ...).
  files: SkillFile[];
  updatedAt: string;
};

export type ToolConfig = {
  // Backend key: lowercase alphanumeric + hyphens.
  name: string;
  description: string; // local-only metadata (backend has no description field)
  transport: "streamable_http" | "stdio";
  url?: string;
  command?: string;
  enabled: boolean;
  // Passthrough for servers created outside the UI (kept when editing).
  args?: string[];
  headers?: Record<string, string>;
  env?: Record<string, string>;
};

// --- Knowledge base (RAG document store) ------------------------------------
//
// Contract the backend is expected to implement under /agent/knowledge-bases
// (proxied at /api/agent/knowledge-bases, same proxy as skills/tools):
//
//   GET    /knowledge-bases                       → list all KBs
//   POST   /knowledge-bases                       → create { name, description }
//   PUT    /knowledge-bases/{name}                → update { name, description }
//   DELETE /knowledge-bases/{name}                → delete KB + all its files
//   POST   /knowledge-bases/{name}/files          → multipart upload
//                                                    (FormData field "files",
//                                                     one or more entries)
//   DELETE /knowledge-bases/{name}/files/{file}   → delete one stored file
//
// File *content* is never stored on the client — the UI keeps metadata only
// and uploads the raw File objects straight to the backend.

export type KnowledgeBaseFile = {
  name: string;
  size: number; // bytes
  type: string; // mime type
};

export type KnowledgeBase = {
  // Backend key: lowercase alphanumeric + hyphens (same rule as skills).
  name: string;
  description: string;
  files: KnowledgeBaseFile[];
  updatedAt: string;
};

export type BackendKnowledgeBase = {
  name: string;
  description: string;
  files: { name: string; size: number; type: string }[];
};

export type SettingsState = {
  model: string;
  systemPrompt: string;
  interruptOn: boolean;
  searxngEnabled: boolean;
  skills: Skill[];
  tools: ToolConfig[];
  knowledgeBases: KnowledgeBase[];
};

export const SETTINGS_STORAGE_KEY = "app-settings";

export const DEFAULT_SETTINGS: SettingsState = {
  model: "gpt-4o-mini",
  systemPrompt:
    "You are a helpful AI assistant running inside a backend service. Be concise and direct.",
  interruptOn: false,
  searxngEnabled: false,
  skills: [
    {
      name: "code-review",
      description: "How to review pull requests",
      content:
        "# Code review\n\n1. Read the diff carefully\n2. Check for edge cases\n3. Suggest tests",
      files: [],
      updatedAt: new Date().toISOString(),
    },
  ],
  tools: [
    {
      name: "web_search",
      description: "Web search via self-hosted SearXNG",
      transport: "streamable_http",
      url: "http://localhost:8888/search",
      enabled: false,
    },
  ],
  knowledgeBases: [],
};

export function loadSettings(): SettingsState {
  if (typeof window === "undefined") {
    return DEFAULT_SETTINGS;
  }
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_SETTINGS;
    }
    const parsed = JSON.parse(raw) as Partial<SettingsState>;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      skills: (parsed.skills ?? DEFAULT_SETTINGS.skills).map(migrateSkill),
      tools: (parsed.tools ?? DEFAULT_SETTINGS.tools).map(migrateTool),
      knowledgeBases: (parsed.knowledgeBases ?? []).map(migrateKnowledgeBase),
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

// --- Migration from the pre-backend scaffold (id-keyed entries) ------------

function migrateSkill(skill: Partial<Skill> & { id?: string }): Skill {
  const name =
    skill.name && SKILL_NAME_RE.test(skill.name)
      ? skill.name
      : normalizeSkillName(skill.name ?? "") || skill.id || "";
  return {
    name,
    description: skill.description ?? "",
    content: skill.content ?? "",
    files: (skill.files ?? []).map((file) => ({
      path: file.path,
      content: file.content,
    })),
    updatedAt: skill.updatedAt ?? "",
  };
}

function migrateKnowledgeBase(
  kb: Partial<KnowledgeBase> & { id?: string },
): KnowledgeBase {
  return {
    name: kb.name ?? kb.id ?? "",
    description: kb.description ?? "",
    files: (kb.files ?? []).map((file) => ({
      name: file.name,
      size: file.size,
      type: file.type,
    })),
    updatedAt: kb.updatedAt ?? "",
  };
}

function migrateTool(tool: Partial<ToolConfig> & { id?: string }): ToolConfig {
  return {
    name: tool.name ?? "",
    description: tool.description ?? "",
    transport: tool.transport ?? "streamable_http",
    url: tool.url,
    command: tool.command,
    enabled: tool.enabled ?? true,
    args: tool.args,
    headers: tool.headers,
    env: tool.env,
  };
}

export function saveSettings(settings: SettingsState) {
  try {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // storage unavailable — ignore
  }
}

export type HealthPayload = {
  model?: string;
  interrupt_on?: Record<string, unknown> | null;
  searxng?: { installed?: boolean; enabled?: boolean };
};

export async function fetchBackendHealth(): Promise<HealthPayload | null> {
  try {
    const res = await fetchWithAuth("/api/health", { cache: "no-store" });
    if (!res.ok) {
      return null;
    }
    return (await res.json()) as HealthPayload;
  } catch {
    return null;
  }
}

// --- Agent resources API (proxied to the backend /agent/* endpoints) -------

// Agent Skills spec: lowercase alphanumeric + hyphens (backend validates).
export const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// Backend file-path pattern: segments start with alnum, then [A-Za-z0-9._-].
// Rejects leading/trailing/double slashes, "..", backslashes and spaces.
export const SKILL_FILE_PATH_RE =
  /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;

export function normalizeSkillName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export type BackendSkill = {
  name: string;
  description: string;
  content: string; // full SKILL.md, frontmatter included
  path: string;
  files: { path: string; content: string }[]; // bundled files, sorted by path
};

export type BackendToolServer = {
  name: string;
  transport: string;
  url: string | null;
  command: string | null;
  args: string[];
  headers: Record<string, string>;
  env: Record<string, string>;
  enabled: boolean;
};

async function agentFetch(path: string, init?: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetchWithAuth(`/api/agent${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch {
    throw new Error("Backend unreachable.");
  }
  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { detail?: string };
      if (body.detail) {
        detail = body.detail;
      }
    } catch {
      // non-JSON error body — keep the default message
    }
    throw new Error(detail);
  }
  return res;
}

// --- skills ---

function skillPayload(skill: Skill) {
  return {
    name: skill.name,
    description: skill.description,
    content: skill.content,
    files: skill.files.map((file) => ({
      path: file.path,
      content: file.content,
    })),
  };
}

export async function fetchSkills(): Promise<BackendSkill[]> {
  const res = await agentFetch("/skills");
  return (await res.json()) as BackendSkill[];
}

export async function createSkill(skill: Skill): Promise<BackendSkill> {
  const res = await agentFetch("/skills", {
    method: "POST",
    body: JSON.stringify(skillPayload(skill)),
  });
  return (await res.json()) as BackendSkill;
}

export async function updateSkill(
  name: string,
  skill: Skill,
): Promise<BackendSkill> {
  const res = await agentFetch(`/skills/${encodeURIComponent(name)}`, {
    method: "PUT",
    body: JSON.stringify(skillPayload(skill)),
  });
  return (await res.json()) as BackendSkill;
}

export async function deleteSkill(name: string): Promise<void> {
  await agentFetch(`/skills/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
}

export async function deleteSkillFile(
  name: string,
  path: string,
): Promise<void> {
  // Encode per segment so slashes stay readable and %2F never breaks routing.
  const encodedPath = path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  await agentFetch(`/skills/${encodeURIComponent(name)}/files/${encodedPath}`, {
    method: "DELETE",
  });
}

// The backend returns SKILL.md with its frontmatter; the UI edits body and
// description separately, so strip the frontmatter on load and let the
// backend re-wrap it on save.
function parseSkillFrontmatter(content: string): {
  description: string;
  body: string;
} {
  const m = content.match(/^---\n[\s\S]*?\n---\n?\n?/);
  if (!m) {
    return { description: "", body: content };
  }
  const description = /^description:\s*(.*)$/m.exec(m[0])?.[1]?.trim() ?? "";
  return { description, body: content.slice(m[0].length) };
}

export function backendSkillToSkill(backend: BackendSkill): Skill {
  const parsed = parseSkillFrontmatter(backend.content);
  return {
    name: backend.name,
    description: backend.description || parsed.description,
    content: parsed.body,
    files: backend.files ?? [],
    updatedAt: "",
  };
}

// --- MCP tool servers ---

export function toolServerPayload(tool: ToolConfig) {
  return {
    name: tool.name,
    transport: tool.transport,
    url: tool.url ?? null,
    command: tool.command ?? null,
    args: tool.args ?? [],
    headers: tool.headers ?? {},
    env: tool.env ?? {},
    enabled: tool.enabled,
  };
}

export async function fetchToolServers(): Promise<BackendToolServer[]> {
  const res = await agentFetch("/tools");
  return (await res.json()) as BackendToolServer[];
}

export async function createToolServer(
  tool: ToolConfig,
): Promise<BackendToolServer> {
  const res = await agentFetch("/tools", {
    method: "POST",
    body: JSON.stringify(toolServerPayload(tool)),
  });
  return (await res.json()) as BackendToolServer;
}

export async function updateToolServer(
  name: string,
  tool: ToolConfig,
): Promise<BackendToolServer> {
  const res = await agentFetch(`/tools/${encodeURIComponent(name)}`, {
    method: "PUT",
    body: JSON.stringify(toolServerPayload(tool)),
  });
  return (await res.json()) as BackendToolServer;
}

export async function deleteToolServer(name: string): Promise<void> {
  await agentFetch(`/tools/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
}

export async function reconnectToolServers(): Promise<{
  connected: string[];
  tools: number;
}> {
  const res = await agentFetch("/tools/reconnect", { method: "POST" });
  return (await res.json()) as { connected: string[]; tools: number };
}

export function backendToolToToolConfig(
  backend: BackendToolServer,
  stored?: ToolConfig,
): ToolConfig {
  return {
    name: backend.name,
    // description is local-only; keep whatever the offline cache had.
    description: stored?.description ?? "",
    transport: backend.transport as ToolConfig["transport"],
    url: backend.url ?? undefined,
    command: backend.command ?? undefined,
    enabled: backend.enabled,
    args: backend.args,
    headers: backend.headers,
    env: backend.env,
  };
}

// --- knowledge bases ---

export async function fetchKnowledgeBases(): Promise<BackendKnowledgeBase[]> {
  const res = await agentFetch("/knowledge-bases");
  return (await res.json()) as BackendKnowledgeBase[];
}

export async function createKnowledgeBase(payload: {
  name: string;
  description: string;
}): Promise<BackendKnowledgeBase> {
  const res = await agentFetch("/knowledge-bases", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return (await res.json()) as BackendKnowledgeBase;
}

export async function updateKnowledgeBase(
  name: string,
  payload: { name: string; description: string },
): Promise<BackendKnowledgeBase> {
  const res = await agentFetch(`/knowledge-bases/${encodeURIComponent(name)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
  return (await res.json()) as BackendKnowledgeBase;
}

export async function deleteKnowledgeBase(name: string): Promise<void> {
  await agentFetch(`/knowledge-bases/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
}

// Multipart upload — must NOT go through agentFetch (it forces a JSON
// Content-Type which would break the boundary header). fetchWithAuth only
// injects the auth headers, so the browser sets multipart/form-data itself.
export async function uploadKnowledgeBaseFiles(
  name: string,
  files: File[],
): Promise<BackendKnowledgeBase> {
  const form = new FormData();
  for (const file of files) {
    form.append("files", file);
  }
  let res: Response;
  try {
    res = await fetchWithAuth(
      `/api/agent/knowledge-bases/${encodeURIComponent(name)}/files`,
      { method: "POST", body: form },
    );
  } catch {
    throw new Error("Backend unreachable.");
  }
  if (!res.ok) {
    let detail = `Upload failed (${res.status})`;
    try {
      const body = (await res.json()) as { detail?: string };
      if (body.detail) {
        detail = body.detail;
      }
    } catch {
      // non-JSON error body — keep the default message
    }
    throw new Error(detail);
  }
  return (await res.json()) as BackendKnowledgeBase;
}

export async function deleteKnowledgeBaseFile(
  name: string,
  fileName: string,
): Promise<void> {
  await agentFetch(
    `/knowledge-bases/${encodeURIComponent(name)}/files/${encodeURIComponent(fileName)}`,
    { method: "DELETE" },
  );
}

export function backendKnowledgeBaseToKnowledgeBase(
  backend: BackendKnowledgeBase,
): KnowledgeBase {
  return {
    name: backend.name,
    description: backend.description ?? "",
    files: backend.files ?? [],
    updatedAt: "",
  };
}
