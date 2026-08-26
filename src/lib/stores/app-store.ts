"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { ViewKind } from "@/lib/types";

interface AppState {
  // Navigation
  view: ViewKind;
  activeProjectId: string | null;
  activeProgramId: string | null;
  activeRunId: string | null;
  sidebarCollapsed: boolean;

  // Setters
  setView: (view: ViewKind) => void;
  setActiveProject: (id: string | null) => void;
  setActiveProgram: (id: string | null) => void;
  setActiveRun: (id: string | null) => void;
  toggleSidebar: () => void;

  // Navigation helpers — switch project + view together
  openProject: (id: string, view?: ViewKind) => void;
  closeProject: () => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      view: "dashboard",
      activeProjectId: null,
      activeProgramId: null,
      activeRunId: null,
      sidebarCollapsed: false,

      setView: (view) => set({ view }),
      setActiveProject: (id) => set({ activeProjectId: id }),
      setActiveProgram: (id) => set({ activeProgramId: id }),
      setActiveRun: (id) => set({ activeRunId: id }),
      toggleSidebar: () =>
        set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

      openProject: (id, view = "overview") =>
        set({ activeProjectId: id, view }),
      closeProject: () =>
        set({
          activeProjectId: null,
          activeProgramId: null,
          activeRunId: null,
          view: "dashboard",
        }),
    }),
    {
      name: "antlion-nav",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        sidebarCollapsed: s.sidebarCollapsed,
      }),
    },
  ),
);
