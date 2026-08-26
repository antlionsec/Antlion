"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Crosshair,
  Bug,
  Activity,
  FileText,
  Settings,
  History,
  ChevronLeft,
  ChevronRight,
  Lock,
  Menu,
  X,
  LayoutDashboard,
} from "lucide-react";
import { useAppStore } from "@/lib/stores/app-store";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { TargetSelectionView } from "./target-selection-view";
import { PipelineConfigView } from "./pipeline-config-view";
import { PipelineRunView } from "./pipeline-run-view";
import { ResultsView } from "./results-view";
import { ReportsView } from "./reports-view";
import { SettingsView } from "./settings-view";
import { AuditLogView } from "./audit-log-view";
import { ProjectOverviewView } from "./project-overview-view";

const NAV_ITEMS = [
  { id: "overview", label: "Overview", icon: LayoutDashboard, group: "Scope" },
  { id: "target-selection", label: "Target Selection", icon: Crosshair, group: "Scope" },
  { id: "pipeline-config", label: "Pipeline Config", icon: Settings, group: "Run" },
  { id: "pipeline-run", label: "Pipeline Execution", icon: Activity, group: "Run" },
  { id: "results", label: "Results Dashboard", icon: Bug, group: "Analyze" },
  { id: "reports", label: "Reports", icon: FileText, group: "Analyze" },
  { id: "audit-log", label: "Audit Log", icon: History, group: "System" },
  { id: "settings", label: "Project Settings", icon: Settings, group: "System" },
] as const;

interface ProjectData {
  id: string;
  name: string;
  description: string | null;
  color: string;
  tags: string[];
  status: string;
  programId?: string | null;
  programName?: string | null;
  programPlatform?: string | null;
  encryptionEnabled: boolean;
}

export function ProjectWorkspace() {
  const { activeProjectId, view, setView, closeProject, sidebarCollapsed, toggleSidebar } = useAppStore();
  const [project, setProject] = useState<ProjectData | null>(null);
  const [loading, setLoading] = useState(true);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const loadProject = useCallback(async () => {
    if (!activeProjectId) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/projects/${activeProjectId}`);
      const d = await r.json();
      if (d.project) setProject(d.project);
    } catch (e) {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [activeProjectId]);

  useEffect(() => {
    loadProject();
  }, [loadProject]);

  // After mutating project, refresh
  useEffect(() => {
    const handler = () => loadProject();
    window.addEventListener("antlion:project-updated", handler);
    return () => window.removeEventListener("antlion:project-updated", handler);
  }, [loadProject]);

  // Close the mobile drawer whenever the view changes
  useEffect(() => {
    setMobileNavOpen(false);
  }, [view]);

  if (loading || !project) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <div className="text-sm text-muted-foreground">Loading project...</div>
        </div>
      </div>
    );
  }

  const grouped: Record<string, typeof NAV_ITEMS> = {};
  for (const item of NAV_ITEMS) {
    if (!grouped[item.group]) grouped[item.group] = [] as any;
    (grouped[item.group] as any).push(item);
  }

  const sidebarContent = (
    <>
      {/* Project header */}
      <div className="p-3 border-b border-sidebar-border">
        <button
          onClick={closeProject}
          className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors mb-3"
        >
          <ChevronLeft className="h-3 w-3" />
          All projects
        </button>
        {/* Brand — logo click takes the user back to the homepage (all projects) */}
        <button
          onClick={closeProject}
          title="Back to homepage"
          aria-label="Antlion — back to homepage"
          className="flex items-start gap-2.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar -m-1 p-1 transition-opacity hover:opacity-80"
        >
          <img
            src="/logo-96.png"
            alt="Antlion logo"
            width={36}
            height={36}
            draggable={false}
            className="h-9 w-9 object-contain flex-shrink-0"
          />
          {(!sidebarCollapsed || mobileNavOpen) && (
            <div className="min-w-0 flex-1 text-left">
              <div className="text-sm font-semibold truncate">{project.name}</div>
              <div className="text-[10px] text-muted-foreground truncate font-mono">
                {project.id.slice(0, 8)}
              </div>
            </div>
          )}
        </button>
        {(!sidebarCollapsed || mobileNavOpen) && project.encryptionEnabled && (
          <div className="mt-2 flex items-center gap-1 text-[10px] text-status-success">
            <Lock className="h-2.5 w-2.5" /> Encrypted
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-2 px-2">
        {Object.entries(grouped).map(([group, items]) => (
          <div key={group} className="mb-3">
            {(!sidebarCollapsed || mobileNavOpen) && (
              <div className="text-[9px] uppercase tracking-widest text-muted-foreground px-2 mb-1 mt-2 font-semibold">
                {group}
              </div>
            )}
            <TooltipProvider delayDuration={200}>
              {items.map((item: any) => {
                const Icon = item.icon;
                const active = view === item.id;
                return (
                  <Tooltip key={item.id}>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => setView(item.id)}
                        className={cn(
                          "w-full flex items-center gap-2.5 rounded-md text-[13px] transition-colors px-2 py-1.5 mb-0.5",
                          active
                            ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                            : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground",
                          (sidebarCollapsed && !mobileNavOpen) && "justify-center",
                        )}
                      >
                        <Icon className={cn("h-4 w-4 flex-shrink-0", active && "text-primary")} />
                        {(!sidebarCollapsed || mobileNavOpen) && <span className="truncate">{item.label}</span>}
                      </button>
                    </TooltipTrigger>
                    {(sidebarCollapsed && !mobileNavOpen) && (
                      <TooltipContent>{item.label}</TooltipContent>
                    )}
                  </Tooltip>
                );
              })}
            </TooltipProvider>
          </div>
        ))}
      </nav>

      {/* Collapse toggle — desktop only */}
      <div className="border-t border-sidebar-border p-2 hidden lg:block">
        <Button
          variant="ghost"
          size="sm"
          onClick={toggleSidebar}
          className="w-full justify-start text-muted-foreground hover:text-foreground"
        >
          {sidebarCollapsed ? <ChevronRight className="h-4 w-4 mx-auto" /> : <><ChevronLeft className="h-4 w-4 mr-2" />Collapse</>}
        </Button>
      </div>
    </>
  );

  return (
    <div className="h-screen flex bg-background overflow-hidden">
      {/* Mobile overlay backdrop */}
      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      {/* Desktop sidebar */}
      <aside
        className={cn(
          "hidden lg:flex flex-shrink-0 border-r border-sidebar-border bg-sidebar flex-col transition-all duration-200",
          sidebarCollapsed ? "lg:w-[56px]" : "lg:w-[230px]",
        )}
      >
        {sidebarContent}
      </aside>

      {/* Mobile drawer sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-[260px] border-r border-sidebar-border bg-sidebar flex flex-col transition-transform duration-200 lg:hidden",
          mobileNavOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <button
          onClick={() => setMobileNavOpen(false)}
          className="absolute top-3 right-3 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50"
          aria-label="Close navigation"
        >
          <X className="h-4 w-4" />
        </button>
        {sidebarContent}
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-hidden flex flex-col min-w-0">
        {/* View header */}
        <div className="flex-shrink-0 border-b border-border bg-background/60 backdrop-blur-md">
          <div className="px-3 sm:px-6 py-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              {/* Mobile hamburger */}
              <button
                onClick={() => setMobileNavOpen(true)}
                className="lg:hidden p-1.5 -ml-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50"
                aria-label="Open navigation"
              >
                <Menu className="h-5 w-5" />
              </button>
              <h1 className="text-[15px] font-semibold tracking-tight truncate">
                {NAV_ITEMS.find((n) => n.id === view)?.label || "Project"}
              </h1>
              {project.tags && project.tags.length > 0 && (
                <div className="hidden md:flex items-center gap-1">
                  {project.tags.slice(0, 3).map((t) => (
                    <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="hidden sm:block text-[11px] text-muted-foreground font-mono tabular-nums flex-shrink-0">
              {project.id.slice(0, 8)}
            </div>
          </div>
        </div>

        {/* View body — each view manages its own scrolling with
            overflow-y-auto + min-h-0 */}
        <div className="flex-1 overflow-hidden min-h-0">
          {view === "target-selection" && <TargetSelectionView />}
          {view === "pipeline-config" && <PipelineConfigView />}
          {view === "pipeline-run" && <PipelineRunView />}
          {view === "results" && <ResultsView />}
          {view === "reports" && <ReportsView />}
          {view === "audit-log" && <AuditLogView />}
          {view === "settings" && <SettingsView />}
          {view === "overview" && <ProjectOverviewView />}
        </div>
      </main>
    </div>
  );
}
