"use client";

import { useEffect, useState, useCallback } from "react";
import { useAppStore } from "@/lib/stores/app-store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { History, RefreshCw, User, Cog, Bug, Crosshair, Activity, FileText } from "lucide-react";
import { cn } from "@/lib/utils";

const ACTION_ICONS: Record<string, React.ElementType> = {
  "project.create": Cog,
  "project.update": Cog,
  "project.soft-delete": Cog,
  "project.hard-delete": Cog,
  "targets.add": Crosshair,
  "pipeline.run.start": Activity,
  "pipeline.run.complete": Activity,
  "pipeline.run.paused": Activity,
  "pipeline.run.cancelled": Activity,
  "pipeline.run.running": Activity,
  "finding.update": Bug,
  "report.generate": FileText,
};

interface LogRow {
  id: string;
  projectId?: string;
  actor: string;
  action: string;
  target?: string;
  details?: string;
  createdAt: string;
}

export function AuditLogView() {
  const { activeProjectId } = useAppStore();
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!activeProjectId) {
      setLoading(false);
      return;
    }
    try {
      const r = await fetch(`/api/audit?projectId=${activeProjectId}&limit=200`);
      const d = await r.json();
      setLogs(d.logs || []);
    } catch (e) {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [activeProjectId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex-shrink-0 px-4 sm:px-6 py-4 border-b border-border bg-background/40 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg sm:text-xl font-semibold tracking-tight">Audit Log</h2>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
            Tamper-evident record of every action scoped to this project · essential for chain-of-custody
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} className="flex-shrink-0">
          <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
          Refresh
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="p-4 sm:p-6 max-w-4xl">
          {loading ? (
            <div className="space-y-1.5">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-12 rounded-md border border-border bg-card animate-pulse" />
              ))}
            </div>
          ) : logs.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border py-16 text-center">
              <History className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
              <div className="font-semibold mb-1">No audit entries yet</div>
              <div className="text-xs text-muted-foreground">
                Actions on this project (target changes, pipeline runs, finding updates) will appear here.
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              {logs.map((log, i) => {
                const Icon = ACTION_ICONS[log.action] || User;
                return (
                  <div
                    key={log.id}
                    className="flex items-center gap-3 rounded-md border border-border bg-card p-2.5"
                  >
                    <div className="h-7 w-7 rounded-md bg-muted flex items-center justify-center flex-shrink-0">
                      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-xs font-medium font-mono">{log.action}</span>
                        {log.target && (
                          <span className="text-[10px] text-muted-foreground font-mono truncate">
                            → {log.target.length > 40 ? log.target.slice(0, 40) + "..." : log.target}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                        <User className="h-2.5 w-2.5" />
                        {log.actor}
                        {log.details && <span className="truncate font-mono">· {log.details.slice(0, 80)}{log.details.length > 80 ? "..." : ""}</span>}
                      </div>
                    </div>
                    <Badge variant="outline" className="text-[10px] font-mono tabular-nums">
                      {new Date(log.createdAt).toLocaleString()}
                    </Badge>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
