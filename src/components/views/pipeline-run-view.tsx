"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Play,
  Pause,
  Square,
  Activity,
  Clock,
  Cpu,
  HardDrive,
  MemoryStick,
  ArrowRight,
  Terminal,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Server,
  Gauge,
  Circle,
  Skull,
} from "lucide-react";
import { useAppStore } from "@/lib/stores/app-store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface LogLine {
  ts: string;
  level: "inf" | "wrn" | "err";
  text: string;
}

interface StageState {
  id: string;
  name: string;
  tool: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped" | "paused";
  progress: number;
  logs: LogLine[];
  startedAt?: string;
  finishedAt?: string;
  outputSummary: any;
  error?: string;
}

interface RunState {
  id: string;
  status: "pending" | "running" | "paused" | "completed" | "failed" | "cancelled";
  config: any;
  startedAt?: string;
  finishedAt?: string;
  totalStages: number;
  doneStages: number;
  findingDelta: number;
  assetDelta: number;
  resourceStats: any;
}

export function PipelineRunView() {
  const { activeProjectId, activeRunId, setActiveRun, setView } = useAppStore();
  const [run, setRun] = useState<RunState | null>(null);
  const [stages, setStages] = useState<StageState[]>([]);
  const [expandedStage, setExpandedStage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!activeProjectId) {
      setLoading(false);
      return;
    }
    if (!activeRunId) {
      // Find the most recent run for this project
      try {
        const r = await fetch(`/api/runs?projectId=${activeProjectId}`);
        const d = await r.json();
        const latest = (d.runs || [])[0];
        if (latest) {
          setActiveRun(latest.id);
        } else {
          setLoading(false);
          toast.info("No pipeline runs yet. Configure and launch from Pipeline Config.");
          setView("pipeline-config");
        }
      } catch (e) {
        setLoading(false);
      }
      return;
    }
    try {
      const r = await fetch(`/api/runs/${activeRunId}`);
      const d = await r.json();
      if (d.run) {
        setRun(d.run);
        setStages(d.stages || []);
        // Auto-expand running or first completed — uses functional setState to avoid deps
        setExpandedStage((prev) => {
          if (prev) return prev;
          const running = (d.stages || []).find((s: StageState) => s.status === "running");
          if (running) return running.id;
          const firstDone = (d.stages || []).find((s: StageState) => s.status === "completed");
          return firstDone?.id || (d.stages || [])[0]?.id || null;
        });
      }
    } catch (e) {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [activeProjectId, activeRunId, setActiveRun, setView]);

  useEffect(() => {
    load();
    const interval = setInterval(() => {
      if (run && (run.status === "running" || run.status === "pending")) {
        load();
      }
    }, 1500);
    return () => clearInterval(interval);
  }, [load, run?.status]);

  const controlRun = async (action: "pause" | "resume" | "cancel") => {
    if (!activeRunId) return;
    await fetch(`/api/runs/${activeRunId}`, {
      method: "PATCH",
      body: JSON.stringify({
        status: action === "pause" ? "paused" : action === "resume" ? "running" : "cancelled",
        projectId: activeProjectId,
      }),
      headers: { "Content-Type": "application/json" },
    });
    toast.success(`Run ${action}d`);
    load();
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="h-6 w-6 text-primary animate-spin" />
      </div>
    );
  }

  if (!run) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <Activity className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <div className="font-semibold mb-1">No active run</div>
          <Button onClick={() => setView("pipeline-config")} className="mt-2 bg-primary hover:bg-primary/90">
            Configure Pipeline
          </Button>
        </div>
      </div>
    );
  }

  const isRunning = run.status === "running";
  const isPaused = run.status === "paused";
  const isDone = run.status === "completed" || run.status === "failed" || run.status === "cancelled";
  const elapsed = run.startedAt ? Math.floor(((run.finishedAt ? new Date(run.finishedAt).getTime() : Date.now()) - new Date(run.startedAt).getTime()) / 1000) : 0;

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Top bar */}
      <div className="flex-shrink-0 px-4 sm:px-6 py-3 border-b border-border bg-background/40">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className={cn(
              "h-2 w-2 rounded-full",
              isRunning ? "bg-status-success animate-pulse-live" : isPaused ? "bg-status-warning" : isDone && run.status === "completed" ? "bg-status-success" : "bg-status-error",
            )} />
            <div>
              <div className="text-sm font-semibold">
                Run <code className="font-mono text-xs text-muted-foreground">{run.id.slice(0, 8)}</code>
              </div>
              <div className="text-[11px] text-muted-foreground">
                {run.startedAt && `Started ${new Date(run.startedAt).toLocaleTimeString()}`}
                {elapsed > 0 && ` · Elapsed ${formatDuration(elapsed)}`}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isRunning && (
              <Button variant="outline" size="sm" onClick={() => controlRun("pause")}>
                <Pause className="h-3.5 w-3.5 mr-1.5" />
                Pause
              </Button>
            )}
            {isPaused && (
              <Button variant="outline" size="sm" onClick={() => controlRun("resume")}>
                <Play className="h-3.5 w-3.5 mr-1.5" />
                Resume
              </Button>
            )}
            {!isDone && (
              <Button variant="outline" size="sm" onClick={() => controlRun("cancel")} className="text-status-error">
                <Square className="h-3.5 w-3.5 mr-1.5" />
                Cancel
              </Button>
            )}
            {isDone && (
              <Button size="sm" onClick={() => setView("results")} className="bg-primary hover:bg-primary/90">
                View Results
                <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
              </Button>
            )}
          </div>
        </div>

        {/* Overall progress */}
        <div className="mt-3 grid grid-cols-2 lg:grid-cols-4 gap-3">
          <MetricCard
            icon={<Activity className="h-3.5 w-3.5" />}
            label="Progress"
            value={`${run.doneStages}/${run.totalStages} stages`}
            progress={run.totalStages ? (run.doneStages / run.totalStages) * 100 : 0}
          />
          <MetricCard
            icon={<HardDrive className="h-3.5 w-3.5" />}
            label="Assets found"
            value={String(run.assetDelta || 0)}
          />
          <MetricCard
            icon={<Skull className="h-3.5 w-3.5" />}
            label="Findings"
            value={String(run.findingDelta || 0)}
            accent
          />
          <MetricCard
            icon={<Clock className="h-3.5 w-3.5" />}
            label="Elapsed"
            value={formatDuration(elapsed)}
          />
        </div>
      </div>

      {/* Stage timeline — stacks + scrolls naturally on mobile, split view on desktop */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-3 gap-3 p-4 overflow-y-auto lg:overflow-hidden">
        <div className="lg:col-span-1 space-y-1 lg:overflow-y-auto min-h-0">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold px-2 pb-1">
            Stage Timeline
          </div>
          {stages.map((s, i) => (
            <StageTimelineItem
              key={s.id}
              stage={s}
              index={i}
              active={expandedStage === s.id}
              onClick={() => setExpandedStage((prev) => (prev === s.id ? null : s.id))}
            />
          ))}
        </div>

        {/* Stage detail */}
        <div className="lg:col-span-2 rounded-lg border border-border bg-card overflow-hidden flex flex-col min-h-[300px] lg:min-h-0">
          {expandedStage && (() => {
            const s = stages.find((x) => x.id === expandedStage);
            if (!s) return null;
            return <StageDetail stage={s} />;
          })()}
          {!expandedStage && (
            <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
              <div className="text-center">
                <Terminal className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <div>Select a stage to view live logs</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StageTimelineItem({
  stage,
  index,
  active,
  onClick,
}: {
  stage: StageState;
  index: number;
  active: boolean;
  onClick: () => void;
}) {
  const statusIcon = () => {
    switch (stage.status) {
      case "running":
        return <Loader2 className="h-3 w-3 text-status-info animate-spin" />;
      case "completed":
        return <CheckCircle2 className="h-3 w-3 text-status-success" />;
      case "failed":
        return <XCircle className="h-3 w-3 text-status-error" />;
      case "skipped":
        return <Circle className="h-3 w-3 text-muted-foreground" />;
      case "paused":
        return <Pause className="h-3 w-3 text-status-warning" />;
      default:
        return <Circle className="h-3 w-3 text-muted-foreground/50" />;
    }
  };

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left rounded-md p-2 transition-colors flex items-center gap-2",
        active ? "bg-accent/30 border border-primary/30" : "hover:bg-muted/40 border border-transparent",
      )}
    >
      <div className="flex flex-col items-center">
        <div className="text-[9px] font-mono text-muted-foreground">{String(index + 1).padStart(2, "0")}</div>
      </div>
      {statusIcon()}
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium truncate">{stage.name}</div>
        <div className="text-[10px] text-muted-foreground font-mono truncate">{stage.tool}</div>
      </div>
      {stage.status === "running" && (
        <div className="text-[10px] text-status-info tabular-nums">{stage.progress}%</div>
      )}
      {stage.status === "completed" && stage.outputSummary?.findings > 0 && (
        <Badge variant="secondary" className="text-[9px] bg-status-success/15 text-status-success">
          +{stage.outputSummary.findings}
        </Badge>
      )}
    </button>
  );
}

function StageDetail({ stage }: { stage: StageState }) {
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [stage.logs]);

  const duration = stage.startedAt && stage.finishedAt
    ? Math.floor((new Date(stage.finishedAt).getTime() - new Date(stage.startedAt).getTime()) / 1000)
    : stage.startedAt
      ? Math.floor((Date.now() - new Date(stage.startedAt).getTime()) / 1000)
      : 0;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="p-3 border-b border-border flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold">{stage.name}</div>
          <div className="text-[11px] text-muted-foreground font-mono">{stage.tool}</div>
        </div>
        <div className="flex items-center gap-2">
          {stage.status === "running" && (
            <>
              <Progress value={stage.progress} className="w-24 h-1.5" />
              <span className="text-[11px] text-status-info tabular-nums">{stage.progress}%</span>
            </>
          )}
          {duration > 0 && (
            <Badge variant="outline" className="text-[10px]">
              <Clock className="h-2.5 w-2.5 mr-1" />
              {formatDuration(duration)}
            </Badge>
          )}
        </div>
      </div>

      <div ref={logRef} className="flex-1 overflow-y-auto p-3 font-mono text-[11px] leading-relaxed bg-[#0a0f1a] dark:bg-[#0a0f1a] bg-muted/30">
        {!stage.logs || stage.logs.length === 0 ? (
          <div className="text-muted-foreground italic">No log output yet...</div>
        ) : (
          stage.logs.map((log, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className="text-muted-foreground/60 text-[10px] tabular-nums">
                {new Date(log.ts).toLocaleTimeString("en-US", { hour12: false })}
              </span>
              <span className={cn(
                "font-semibold text-[10px] uppercase w-7 flex-shrink-0",
                log.level === "err" ? "text-status-error" : log.level === "wrn" ? "text-status-warning" : "text-status-info",
              )}>
                {log.level}
              </span>
              <span className={cn(
                "flex-1 break-all",
                log.level === "err" ? "text-status-error" : log.level === "wrn" ? "text-status-warning" : "text-foreground/90",
              )}>
                {log.text}
              </span>
            </div>
          ))
        )}
        {stage.status === "running" && (
          <div className="cursor-blink inline-block" />
        )}
      </div>

      {stage.outputSummary && Object.keys(stage.outputSummary).length > 0 && stage.status === "completed" && (
        <div className="p-3 border-t border-border bg-muted/20">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">Stage Output</div>
          <div className="flex flex-wrap gap-2 text-xs">
            {stage.outputSummary.findings > 0 && (
              <Badge variant="secondary" className="text-[10px] bg-status-success/15 text-status-success">
                +{stage.outputSummary.findings} findings
              </Badge>
            )}
            {stage.outputSummary.tools && (
              <Badge variant="outline" className="text-[10px]">{stage.outputSummary.tools} tools executed</Badge>
            )}
            {stage.outputSummary.duration && (
              <Badge variant="outline" className="text-[10px]">{stage.outputSummary.duration.toFixed(1)}s</Badge>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  progress,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  progress?: number;
  accent?: boolean;
}) {
  return (
    <div className="rounded-md border border-border bg-card p-2.5">
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mb-1">
        {icon}
        <span className="uppercase tracking-wider">{label}</span>
      </div>
      <div className={cn("text-lg font-semibold tabular-nums", accent && "text-primary")}>{value}</div>
      {progress !== undefined && (
        <Progress value={progress} className="h-1 mt-1.5" />
      )}
    </div>
  );
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${h}h ${min}m`;
}
