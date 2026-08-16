"use client";

// Settings > Permissions (admin-only — the page only mounts this tab for
// admins). The tab is organized as titled sections, one per permission
// area (model access today; tools, knowledge, skills later), so new
// permissions can be added without reshuffling the existing layout.
// The backend has no further permission-management API yet — the global
// model allowlist is the only live permission today.

import { ListChecksIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
function PermissionSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-base font-semibold">{title}</h2>
        {description && (
          <p className="text-[13px] text-muted-foreground">{description}</p>
        )}
      </div>
      {children}
    </section>
  );
}

export function PermissionsTab() {
  // The global allowlist (admin-managed, role-based): which models
  // user-role accounts may use; null = not loaded (backend offline).
  const [allowlist, setAllowlist] = useState<AllowedModels | null>(null);
  // Allowlist editor: checked model ids (null = dialog closed).
  const [allowlistDraft, setAllowlistDraft] = useState<string[] | null>(null);
  const [savingAllowlist, setSavingAllowlist] = useState(false);
  // Live model catalog (admin view): every saved llm connection's model
  // list, with per-source error reporting.
  const { sources } = useModelCatalog();

  // Options of the allowlist editor: every discovered model id (from all
  // saved connections) plus the currently-allowed ids that are no longer in
  // the catalog, so saving never silently drops them.
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

  // Fetch the allowlist on mount. The editor below is the only thing that
  // mutates it; useModelCatalog refetches the catalog on the
  // settings-changed event, which rebuilds the editor options.
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

  const refreshAllowlist = async () => {
    try {
      setAllowlist(await fetchAllowedModels());
    } catch {
      // Backend offline — keep the cached list.
    }
  };

  const openAllowlistEditor = () => {
    setAllowlistDraft([...(allowlist?.models ?? [])]);
  };

  const saveAllowlist = async () => {
    if (!allowlistDraft) {
      return;
    }
    setSavingAllowlist(true);
    try {
      const next = await updateAllowedModels(allowlistDraft);
      setAllowlist(next);
      setAllowlistDraft(null);
      toast.success(
        next.models.length === 0
          ? "Allowlist saved — user accounts can no longer pick models"
          : `Allowlist saved — ${next.models.length} model(s) allowed for user accounts`,
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to save the allowlist",
      );
    } finally {
      setSavingAllowlist(false);
    }
  };

  const removeAllowlist = async () => {
    try {
      await clearAllowedModels();
      await refreshAllowlist();
      toast.success("Restriction removed — every model is allowed again");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to remove the restriction",
      );
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PermissionSection
        title="Model"
        description="Which models user-role accounts may use. Admins are never restricted."
      >
        <Card className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm font-medium">Allowed models</span>
            {allowlist?.restricted ? (
              <Badge>{allowlist.models.length} allowed</Badge>
            ) : (
              <Badge variant="outline">Unrestricted</Badge>
            )}
          </div>
          {allowlist === null ? (
            <p className="text-[13px] text-muted-foreground">
              Loading allowlist…
            </p>
          ) : allowlist.restricted ? (
            <>
              <div className="flex flex-wrap gap-1.5">
                {allowlist.models.length === 0 ? (
                  <span className="text-[13px] text-destructive">
                    Allow at least one model so users can chat.
                  </span>
                ) : (
                  allowlist.models.map((id) => (
                    <Badge className="font-mono" key={id} variant="secondary">
                      {id}
                    </Badge>
                  ))
                )}
              </div>
              <div className="flex items-center gap-3">
                <Button
                  onClick={openAllowlistEditor}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  Edit allowlist
                </Button>
                <Button
                  onClick={removeAllowlist}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  Remove restriction
                </Button>
              </div>
            </>
          ) : (
            <div className="flex items-center gap-3">
              <Button
                onClick={openAllowlistEditor}
                size="sm"
                type="button"
                variant="secondary"
              >
                <ListChecksIcon data-icon="inline-start" />
                Restrict models…
              </Button>
            </div>
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

      <Dialog
        open={allowlistDraft !== null}
        onOpenChange={(open) => {
          if (!open) {
            setAllowlistDraft(null);
          }
        }}
      >
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Allowed models</DialogTitle>
          </DialogHeader>
          <p className="text-[13px] text-muted-foreground">
            Models user-role accounts may use (empty selection = allow none).
          </p>
          {allowlistOptions.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">
              No llm connections with models yet.
            </p>
          ) : (
            <div className="flex max-h-72 flex-col gap-0.5 overflow-y-auto rounded-md border p-2">
              {allowlistOptions.map((option) => (
                <div
                  className="flex items-center gap-2.5 rounded px-2 py-1.5 hover:bg-muted"
                  key={option.id}
                >
                  <Checkbox
                    aria-label={`Allow ${option.id}`}
                    checked={allowlistDraft?.includes(option.id) ?? false}
                    onCheckedChange={(checked) =>
                      setAllowlistDraft((current) => {
                        const next = new Set(current ?? []);
                        if (checked) {
                          next.add(option.id);
                        } else {
                          next.delete(option.id);
                        }
                        return [...next];
                      })
                    }
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-[13px]">
                      {option.id}
                    </span>
                    <span className="block truncate text-[12px] text-muted-foreground">
                      via {option.source}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button
              onClick={() => setAllowlistDraft(null)}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              disabled={savingAllowlist}
              onClick={saveAllowlist}
              type="button"
            >
              {savingAllowlist ? "Saving…" : "Save allowlist"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
