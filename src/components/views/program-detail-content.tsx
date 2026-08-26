"use client";

import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Globe,
  Clock,
  Building2,
  Award,
  FileText,
  History,
  CheckCircle2,
  XCircle,
  Plus,
  ExternalLink,
  AlertCircle,
  RefreshCw,
  Loader2,
  Target,
} from "lucide-react";
import { useAppStore } from "@/lib/stores/app-store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { NewBadge } from "@/components/antlion/badges";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface ProgramAsset {
  value: string;
  type: string;
  instructions?: string;
  isNew?: boolean;
  updatedAt?: string;
}

interface ProgramDetail {
  id: string;
  name: string;
  platform: string;
  type: string;
  url?: string;
  state: string;
  industry?: string;
  languages: string[];
  region?: string;
  maxBounty?: number;
  avgBounty?: number;
  totalPaid?: number;
  resolvedReports?: number;
  acceptedReports?: number;
  avgResponseHrs?: number;
  avgResolutionHrs?: number;
  acceptanceRate?: number;
  inScope: ProgramAsset[];
  outScope: ProgramAsset[];
  scopeHistory: any[];
  policy?: string;
  firstSeenAt: string;
  lastSyncAt: string;
  scopeUpdated?: string;
  isNew: boolean;
  liveScopeError?: string;
}

export const PLATFORM_LABELS: Record<string, string> = {
  hackerone: "HackerOne",
  bugcrowd: "Bugcrowd",
  intigriti: "Intigriti",
  yeswehack: "YesWeHack",
  immunefi: "Immunefi",
  custom: "Custom",
};

const TYPE_BADGES: Record<string, { label: string; cls: string }> = {
  bbp: { label: "Bug Bounty Program", cls: "bg-status-success/15 text-status-success" },
  vdp: { label: "Vulnerability Disclosure", cls: "bg-status-info/15 text-status-info" },
  private: { label: "Private / Invite-only", cls: "bg-violet-500/15 text-violet-400" },
  crowdsourced: { label: "Crowdsourced", cls: "bg-amber-500/15 text-amber-400" },
  web3: { label: "Web3 / Audit", cls: "bg-cyan-500/15 text-cyan-400" },
};

const TYPE_COLORS: Record<string, string> = {
  wildcard: "bg-violet-500/15 text-violet-400",
  domain: "bg-teal-500/15 text-teal-400",
  url: "bg-cyan-500/15 text-cyan-400",
  ip: "bg-amber-500/15 text-amber-400",
  cidr: "bg-orange-500/15 text-orange-400",
  mobile: "bg-rose-500/15 text-rose-400",
  api: "bg-emerald-500/15 text-emerald-400",
  other: "bg-slate-500/15 text-slate-400",
};

export function formatMoney(n?: number | null): string {
  if (n === undefined || n === null) return "—";
  if (n === 0) return "Swag";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `$${(n / 1000).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
}

export function formatHours(h?: number | null): string {
  if (h === undefined || h === null) return "—";
  if (h < 24) return `${h.toFixed(h < 10 ? 1 : 0)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

/**
 * Reusable program detail content. Works standalone (workspace view) and
 * embedded inside the Program Discovery dialog.
 */
export function ProgramDetailContent({
  programId,
  onBack,
  onImported,
  compact,
}: {
  programId: string;
  onBack?: () => void;
  onImported?: () => void;
  compact?: boolean;
}) {
  const { activeProjectId, setView, openProject } = useAppStore();
  const [program, setProgram] = useState<ProgramDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [refreshingScope, setRefreshingScope] = useState(false);

  const load = useCallback(async () => {
    if (!programId) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/programs/${programId}`);
      const d = await r.json();
      setProgram(d);
    } catch (e) {
      toast.error("Failed to load program");
    } finally {
      setLoading(false);
    }
  }, [programId]);

  useEffect(() => {
    load();
  }, [load]);

  const refreshScope = useCallback(async () => {
    if (!programId) return;
    setRefreshingScope(true);
    try {
      const r = await fetch(`/api/programs/${programId}`, { method: "POST" });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      toast.success(
        `Live scope fetched — ${d.inScopeCount || 0} in-scope, ${d.outScopeCount || 0} out-of-scope`,
      );
      await load();
    } catch (e: any) {
      toast.error(`Live scope fetch failed: ${e.message}`);
    } finally {
      setRefreshingScope(false);
    }
  }, [programId, load]);

  const importProgramToProject = async () => {
    if (!program) return;
    if (!activeProjectId) {
      // No active project — create one seeded with the program scope
      setImporting(true);
      try {
        const r = await fetch("/api/projects", {
          method: "POST",
          body: JSON.stringify({
            name: program.name,
            description: `${PLATFORM_LABELS[program.platform]} · ${program.industry || ""}`.trim(),
            color: "teal",
            tags: [program.platform, program.type].filter(Boolean),
            programId: program.id,
            programName: program.name,
            programPlatform: program.platform,
          }),
          headers: { "Content-Type": "application/json" },
        });
        const d = await r.json();
        if (d.error) throw new Error(d.error);
        if (program.inScope.length) {
          await fetch("/api/targets", {
            method: "POST",
            body: JSON.stringify({
              projectId: d.project.id,
              items: program.inScope.map((a) => ({ value: a.value, type: a.type, origin: "program" })),
            }),
            headers: { "Content-Type": "application/json" },
          });
        }
        if (program.outScope.length) {
          await fetch("/api/targets", {
            method: "POST",
            body: JSON.stringify({
              projectId: d.project.id,
              items: program.outScope.map((a) => ({ value: a.value, type: a.type, origin: "program", inScope: false })),
            }),
            headers: { "Content-Type": "application/json" },
          });
        }
        toast.success("Project created with program scope imported");
        onImported?.();
        openProject(d.project.id, "target-selection");
      } catch (e: any) {
        toast.error(e.message);
      } finally {
        setImporting(false);
      }
      return;
    }
    // Existing project — import targets into it
    setImporting(true);
    try {
      await fetch("/api/targets", {
        method: "POST",
        body: JSON.stringify({
          projectId: activeProjectId,
          items: program.inScope.map((a) => ({ value: a.value, type: a.type, origin: "program" })),
        }),
        headers: { "Content-Type": "application/json" },
      });
      await fetch("/api/targets", {
        method: "POST",
        body: JSON.stringify({
          projectId: activeProjectId,
          items: program.outScope.map((a) => ({ value: a.value, type: a.type, origin: "program", inScope: false })),
        }),
        headers: { "Content-Type": "application/json" },
      });
      toast.success(`Imported ${program.inScope.length} targets + ${program.outScope.length} exclusions`);
      // Notify the Target Selection view to reload its lists
      window.dispatchEvent(new Event("antlion:targets-updated"));
      onImported?.();
      setView("target-selection");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setImporting(false);
    }
  };

  if (loading || !program) {
    return (
      <div className="h-full min-h-[300px] flex items-center justify-center">
        <div className="h-8 w-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const typeInfo = TYPE_BADGES[program.type] || TYPE_BADGES.bbp;
  const scopeEmpty = program.inScope.length === 0 && program.outScope.length === 0;
  const canFetchLive = ["hackerone", "bugcrowd", "yeswehack", "intigriti", "immunefi"].includes(
    program.platform,
  );

  return (
    <div className="flex flex-col min-h-0 h-full">
      {/* Header */}
      <div className={cn("flex-shrink-0 border-b border-border bg-background/40", compact ? "px-4 py-3" : "px-6 py-4")}>
        {onBack && (
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-3"
          >
            <ArrowLeft className="h-3 w-3" />
            Back to programs
          </button>
        )}

        <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <Badge className={cn("text-[9px] font-bold uppercase tracking-wider", typeInfo.cls)} variant="secondary">
                {typeInfo.label}
              </Badge>
              {program.isNew && <NewBadge />}
              <Badge variant="outline" className="text-[10px] font-medium uppercase">
                {PLATFORM_LABELS[program.platform]}
              </Badge>
              {program.state !== "active" && (
                <Badge className="text-[9px] font-bold uppercase bg-status-warning/15 text-status-warning" variant="secondary">
                  {program.state}
                </Badge>
              )}
            </div>
            <h1 className={cn("font-semibold tracking-tight mb-1", compact ? "text-xl" : "text-2xl")}>
              {program.name}
            </h1>
            <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
              {program.industry && <span className="flex items-center gap-1"><Building2 className="h-3 w-3" />{program.industry}</span>}
              {program.region && <span className="flex items-center gap-1"><Globe className="h-3 w-3" />{program.region}</span>}
              {program.languages && program.languages.length > 0 && (
                <span className="flex items-center gap-1">
                  <FileText className="h-3 w-3" />
                  {program.languages.join(", ")}
                </span>
              )}
              {program.scopeUpdated && (
                <span>Last scope update: {new Date(program.scopeUpdated).toLocaleDateString()}</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {canFetchLive && (
              <Button
                variant="outline"
                size="sm"
                onClick={refreshScope}
                disabled={refreshingScope}
              >
                {refreshingScope ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                )}
                {refreshingScope ? "Fetching..." : "Refresh live scope"}
              </Button>
            )}
            {program.url && (
              <Button variant="outline" size="sm" asChild>
                <a href={program.url} target="_blank" rel="noreferrer">
                  <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                  Platform
                </a>
              </Button>
            )}
            <Button size="sm" onClick={importProgramToProject} disabled={importing || (scopeEmpty && !refreshingScope)} className="bg-primary hover:bg-primary/90">
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              {importing
                ? "Importing..."
                : activeProjectId
                  ? "Import to this Project"
                  : "Create Project from Program"}
            </Button>
          </div>
        </div>
        {program.liveScopeError && (
          <div className="mt-3 text-[11px] text-status-warning flex items-start gap-1.5 p-2 rounded bg-status-warning/5 border border-status-warning/30">
            <AlertCircle className="h-3 w-3 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <div className="font-medium">Live scope could not be auto-fetched</div>
              <div className="opacity-80">{program.liveScopeError}</div>
            </div>
          </div>
        )}
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto min-h-0">
        <div className={cn("grid grid-cols-1 lg:grid-cols-3 gap-4", compact ? "p-4" : "p-6")}>
          {/* Stats card */}
          <Card className="lg:col-span-1 h-fit">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Award className="h-4 w-4 text-primary" />
                Reward Metrics
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <StatRow label="Maximum bounty" value={formatMoney(program.maxBounty)} accent />
              <StatRow label="Average bounty" value={formatMoney(program.avgBounty)} />
              <StatRow label="Total paid out" value={formatMoney(program.totalPaid)} />
              <div className="border-t border-border pt-3 mt-3 space-y-3">
                <StatRow label="Reports resolved" value={program.resolvedReports != null ? String(program.resolvedReports) : "—"} />
                <StatRow label="Acceptance rate" value={program.acceptanceRate != null ? `${program.acceptanceRate}%` : "—"} />
                <StatRow label="Avg response" value={formatHours(program.avgResponseHrs)} icon={<Clock className="h-3 w-3" />} />
                <StatRow label="Avg resolution" value={formatHours(program.avgResolutionHrs)} icon={<Clock className="h-3 w-3" />} />
              </div>
            </CardContent>
          </Card>

          {/* In-scope */}
          <Card className="lg:col-span-2 h-fit">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-status-success" />
                  In-Scope Assets
                  <Badge variant="secondary" className="text-[10px]">{program.inScope.length}</Badge>
                </span>
                {program.inScope.some((a) => a.isNew) && (
                  <span className="text-[10px] text-primary flex items-center gap-1">
                    <NewBadge /> {program.inScope.filter((a) => a.isNew).length} recently added
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {program.inScope.length === 0 ? (
                <div className="py-8 text-center">
                  <Target className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                  <div className="text-sm text-muted-foreground mb-3">
                    {refreshingScope
                      ? "Fetching live scope from platform..."
                      : canFetchLive
                        ? "No cached scope — click \"Refresh live scope\" to fetch from the platform."
                        : "No in-scope assets published for this program."}
                  </div>
                  {canFetchLive && !refreshingScope && (
                    <Button size="sm" variant="outline" onClick={refreshScope}>
                      <RefreshCw className="h-3 w-3 mr-1.5" />
                      Fetch live scope
                    </Button>
                  )}
                </div>
              ) : (
                <div className="space-y-1.5 max-h-[28rem] overflow-y-auto pr-1">
                  {program.inScope.map((a, i) => (
                    <motion.div
                      key={`${a.value}-${i}`}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: Math.min(i * 0.01, 0.3) }}
                      className={cn(
                        "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm font-mono",
                        a.isNew ? "bg-primary/5 border border-primary/30" : "hover:bg-muted/40",
                      )}
                    >
                      <Badge className={cn("text-[9px] uppercase", TYPE_COLORS[a.type] || TYPE_COLORS.other)} variant="secondary">
                        {a.type}
                      </Badge>
                      <span className="flex-1 truncate">{a.value}</span>
                      {a.isNew && <NewBadge />}
                      {a.instructions && (
                        <span className="text-[10px] text-muted-foreground truncate hidden md:inline max-w-[240px]" title={a.instructions}>
                          {a.instructions}
                        </span>
                      )}
                    </motion.div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Out-of-scope */}
          <Card className="lg:col-span-2 h-fit">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <XCircle className="h-4 w-4 text-status-error" />
                Out-of-Scope (Hard Exclusions)
                <Badge variant="secondary" className="text-[10px]">{program.outScope.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {program.outScope.length === 0 ? (
                <div className="py-6 text-center text-sm text-muted-foreground">
                  No explicit out-of-scope assets published.
                </div>
              ) : (
                <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                  {program.outScope.map((a, i) => (
                    <div
                      key={`${a.value}-${i}`}
                      className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm font-mono hover:bg-muted/40"
                    >
                      <Badge className={cn("text-[9px] uppercase", TYPE_COLORS[a.type] || TYPE_COLORS.other)} variant="secondary">
                        {a.type}
                      </Badge>
                      <span className="flex-1 truncate line-through opacity-60">{a.value}</span>
                      {a.instructions && (
                        <span className="text-[10px] text-muted-foreground truncate hidden md:inline max-w-[240px]" title={a.instructions}>
                          {a.instructions}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Policy */}
          {program.policy && (
            <Card className="lg:col-span-3">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <FileText className="h-4 w-4 text-primary" />
                  Program Policy Excerpt
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm leading-relaxed text-muted-foreground whitespace-pre-line">{program.policy}</p>
              </CardContent>
            </Card>
          )}

          {/* Scope history */}
          {program.scopeHistory && program.scopeHistory.length > 0 && (
            <Card className="lg:col-span-3">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <History className="h-4 w-4 text-primary" />
                  Scope Change Log
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {program.scopeHistory.map((h, i) => (
                    <div key={i} className="flex items-start gap-3 text-sm">
                      <div className="flex flex-col items-center pt-0.5">
                        <div className={cn("h-2 w-2 rounded-full", i === 0 ? "bg-primary" : "bg-muted-foreground/40")} />
                        {i < program.scopeHistory.length - 1 && <div className="w-px h-8 bg-border mt-1" />}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 text-xs">
                          <span className="font-medium">{new Date(h.date).toLocaleDateString()}</span>
                          <span className="text-status-success">+{h.added}</span>
                          {h.removed > 0 && <span className="text-status-error">-{h.removed}</span>}
                        </div>
                        {h.note && <div className="text-xs text-muted-foreground mt-0.5">{h.note}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Ethical use notice */}
          <div className="lg:col-span-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 flex items-start gap-2 text-xs text-muted-foreground">
            <AlertCircle className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />
            <p>
              By importing this program, you acknowledge that you have read and accepted the platform&apos;s policy,
              will test only explicitly in-scope assets, and will report findings via the program&apos;s designated channel.
              All pipeline stages enforce the scope defined above; out-of-scope assets become hard exclusions.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatRow({
  label,
  value,
  accent,
  icon,
}: {
  label: string;
  value: string;
  accent?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-muted-foreground flex items-center gap-1.5">
        {icon}
        {label}
      </span>
      <span className={cn("text-sm font-semibold tabular-nums", accent && "text-primary")}>{value}</span>
    </div>
  );
}
