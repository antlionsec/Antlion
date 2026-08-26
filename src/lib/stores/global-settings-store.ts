"use client";

import { create } from "zustand";

/**
 * Global Settings dialog state.
 *
 * Notification hooks, platform accounts, API keys, appearance and tool
 * detection are GLOBAL — configured once, applicable to every project.
 * The dialog is mounted at the app root and opened from the landing page
 * header (gear icon) or from a project's Settings view.
 */
interface GlobalSettingsState {
  open: boolean;
  /** Currently active tab — deep-linked on open, then user-controlled. */
  tab: string;
  openGlobalSettings: (tab?: string) => void;
  closeGlobalSettings: () => void;
  setTab: (tab: string) => void;
}

export const useGlobalSettingsStore = create<GlobalSettingsState>()((set) => ({
  open: false,
  tab: "notifications",
  openGlobalSettings: (tab) => set(tab ? { open: true, tab } : { open: true }),
  closeGlobalSettings: () => set({ open: false }),
  setTab: (tab) => set({ tab }),
}));
