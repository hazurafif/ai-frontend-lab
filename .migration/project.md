# project

2026-08-12, whole-project migration radix-maia -> base-maia (CLI seed for pristine wrappers + registry golden-pair three-way merges, parallelized across worktree/multi-agent runs), migrated.

## Changed

All 18 radix wrappers migrated to `@base-ui/react`; `components.json` flipped to `base-maia`; `radix-ui` removed from package.json. Per-component reports: button, badge, label, separator, switch, scroll-area, collapsible, button-group (CLI seed, commit eea32d5), select/dropdown-menu/tabs/sidebar (agent commits 382ea84-10ae14e), dialog/alert-dialog/sheet/popover/tooltip/hover-card (commit 7d2c7be), consumer sweep (this commit).

Consumer sweep (asChild -> render; class hooks per class-mapping.md):
- `components/chat/app-sidebar.tsx` — SidebarMenuButton `render={<Link/>}` x2; collapsed-logo tooltip restructured onto SidebarMenuButton's `tooltip` prop (accepts TooltipContent props) replacing the manual Tooltip/Trigger nesting; dead Tooltip imports removed. NOTE: this file also carries the user's in-flight auth additions (useAuth logout button) interleaved in the working tree at commit time — included in this commit.
- `components/chat/multimodal-input.tsx` — ModelSelectorTrigger `render={<Button/>}` (also carries the earlier model-selector close-on-select fix).
- `components/chat/sidebar-history-item.tsx` — SidebarMenuButton + DropdownMenuTrigger `render`; trigger open classes `data-[state=open]` -> `data-popup-open`; `DropdownMenu modal={true}` kept (Base UI Menu.Root has `modal`).
- `components/ai-elements/message.tsx` — TooltipTrigger `render={button}`.
- `components/ai-elements/model-selector.tsx` — last `radix-ui` import (type-only Popover) -> `@base-ui/react/popover`.
- `components/ui/command.tsx` — CommandDialog children type narrowed to `ReactNode` (base Dialog Root's children widened to include render functions); cmdk itself untouched.

## Left alone

- cmdk (command), sonner (toast), plain-React wrappers (input, input-group, textarea, field, table, skeleton, spinner), Base UI combobox, user's new alert/card (base-flavored, non-radix), user's in-flight auth + settings WIP (app/(chat)/layout.tsx, app/layout.tsx, settings/page.tsx, hooks/use-active-chat.tsx, lib/constants.ts, lib/settings.ts, biome.jsonc, components.json touch from their shadcn add) — left uncommitted for the user.

## Behavior changes

- Base UI tab activation defaults to manual (radix default was automatic); settings tabs unaffected (click-driven).
- Base UI menu Checkbox/RadioItem default `closeOnClick` false (not used in this app).
- Popover/tooltip/hover-card now positioner-based; visually identical.
- TooltipProvider delay 0 preserved.

## Verify by hand

- `pnpm check`, `npx tsc --noEmit`, `pnpm build` all pass.
- Browser smoke: sidebar tooltips (collapsed), history-item dropdown menu delete, model selector open/close + select, settings tabs + combobox, delete-all alert dialog, theme toggle, chat send/stop.
