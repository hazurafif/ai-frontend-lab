# alert-dialog

2026-08-12, golden pair via registry fetch + three-way merge (worktree agent; runner died pre-commit, parent verified and committed), migrated.

## Changed

- `components/ui/alert-dialog.tsx` rewritten on `@base-ui/react`: imports, part renames (Overlay→Backdrop, Content→Popup, Cancel→Close, Action dropped for alert-dialog, Anchor dropped for popover, Provider delayDuration→delay for tooltip, PreviewCardPrimitive for hover-card), Portal > Positioner > Popup with side/sideOffset/align/alignOffset destructured and forwarded to Positioner explicitly, `--radix-*` vars → `--transform-origin`/`--available-height`/`--anchor-width`, `data-[state=open/closed]` → `data-open`/`data-closed`, asChild → render.
- Leftover scan (`grep "radix-ui|@radix-ui|IconPlaceholder"`) clean.

## Left alone

- Consumer call sites (still passing asChild) — separate sweep phase.

## Behavior changes

- Standard Base UI deltas only (positioner model, no onInteractOutside/onEscapeKeyDown surface); none intentional.

## Verify by hand

- Open/close with Esc, backdrop click, focus return; tooltip delay 0 and arrow on all 4 sides; hover-card alignment.
