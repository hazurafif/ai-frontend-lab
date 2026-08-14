/**
 * FastMCP Prefab apps (MCP Apps extension, SEP-1865) — client-side support.
 *
 * FastMCP tools marked `app=True` return their UI as a `structuredContent`
 * envelope — a JSON component tree (`view` + initial `state` + `_meta`).
 * Through the backend's langchain MCP adapter that envelope arrives inside
 * the tool output as `artifact.structured_content` (a serialized ToolMessage).
 *
 * Rendering follows the MCP Apps extension: the official Prefab renderer
 * (pinned on jsDelivr — the same CDN loader `prefab-ui`'s
 * `get_renderer_html()` ships) is mounted in a sandboxed iframe and the
 * envelope is pushed over postMessage after an `ui/initialize` handshake.
 * See components/ai-elements/prefab-app.tsx for the host-side protocol.
 */

/**
 * Renderer version pinned to `@prefecthq/prefab-ui` on jsDelivr. Keep in
 * sync with the `prefab-ui` Python package used by the FastMCP servers.
 */
export const PREFAB_RENDERER_VERSION = "0.20.2";

/** The prefab envelope carried in a tool result's `structuredContent`. */
export type PrefabPayload = {
  /** Full envelope pushed to the renderer (`{view, state, _meta, ...}`). */
  json: Record<string, unknown>;
  /** Component tree — the only field required for a prefab payload. */
  view: unknown;
  /** Initial state values. */
  state: unknown;
  /** Routing metadata (`_meta`), e.g. `_meta.fastmcp.toolNames`. */
  meta: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Detect a FastMCP prefab UI payload inside a tool output.
 *
 * The backend relays langchain `ToolMessage`s (JSON-serialized via
 * `model_dump`), so the envelope lands at `artifact.structured_content`;
 * bare `structuredContent` / `structured_content` (raw MCP CallToolResult
 * shapes) are accepted too. A payload is only recognized when the envelope
 * actually has a `view` tree — plain text outputs are left untouched.
 */
export function extractPrefabPayload(output: unknown): PrefabPayload | null {
  if (!isRecord(output)) {
    return null;
  }
  const artifact = isRecord(output.artifact)
    ? output.artifact
    : isRecord(output.artifactJson)
      ? output.artifactJson
      : null;
  const structured =
    artifact?.structured_content ??
    artifact?.structuredContent ??
    output.structuredContent ??
    output.structured_content;
  if (!isRecord(structured) || !isRecord(structured.view)) {
    return null;
  }
  return {
    json: structured,
    view: structured.view,
    state: structured.state,
    meta: structured._meta,
  };
}

/**
 * The renderer bootstrap HTML — mirrors `prefab-ui`'s `get_renderer_html()`
 * CDN template: a tiny loader that pulls the code-split React renderer from
 * jsDelivr. The iframe gets an opaque origin via `sandbox` (no
 * `allow-same-origin`), so the app can never touch the host page.
 */
export function prefabRendererHtml(
  version: string = PREFAB_RENDERER_VERSION,
): string {
  const base = `https://cdn.jsdelivr.net/npm/@prefecthq/prefab-ui@${version}/dist/app`;
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '  <meta charset="UTF-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
    "  <title>Prefab</title>",
    `  <link rel="stylesheet" crossorigin href="${base}/renderer.css">`,
    "</head>",
    "<body>",
    '  <div id="root"></div>',
    `  <script type="module" crossorigin src="${base}/renderer.js"></script>`,
    "</body>",
    "</html>",
  ].join("\n");
}
