"use client";

import { create } from "zustand";

/**
 * Global Program Discovery dialog state.
 *
 * Program Discovery is a popup feature window (not a page). It can be opened
 * from Target Selection ("Discover a Program") and from the dashboard quick
 * actions. The dialog is mounted once at the app root.
 */
interface DiscoveryState {
  open: boolean;
  /** Forces a source re-sync when the dialog opens. */
  openDiscovery: () => void;
  closeDiscovery: () => void;
}

export const useDiscoveryStore = create<DiscoveryState>()((set) => ({
  open: false,
  openDiscovery: () => set({ open: true }),
  closeDiscovery: () => set({ open: false }),
}));
