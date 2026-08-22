// Generates the backend system-prompt artifacts from the merged GenUI
// library that the frontend renderer uses (lib/genui-library.ts).
//
//   node scripts/tools/genui-spec.mjs
//
// Outputs into genui-spec/:
//   - system-prompt.txt    the full instruction text to inject into the
//                          backend's system prompt (paste into Python or
//                          ship as a file the backend reads)
//   - library-spec.json    the serialized library spec (prompt + schema)
//   - library-schema.json  the JSON Schema used by the parser (reference)
//
// Version discipline: the prompt MUST be regenerated whenever
// lib/genui-library.ts bumps GENUI_LIBRARY_VERSION, and the backend must
// consume the regenerated artifact — otherwise the model may emit
// components the frontend renderer doesn't know.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openuiPromptOptions } from "@openuidev/react-ui/genui-lib";
import {
  GENUI_LIBRARY_VERSION,
  mergedOpenuiLibrary,
} from "../../lib/genui-library.ts";

// App-level rules that pin the output to THIS renderer's contract
// (components/ai-elements/genui.tsx + components/chat/message.tsx):
const CHAT_APP_RULES = [
  "You are replying inside a chat conversation. Your ENTIRE response must be ONE OpenUI Lang program — no Markdown, no code fences, no explanation before or after. Anything outside the program is discarded.",
  "Start the program with a root assignment: root = Stack([...]).",
  "Balance every bracket: each ( pairs with ) and each [ pairs with ]. Unbalanced programs fail to render.",
  "Do NOT use Query(), Mutation(), or @Run(...): there is no client-side tool execution. All data must come from the conversation context and the tool results already available to you. $variables and @Set/@Reset are allowed.",
  "Wrap prose, lists and paragraphs inside TextContent or MarkDownRenderer components.",
  'Carousel takes an array of slides, each slide an array of content: carousel = Carousel([[t1, img1], [t2, img2]], "card"). Every slide must use the same component structure in the same order.',
  "For images use real, accessible URLs (e.g. https://picsum.photos/seed/KEYWORD/800/500); never invent URLs.",
  "When you call the web_search tool, surface the results as UI data (Table, ListBlock, TextContent) inside the program.",
];

const specDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "genui-spec",
);
mkdirSync(specDir, { recursive: true });

const promptText = mergedOpenuiLibrary.prompt({
  toolCalls: false, // no Query()/Mutation() — frontend has no toolProvider
  bindings: true, // $variables / @Set / @Reset are client-side safe
  examples: openuiPromptOptions.examples,
  additionalRules: CHAT_APP_RULES,
});

const spoiler = `OpenUI Lang generation instructions (library: @openuidev/react-ui@${GENUI_LIBRARY_VERSION}, merged renderer library — see lib/genui-library.ts).\n\n`;
writeFileSync(
  join(specDir, "system-prompt.txt"),
  spoiler + promptText + "\n",
  "utf8",
);
writeFileSync(
  join(specDir, "library-spec.json"),
  JSON.stringify(mergedOpenuiLibrary.toSpec(), null, 2) + "\n",
  "utf8",
);
writeFileSync(
  join(specDir, "library-schema.json"),
  JSON.stringify(mergedOpenuiLibrary.toJSONSchema(), null, 2) + "\n",
  "utf8",
);

const prompts = Object.values(mergedOpenuiLibrary.components).length;
console.log(
  `genui-spec/ written (${prompts} components, library v${GENUI_LIBRARY_VERSION})`,
);
console.log(
  `  system-prompt.txt   ${(promptText.length / 1024).toFixed(1)} KB`,
);
console.log(
  `  library-spec.json   ${(JSON.stringify(mergedOpenuiLibrary.toSpec()).length / 1024).toFixed(1)} KB`,
);
console.log(
  `  library-schema.json ${(JSON.stringify(mergedOpenuiLibrary.toJSONSchema()).length / 1024).toFixed(1)} KB`,
);
