"use client";

/**
 * OpenUI (GenUI) rendering for assistant messages.
 *
 * The backend's system prompt instructs the model to respond in OpenUI Lang
 * (a compact, streaming-first UI language) instead of plain markdown. This
 * component turns that streamed text into interactive UI via the official
 * React runtime (`Renderer` + a merged component library built from the
 * official general-purpose `openuiLibrary` and chat-optimised
 * `openuiChatLibrary`).
 *
 * Decision logic (kept heuristic so the renderer never flashes):
 * - Assistant text that *starts* like an OpenUI Lang statement
 *   (`name = ...` or `$var = ...`) is routed into the Renderer, streaming
 *   or not. Plain prose never matches, so legacy markdown answers (old
 *   history, models/prompts that ignore the GenUI instruction) keep the
 *   existing Streamdown pipeline untouched.
 * - Fenced ```openui blocks (```openui\nroot = ...\n```) are also treated
 *   as GenUI intent: the fence is stripped and the inner program rendered.
 *   This doubles as the fix for Shiki choking on the unknown `openui`
 *   language in the markdown path (see TextPart's fence demotion).
 * - If the stream settles and the text never parsed into a root element
 *   (e.g. a broken / partial GenUI response), we fall back to the markdown
 *   rendering instead of leaving a silent hole in the conversation.
 * - Buttons wired to `@ToAssistant("...")` send that text back into the
 *   chat as a user message; `@OpenUrl("...")` opens the URL in a new tab.
 */
import {
  BuiltinActionType,
  Renderer,
} from "@openuidev/react-lang";
import type { ActionEvent, ParseResult } from "@openuidev/react-lang";
import { ThemeProvider as OpenUIThemeProvider } from "@openuidev/react-ui";
import { useTheme } from "next-themes";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useActiveChat } from "@/hooks/use-active-chat";
import { mergedOpenuiLibrary } from "@/lib/genui-library";

/** First non-whitespace token must look like an OpenUI Lang statement:
 * `root = ...`, `$title = "..."`, `header = CardHeader("...")`. */
const OPENUI_STATEMENT = /^\s*[A-Za-z_$][\w$]*\s*=/;

/** A CLOSED fenced ```openui code block (GFM fence, optional attrs). */
const OPENUI_FENCE = /```openui\b[^\n]*\n([\s\S]*?)\n?```/;

/**
 * An OPENING ```openui fence whose language token may be INCOMPLETE
 * (streaming chunk boundaries produce ```o, ```op, ```open, ```openui …)
 * and whose body is still growing. Captures everything after the fence
 * line. Checked after OPENUI_FENCE (closed form wins).
 */
const OPENUI_FENCE_OPEN =
  /```o(?:p(?:e(?:n(?:u(?:i)?)?)?)?)?[^\n]*\n?([\s\S]*)$/;

/**
 * The Lang program to render: the first COMPLETE ```openui block when the
 * response has one (fence markers are markdown, not Lang); otherwise, once
 * any ```open… fence has started streaming, everything after it (growing)
 * — so fenced output renders progressively while it streams. Null when no
 * fence is present at all (statement-style output uses the raw text).
 */
function extractFencedProgram(text: string): string | null {
  const closed = text.match(OPENUI_FENCE);
  if (closed) {
    return closed[1].trim();
  }
  const open = text.match(OPENUI_FENCE_OPEN);
  return open ? open[1] : null;
}

export function GenUIContent({
  fallback,
  isStreaming,
  text,
}: {
  fallback: ReactNode;
  isStreaming: boolean;
  text: string;
}) {
  const { sendMessage, status } = useActiveChat();
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);

  // The openui stylesheet only follows `prefers-color-scheme` — the app's
  // theme is a `.dark` class (next-themes). Mounting their ThemeProvider
  // with the resolved app mode injects the matching `--openui-*` tokens on
  // body, so GenUI follows the app toggle instead of the OS setting.
  const { resolvedTheme } = useTheme();
  const openuiMode = resolvedTheme === "dark" ? "dark" : "light";

  // Fenced ```openui blocks are GenUI intent: extract the inner program
  // (the fence markers are markdown, not Lang). An open ```open… fence
  // (partial language token, growing body — i.e. still streaming) routes
  // the growing program to the Renderer too, so fenced output renders
  // progressively instead of flashing the prose/markdown fallback (which
  // would also hand partial tokens like ```open to Shiki). Statement-style
  // output (no fence) uses the raw text.
  const fencedProgram = useMemo(() => extractFencedProgram(text), [text]);
  const program = fencedProgram ?? text;
  const looksLikeOpenUI =
    fencedProgram !== null || OPENUI_STATEMENT.test(program);

  const handleAction = useCallback(
    (event: ActionEvent) => {
      if (
        event.type === BuiltinActionType.ContinueConversation &&
        event.humanFriendlyMessage
      ) {
        // Follow-up / regenerate buttons on generated UI: send the text as
        // a new user message (same shape as Edit).
        if (status === "ready") {
          sendMessage({
            parts: [{ text: event.humanFriendlyMessage, type: "text" }],
            role: "user",
          });
        }
        return;
      }
      if (
        event.type === BuiltinActionType.OpenUrl &&
        event.params?.url &&
        typeof event.params.url === "string"
      ) {
        window.open(event.params.url, "_blank", "noopener,noreferrer");
      }
    },
    [sendMessage, status],
  );

  // Stream settled on text that never produced a parseable program → show
  // the markdown fallback (raw Lang markup or prose) rather than nothing.
  const failedToParse =
    parseResult !== null &&
    !isStreaming &&
    parseResult.root === null &&
    !parseResult.meta.incomplete &&
    program.trim().length > 0;

  if (!looksLikeOpenUI || failedToParse) {
    return <>{fallback}</>;
  }

  return (
    <OpenUIThemeProvider mode={openuiMode}>
      <Renderer
        isStreaming={isStreaming}
        library={mergedOpenuiLibrary}
        onAction={handleAction}
        onParseResult={setParseResult}
        response={program}
      />
    </OpenUIThemeProvider>
  );
}