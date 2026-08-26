"use client";

// ============================================================================
// ANTLION — Project Overview
// ----------------------------------------------------------------------------
// At-a-glance dashboard for the active project: scope size, tool readiness,
// findings by severity, recent pipeline runs and the linked bug bounty
// program's live metrics. All data comes from the app's real APIs —
// nothing here is simulated.
// ============================================================================

import { useEffect, useState, useCallback } from "react";
import {
  Crosshair,
  Activity,
  Bug,
  FileText,
  Shield,
  Wrench,
  Globe2,
  Trophy,
  Clock,
  ExternalLink,
  ArrowRight,
  Loader2,
  CircleDollarSign,
  Ban,
} from "lucide-react";
import { useAppStore } from "@/lib/stores/app-store";
import { useDiscoveryStore } from "@/lib/stores/discovery-store";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SeverityBadge } from "@/components/antlion/badges";
import type { Severity, ViewKind } from "@/lib/types";

// ---------------------------------------------------------------------------
// Types (API response shapes)
// ---------------------------------------------------------------------------
interface OverviewProject {
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
  targetCount?: number;
  excludedCount?: number;
  runCount?: number;
  findingCount?: number;
  lastActivityAt?: string;
  createdAt?: string;
}

interface OverviewRun {
  id: string;
  status: string;
  trigger?: string;
  startedAt?: string;
  finishedAt?: string | null;
  totalStages?: number;
  doneStages?: number;
  findingDelta?: number;
  assetDelta?: number;
  errorMessage?: string | null;
  createdAt?: string;
}

interface OverviewFinding {
  id: string;
  title: string;
  severity: Severity;
  status: string;
  createdAt?: string;
}

interface ToolEntry {
  id: string;
  name: string;
  installed: boolean;
  category?: string;
}

interface LinkedProgram {
  id: string;
  name: string;
  platform: string;
  type?: string;
  maxBounty?: number | null;
  avgBounty?: number | null;
  totalPaid?: number | null;
  avgResponseHrs?: number | null;
  acceptanceRate?: number | null;
  url?: string | null;
}

const PLATFORM_NAMES: Record<string, string> = {
  hackerone: "HackerOne",
  bugcrowd: "Bugcrowd",
  intigriti: "Intigriti",
  yeswehack: "YesWeHack",
  immunefi: "Immunefi",
  disclose: "disclose.io",
};

const SEVERITIES: Severity[] = ["critical", "high", "medium", "low", "info"];

function fmtMoney(n?: number | null): string | null {
  if (n === null || n === undefined) return null;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}K`;
  return `$${n}`;
}

function fmtHours(h?: number | null): string | null {
  if (h === null || h === undefined) return null;
  if (h < 1) return `${Math.round(h * 60)}m`;
  if (h < 48) return `${h.toFixed(1)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

function timeAgo(iso?: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return "just now";
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

const RUN_STATUS_STYLE: Record<string, string> = {
  completed: "bg-status-success/15 text-status-success",
  running: "bg-status-info/15 text-status-info",
  failed: "bg-severity-critical/15 text-severity-critical",
  cancelled: "bg-muted text-muted-foreground",
  paused: "bg-amber-500/15 text-amber-500",
};

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------
export function ProjectOverviewView() {
  const { activeProjectId, setView, setActiveRun } = useAppStore();
  const { openDiscovery } = useDiscoveryStore();
  const [project, setProject] = useState<OverviewProject | null>(null);
  const [runs, setRuns] = useState<OverviewRun[]>([]);
  const [findings, setFindings] = useState<OverviewFinding[]>([]);
  const [tools, setTools] = useState<ToolEntry[]>([]);
  const [program, setProgram] = useState<LinkedProgram | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!activeProjectId) return;
    setLoading(true);
    try {
      const [projRes, findRes, toolRes] = await Promise.all([
        fetch(`/api/projects/${activeProjectId}`),
        fetch(`/api/findings?projectId=${activeProjectId}&limit=1000`),
        fetch(`/api/tools`),
      ]);
      const proj = await projRes.json();
      if (proj.project) {
        setProject(proj.project);
        setRuns((proj.recentRuns || []).slice(0, 5));
      }
      const find = await findRes.json();
      setFindings(find.findings || []);
      const tool = await toolRes.json();
      setTools(tool.tools || []);
      // Linked program metrics (live from the programs cache)
      if (proj.project?.programId) {
        try {
          const r = await fetch(`/api/programs/${proj.project.programId}`);
          const d = await r.json();
          if (d && d.id) setProgram(d);
        } catch {
          setProgram(null);
        }
      } else {
        setProgram(null);
      }
    } catch {
      // surfaced by empty state below
    } finally {
      setLoading(false);
    }
  }, [activeProjectId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        <span className="text-sm">Loading project overview…</span>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        <div className="text-center">
          <div className="text-2xl mb-2">⚠️</div>
          <div className="text-sm">Project not found — select a project from the dashboard.</div>
        </div>
      </div>
    );
  }

  const inTargets = project.targetCount ?? 0;
  const outTargets = project.excludedCount ?? 0;
  const installedTools = tools.filter((t) => t.installed).length;
  const missingTools = tools.filter((t) => !t.installed);
  const severityCounts: Record<string, number> = {};
  for (const f of findings) severityCounts[f.severity] = (severityCounts[f.severity] || 0) + 1;
  const maxSeverity = Math.max(1, ...SEVERITIES.map((s) => severityCounts[s] || 0));
  const openFindings = findings.filter((f) => f.status === "new" || f.status === "todo").length;

  const goto = (view: ViewKind) => setView(view);

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-4 sm:space-y-6">
          {/* ── Header ─────────────────────────────────────────────── */}
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg font-semibold tracking-tight truncate">{project.name}</h2>
                <span className={cn(
                  "text-[10px] px-2 py-0.5 rounded-full font-medium uppercase tracking-wide",
                  project.status === "active" ? "bg-status-success/15 text-status-success" : "bg-muted text-muted-foreground",
                )}>
                  {project.status}
                </span>
                {project.encryptionEnabled && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium flex items-center gap-1">
                    <Shield className="h-3 w-3" /> Encrypted
                  </span>
                )}
              </div>
              {project.description && (
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{project.description}</p>
              )}
              <div className="text-[11px] text-muted-foreground mt-1.5 flex items-center gap-3 flex-wrap">
                <span>Created {timeAgo(project.createdAt)}</span>
                <span className="hidden sm:inline">·</span>
                <span>Last activity {timeAgo(project.lastActivityAt)}</span>
                {project.tags?.length > 0 && (
                  <>
                    <span className="hidden sm:inline">·</span>
                    <span className="flex gap-1">
                      {project.tags.slice(0, 4).map((t) => (
                        <span key={t} className="px-1.5 py-0.5 rounded bg-muted text-[10px]">{t}</span>
                      ))}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* ── Quick stats row ────────────────────────────────────── */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <StatCard
              icon={Crosshair}
              label="In-Scope Targets"
              value={inTargets}
              hint={inTargets === 0 ? "No scope yet" : "ready for recon"}
              onClick={() => goto("target-selection")}
            />
            <StatCard
              icon={Ban}
              label="Exclusions"
              value={outTargets}
              hint={outTargets === 0 ? "No exclusions" : "hard-excluded"}
              onClick={() => goto("target-selection")}
            />
            <StatCard
              icon={Activity}
              label="Pipeline Runs"
              value={project.runCount ?? runs.length}
              hint={(project.runCount ?? runs.length) === 0 ? "Never run" : "executions"}
              onClick={() => goto("pipeline-run")}
            />
            <StatCard
              icon={Bug}
              label="Findings"
              value={findings.length}
              hint={openFindings > 0 ? `${openFindings} open` : findings.length === 0 ? "None yet" : "all triaged"}
              onClick={() => goto("results")}
            />
            <StatCard
              icon={Wrench}
              label="Tools Ready"
              value={`${installedTools}/${tools.length || 21}`}
              hint={missingTools.length === 0 ? "all installed" : `${missingTools.length} missing`}
              onClick={() => goto("settings")}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
            {/* ── Linked program ─────────────────────────────────── */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Globe2 className="h-4 w-4 text-primary" />
                  Linked Program
                </CardTitle>
              </CardHeader>
              <CardContent>
                {program ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-medium text-sm truncate">{program.name}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {PLATFORM_NAMES[program.platform] || program.platform}
                          {program.type ? ` · ${program.type.toUpperCase()}` : ""}
                        </div>
                      </div>
                      {program.url && (
                        <a
                          href={program.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-muted-foreground hover:text-primary flex-shrink-0"
                          aria-label="Open program page"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      )}
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <Metric icon={Trophy} label="Max bounty" value={fmtMoney(program.maxBounty)} />
                      <Metric icon={CircleDollarSign} label="Avg bounty" value={fmtMoney(program.avgBounty)} />
                      <Metric icon={CircleDollarSign} label="Total paid" value={fmtMoney(program.totalPaid)} />
                      <Metric icon={Clock} label="Avg response" value={fmtHours(program.avgResponseHrs)} />
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground space-y-2">
                    <p>No bug bounty program linked to this project yet.</p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setView("target-selection");
                        openDiscovery();
                      }}
                      className="h-7 text-[11px]"
                    >
                      Discover a program <ArrowRight className="h-3 w-3 ml-1" />
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* ── Tool readiness ─────────────────────────────────── */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Wrench className="h-4 w-4 text-primary" />
                  Tool Readiness
                </CardTitle>
              </CardHeader>
              <CardContent>
                {tools.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Tool scan unavailable.</p>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-baseline gap-2">
                      <span className="text-2xl font-semibold tabular-nums">{installedTools}</span>
                      <span className="text-xs text-muted-foreground">of {tools.length} pipeline tools detected on this machine</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full bg-primary transition-all"
                        style={{ width: `${Math.round((installedTools / tools.length) * 100)}%` }}
                      />
                    </div>
                    {missingTools.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {missingTools.slice(0, 8).map((t) => (
                          <span key={t.id} className="text-[10px] px-1.5 py-0.5 rounded bg-severity-high/10 text-severity-high border border-severity-high/20">
                            {t.name}
                          </span>
                        ))}
                        {missingTools.length > 8 && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                            +{missingTools.length - 8} more
                          </span>
                        )}
                      </div>
                    ) : (
                      <p className="text-[11px] text-status-success">All pipeline tools are installed and detected.</p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* ── Findings by severity ───────────────────────────── */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Bug className="h-4 w-4 text-primary" />
                  Findings by Severity
                </CardTitle>
              </CardHeader>
              <CardContent>
                {findings.length === 0 ? (
                  <div className="text-xs text-muted-foreground space-y-2">
                    <p>No findings recorded yet. Run the pipeline to start collecting results.</p>
                    <Button variant="outline" size="sm" onClick={() => goto("pipeline-run")} className="h-7 text-[11px]">
                      Go to pipeline <ArrowRight className="h-3 w-3 ml-1" />
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {SEVERITIES.map((sev) => {
                      const count = severityCounts[sev] || 0;
                      return (
                        <button
                          key={sev}
                          onClick={() => goto("results")}
                          className="w-full flex items-center gap-2 group"
                        >
                          <SeverityBadge severity={sev} variant="dot" />
                          <div className="flex-1 h-4 flex items-center">
                            <div
                              className={cn("h-2 rounded-full transition-all", `bg-severity-${sev}`)}
                              style={{ width: `${Math.max(count > 0 ? 4 : 0, (count / maxSeverity) * 100)}%` }}
                            />
                          </div>
                          <span className="text-xs tabular-nums text-muted-foreground group-hover:text-foreground w-6 text-right">
                            {count}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* ── Recent runs ────────────────────────────────────── */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Activity className="h-4 w-4 text-primary" />
                  Recent Pipeline Runs
                </CardTitle>
              </CardHeader>
              <CardContent>
                {runs.length === 0 ? (
                  <div className="text-xs text-muted-foreground space-y-2">
                    <p>No pipeline runs yet. Configure and execute your first recon pipeline.</p>
                    <Button variant="outline" size="sm" onClick={() => goto("pipeline-config")} className="h-7 text-[11px]">
                      Configure pipeline <ArrowRight className="h-3 w-3 ml-1" />
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {runs.map((run) => (
                      <button
                        key={run.id}
                        onClick={() => {
                          setActiveRun(run.id);
                          goto("pipeline-run");
                        }}
                        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted/50 text-left transition-colors"
                      >
                        <span className={cn(
                          "text-[10px] px-1.5 py-0.5 rounded font-medium uppercase",
                          RUN_STATUS_STYLE[run.status] || "bg-muted text-muted-foreground",
                        )}>
                          {run.status}
                        </span>
                        <span className="text-[11px] text-muted-foreground flex-1 truncate">
                          {run.doneStages ?? 0}/{run.totalStages ?? 0} stages
                          {run.findingDelta ? ` · +${run.findingDelta} findings` : ""}
                          {run.assetDelta ? ` · +${run.assetDelta} assets` : ""}
                        </span>
                        <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                          {timeAgo(run.startedAt || run.createdAt)}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* ── Quick actions ──────────────────────────────────────── */}
          <div className="flex flex-wrap gap-2 pb-2">
            <Button size="sm" variant="outline" onClick={() => goto("target-selection")}>
              <Crosshair className="h-3.5 w-3.5 mr-1.5" /> Scope
            </Button>
            <Button size="sm" variant="outline" onClick={() => goto("pipeline-config")}>
              <Wrench className="h-3.5 w-3.5 mr-1.5" /> Configure
            </Button>
            <Button size="sm" variant="outline" onClick={() => goto("pipeline-run")}>
              <Activity className="h-3.5 w-3.5 mr-1.5" /> Execute
            </Button>
            <Button size="sm" variant="outline" onClick={() => goto("results")}>
              <Bug className="h-3.5 w-3.5 mr-1.5" /> Results
            </Button>
            <Button size="sm" variant="outline" onClick={() => goto("reports")}>
              <FileText className="h-3.5 w-3.5 mr-1.5" /> Reports
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------
function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number | string;
  hint?: string;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-xl border border-border bg-card p-3 sm:p-4 text-left transition-all",
        "hover:border-primary/40 hover:bg-primary/[0.03] focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        <span className="text-[10px] font-medium uppercase tracking-wide truncate">{label}</span>
      </div>
      <div className="mt-1.5 text-xl sm:text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground mt-0.5 truncate">{hint}</div>}
    </button>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | null;
}) {
  return (
    <div className="rounded-lg bg-muted/40 px-2 py-1.5 min-w-0">
      <div className="flex items-center gap-1 text-muted-foreground">
        <Icon className="h-3 w-3 flex-shrink-0" />
        <span className="text-[9px] uppercase tracking-wide truncate">{label}</span>
      </div>
      <div className="text-xs font-medium tabular-nums mt-0.5 truncate">
        {value ?? <span className="text-muted-foreground font-normal">—</span>}
      </div>
    </div>
  );
}
