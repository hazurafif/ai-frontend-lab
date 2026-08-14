"use client";

import {
  BotIcon,
  DatabaseIcon,
  type LucideIcon,
  PuzzleIcon,
  SlidersHorizontalIcon,
  UserIcon,
  UsersIcon,
  WrenchIcon,
} from "lucide-react";
import { createContext, useContext, useState } from "react";

export type SettingsTabId =
  | "general"
  | "model"
  | "skills"
  | "tools"
  | "knowledge-base"
  | "account"
  | "users";

export type SettingsTab = {
  id: SettingsTabId;
  label: string;
  icon: LucideIcon;
};

export const SETTINGS_TABS: SettingsTab[] = [
  { id: "general", label: "General", icon: SlidersHorizontalIcon },
  { id: "model", label: "Model", icon: BotIcon },
  { id: "skills", label: "Skills", icon: WrenchIcon },
  { id: "tools", label: "Tools", icon: PuzzleIcon },
  { id: "knowledge-base", label: "Knowledge base", icon: DatabaseIcon },
  { id: "account", label: "Account", icon: UserIcon },
  { id: "users", label: "Users", icon: UsersIcon },
];

// Skills, tools and users are admin-only on the backend.
export function settingsTabsForRole(role?: string): SettingsTab[] {
  return role === "admin"
    ? SETTINGS_TABS
    : SETTINGS_TABS.filter(
        (tab) =>
          tab.id !== "skills" && tab.id !== "tools" && tab.id !== "users",
      );
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
