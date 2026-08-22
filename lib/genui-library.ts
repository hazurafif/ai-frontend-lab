/**
 * The merged OpenUI component library used by BOTH the chat renderer
 * (`components/ai-elements/genui.tsx`) and the spec/prompt generator
 * (`scripts/tools/genui-spec.mjs`).
 *
 * Composition: general-purpose `openuiLibrary` (Stack, Modal, Carousel …
 * — needed for full-page programs like `root = Stack([...])`) PLUS the
 * chat-only blocks from `openuiChatLibrary` (FollowUpBlock, ListBlock,
 * SectionBlock …). Shared names prefer the general-purpose definitions
 * (more permissive schemas). Within a shared `createLibrary` calls the
 * zod registry sees the same definitions and `toJSONSchema()` stays
 * consistent for the parser.
 *
 * Version pin: `@openuidev/react-ui@0.13.8`. The backend system prompt
 * MUST be generated against this same library (see scripts/tools/
 * genui-spec.mjs) or the model may emit components this renderer doesn't
 * know. Bump the pin here and re-run the generator whenever the renderer
 * library changes.
 */
import { createLibrary } from "@openuidev/react-lang";
import {
  openuiChatLibrary,
  openuiLibrary,
} from "@openuidev/react-ui/genui-lib";

export const GENUI_LIBRARY_VERSION = "0.13.8";

export const mergedOpenuiLibrary = createLibrary({
  root: "Stack",
  components: [
    ...Object.values(openuiLibrary.components),
    ...Object.keys(openuiChatLibrary.components)
      .filter((name) => !Object.hasOwn(openuiLibrary.components, name))
      .map((name) => openuiChatLibrary.components[name]),
  ],
  componentGroups: (openuiChatLibrary.componentGroups ?? []).concat(
    openuiLibrary.componentGroups ?? [],
  ),
});
