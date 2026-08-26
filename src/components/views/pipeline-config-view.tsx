"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Play,
  Save,
  Settings2,
  Gauge,
  Camera,
  PauseCircle,
  Bell,
  Globe,
  RotateCw,
  Server,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  Layers,
  Info,
  Cpu,
  Lock,
  Terminal,
  Zap,
  AlertCircle,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { useAppStore } from "@/lib/stores/app-store";
import { useGlobalSettingsStore } from "@/lib/stores/global-settings-store";
import { useToolStatus, type ToolStatusClient } from "@/hooks/use-tool-status";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  PIPELINE_STAGES,
  TOOLS,
  type ToolConfig,
} from "@/lib/pipeline-config";
import type { PipelineConfig } from "@/lib/types";

const CATEGORY_LABELS: Record<string, string> = {
  subdomain: "Subdomain Discovery",
  "url-discovery": "URL & Endpoint Discovery",
  probing: "Live Probing & Fingerprinting",
  vulnerability: "Vulnerability Scanning",
  intelligence: "Intelligence Sources",
  secret: "Secret & Sensitive Data",
  portscan: "Port & Service Scan",
  content: "Content Discovery",
  screenshot: "Visual Asset Capture",
};

export function PipelineConfigView() {
  const { activeProjectId, setActiveRun, setView } = useAppStore();
  const openGlobalSettings = useGlobalSettingsStore((s) => s.openGlobalSettings);
  const { scan: toolScan, statusById } = useToolStatus();
  const [targetCount, setTargetCount] = useState(0);

  useEffect(() => {
    if (!activeProjectId) return;
    (async () => {
      try {
        const r = await fetch(`/api/targets?projectId=${activeProjectId}`);
        const d = await r.json();
        setTargetCount((d.targets || []).length);
      } catch {
        // ignore
      }
    })();
  }, [activeProjectId]);

  const [config, setConfig] = useState<PipelineConfig>({
    stages: PIPELINE_STAGES.map((s) => ({
      id: s.id,
      name: s.name,
      toolIds: s.toolIds,
      enabled: true,
      intensity: "normal" as const,
      parallelSafe: s.parallelSafe,
      description: s.description,
      category: s.category,
      required: s.required,
    })),
    concurrency: 10,
    rateLimit: 50,
    enableScreenshots: true,
    pauseAfterVulnScan: false,
    userAgentRotation: true,
    outputDir: `/home/z/my-project/.antlion/${activeProjectId}/output`,
  });

  const [activeStage, setActiveStage] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);

  const updateStage = (id: string, patch: any) => {
    setConfig((prev) => ({
      ...prev,
      stages: prev.stages.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    }));
  };

  const launch = async () => {
    if (!activeProjectId) {
      toast.error("Active project required");
      return;
    }
    setLaunching(true);
    try {
      // Fetch selected targets from API
      const tr = await fetch(`/api/targets?projectId=${activeProjectId}`);
      const td = await tr.json();
      const targets = (td.targets || []).map((t: any) => t.value);
      if (targets.length === 0) {
        toast.error("No targets selected. Add targets in Target Selection first.");
        setLaunching(false);
        return;
      }

      const r = await fetch("/api/runs", {
        method: "POST",
        body: JSON.stringify({
          projectId: activeProjectId,
          config,
          targetValues: targets,
        }),
        headers: { "Content-Type": "application/json" },
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      toast.success("Pipeline launched — orchestrating stages...");
      setActiveRun(d.runId);
      setView("pipeline-run");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLaunching(false);
    }
  };

  const enabledCount = config.stages.filter((s) => s.enabled).length;
  const toolCount = config.stages.filter((s) => s.enabled).reduce((sum, s) => sum + s.toolIds.length, 0);
  const missingTools = toolScan
    ? config.stages
        .filter((s) => s.enabled)
        .flatMap((s) => s.toolIds)
        .map((id) => statusById(id))
        .filter((t) => t && !t.installed)
    : [];

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex-shrink-0 px-4 sm:px-6 py-4 border-b border-border bg-background/40">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <h2 className="text-lg sm:text-xl font-semibold tracking-tight">Pipeline Configuration</h2>
            <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
              Modular stage-based orchestration · per-stage tuning · concurrency & rate limiting · notification hooks
            </p>
          </div>
          <Button onClick={launch} disabled={launching} className="bg-primary hover:bg-primary/90">
            {launching ? (
              <RotateCw className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <Play className="h-4 w-4 mr-1.5" />
            )}
            {launching ? "Launching..." : "Launch Pipeline"}
          </Button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 sm:gap-3 text-[11px] text-muted-foreground">
          <Badge variant="outline" className="text-[10px]">{enabledCount} / {config.stages.length} stages</Badge>
          <Badge variant="outline" className="text-[10px]">{toolCount} tools</Badge>
          <Badge variant="outline" className="text-[10px]">{targetCount} targets</Badge>
          {toolScan && (
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[10px] cursor-default",
                      toolScan.installedCount === toolScan.totalCount
                        ? "border-status-success/40 text-status-success"
                        : "border-amber-500/40 text-amber-500",
                    )}
                  >
                    <Server className="h-2.5 w-2.5 mr-1" />
                    {toolScan.installedCount}/{toolScan.totalCount} tools installed
                  </Badge>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <div className="text-xs">
                    Tool availability is detected from the command line at startup.
                    {missingTools.length > 0 && (
                      <div className="mt-1 text-muted-foreground">
                        Missing: {missingTools.map((t) => t!.name).join(", ")}
                      </div>
                    )}
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>

        {missingTools.length > 0 && (
          <div className="mt-2 text-[11px] text-amber-600 dark:text-amber-400 flex items-start gap-1.5">
            <AlertCircle className="h-3 w-3 mt-0.5 flex-shrink-0" />
            <span>
              {missingTools.length} tool{missingTools.length > 1 ? "s" : ""} not found on this machine — their
              stages will log an honest "binary not found" and skip: {missingTools.slice(0, 6).map((t) => t!.binary).join(", ")}
              {missingTools.length > 6 ? "…" : ""}
            </span>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Stages */}
          <div className="lg:col-span-2 space-y-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
              <Layers className="h-3.5 w-3.5" />
              <span className="font-medium uppercase tracking-wider">Pipeline Stages</span>
              <span className="hidden sm:inline">· stages run in order · parallel-safe tools execute concurrently within each</span>
            </div>
            {config.stages.map((stage, idx) => (
              <StageCard
                key={stage.id}
                stage={stage}
                index={idx}
                expanded={activeStage === stage.id}
                onToggleExpand={() => setActiveStage((prev) => (prev === stage.id ? null : stage.id))}
                onToggleEnabled={() => updateStage(stage.id, { enabled: !stage.enabled })}
                onSetIntensity={(v) => updateStage(stage.id, { intensity: v })}
                statusById={statusById}
              />
            ))}
          </div>

          {/* Right column: global settings */}
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Gauge className="h-4 w-4 text-primary" />
                  Execution
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs flex items-center gap-1">
                      <Cpu className="h-3 w-3" />
                      Max concurrency
                    </Label>
                    <span className="text-sm font-semibold tabular-nums">{config.concurrency}</span>
                  </div>
                  <Slider
                    value={[config.concurrency]}
                    min={1}
                    max={50}
                    step={1}
                    onValueChange={(v) => setConfig((p) => ({ ...p, concurrency: v[0] }))}
                  />
                  <div className="text-[10px] text-muted-foreground">Maximum parallel in-flight tool processes</div>
                </div>

                <Separator />

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs flex items-center gap-1">
                      <Zap className="h-3 w-3" />
                      Rate limit (req/s)
                    </Label>
                    <span className="text-sm font-semibold tabular-nums">{config.rateLimit}</span>
                  </div>
                  <Slider
                    value={[config.rateLimit]}
                    min={5}
                    max={500}
                    step={5}
                    onValueChange={(v) => setConfig((p) => ({ ...p, rateLimit: v[0] }))}
                  />
                  <div className="text-[10px] text-muted-foreground">Per-host request rate cap. Reduce for stealth mode.</div>
                </div>

                <Separator />

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs flex items-center gap-1.5">
                      <Camera className="h-3 w-3" />
                      Capture screenshots
                    </Label>
                    <Switch checked={config.enableScreenshots} onCheckedChange={(v) => setConfig((p) => ({ ...p, enableScreenshots: v }))} />
                  </div>
                  <div className="text-[10px] text-muted-foreground">Gowitness headless capture of live web assets for triage.</div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs flex items-center gap-1.5">
                      <PauseCircle className="h-3 w-3" />
                      Pause after vuln scan
                    </Label>
                    <Switch checked={config.pauseAfterVulnScan} onCheckedChange={(v) => setConfig((p) => ({ ...p, pauseAfterVulnScan: v }))} />
                  </div>
                  <div className="text-[10px] text-muted-foreground">Manual review checkpoint between vuln scan and secret detection.</div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Server className="h-4 w-4 text-primary" />
                  Transport
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-xs flex items-center gap-1.5">
                    <RotateCw className="h-3 w-3" />
                    Rotate User-Agent
                  </Label>
                  <Switch checked={config.userAgentRotation} onCheckedChange={(v) => setConfig((p) => ({ ...p, userAgentRotation: v }))} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs flex items-center gap-1.5">
                    <FolderOpen className="h-3 w-3" />
                    Output directory
                  </Label>
                  <Input
                    value={config.outputDir}
                    onChange={(e) => setConfig((p) => ({ ...p, outputDir: e.target.value }))}
                    className="h-8 font-mono text-xs"
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Bell className="h-4 w-4 text-primary" />
                  Notifications
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2.5">
                <div className="text-xs text-muted-foreground leading-relaxed">
                  Run and finding alerts are configured <b>globally</b> — Discord, Slack, Telegram,
                  email or generic webhooks — and fire for <b>every project</b>. There is no
                  per-project notification config.
                </div>
                <Button size="sm" variant="outline" onClick={() => openGlobalSettings("notifications")}>
                  <Globe className="h-3.5 w-3.5 mr-1.5" />
                  Open global notification hooks
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
interface StageCardProps {
  stage: any;
  index: number;
  expanded: boolean;
  onToggleExpand: () => void;
  onToggleEnabled: () => void;
  onSetIntensity: (v: "stealth" | "normal" | "aggressive") => void;
  statusById: (id: string) => ToolStatusClient | undefined;
}

function StageCard({ stage, index, expanded, onToggleExpand, onToggleEnabled, onSetIntensity, statusById }: StageCardProps) {
  const toolConfigs = stage.toolIds.map((id: string) => TOOLS.find((t) => t.id === id)).filter(Boolean) as ToolConfig[];
  const stageToolsInstalled = stage.toolIds.filter(
    (id: string) => statusById(id)?.installed,
  ).length;

  return (
    <Card className={cn("overflow-hidden transition-all", !stage.enabled && "opacity-50")}>
      <div className="flex items-center gap-2 sm:gap-3 p-3">
        <div className="text-[10px] font-mono text-muted-foreground tabular-nums w-6 hidden sm:block">{String(index + 1).padStart(2, "0")}</div>
        <Switch checked={stage.enabled} onCheckedChange={onToggleEnabled} />
        <button onClick={onToggleExpand} className="flex-1 flex items-center justify-between text-left min-w-0 gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium truncate">{stage.name}</span>
              {stage.required && (
                <Badge variant="secondary" className="text-[9px] uppercase">Required</Badge>
              )}
              {stage.parallelSafe ? (
                <Badge variant="outline" className="text-[9px] uppercase text-status-success hidden sm:inline-flex">Parallel-safe</Badge>
              ) : (
                <Badge variant="outline" className="text-[9px] uppercase text-status-warning hidden sm:inline-flex">Sequential</Badge>
              )}
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5 truncate">{stage.description}</div>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <Badge
              variant="outline"
              className={cn(
                "text-[9px] uppercase",
                stageToolsInstalled === toolConfigs.length
                  ? "text-status-success"
                  : stageToolsInstalled === 0
                    ? "text-status-error"
                    : "text-amber-500",
              )}
            >
              {stageToolsInstalled}/{toolConfigs.length} installed
            </Badge>
            <span className="text-[10px] text-muted-foreground hidden sm:inline">{toolConfigs.length} tools</span>
            {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </div>
        </button>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="border-t border-border"
          >
            <div className="p-3 space-y-3 bg-muted/20">
              {/* Intensity selector */}
              {stage.intensity && (
                <div>
                  <Label className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5 block">Intensity</Label>
                  <div className="flex gap-1.5">
                    {(["stealth", "normal", "aggressive"] as const).map((lvl) => (
                      <button
                        key={lvl}
                        onClick={() => onSetIntensity(lvl)}
                        className={cn(
                          "flex-1 rounded-md px-2 py-1 text-[11px] font-medium capitalize transition-colors",
                          stage.intensity === lvl
                            ? "bg-primary text-primary-foreground"
                            : "bg-card border border-border hover:bg-accent/30",
                        )}
                      >
                        {lvl}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Tool list */}
              <div>
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5 block">
                  Tools ({toolConfigs.length})
                </Label>
                <div className="space-y-1.5">
                  {toolConfigs.map((t) => {
                    const st = statusById(t.id);
                    return (
                    <div key={t.id} className={cn("rounded-md border bg-card p-2.5", !st?.installed && "border-amber-500/30")}>
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <div className="flex items-center gap-2 min-w-0">
                          <Terminal className="h-3 w-3 text-primary flex-shrink-0" />
                          <span className="text-xs font-medium truncate">{t.name}</span>
                          <code className="text-[10px] text-muted-foreground font-mono hidden sm:inline">{t.binary}</code>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {st ? (
                            st.installed ? (
                              <Badge variant="secondary" className="text-[9px] bg-status-success/15 text-status-success gap-0.5">
                                <CheckCircle2 className="h-2.5 w-2.5" />
                                {st.version ? `v${st.version.replace(/^v/, "")}` : "Installed"}
                              </Badge>
                            ) : (
                              <Badge variant="secondary" className="text-[9px] bg-status-error/10 text-status-error gap-0.5">
                                <XCircle className="h-2.5 w-2.5" />
                                Not installed
                              </Badge>
                            )
                          ) : null}
                          {t.requiresApiKey && (
                            <Badge
                              variant="secondary"
                              className={cn(
                                "text-[9px]",
                                st?.apiKeyPresent
                                  ? "bg-status-success/15 text-status-success"
                                  : "bg-amber-500/15 text-amber-400",
                              )}
                            >
                              <Lock className="h-2.5 w-2.5 mr-0.5" />
                              {st?.apiKeyPresent ? "API key set" : "API key missing"}
                            </Badge>
                          )}
                          {!t.enabled && (
                            <Badge variant="secondary" className="text-[9px] bg-muted text-muted-foreground">Disabled</Badge>
                          )}
                        </div>
                      </div>
                      <div className="text-[10px] text-muted-foreground leading-relaxed">{t.description}</div>
                      {st && !st.installed && (
                        <div className="mt-1.5 text-[10px] text-amber-600 dark:text-amber-400">
                          Install with e.g. <code className="px-1 bg-muted rounded">go install github.com/projectdiscovery/{t.binary}@latest</code> or your package manager, then reopen this page.
                        </div>
                      )}
                      {t.configurable.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {t.configurable.map((c) => (
                            <span key={c.key} className="text-[9px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono">
                              {c.label}: {String(c.default)}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}
