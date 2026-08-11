# sidebar

2026-08-12, golden pair via three-way merge (user file + radix-maia golden as
ancestor + base-maia golden), verdict: migrated to @base-ui/react with all
user customizations preserved.

## Changed

- `components/ui/sidebar.tsx` — radix -> base-ui rewrite via
  `git merge-file components/ui/sidebar.tsx /tmp/maia-radix/sidebar.tsx
  /tmp/base-sidebar.tsx` (radix golden as ancestor), then hand-resolved 5
  conflict hunks.
  - Imports: `Slot` from "radix-ui" removed; `@base-ui/react/merge-props`
    (`mergeProps`) and `@base-ui/react/use-render` (`useRender`) added.
    Registry golden paths (`@/registry/base-maia/...`) resolved to the
    project's `@/hooks/use-mobile`, `@/lib/utils`, `@/components/ui/*`.
  - `SidebarGroupLabel`, `SidebarGroupAction`, `SidebarMenuAction`,
    `SidebarMenuSubButton`: `asChild` + `Slot.Root` -> `useRender` +
    `mergeProps` with `state: { slot, sidebar, ... }` (data-slot/data-sidebar/
    data-size/data-active via useRender state).
  - `SidebarMenuButton`: `asChild`/Slot -> `useRender`; tooltip path now
    `render: !tooltip ? render : <TooltipTrigger render={render} />`
    (Base UI `render` prop, no more `<TooltipTrigger asChild>`).
  - `SidebarRail`, mobile `SheetContent` bottom-sheet, `PanelLeftIcon`
    trigger icon, timing/class customizations (see Behavior changes) all
    auto-merged from the user side — verified present in the result.
  - Leftover scan clean: `grep -n "radix-ui|@radix-ui|IconPlaceholder"` ->
    no matches; no `@/registry/...` paths remain; 0 conflict markers.
  - Exports unchanged (27 names incl. `useSidebar`); consumers'
    `useSidebar()` shape (`state`, `open`, `setOpen`, `isMobile`,
    `openMobile`, `setOpenMobile`, `toggleSidebar`) unchanged.
  - `npx tsc --noEmit`: no errors in sidebar.tsx.

## Left alone

- `components/ui/tooltip.tsx`, `components/ui/sheet.tsx` — migrated by a
  parallel agent; sidebar only imports their public wrappers.
- `components/chat/*` consumers — still pass `asChild`; consumer sweep is a
  later phase (they will switch `asChild` -> `render` there).
- `components/ui/command.tsx` (cmdk) — not radix, intentionally untouched.

## Behavior changes

- Tooltip open/close now goes through the base Tooltip wrapper (`render`
  trigger); hover delay follows the base tooltip wrapper's defaults.
- Mobile sidebar Sheet retains the app's bottom-sheet customization
  (`side="bottom"`, 70dvh, drag handle); SheetContent `dir`/`showCloseButton`
  props pass through as before.
- Sidebar menu-button active state still driven by `data-active` (isActive),
  same as radix; no radix-specific `data-[state]` styling was relied on.
- No other behavior deltas: keyboard shortcut (Cmd/Ctrl+B), cookie
  persistence, and rail resize affordances are unchanged.

## Verify by hand

1. Desktop: toggle sidebar (Cmd/Ctrl+B and rail button) — collapse/expand
   with the 300ms ease curve; rail hover highlight appears.
2. Hover a collapsed-sidebar menu button — tooltip shows on the right and
   hides when expanded.
3. Mobile viewport (<768px): open the sidebar — bottom sheet slides up with
   drag handle; selecting a chat closes it.
4. Active chat row shows the underline/medium style via `data-active`.
5. Delete-all dialog still opens from the sidebar footer.
