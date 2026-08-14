"use client";

import { useEffect, useState } from "react";
import { SETTINGS_CHANGED_EVENT } from "@/lib/constants";
import { type ChatModel, chatModelsFromSource } from "@/lib/models";
import { loadSettings } from "@/lib/settings";

// Fetches the live model list for the model selectors via /api/models:
//
//   - with a saved connection (settings → modelConnection): POSTs it so the
//     list comes from the chosen source (OpenAI / Gemini / custom);
//   - without one: GETs the server-configured env source
//     (MODELS_BASE_URL / MODELS_API_KEY in .env.local).
//
// Returns null while loading or when the fetch fails so callers can fall
// back to the built-in chatModels list. Refetches whenever settings change
// (SETTINGS_CHANGED_EVENT), e.g. right after saving a new connection.
export function useAvailableModels(): ChatModel[] | null {
  const [models, setModels] = useState<ChatModel[] | null>(null);
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

    // Mount-gated read (hydration rule): localStorage is only ever touched
    // inside effects, never during render.
    const connection = loadSettings().modelConnection;
    const request = connection
      ? fetch("/api/models", {
          body: JSON.stringify(connection),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        })
      : fetch("/api/models");

    request
      .then((res) =>
        res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`)),
      )
      .then(
        (body: {
          models?: Array<{ id: string; name: string }>;
          provider?: string;
        }) => {
          if (!cancelled && body.models?.length) {
            setModels(
              chatModelsFromSource(body.provider ?? "openai", body.models),
            );
          }
        },
      )
      .catch(() => {
        // Leave models as-is (or null) — callers fall back to the built-in
        // list; the settings page's Test connection reports the error.
      });

    return () => {
      cancelled = true;
    };
  }, [revision]);

  return models;
}
