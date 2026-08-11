# tabs

2026-08-12, golden pair (base-maia registry variant fetched by URL + user-patch replay), migrated.

## Changed

- `components/ui/tabs.tsx` — rewritten on `@base-ui/react/tabs`:
  - `TabsPrimitive.Root` -> `TabsPrimitive.Root` (same), but `React.ComponentProps<typeof TabsPrimitive.Root>` -> `TabsPrimitive.Root.Props`; `TabsPrimitive.Trigger` -> `TabsPrimitive.Tab`; `TabsPrimitive.Content` -> `TabsPrimitive.Panel`. `data-slot` names unchanged (`tabs`, `tabs-list`, `tabs-trigger`, `tabs-content`) so consumer imports and any `data-slot` CSS selectors keep working.
  - Import fixed: `@/registry/base-maia/lib/utils` -> `@/lib/utils` (project alias); `radix-ui` -> `@base-ui/react/tabs`.
  - USER PATCH PORTED: the local patch that sets `data-horizontal` / `data-vertical` on the Root is kept (Base UI also only sets `data-orientation`, so the `group-data-horizontal/tabs:*` and `data-horizontal:flex-col` styles would be dead without it). Lines ~12-15.
  - USER PATCH DROPPED: the local `data-[state=active]:...` trigger styles are replaced by the base golden's `data-active:...` (Base UI Tab sets `data-active` natively); the `group-data-[variant=line]/tabs-list:data-[state=active]:after:opacity-100` becomes `...:data-active:after:opacity-100`. The active underline (`after:absolute after:bg-foreground ...`) keeps working in both orientations via the ported `data-horizontal`/`data-vertical` Root attributes.
  - Base golden's `aria-disabled:*` trigger classes kept (Base UI tabs surface disabled via `aria-disabled`).
  - Leftover scan clean: `grep -n "radix-ui\|@radix-ui\|IconPlaceholder" components/ui/tabs.tsx` -> no matches.

## Left alone

- `components/ui/command.tsx` — cmdk, intentionally untouched (not radix).
- `app/(chat)/settings/page.tsx` — consumer of Tabs; imports unchanged (wrapper names survive). Consumer-sweep phase handles any remaining `asChild`/prop renames.

## Behavior changes

- FLAGGED: Base UI tabs default to MANUAL activation (Radix default was automatic). The base registry accepts this default (no `activateOnFocus` added), so it is flagged, not patched.
- FLAGGED: Radix `activationMode` prop is dropped; Base UI moves this to `List.activateOnFocus`. No current consumer uses it.

## Verify by hand

1. Open `/settings`: the vertical tab list (General | Model | Skills | Tools) still switches panels, active tab is highlighted.
2. Horizontal usage (none today, but check any `TabsList variant="line"`): underline appears under the active tab and follows orientation.
3. Keyboard: focus a tab, arrow-key between tabs, Enter activates; disabled tabs skip.
4. Resize / no console warnings about missing `data-horizontal`.
