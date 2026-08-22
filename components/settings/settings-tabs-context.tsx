import {
  BotIcon,
  CableIcon,
  DatabaseIcon,
  type LucideIcon,
  PuzzleIcon,
  ShieldCheckIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
  UserIcon,
  UsersIcon,
  WrenchIcon,
} from "lucide-react";
import { createContext, useContext, useState } from "react";

export type SettingsTabId =
  | "general"
  | "connections"
  | "model"
  | "agents"
  | "skills"
  | "tools"
  | "knowledge-base"
  | "account"
  | "permissions"
  | "users";

export type SettingsTab = {
  id: SettingsTabId;
  label: string;
  icon: LucideIcon;
};

export const SETTINGS_TABS: SettingsTab[] = [
  { id: "general", label: "General", icon: SlidersHorizontalIcon },
  { id: "connections", label: "Connections", icon: CableIcon },
  { id: "model", label: "Model", icon: BotIcon },
  { id: "agents", label: "Agents", icon: SparklesIcon },
  { id: "skills", label: "Skills", icon: WrenchIcon },
  { id: "tools", label: "Tools", icon: PuzzleIcon },
  { id: "knowledge-base", label: "Knowledge", icon: DatabaseIcon },
  { id: "account", label: "Account", icon: UserIcon },
  { id: "permissions", label: "Permissions", icon: ShieldCheckIcon },
  { id: "users", label: "Users", icon: UsersIcon },
];

// Settings sidebar sections: labeled groups around the tab list.
export type SettingsTabCategory = {
  id: string;
  label: string;
  tabIds: SettingsTabId[];
};

export const SETTINGS_TAB_CATEGORIES: SettingsTabCategory[] = [
  {
    id: "preferences",
    label: "Preferences",
    tabIds: ["general", "connections", "model"],
  },
  {
    id: "agent",
    label: "Agent",
    tabIds: ["agents", "skills", "tools", "knowledge-base"],
  },
  {
    id: "account",
    label: "Account",
    tabIds: ["account", "permissions", "users"],
  },
];

// MCP tool servers are per-user on the backend now (each user brings their
// own, CRUD at /mcp/servers) — the Tools tab is available to everyone.
// Skills are per-user too (CRUD at /skills); admins additionally manage the
// agent-wide ones (/agent/skills). Only connections (admin credentials),
// global agents, users and permissions stay admin-only.
export function settingsTabsForRole(role?: string): SettingsTab[] {
  return role === "admin"
    ? SETTINGS_TABS
    : SETTINGS_TABS.filter(
        (tab) =>
          tab.id !== "users" &&
          tab.id !== "permissions" &&
          tab.id !== "connections",
      );
}

// The same role-filtered tabs, grouped into labeled categories (empty
// categories are dropped, e.g. "Agent" for non-admins without a KB).
export function settingsCategoriesForRole(role?: string): {
  id: string;
  label: string;
  tabs: SettingsTab[];
}[] {
  const visible = new Set(settingsTabsForRole(role).map((tab) => tab.id));
  return SETTINGS_TAB_CATEGORIES.map((category) => ({
    id: category.id,
    label: category.label,
    tabs: category.tabIds
      .map((id) => SETTINGS_TABS.find((tab) => tab.id === id))
      .filter(
        (tab): tab is SettingsTab => tab !== undefined && visible.has(tab.id),
      ),
  })).filter((category) => category.tabs.length > 0);
}

type SettingsTabsContextValue = {
  activeTab: SettingsTabId;
  setActiveTab: (tab: SettingsTabId) => void;
};

const SettingsTabsContext = createContext<SettingsTabsContextValue | null>(
  null,
);

export function SettingsTabsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [activeTab, setActiveTab] = useState<SettingsTabId>("general");
  return (
    <SettingsTabsContext.Provider value={{ activeTab, setActiveTab }}>
      {children}
    </SettingsTabsContext.Provider>
  );
}

export function useSettingsTabs(): SettingsTabsContextValue {
  const value = useContext(SettingsTabsContext);
  if (!value) {
    throw new Error(
      "useSettingsTabs must be used within a SettingsTabsProvider",
    );
  }
  return value;
}
