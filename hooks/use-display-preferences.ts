"use client";

// Reactive chat display preferences (hide thinking / hide tool calls).
//
// The backend persists these per-user, but its AI SDK bridge does not apply
// them to the /api/chat stream, so the message renderer filters parts
// client-side — uniformly across every source of parts (live stream, attach
// stream, rehydrated history). Values are mirrored into the settings
// localStorage cache by the settings page toggles, so this hook reads them
// there and re-applies on SETTINGS_CHANGED_EVENT.

import { useEffect, useState } from "react";
import { SETTINGS_CHANGED_EVENT } from "@/lib/constants";
import { loadSettings } from "@/lib/settings";

export type DisplayPreferences = {
  hideReasoning: boolean;
  hideToolCalls: boolean;
};

const DEFAULTS: DisplayPreferences = {
  hideReasoning: false,
  hideToolCalls: false,
};

export function useDisplayPreferences(): DisplayPreferences {
  const [prefs, setPrefs] = useState<DisplayPreferences>(DEFAULTS);

  useEffect(() => {
    const apply = () => {
      const settings = loadSettings();
      setPrefs({
        hideReasoning: Boolean(settings.hideReasoning),
        hideToolCalls: Boolean(settings.hideToolCalls),
      });
    };
    apply();
    window.addEventListener(SETTINGS_CHANGED_EVENT, apply);
    return () => {
      window.removeEventListener(SETTINGS_CHANGED_EVENT, apply);
    };
  }, []);

  return prefs;
}
