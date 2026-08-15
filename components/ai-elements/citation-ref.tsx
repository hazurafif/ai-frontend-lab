"use client";

import type { ReactNode } from "react";
import type { ChatMessage } from "@/lib/types";
import {
  InlineCitation,
  InlineCitationCard,
  InlineCitationCardBody,
  InlineCitationCardTrigger,
  InlineCitationSource,
} from "./inline-citation";

/**
 * Inline citations for web-search answers.
 *
 * The backend's `web_search` tool (SearXNG) numbers its results
 * (`1. [title](url)`) and the system prompt tells the model to cite claims
 * with `[n]` markers. On this side we:
 *
 * 1. Extract the source list from the `tool-web_search` output parts
 *    (`extractSearchSources`) — the markdown links inside the tool output.
 * 2. Rewrite `[n]` markers in the answer text to a custom HTML element
 *    (`embedCitationMarkers`) that Streamdown renders through our
 *    `components` map as a hover badge (`CitationRef`), so markdown around
 *    the marker (bold, lists, links) stays intact.
 *
 * Streamdown quirks this works around:
 * - Streamdown only accepts a plain string child, so badges can't be
 *   interleaved as React nodes.
 * - Raw HTML is parsed (rehype-raw) and sanitized; a tag survives only if
 *   listed in `allowedTags`, and `data-*` attributes need the special
 *   `data*` entry (hast-util-sanitize treats them separately).
 * - rehype-raw camelCases the attribute: `<cite-ref data-n="1"/>` arrives
 *   with `data-n` (in props) / `dataN` (in `node.properties`).
 */

export type SearchSource = {
  title: string;
  url: string;
  description?: string;
};

/** The custom element Streamdown renders via `components`. */
const SOURCE_TAG = "cite-ref";

/** `[n]` citation markers, as the backend prompt tells the model to emit. */
const MARKER_RE = /\[(\d+)\]/g;

/** Markdown result line emitted by the backend's searxng tool. */
const RESULT_LINE_RE = /^\s*\d+\.\s+\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)(.*)$/;

/**
 * Langchain serializes tool outputs as `{content, type, ...}` — unwrap the
 * content before parsing.
 */
function unwrapOutput(output: unknown): unknown {
  if (output && typeof output === "object" && "content" in output) {
    return (output as { content?: unknown }).content;
  }
  return output;
}

/** Parse the tool's numbered markdown list into sources. */
export function parseSearchSources(markdown: string): SearchSource[] {
  const sources: SearchSource[] = [];
  let current: SearchSource | null = null;
  for (const line of markdown.split("\n")) {
    const match = RESULT_LINE_RE.exec(line);
    if (match) {
      current = { title: match[1], url: match[2] };
      sources.push(current);
      continue;
    }
    // Indented continuation lines (the result snippet) become the
    // hover-card description.
    if (current && /^\s{2,}\S/.test(line)) {
      current.description = [current.description, line.trim()]
        .filter(Boolean)
        .join(" ");
    }
  }
  return sources;
}

/** Collect sources from every `web_search` tool part of a message. */
export function extractSearchSources(message: ChatMessage): SearchSource[] {
  const sources: SearchSource[] = [];
  for (const part of message.parts ?? []) {
    if (part.type !== "tool-web_search") {
      continue;
    }
    const output = unwrapOutput((part as { output?: unknown }).output);
    if (typeof output === "string") {
      sources.push(...parseSearchSources(output));
    }
  }
  return sources;
}

/**
 * Replace `[n]` markers with `<cite-ref data-n="n"/>` outside code fences,
 * inline code spans, and link destinations (where the marker is a literal
 * part of a URL or an actual markdown link the model wrote).
 */
export function embedCitationMarkers(text: string): string {
  const lines = text.split("\n");
  let inFence = false;
  const out: string[] = [];
  for (const line of lines) {
    if (/^\s*(`{3,}|~{3,})/.test(line)) {
      inFence = !inFence;
      out.push(line);
      continue;
    }
    out.push(inFence ? line : replaceMarkersInLine(line));
  }
  return out.join("\n");
}

function replaceMarkersInLine(line: string): string {
  // Mask inline code spans so markers inside them are not rewritten.
  const spans: string[] = [];
  const masked = line.replace(/`[^`]*`/g, (span) => {
    spans.push(span);
    return `\u0000${spans.length - 1}\u0000`;
  });
  const replaced = masked.replace(MARKER_RE, (marker, n: string, offset: number) => {
    const before = offset > 0 ? masked[offset - 1] : "";
    const after = masked[offset + marker.length] ?? "";
    // Inside a link destination `](...)` or a shortcut reference `[1](url)`.
    if (before === "(" || after === "(") {
      return marker;
    }
    return `<${SOURCE_TAG} data-n="${n}"/>`;
  });
  return replaced.replace(/\u0000(\d+)\u0000/g, (_, index: string) => {
    return spans[Number(index)] ?? "";
  });
}

/**
 * Streamdown props that render `[n]` markers as citation badges resolved
 * against the message's sources. Pass the result to `<MessageResponse>`.
 */
export function citationStreamdownProps(sources: SearchSource[]) {
  function CitationRef(props: {
    "data-n"?: string;
    children?: ReactNode;
    node?: unknown;
  }) {
    return <CitationBadge marker={props["data-n"] ?? ""} source={sources[Number(props["data-n"]) - 1]} />;
  }
  return {
    allowedTags: { [SOURCE_TAG]: ["data*"] },
    components: { [SOURCE_TAG]: CitationRef },
  };
}

/** The hover badge for one `[n]` marker; plain text when no source matches. */
function CitationBadge({ marker, source }: { marker: string; source?: SearchSource }) {
  let url: string | undefined;
  try {
    url = source ? new URL(source.url).toString() : undefined;
  } catch {
    url = undefined;
  }
  if (!url) {
    return <span className="whitespace-nowrap">[{marker}]</span>;
  }
  return (
    <InlineCitation>
      <InlineCitationCard>
        {/* The pill is a link: click opens the source in a new tab. Hover
            still shows the metadata card. */}
        <InlineCitationCardTrigger href={url} sources={[url]} />
        <InlineCitationCardBody>
          <div className="flex flex-col gap-3 p-3">
            <InlineCitationSource
              description={source?.description}
              title={source?.title}
              url={url}
            />
          </div>
        </InlineCitationCardBody>
      </InlineCitationCard>
    </InlineCitation>
  );
}
