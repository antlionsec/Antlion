"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Plus,
  Trash2,
  Check,
  X,
  AlertTriangle,
  ClipboardPaste,
  ArrowRight,
  Shield,
  Crosshair,
  Ban,
  Loader2,
  Search,
} from "lucide-react";
import { useAppStore } from "@/lib/stores/app-store";
import { useDiscoveryStore } from "@/lib/stores/discovery-store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";

interface Target {
  id: string;
  value: string;
  type: string;
  origin: string;
  addedAt: string;
}

interface ExcludedTarget {
  id: string;
  value: string;
  type: string;
  origin: string;
  reason?: string;
  addedAt: string;
}

interface Warning {
  level: "warning" | "error";
  code: string;
  message: string;
  target?: string;
}

const TYPE_COLORS: Record<string, string> = {
  wildcard: "bg-violet-500/15 text-violet-400",
  domain: "bg-teal-500/15 text-teal-400",
  url: "bg-cyan-500/15 text-cyan-400",
  ip: "bg-amber-500/15 text-amber-400",
  cidr: "bg-orange-500/15 text-orange-400",
  mobile: "bg-rose-500/15 text-rose-400",
  api: "bg-emerald-500/15 text-emerald-400",
};

function classifyTarget(raw: string): string {
  const v = raw.trim();
  if (/^https?:\/\//i.test(v)) return "url";
  if (/^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/.test(v)) return "cidr";
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(v)) return "ip";
  if (/^\*\..+\.[a-z]{2,}$/i.test(v)) return "wildcard";
  if (/^com\..+\.mobile$/i.test(v) || /^io\..+\.mobile$/i.test(v)) return "mobile";
  if (/^.+\.[a-z]{2,}$/i.test(v)) return "domain";
  return "domain";
}

function preflightCheck(targets: { value: string; type: string }[]): Warning[] {
  const warnings: Warning[] = [];
  const roots = new Set<string>();
  for (const t of targets) {
    if (t.type === "wildcard") {
      const root = t.value.replace(/^\*\./, "");
      if (roots.has(root)) {
        warnings.push({ level: "warning", code: "duplicate-wildcard-root", message: `Multiple wildcards sharing root ${root} — consider consolidating.`, target: t.value });
      }
      roots.add(root);
    }
    if (t.type === "ip" || t.type === "cidr") {
      warnings.push({ level: "warning", code: "ip-target", message: `IP/CIDR targets require explicit authorization verification. Confirm with program owner before scanning.`, target: t.value });
    }
    if (t.value.includes("localhost") || t.value.includes("127.0.0.1") || t.value.includes("0.0.0.0")) {
      warnings.push({ level: "error", code: "loopback-target", message: `Loopback addresses are never in scope.`, target: t.value });
    }
  }
  if (targets.length === 0) {
    warnings.push({ level: "error", code: "no-targets", message: "No targets selected. Add at least one in-scope asset before launching." });
  }
  if (targets.length > 500) {
    warnings.push({ level: "warning", code: "large-scope", message: `Large scope (${targets.length} targets) — consider staging with lower concurrency to avoid rate-limit bans.` });
  }
  return warnings;
}

export function TargetSelectionView() {
  const { activeProjectId, setView } = useAppStore();
  const { openDiscovery } = useDiscoveryStore();
  const [targets, setTargets] = useState<Target[]>([]);
  const [excluded, setExcluded] = useState<ExcludedTarget[]>([]);
  const [loading, setLoading] = useState(true);
  const [bulkText, setBulkText] = useState("");
  const [bulkOpen, setBulkOpen] = useState(false);
  const [manualValue, setManualValue] = useState("");
  const [manualType, setManualType] = useState("domain");
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (!activeProjectId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const r = await fetch(`/api/targets?projectId=${activeProjectId}`);
      const d = await r.json();
      setTargets(d.targets || []);
      setExcluded(d.excluded || []);
      // Pre-select all targets by default
      setSelected(new Set((d.targets || []).map((t: Target) => t.id)));
    } catch (e) {
      toast.error("Failed to load targets");
    } finally {
      setLoading(false);
    }
  }, [activeProjectId]);

  useEffect(() => {
    load();
  }, [load]);

  // Reload when the discovery dialog imports a program into this project
  useEffect(() => {
    const handler = () => load();
    window.addEventListener("antlion:targets-updated", handler);
    return () => window.removeEventListener("antlion:targets-updated", handler);
  }, [load]);

  const addManual = async () => {
    if (!manualValue.trim() || !activeProjectId) return;
    try {
      await fetch("/api/targets", {
        method: "POST",
        body: JSON.stringify({
          projectId: activeProjectId,
          items: [{ value: manualValue.trim(), type: manualType === "auto" ? classifyTarget(manualValue) : manualType, origin: "manual" }],
        }),
        headers: { "Content-Type": "application/json" },
      });
      toast.success("Target added");
      setManualValue("");
      load();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const addBulk = async () => {
    if (!bulkText.trim() || !activeProjectId) return;
    const lines = bulkText.split("\n").map((l) => l.trim()).filter(Boolean);
    const items = lines.map((l) => ({ value: l, type: classifyTarget(l), origin: "paste" as const }));
    try {
      const r = await fetch("/api/targets", {
        method: "POST",
        body: JSON.stringify({ projectId: activeProjectId, items }),
        headers: { "Content-Type": "application/json" },
      });
      const d = await r.json();
      toast.success(`Added ${d.added} targets${d.excluded ? `, ${d.excluded} exclusions` : ""}`);
      setBulkText("");
      setBulkOpen(false);
      load();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const removeTarget = async (id: string) => {
    if (!activeProjectId) return;
    await fetch(`/api/targets?projectId=${activeProjectId}&id=${id}&scope=in`, { method: "DELETE" });
    setTargets((prev) => prev.filter((t) => t.id !== id));
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const removeExcluded = async (id: string) => {
    if (!activeProjectId) return;
    await fetch(`/api/targets?projectId=${activeProjectId}&id=${id}&scope=out`, { method: "DELETE" });
    setExcluded((prev) => prev.filter((t) => t.id !== id));
  };

  const toggleTarget = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedTargets = targets.filter((t) => selected.has(t.id));
  const warnings = preflightCheck(selectedTargets.map((t) => ({ value: t.value, type: t.type })));
  const hasErrors = warnings.some((w) => w.level === "error");
  const visibleTargets = filter
    ? targets.filter((t) => t.value.toLowerCase().includes(filter.toLowerCase()))
    : targets;

  const launchPipeline = () => {
    if (hasErrors) {
      toast.error("Resolve pre-flight errors before launching");
      return;
    }
    setView("pipeline-config");
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="h-6 w-6 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Header */}
      <div className="flex-shrink-0 px-4 sm:px-6 py-4 border-b border-border bg-background/40">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-3">
          <div>
            <h2 className="text-lg sm:text-xl font-semibold tracking-tight">Target Selection</h2>
            <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
              Multi-select in-scope assets · out-of-scope items become hard exclusions across every pipeline stage
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              onClick={openDiscovery}
              size="sm"
              className="bg-primary hover:bg-primary/90"
            >
              <Search className="h-3.5 w-3.5 mr-1.5" />
              Discover a Program
            </Button>
            <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                  <ClipboardPaste className="h-3.5 w-3.5 mr-1.5" />
                  Bulk Paste
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                  <DialogTitle>Bulk paste targets</DialogTitle>
                  <DialogDescription>
                    One target per line. The system auto-classifies (wildcard/domain/url/ip/cidr) and validates each.
                  </DialogDescription>
                </DialogHeader>
                <Textarea
                  value={bulkText}
                  onChange={(e) => setBulkText(e.target.value)}
                  placeholder={"*.acme.com\nhttps://app.acme.com\n192.0.2.0/24"}
                  className="min-h-[200px] font-mono text-xs"
                />
                <DialogFooter>
                  <Button variant="outline" onClick={() => setBulkOpen(false)}>Cancel</Button>
                  <Button onClick={addBulk} disabled={!bulkText.trim()} className="bg-primary hover:bg-primary/90">
                    Add {bulkText.split("\n").filter((l) => l.trim()).length} targets
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Summary strip */}
        <div className="flex items-center gap-3 sm:gap-4 text-xs flex-wrap">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-status-success/10 text-status-success border border-status-success/30">
            <Check className="h-3 w-3" />
            <span className="font-semibold tabular-nums">{selectedTargets.length}</span> selected
            <span className="text-muted-foreground hidden sm:inline">of {targets.length}</span>
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-status-error/10 text-status-error border border-status-error/30">
            <Ban className="h-3 w-3" />
            <span className="font-semibold tabular-nums">{excluded.length}</span>
            <span className="hidden sm:inline">hard exclusions</span>
          </div>
        </div>
      </div>

      {/* Body — stacks on mobile, 3 columns on desktop; the whole area scrolls
          naturally on small screens while panels scroll internally on desktop */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-3 gap-4 p-4 sm:p-6 overflow-y-auto lg:overflow-hidden">
        {/* In-scope panel */}
        <Card className="lg:col-span-2 flex flex-col overflow-hidden min-h-[300px]">
          <CardHeader className="flex-row items-center justify-between pb-3 border-b border-border flex-wrap gap-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Crosshair className="h-4 w-4 text-status-success" />
              In-Scope Assets
              <Badge variant="secondary" className="text-[10px]">{targets.length}</Badge>
            </CardTitle>
            <div className="flex items-center gap-2">
              {targets.length > 5 && (
                <div className="relative hidden sm:block">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                  <Input
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder="Filter..."
                    className="h-7 w-36 pl-8 text-xs"
                  />
                </div>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelected(new Set(targets.map((t) => t.id)))}
                className="text-xs h-7"
              >
                Select all
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelected(new Set())}
                className="text-xs h-7"
              >
                Clear
              </Button>
            </div>
          </CardHeader>
          <CardContent className="flex-1 overflow-y-auto p-0 min-h-0">
            <div className="p-4 space-y-1">
              {targets.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border py-12 text-center">
                  <Crosshair className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                  <div className="text-sm font-medium mb-1">No in-scope targets yet</div>
                  <div className="text-xs text-muted-foreground mb-3">
                    Discover a bug bounty program and import its scope, paste a list, or add manually below.
                  </div>
                  <Button variant="outline" size="sm" onClick={openDiscovery}>
                    <Search className="h-3.5 w-3.5 mr-1" />
                    Discover a Program
                  </Button>
                </div>
              ) : (
                <AnimatePresence mode="popLayout">
                  {visibleTargets.map((t, i) => (
                    <motion.div
                      key={t.id}
                      layout
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: 0.15, delay: Math.min(i * 0.005, 0.1) }}
                      className={cn(
                        "flex items-center gap-2 rounded-md px-2.5 py-2 cursor-pointer transition-colors",
                        selected.has(t.id)
                          ? "bg-status-success/10 border border-status-success/30"
                          : "hover:bg-muted/50 border border-transparent",
                      )}
                      onClick={() => toggleTarget(t.id)}
                    >
                      <button
                        className={cn(
                          "h-4 w-4 rounded border flex items-center justify-center flex-shrink-0",
                          selected.has(t.id)
                            ? "bg-status-success border-status-success text-white"
                            : "border-border",
                        )}
                        onClick={(e) => { e.stopPropagation(); toggleTarget(t.id); }}
                      >
                        {selected.has(t.id) && <Check className="h-3 w-3" />}
                      </button>
                      <Badge className={cn("text-[9px] uppercase flex-shrink-0", TYPE_COLORS[t.type] || TYPE_COLORS.domain)} variant="secondary">
                        {t.type}
                      </Badge>
                      <span className="flex-1 truncate font-mono text-xs sm:text-sm">{t.value}</span>
                      <span className="text-[10px] text-muted-foreground hidden sm:inline flex-shrink-0">{t.origin}</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 opacity-40 hover:opacity-100 flex-shrink-0"
                        onClick={(e) => { e.stopPropagation(); removeTarget(t.id); }}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </motion.div>
                  ))}
                </AnimatePresence>
              )}

              {/* Manual add form */}
              <div className="pt-3 mt-3 border-t border-border">
                <div className="flex items-center gap-2">
                  <Input
                    value={manualValue}
                    onChange={(e) => setManualValue(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addManual()}
                    placeholder="Add target — e.g. *.acme.com"
                    className="font-mono text-xs sm:text-sm h-9"
                  />
                  <Button size="sm" onClick={addManual} disabled={!manualValue.trim()} className="bg-primary hover:bg-primary/90">
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="text-[10px] text-muted-foreground mt-1.5">
                  Auto-classifies type. Press Enter to add.
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Right column: exclusions + pre-flight */}
        <div className="flex flex-col gap-4 lg:overflow-hidden lg:min-h-0">
          <Card className="flex flex-col overflow-hidden lg:flex-1 min-h-[160px]">
            <CardHeader className="pb-3 border-b border-border">
              <CardTitle className="text-sm flex items-center gap-2">
                <Ban className="h-4 w-4 text-status-error" />
                Hard Exclusions
                <Badge variant="secondary" className="text-[10px]">{excluded.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto p-0 min-h-0">
              <div className="p-3 space-y-1">
                {excluded.length === 0 ? (
                  <div className="text-[11px] text-muted-foreground text-center py-4">
                    No explicit exclusions. Out-of-scope items imported from programs appear here.
                  </div>
                ) : (
                  excluded.map((t) => (
                    <div
                      key={t.id}
                      className="group flex items-center gap-1.5 rounded-md px-2 py-1.5 hover:bg-muted/40"
                    >
                      <Badge className={cn("text-[9px] uppercase flex-shrink-0", TYPE_COLORS[t.type] || TYPE_COLORS.domain)} variant="secondary">
                        {t.type}
                      </Badge>
                      <span className="flex-1 truncate font-mono text-xs line-through opacity-60">{t.value}</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 opacity-0 group-hover:opacity-100 flex-shrink-0"
                        onClick={() => removeExcluded(t.id)}
                      >
                        <Trash2 className="h-2.5 w-2.5" />
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>

          {/* Pre-flight validation */}
          <Card className={cn(
            "flex-shrink-0",
            hasErrors ? "border-status-error/40" : warnings.length > 0 ? "border-status-warning/40" : "",
          )}>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs flex items-center gap-1.5">
                <Shield className="h-3.5 w-3.5 text-primary" />
                Pre-flight Validation
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 space-y-2">
              {warnings.length === 0 ? (
                <div className="text-xs flex items-center gap-1.5 text-status-success">
                  <Check className="h-3 w-3" /> Scope validated · ready to launch
                </div>
              ) : (
                warnings.map((w, i) => (
                  <div
                    key={i}
                    className={cn(
                      "flex items-start gap-1.5 text-xs rounded-md px-2 py-1.5",
                      w.level === "error" ? "bg-status-error/10 text-status-error" : "bg-status-warning/10 text-status-warning",
                    )}
                  >
                    {w.level === "error" ? <X className="h-3 w-3 mt-0.5 flex-shrink-0" /> : <AlertTriangle className="h-3 w-3 mt-0.5 flex-shrink-0" />}
                    <span>{w.message}</span>
                  </div>
                ))
              )}
              <Button
                className="w-full mt-2 bg-primary hover:bg-primary/90"
                size="sm"
                disabled={hasErrors || selectedTargets.length === 0}
                onClick={launchPipeline}
              >
                <ArrowRight className="h-3.5 w-3.5 mr-1.5" />
                Continue to Pipeline
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
