# select

2026-08-12, golden pair (base-maia registry variant fetched by URL + user-customization replay), migrated.

## Changed

- `components/ui/select.tsx` — rewritten on `@base-ui/react/select`:
  - `const Select = SelectPrimitive.Root` bare re-export (sidesteps the generic `Root.Props` type); all other public wrapper names (`SelectGroup`, `SelectValue`, `SelectTrigger`, `SelectContent`, `SelectLabel`, `SelectItem`, `SelectSeparator`, `SelectScrollUpButton`, `SelectScrollDownButton`) kept.
  - Part renames: `Viewport` -> `List`, `ScrollUpButton` -> `ScrollUpArrow`, `ScrollDownButton` -> `ScrollDownArrow`, `Label` -> `GroupLabel`. `ItemIndicator` moved after `ItemText` in the item anatomy (base golden shape; `ItemText` gets `flex flex-1 shrink-0 gap-2 whitespace-nowrap`).
  - `Content` -> `Portal > Positioner > Popup`. Positioner receives `side/sideOffset/align/alignOffset/alignItemWithTrigger` (declared, destructured, forwarded). Radix `position` prop dropped in favor of `alignItemWithTrigger` (default `true`). CSS vars renamed: `--radix-select-content-available-height` -> `--available-height`, `--radix-select-content-transform-origin` -> `--transform-origin`; added `w-(--anchor-width)` and base logical-side slide classes.
  - `SelectTrigger` Icon: `asChild` -> `render` (base shape).
  - Import fixed: `@/registry/base-maia/lib/utils` -> `@/lib/utils`; `radix-ui` -> `@base-ui/react/select`.
  - USER CUSTOMIZATIONS REPLAYED (from pre-migration local diff vs stock radix-maia): lucide `ChevronDownIcon`/`CheckIcon`/`ChevronUpIcon` instead of registry `IconPlaceholder`; `cn-menu-target`/`cn-menu-translucent` hooks removed from the Popup class (project does not use registry cn-* hooks). Everything else matched the golden (`rounded-2xl`, popper translate classes carried by `data-[align-trigger=true]` behavior).
  - Leftover scan clean: `grep -n "radix-ui\|@radix-ui\|IconPlaceholder" components/ui/select.tsx` -> no matches.

## Left alone

- No current app-code consumers of `Select` (verified: no imports outside `components/ui`); only the wrapper changed. The settings page uses the Base UI `Combobox` instead.

## Behavior changes

- FLAGGED: `position="item-aligned"|"popper"` (Radix) is replaced by `alignItemWithTrigger` boolean (Base UI, default `true`). No consumers today, so nothing to update, but any future call site must use the new prop.
- FLAGGED: Radix `Content` `side`/`align` defaults (`"bottom"`/`"start"`) vs Base UI (`'bottom'`/`'center'`); wrapper keeps the golden defaults (`align="center"`).
- `Value` now renders the raw value string unless `items`/`children` formatting is supplied (Base UI behavior difference vs Radix rendering `ItemText`). No consumers today.

## Verify by hand

1. Not consumed anywhere in the app today — smoke-test with a temporary page or trust the wrapper typecheck.
2. If used: trigger opens popup aligned to the item, scroll arrows appear when the list overflows, keyboard typeahead works, Esc closes.
