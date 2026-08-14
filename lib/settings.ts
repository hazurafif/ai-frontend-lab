// Settings state for the /settings page.
//
// Skills and MCP tool servers are backed by the backend's /agent/* CRUD
// endpoints (via the /api/agent proxy) — the backend persists them in the
// LangGraph store and applies them to the agent on the next run. The same
// data is also mirrored to localStorage as an offline fallback/cache, and
// the remaining settings (model, prompt, toggles) are still local-only
// until the backend /settings endpoints exist.

import { fetchWithAuth } from "@/lib/auth";
import { generateUUID } from "@/lib/utils";

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
// Contract with the backend's /kb endpoints (proxied at /api/kb, per-user
// owner-scoped auth — NOT the admin-only /agent resources):
//
//   GET    /kb                           → list the current user's KBs
//   POST   /kb                           → create { name, description }
//   GET    /kb/{id}                      → one KB
//   PATCH  /kb/{id}                      → update { name, description }
//   DELETE /kb/{id}                      → delete KB + documents + vectors
//   POST   /kb/{id}/files                → multipart upload
//                                            (FormData fields "files" and
//                                             "paths", paired by index, so
//                                             folder uploads keep structure)
//   GET    /kb/{id}/files                → list documents (ingest status)
//   GET    /kb/{id}/files/{docId}        → document detail
//   GET    /kb/{id}/files/{docId}/content → raw file bytes (inline preview)
//   DELETE /kb/{id}/files/{docId}        → delete one document
//   POST   /kb/{id}/reindex              → re-parse + re-embed all documents
//   GET    /kb/search?q=&limit=          → hybrid search across the user's KBs
//
// KBs are keyed by backend UUID (not name). Documents are ingested
// synchronously on upload: status pending → processing → ready (or failed +
// error); the upload response reports per-file results (unsupported
// extension, quota, parse errors). File *content* is never stored on the
// client — the UI keeps metadata only and uploads raw File objects.

export type KnowledgeBaseDocument = {
  id: string; // backend UUID
  path: string; // relative path, may include folders (subfolder/doc.md)
  mimeType: string | null;
  sizeBytes: number;
  status: "pending" | "processing" | "ready" | "failed";
  error: string | null;
  chunkCount: number;
};

export type KnowledgeBase = {
  id: string; // backend UUID — the key for all KB operations
  name: string; // display name (letters, digits, spaces, dots, dashes, _)
  description: string;
  documents: KnowledgeBaseDocument[];
  updatedAt: string;
};

export type BackendKnowledgeBase = {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  document_count: number;
  chunk_count: number;
};

export type BackendKnowledgeBaseDocument = {
  id: string;
  kb_id: string;
  path: string;
  mime_type: string | null;
  size_bytes: number;
  status: "pending" | "processing" | "ready" | "failed";
  error: string | null;
  chunk_count: number;
  created_at: string;
  updated_at: string;
};

export type KnowledgeBaseUploadResult = {
  path: string;
  ok: boolean;
  doc_id: string | null;
  error: string | null;
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

// Model ids before the backend's `provider:model` convention; kept so stored
// settings from older versions still resolve to a model in chatModels.
const LEGACY_MODEL_IDS: Record<string, string> = {
  "gpt-4o-mini": "openai:gpt-4o-mini",
  "gpt-4o": "openai:gpt-4o",
  "claude-3-5-sonnet-latest": "anthropic:claude-sonnet-4-5",
  "gemini-2.0-flash": "google_genai:gemini-2.5-flash",
};

export const DEFAULT_SETTINGS: SettingsState = {
  model: "openai:gpt-4o-mini",
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
      model:
        LEGACY_MODEL_IDS[parsed.model ?? ""] ??
        parsed.model ??
        DEFAULT_SETTINGS.model,
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
    id: kb.id ?? generateUUID(),
    name: kb.name ?? "",
    description: kb.description ?? "",
    documents: (kb.documents ?? []).map((doc) => ({
      id: doc.id ?? generateUUID(),
      path: doc.path,
      mimeType: doc.mimeType ?? null,
      sizeBytes: doc.sizeBytes,
      status: doc.status ?? "pending",
      error: doc.error ?? null,
      chunkCount: doc.chunkCount ?? 0,
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

// Whether the user has ever saved settings (vs. first run with defaults).
// GET /health reports the backend's own live values; those may only seed
// the first-run defaults — applying them on every load would clobber saved
// choices (model, interrupt toggle, web-search toggle) since the backend
// has no /settings endpoints yet.
export function hasStoredSettings(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    return window.localStorage.getItem(SETTINGS_STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

// Shape of GET /health (backend GET /health) — live backend state.
export type HealthPayload = {
  status?: string;
  persistence?: string;
  mcp_servers?: string[];
  model?: string;
  interrupt_on?: Record<string, unknown> | null;
  searxng?: { installed?: boolean; enabled?: boolean };
  execute?: { enabled?: boolean; max_timeout?: number };
  agent_resources?: { skills?: number; tool_servers?: number };
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

// KB display-name spec (backend KB_NAME_RE): starts alnum, then letters,
// digits, spaces, dots, dashes, underscores — max 64 chars.
export const KB_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,63}$/;

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

// JSON helper against /api/kb (per-user owner-scoped endpoints; the KB
// routes live under /kb in the backend, not under /agent).
async function kbFetch(path: string, init?: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetchWithAuth(`/api${path}`, {
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

export async function fetchKnowledgeBases(): Promise<BackendKnowledgeBase[]> {
  const res = await kbFetch("/kb");
  return (await res.json()) as BackendKnowledgeBase[];
}

export async function createKnowledgeBase(payload: {
  name: string;
  description: string;
}): Promise<BackendKnowledgeBase> {
  const res = await kbFetch("/kb", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return (await res.json()) as BackendKnowledgeBase;
}

export async function updateKnowledgeBase(
  id: string,
  payload: { name?: string; description?: string },
): Promise<BackendKnowledgeBase> {
  const res = await kbFetch(`/kb/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  return (await res.json()) as BackendKnowledgeBase;
}

export async function deleteKnowledgeBase(id: string): Promise<void> {
  await kbFetch(`/kb/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function fetchKnowledgeBaseDocuments(
  id: string,
): Promise<BackendKnowledgeBaseDocument[]> {
  const res = await kbFetch(`/kb/${encodeURIComponent(id)}/files`);
  return (await res.json()) as BackendKnowledgeBaseDocument[];
}

// Multipart upload — must NOT go through kbFetch (it forces a JSON
// Content-Type which would break the boundary header). fetchWithAuth only
// injects the auth headers, so the browser sets multipart/form-data itself.
// The optional `paths` list pairs each file with a relative path (folder
// uploads keep their structure); the response is per-file results.
export async function uploadKnowledgeBaseFiles(
  id: string,
  files: File[],
  paths?: string[],
): Promise<KnowledgeBaseUploadResult[]> {
  const form = new FormData();
  for (const file of files) {
    form.append("files", file);
  }
  for (const path of paths ?? files.map((file) => file.name)) {
    form.append("paths", path);
  }
  let res: Response;
  try {
    res = await fetchWithAuth(`/api/kb/${encodeURIComponent(id)}/files`, {
      method: "POST",
      body: form,
    });
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
  const body = (await res.json()) as { results?: KnowledgeBaseUploadResult[] };
  return body.results ?? [];
}

export async function deleteKnowledgeBaseFile(
  kbId: string,
  docId: string,
): Promise<void> {
  await kbFetch(
    `/kb/${encodeURIComponent(kbId)}/files/${encodeURIComponent(docId)}`,
    { method: "DELETE" },
  );
}

export async function reindexKnowledgeBase(id: string): Promise<void> {
  await kbFetch(`/kb/${encodeURIComponent(id)}/reindex`, { method: "POST" });
}

// Raw content download (inline preview) — link target, not a JSON call.
export function knowledgeBaseDocumentUrl(kbId: string, docId: string): string {
  return `/api/kb/${encodeURIComponent(kbId)}/files/${encodeURIComponent(docId)}/content`;
}

export function backendDocumentToKnowledgeBaseDocument(
  doc: BackendKnowledgeBaseDocument,
): KnowledgeBaseDocument {
  return {
    id: doc.id,
    path: doc.path,
    mimeType: doc.mime_type,
    sizeBytes: doc.size_bytes,
    status: doc.status,
    error: doc.error,
    chunkCount: doc.chunk_count,
  };
}

export function backendKnowledgeBaseToKnowledgeBase(
  backend: BackendKnowledgeBase,
  documents: BackendKnowledgeBaseDocument[] = [],
): KnowledgeBase {
  return {
    id: backend.id,
    name: backend.name,
    description: backend.description ?? "",
    documents: documents.map(backendDocumentToKnowledgeBaseDocument),
    updatedAt: backend.updated_at,
  };
}

// KB list + per-KB document lists in one round trip (the settings page
// shows ingest status next to every document).
export async function fetchKnowledgeBasesWithDocuments(): Promise<
  KnowledgeBase[]
> {
  const kbs = await fetchKnowledgeBases();
  const withDocs = await Promise.all(
    kbs.map(async (kb) => ({
      backend: kb,
      documents: await fetchKnowledgeBaseDocuments(kb.id),
    })),
  );
  return withDocs.map(({ backend, documents }) =>
    backendKnowledgeBaseToKnowledgeBase(backend, documents),
  );
}
