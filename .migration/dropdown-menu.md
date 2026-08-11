# dropdown-menu

2026-08-12, golden pair (base-maia registry variant fetched by URL + user-customization replay), migrated.

## Changed

- `components/ui/dropdown-menu.tsx` — rewritten on `@base-ui/react/menu`:
  - `DropdownMenuPrimitive.*` (radix) -> `MenuPrimitive.*` (Base UI Menu); all public wrapper names (`DropdownMenu`, `DropdownMenuPortal`, `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuGroup`, `DropdownMenuLabel`, `DropdownMenuItem`, `DropdownMenuCheckboxItem`, `DropdownMenuRadioGroup`, `DropdownMenuRadioItem`, `DropdownMenuSeparator`, `DropdownMenuShortcut`, `DropdownMenuSub`, `DropdownMenuSubTrigger`, `DropdownMenuSubContent`) kept so consumer imports don't change.
  - Part renames: `Root`->`Root` (same), `Label` -> `GroupLabel`, `Sub` -> `SubmenuRoot`, `SubTrigger` -> `SubmenuTrigger`, `CheckboxItem.ItemIndicator` -> `CheckboxItemIndicator`, `RadioItem.ItemIndicator` -> `RadioItemIndicator`. Types: `React.ComponentProps<typeof X>` -> `X.Props`.
  - `Content` -> `Portal > Positioner > Popup`. Positioner gets `isolate z-50 outline-none` and the forwarded `align/alignOffset/side/sideOffset` (declared, destructured, forwarded per the Pick-means-FORWARD rule); Popup keeps `data-slot="dropdown-menu-content"` and the styled box. CSS vars renamed: `--radix-dropdown-menu-content-available-height` -> `--available-height`, `--radix-dropdown-menu-trigger-width` -> `--anchor-width`, `--radix-dropdown-menu-content-transform-origin` -> `--transform-origin`; added base logical-side slide classes (`data-[side=inline-end]` / `data-[side=inline-start]`).
  - `SubContent` composed from the public `DropdownMenuContent` wrapper (base golden shape) with the load-bearing submenu defaults `align="start" alignOffset={-3} side="right" sideOffset={0}`.
  - Import fixed: `@/registry/base-maia/lib/utils` -> `@/lib/utils`; `radix-ui` -> `@base-ui/react/menu`.
  - USER CUSTOMIZATIONS REPLAYED (all from the pre-migration local diff vs stock radix-maia):
    - lucide `CheckIcon` / `ChevronRightIcon` instead of registry `IconPlaceholder`.
    - `rounded-2xl` -> `rounded-lg` on Content and SubContent.
    - `cn-menu-target` / `cn-menu-translucent` hooks removed (project does not use registry cn-* hooks).
    - `DropdownMenuItem` keeps the user's simplified class set: `rounded-lg`, `transition-colors duration-150`, no `data-[variant=destructive]:text-destructive` / dark destructive variant / destructive svg coloring.
  - SubTrigger open styling uses Base UI's `data-popup-open:bg-accent data-popup-open:text-accent-foreground` (kept alongside `data-open:...` as in the golden).
  - Leftover scan clean: `grep -n "radix-ui\|@radix-ui\|IconPlaceholder" components/ui/dropdown-menu.tsx` -> no matches.

## Left alone

- `components/chat/sidebar-history-item.tsx` — consumer of DropdownMenu; imports unchanged (wrapper names survive). Consumer-sweep phase handles `onSelect` -> `onClick` on the item.

## Behavior changes

- FLAGGED: Radix `onSelect` (item) -> Base UI `onClick` + `closeOnClick`; consumer `sidebar-history-item.tsx` still uses `onSelect`, which no longer exists on the Base UI item — must be updated in the consumer-sweep phase (`onSelect={handleDelete}` -> `onClick={handleDelete}`).
- FLAGGED: Base UI `CheckboxItem`/`RadioItem` `closeOnClick` defaults to `false` (Radix closed the menu on select). Not patched; only relevant if checkbox/radio items are used, which they are not today.
- FLAGGED: `forceMount` -> `keepMounted`, `onEscapeKeyDown`/`onPointerDownOutside` consolidated into Root `onOpenChange` `eventDetails.reason`; not surfaced by the wrapper, so no consumer impact today.
- `data-[state=closed]:overflow-hidden` -> `data-closed:overflow-hidden` (token rename).

## Verify by hand

1. In the sidebar history, hover a chat item, click the "More" (`MoreHorizontal`) menu button: menu opens below-right, Delete item shows, click Delete -> menu closes and the delete dialog flow runs.
2. Keyboard: Tab/Arrow into the trigger, Enter opens, Arrow keys move, Enter activates Delete, Esc closes and focus returns to the trigger.
3. No console errors; menu is not clipped by the sidebar (renders in portal).
4. Hover an item: highlight follows; destructive item keeps the user's (simplified) styling.
