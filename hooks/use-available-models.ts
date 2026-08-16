"use client";

import { useEffect, useState } from "react";
import { fetchWithAuth } from "@/lib/auth";
import { SETTINGS_CHANGED_EVENT } from "@/lib/constants";
import { type ChatModel, chatModelsFromSource } from "@/lib/models";
import {
  type AllowedModels,
  type BackendModelsSource,
  fetchConnectionModels,
  fetchMyAllowedModels,
  loadSettings,
} from "@/lib/settings";

// Provider prefix per source: picker ids follow the backend's
// `provider:model` convention (agent configs + the model allowlist match on
// them). Every OpenAI-compatible endpoint is reachable with the `openai:`
// prefix; Gemini's OpenAI-compatibility layer keeps the `google_genai:`
// convention.
function providerPrefixForSource(source: BackendModelsSource): string {
  return source.base_url?.includes("generativelanguage.googleapis.com")
    ? "google_genai"
    : "openai";
}

// Flattens the backend's aggregated per-connection model lists (GET
// /connections/models) into picker entries. Ids are deduped (first source
// wins); failing sources contribute nothing — their `error` is surfaced in
// the settings UI, not here. Known ids (in the built-in list) keep their
// friendly display name so the trigger and the dropdown always agree;
// unknown models show their raw id.
export function chatModelsFromSources(
  sources: BackendModelsSource[],
): ChatModel[] {
  const seen = new Set<string>();
  const models: ChatModel[] = [];
  for (const source of sources) {
    const prefix = providerPrefixForSource(source);
    for (const model of source.models) {
      const id = `${prefix}:${model.id}`;
      if (seen.has(id)) {
        continue;
      }
      seen.add(id);
      models.push({
        id,
        name: model.id,
        description: `Available via ${source.connection}`,
      });
    }
  }
  return models;
}

// The live model catalog for the model selectors, following the backend's
// new flow:
//
//   1. GET /api/connections/models — every saved `llm` connection's model
//      list, aggregated server-side with per-source error reporting
//      (admin-only endpoint; non-admins get 403 and fall back).
//   2. Fallback (non-admins / older backend): the legacy /api/models flow —
//      POST the saved modelConnection, or GET the server-configured source.
//   3. GET /api/auth/users/me/allowed-models — the caller's effective
//      restriction filters the picker when set (admins never restricted).
//
// `models` is null while loading or when no live source is reachable —
// the pickers then show an empty list (never built-in presets). Refetches
// whenever settings change (SETTINGS_CHANGED_EVENT), e.g. right after
// saving a connection or editing the allowlist.
export function useModelCatalog(): {
  models: ChatModel[] | null;
  // Aggregated per-connection sources (admin view; null for non-admins or
  // when the fallback flow was used).
  sources: BackendModelsSource[] | null;
  // The caller's effective restriction (role-aware), or null when unknown.
  allowed: AllowedModels | null;
} {
  const [models, setModels] = useState<ChatModel[] | null>(null);
  const [sources, setSources] = useState<BackendModelsSource[] | null>(null);
  const [allowed, setAllowed] = useState<AllowedModels | null>(null);
  // Bumped by the settings-changed event so a saved connection re-triggers
  // the fetch without re-mounting the hook.
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const handleSettingsChanged = () => {
      setRevision((current) => current + 1);
    };
    window.addEventListener(SETTINGS_CHANGED_EVENT, handleSettingsChanged);
    return () => {
      window.removeEventListener(SETTINGS_CHANGED_EVENT, handleSettingsChanged);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const applyRestriction = (
      fetched: ChatModel[] | null,
      restriction: AllowedModels | null,
    ) => {
      if (cancelled) {
        return;
      }
      setAllowed(restriction);
      if (!restriction?.restricted) {
        setModels(fetched);
        return;
      }
      // The aggregated catalog is admin-only: non-admins fall back to the
      // legacy source (or nothing). Either way the picker must only show
      // what the account may actually use — restrict the fetched list and
      // surface any allowed ids the list does not cover (their real ids
      // are the contract the allowlist + chat enforcement match on).
      const allowedIds = new Set(restriction.models);
      const base = (fetched ?? []).filter((model) => allowedIds.has(model.id));
      const covered = new Set(base.map((model) => model.id));
      const uncovered = restriction.models
        .filter((id) => !covered.has(id))
        .map((id) => ({
          id,
          name: id,
          description: "Allowed by the admin",
        }));
      setModels([...base, ...uncovered]);
    };

    (async () => {
      // New flow first: aggregated per-connection lists (admin-only — a
      // 403, an offline backend or an older backend falls back below).
      let catalog: BackendModelsSource[] | null = null;
      try {
        catalog = await fetchConnectionModels();
      } catch {
        catalog = null;
      }
      if (catalog !== null) {
        if (!cancelled) {
          setSources(catalog);
          setModels(chatModelsFromSources(catalog));
          // Admins are never restricted — no allowlist fetch needed.
          setAllowed(null);
        }
        return;
      }

      // Legacy fallback: the saved modelConnection (POST) or the
      // server-configured env source / default connection (GET) via
      // /api/models. Mount-gated read (hydration rule): localStorage is
      // only ever touched inside effects, never during render. fetchWithAuth
      // attaches the Bearer token so the GET fallback can read the backend.
      const connection = loadSettings().modelConnection;
      const request = connection
        ? fetchWithAuth("/api/models", {
            body: JSON.stringify(connection),
            headers: { "Content-Type": "application/json" },
            method: "POST",
          })
        : fetchWithAuth("/api/models");

      let fetched: ChatModel[] | null = null;
      try {
        const res = await request;
        if (res.ok) {
          const body = (await res.json()) as {
            models?: Array<{ id: string; name: string }>;
            provider?: string;
          };
          if (body.models?.length) {
            fetched = chatModelsFromSource(
              body.provider ?? "openai",
              body.models,
            );
          }
        }
      } catch {
        // Leave models as-is (or null) — callers fall back to the built-in
        // list; the settings page's Test connection reports the error.
        fetched = null;
      }

      // The caller's effective restriction filters the picker for
      // user-role accounts; a failed fetch never restricts.
      const restriction = await fetchMyAllowedModels();
      applyRestriction(fetched, restriction);
    })();

    return () => {
      cancelled = true;
    };
  }, [revision]);

  return { models, sources, allowed };
}

// Convenience for callers that only need the picker list (filtered per the
// caller's allowlist). Returns null while loading or when no live source
// is reachable — callers must show an empty list, never built-in presets.
export function useAvailableModels(): ChatModel[] | null {
  return useModelCatalog().models;
}
