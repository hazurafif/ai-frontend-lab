// Settings state for the /settings page.
//
// Skills and MCP tool servers are backed by the backend's /agent/* CRUD
// endpoints (via the /api/agent proxy) — the backend persists them in the
// LangGraph store and applies them to the agent on the next run. The same
// data is also mirrored to localStorage as an offline fallback/cache, and
// the remaining settings (model, prompt, toggles) are still local-only
// until the backend /settings endpoints exist.

export type Skill = {
  // Backend key: lowercase alphanumeric + hyphens (Agent Skills spec).
  name: string;
  description: string;
  content: string;
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

export type SettingsState = {
  model: string;
  systemPrompt: string;
  interruptOn: boolean;
  searxngEnabled: boolean;
  skills: Skill[];
  tools: ToolConfig[];
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
    updatedAt: skill.updatedAt ?? "",
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
    const res = await fetch("/api/health", { cache: "no-store" });
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
    res = await fetch(`/api/agent${path}`, {
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
