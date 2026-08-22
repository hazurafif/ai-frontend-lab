// Settings > Permissions (admin-only — the page only mounts this tab for
// admins). The tab is organized as titled sections, one per permission
// area (model access today; tools, knowledge, skills later), so new
// permissions can be added without reshuffling the existing layout.
// The backend has no further permission-management API yet — the global
// model allowlist is the only live permission today.

import { ShieldCheckIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/hooks/use-auth";
import { useModelCatalog } from "@/hooks/use-available-models";
import {
  type AllowedModels,
  clearAllowedModels,
  fetchAllowedModels,
  updateAllowedModels,
} from "@/lib/settings";
import { cn } from "@/lib/utils";

// Same card style as the settings page's local Card.
function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-border/60 bg-card p-4 shadow-[var(--shadow-card)] md:p-5",
        className,
      )}
      {...props}
    />
  );
}

// One permission area on the tab: a titled section holding its card(s).
// New permissions (tools, knowledge, skills…) each get their own section.
// `aside` is an optional slot on the title row (e.g. the caller's role).
function PermissionSection({
  title,
  description,
  aside,
  children,
}: {
  title: string;
  description?: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-base font-semibold">{title}</h2>
          {description && (
            <p className="text-[13px] text-muted-foreground">{description}</p>
          )}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function PermissionsTab() {
  // The signed-in role — the allowlist applies to `user` accounts and
  // Admins are never restricted, so surface it next to the section title.
  const { user } = useAuth();
  // The global allowlist (admin-managed, role-based): which models
  // user-role accounts may use; null = not loaded (backend offline).
  const [allowlist, setAllowlist] = useState<AllowedModels | null>(null);
  // True while a switch's save is in flight — disables every switch so
  // toggles can't race each other.
  const [saving, setSaving] = useState(false);
  // Live model catalog (admin view): every saved llm connection's model
  // list, with per-source error reporting.
  const { sources } = useModelCatalog();

  // Every known model id (from all saved connections) plus the
  // currently-allowed ids that are no longer in the catalog, so a stale
  // allowlist entry stays visible (and can be switched off) instead of
  // silently disappearing.
  const allowlistOptions: Array<{ id: string; source: string }> =
    useMemo(() => {
      const options: Array<{ id: string; source: string }> = [];
      const seen = new Set<string>();
      for (const source of sources ?? []) {
        const prefix = source.base_url?.includes(
          "generativelanguage.googleapis.com",
        )
          ? "google_genai"
          : "openai";
        for (const model of source.models) {
          const id = `${prefix}:${model.id}`;
          if (seen.has(id)) {
            continue;
          }
          seen.add(id);
          options.push({ id, source: source.connection });
        }
      }
      for (const id of allowlist?.models ?? []) {
        if (!seen.has(id)) {
          seen.add(id);
          options.push({ id, source: "allowed — not in the current catalog" });
        }
      }
      return options;
    }, [allowlist, sources]);

  // Fetch the allowlist on mount. The row switches below are the only
  // thing that mutates it; useModelCatalog refetches the catalog on the
  // settings-changed event, which rebuilds the rows.
  useEffect(() => {
    let cancelled = false;
    fetchAllowedModels()
      .then((next) => {
        if (!cancelled) {
          setAllowlist(next);
        }
      })
      .catch(() => {
        // Backend offline — leave the list empty.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Flip one model's switch. With no restriction the effective allowed set
  // is the whole catalog — turning the first one OFF starts the restriction
  // (allowlist = catalog minus that id, the same pattern as the Model tab's
  // per-user switches). Turning the last restricted model back ON lifts the
  // restriction again once every catalog model is covered. Saves
  // optimistically and reverts on failure.
  const toggleModelAllowed = async (id: string, enabled: boolean) => {
    if (!allowlist || saving) {
      return;
    }
    const previous = allowlist;
    const catalog = allowlistOptions.map((option) => option.id);
    const baseAllowed = previous.restricted ? previous.models : catalog;
    const next = enabled
      ? [...baseAllowed, id]
      : baseAllowed.filter((x) => x !== id);
    // All catalog models covered → no restriction actually applies; clear
    // it so the badge goes back to Unrestricted.
    const coversAll =
      catalog.length > 0 && catalog.every((model) => next.includes(model));
    setSaving(true);
    setAllowlist({ restricted: !coversAll, models: next });
    try {
      if (coversAll) {
        await clearAllowedModels();
        toast.success("Restriction removed — every model is allowed again");
      } else {
        setAllowlist(await updateAllowedModels(next));
        toast.success(
          next.length === 0
            ? "No models are allowed for user accounts"
            : `Allowlist saved — ${next.length} model(s) allowed for user accounts`,
        );
      }
    } catch (error) {
      setAllowlist(previous);
      toast.error(
        error instanceof Error ? error.message : "Failed to save the allowlist",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PermissionSection
        aside={
          <Badge className="gap-1" variant="secondary">
            <ShieldCheckIcon className="size-3" />
            {user?.role ?? "user"}
          </Badge>
        }
        title="Model"
        description="Which models user-role accounts may use. Admins are never restricted."
      >
        <Card className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm font-medium">Allowed models</span>
            {allowlist !== null && (
              <Badge variant={allowlist.restricted ? "default" : "outline"}>
                {allowlist.restricted
                  ? `${allowlist.models.length} allowed`
                  : "Unrestricted"}
              </Badge>
            )}
          </div>
          {allowlist === null ? (
            <p className="text-[13px] text-muted-foreground">
              Loading allowlist…
            </p>
          ) : allowlistOptions.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">
              No llm connections with models yet.
            </p>
          ) : (
            <>
              {/* Every discovered model with its own switch: ON = allowed
                  for user accounts. Unrestricted shows all ON; switching
                  the first one OFF activates the restriction. */}
              <div className="flex max-h-72 flex-col overflow-y-auto rounded-md border border-border/60">
                {allowlistOptions.map((option) => {
                  const isAllowed =
                    !allowlist.restricted ||
                    allowlist.models.includes(option.id);
                  return (
                    <div
                      className="flex items-center justify-between gap-3 border-b border-border/60 px-3 py-2 last:border-b-0"
                      key={option.id}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-mono text-[13px]">
                          {option.id}
                        </span>
                        <span className="block truncate text-[12px] text-muted-foreground">
                          via {option.source}
                        </span>
                      </span>
                      <Switch
                        aria-label={`Allow ${option.id}`}
                        checked={isAllowed}
                        disabled={saving}
                        onCheckedChange={(checked) =>
                          toggleModelAllowed(option.id, checked)
                        }
                      />
                    </div>
                  );
                })}
              </div>
              {allowlist.restricted && allowlist.models.length === 0 && (
                <p className="text-[13px] text-destructive">
                  Allow at least one model so users can chat.
                </p>
              )}
            </>
          )}
          {sources?.some((source) => source.error) && (
            <div className="flex flex-col gap-1">
              {sources
                .filter((source) => source.error)
                .map((source) => (
                  <span
                    className="flex items-center gap-1.5 text-[12px] text-muted-foreground"
                    key={source.connection}
                  >
                    <TriangleAlertIcon className="size-3.5 shrink-0" />
                    <span className="truncate font-mono">
                      {source.connection}
                    </span>
                    : {source.error}
                  </span>
                ))}
            </div>
          )}
        </Card>
      </PermissionSection>
    </div>
  );
}
