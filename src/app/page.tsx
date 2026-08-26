"use client";

import { useAppStore } from "@/lib/stores/app-store";
import { DashboardView } from "@/components/views/dashboard-view";
import { ProjectWorkspace } from "@/components/views/project-workspace";
import { ProgramDiscoveryDialog } from "@/components/views/program-discovery-dialog";
import { GlobalSettingsDialog } from "@/components/global-settings-dialog";

export default function Home() {
  const activeProjectId = useAppStore((s) => s.activeProjectId);

  return (
    <>
      {activeProjectId ? <ProjectWorkspace /> : <DashboardView />}
      {/* Program Discovery is a global popup feature window — mounted once,
          openable from Target Selection and the dashboard. */}
      <ProgramDiscoveryDialog />
      {/* Global Settings — notification hooks, platform accounts, API keys.
          Configured once, applicable to every project container. */}
      <GlobalSettingsDialog />
    </>
  );
}
