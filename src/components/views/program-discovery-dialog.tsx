"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Search,
  TrendingUp,
  Clock,
  DollarSign,
  Globe,
  ChevronRight,
  Sparkles,
  RefreshCw,
  Cloud,
  CheckCircle2,
  XCircle,
  Loader2,
  Radio,
  KeyRound,
  LogIn,
} from "lucide-react";
import { useDiscoveryStore } from "@/lib/stores/discovery-store";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { NewBadge } from "@/components/antlion/badges";
import { ProgramDetailContent, formatMoney, formatHours } from "./program-detail-content";
import {
  PlatformLoginPanel,
  type PlatformAuthEntry,
} from "@/components/antlion/platform-login-panel";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ProgramAsset {
  value: string;
  type: string;
  instructions?: string;
}

interface Program {
  id: string;
  name: string;
  platform: string;
  type: string;
  url?: string;
  state: string;
  industry?: string;
  languages: string[];
  region?: string;
  maxBounty?: number | null;
  avgBounty?: number | null;
  totalPaid?: number | null;
  resolvedReports?: number | null;
  avgResponseHrs?: number | null;
  avgResolutionHrs?: number | null;
  acceptanceRate?: number | null;
  inScope: ProgramAsset[];
  outScope: ProgramAsset[];
  firstSeenAt: string;
  lastSyncAt: string;
  scopeUpdated?: string;
  isNew: boolean;
}

interface SyncResult {
  platform: string;
  ok: boolean;
  count: number;
  error?: string;
  durationMs: number;
}

interface SyncInfo {
  at?: string;
  results?: SyncResult[];
  count?: number;
  durationMs?: number;
}

const PLATFORM_LABELS: Record<string, string> = {
  hackerone: "HackerOne",
  bugcrowd: "Bugcrowd",
  intigriti: "Intigriti",
  yeswehack: "YesWeHack",
  immunefi: "Immunefi",
  disclose: "disclose.io",
};

const TYPE_LABELS: Record<string, { label: string; color: string }> = {
  bbp: { label: "BBP", color: "bg-status-success/15 text-status-success" },
  vdp: { label: "VDP", color: "bg-status-info/15 text-status-info" },
  private: { label: "Private", color: "bg-violet-500/15 text-violet-400" },
  crowdsourced: { label: "Crowd", color: "bg-amber-500/15 text-amber-400" },
  web3: { label: "Web3", color: "bg-cyan-500/15 text-cyan-400" },
};

function timeAgo(iso?: string): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

/**
 * Program Discovery — popup feature window.
 * Live listings from all bug bounty platforms with real metrics (avg response,
 * bounties paid, scope counts). Platforms requiring auth show an inline API-key
 * prompt; credentials persist across every project.
 */
export function ProgramDiscoveryDialog() {
  const { open, closeDiscovery } = useDiscoveryStore();
  const [selectedProgramId, setSelectedProgramId] = useState<string | null>(null);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncInfo, setSyncInfo] = useState<SyncInfo | null>(null);
  const [query, setQuery] = useState("");
  const [platform, setPlatform] = useState("all");
  const [type, setType] = useState("all");
  const [sort, setSort] = useState("newest");
  const [onlyNew, setOnlyNew] = useState(false);
  const [authStatus, setAuthStatus] = useState<PlatformAuthEntry[]>([]);
  const [showAuth, setShowAuth] = useState(false);

  const loadAuthStatus = useCallback(async () => {
    try {
      const r = await fetch("/api/platform-auth");
      const d = await r.json();
      setAuthStatus(d.status || []);
    } catch {
      // ignore
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ q: query, sort });
      if (platform !== "all") params.set("platform", platform);
      if (type !== "all") params.set("type", type);
      if (onlyNew) params.set("onlyNew", "1");
      const r = await fetch(`/api/programs?${params}`);
      const d = await r.json();
      setPrograms(d.programs || []);
      setSyncInfo(d.sync || null);
    } catch (e) {
      toast.error("Failed to load programs");
    } finally {
      setLoading(false);
    }
  }, [query, sort, platform, type, onlyNew]);

  const syncNow = useCallback(async () => {
    setSyncing(true);
    try {
      const r = await fetch("/api/programs/refresh", { method: "POST" });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      const okSources = (d.results || []).filter((r: SyncResult) => r.ok).length;
      const totalSources = (d.results || []).length;
      toast.success(
        `Synced ${d.count} programs from ${okSources}/${totalSources} sources in ${((d.durationMs || 0) / 1000).toFixed(1)}s`,
      );
      await load();
      await loadAuthStatus();
    } catch (e: any) {
      toast.error(`Sync failed: ${e.message}`);
    } finally {
      setSyncing(false);
    }
  }, [load, loadAuthStatus]);

  // On open: load auth status + programs; auto-sync on first ever run
  useEffect(() => {
    if (!open) return;
    setSelectedProgramId(null);
    loadAuthStatus();
    (async () => {
      setLoading(true);
      try {
        const r = await fetch(`/api/programs`);
        const d = await r.json();
        setPrograms(d.programs || []);
        setSyncInfo(d.sync || null);
        if ((d.programs || []).length === 0 && !d.sync) {
          setSyncing(true);
          try {
            const sr = await fetch("/api/programs/refresh", { method: "POST" });
            const sd = await sr.json();
            if (sd.error) throw new Error(sd.error);
            const rr = await fetch(`/api/programs`);
            const rd = await rr.json();
            setPrograms(rd.programs || []);
            setSyncInfo(rd.sync || null);
            const okSources = (sd.results || []).filter((r: SyncResult) => r.ok).length;
            const totalSources = (sd.results || []).length;
            toast.success(
              `Synced ${sd.count} programs from ${okSources}/${totalSources} sources in ${((sd.durationMs || 0) / 1000).toFixed(1)}s`,
            );
          } catch (e: any) {
            toast.error(`Initial sync failed: ${e.message}`);
          } finally {
            setSyncing(false);
          }
        }
      } catch (e) {
        toast.error("Failed to load programs");
      } finally {
        setLoading(false);
      }
    })();
  }, [open, loadAuthStatus]);

  // Debounced reload on filter change
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load, open]);

  const newCount = programs.filter((p) => p.isNew).length;
  const totalBounties = programs.reduce((s, p) => s + (p.totalPaid || 0), 0);

  const platformStatus = useMemo(() => {
    const map: Record<string, { ok: boolean; count: number; error?: string }> = {};
    for (const r of syncInfo?.results || []) {
      map[r.platform] = { ok: r.ok, count: r.count, error: r.error };
    }
    return map;
  }, [syncInfo]);

  const authByPlatform = useMemo(() => {
    const map: Record<string, PlatformAuthEntry> = {};
    for (const a of authStatus) map[a.platform] = a;
    return map;
  }, [authStatus]);

  const needsLoginPlatforms = authStatus.filter(
    (a) => a.requiresAuth && !a.authenticated,
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && closeDiscovery()}>
      <DialogContent
        className="sm:max-w-[95vw] lg:max-w-[1100px] w-[95vw] h-[92vh] max-h-[92vh] p-0 gap-0 overflow-hidden flex flex-col rounded-xl"
        showCloseButton={true}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Program Discovery</DialogTitle>
          <DialogDescription>
            Browse live bug bounty programs from all platforms
          </DialogDescription>
        </DialogHeader>

        {selectedProgramId ? (
          <ProgramDetailContent
            programId={selectedProgramId}
            onBack={() => setSelectedProgramId(null)}
            onImported={closeDiscovery}
            compact
          />
        ) : (
          <div className="flex flex-col min-h-0 flex-1">
            {/* Toolbar */}
            <div className="flex-shrink-0 px-4 sm:px-6 py-4 border-b border-border bg-background/40">
              <div className="mb-3 flex items-start justify-between gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <h2 className="text-xl sm:text-2xl font-semibold tracking-tight flex items-center gap-2">
                    Program Discovery
                    <Radio className="h-4 w-4 text-primary animate-pulse-live" />
                  </h2>
                  <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
                    Live listings from HackerOne, Bugcrowd, Intigriti, YesWeHack, Immunefi and disclose.io .
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {syncInfo?.at && (
                    <TooltipProvider delayDuration={200}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="hidden sm:inline-block text-[10px] text-muted-foreground font-mono px-2 py-1 rounded border border-border bg-card">
                            Last sync: {timeAgo(syncInfo.at)}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">
                          <div className="text-xs space-y-1">
                            <div>{new Date(syncInfo.at).toLocaleString()}</div>
                            {syncInfo.durationMs != null && (
                              <div className="text-muted-foreground">
                                {(syncInfo.durationMs / 1000).toFixed(1)}s · {syncInfo.count || 0} programs
                              </div>
                            )}
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                  <Button
                    onClick={syncNow}
                    disabled={syncing}
                    className="bg-primary hover:bg-primary/90"
                    size="sm"
                  >
                    {syncing ? (
                      <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                    ) : (
                      <Cloud className="h-3.5 w-3.5 mr-1.5" />
                    )}
                    <span className="hidden sm:inline">{syncing ? "Syncing..." : "Sync live sources"}</span>
                    <span className="sm:hidden">Sync</span>
                  </Button>
                </div>
              </div>

              {/* Auth-required banner */}
              {needsLoginPlatforms.length > 0 && (
                <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 flex flex-col sm:flex-row sm:items-center gap-2">
                  <div className="flex-1 flex items-start gap-2 text-xs text-amber-600 dark:text-amber-400">
                    <KeyRound className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                    <span>
                      {needsLoginPlatforms.map((a) => PLATFORM_LABELS[a.platform] || a.platform).join(" and ")}{" "}
                      {needsLoginPlatforms.length > 1 ? "require" : "requires"} an API key to load programs &amp; scope.
                      Connect once — the key persists for every project.
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setShowAuth((v) => !v)}
                    className="h-7 text-xs border-amber-500/40 hover:bg-amber-500/10 flex-shrink-0 w-fit"
                  >
                    <LogIn className="h-3 w-3 mr-1" />
                    {showAuth ? "Hide" : "Connect"}
                  </Button>
                </div>
              )}

              {/* Inline auth panels */}
              {showAuth && needsLoginPlatforms.length > 0 && (
                <div className="mb-3 grid grid-cols-1 md:grid-cols-2 gap-2">
                  {needsLoginPlatforms.map((a) => (
                    <PlatformLoginPanel
                      key={a.platform}
                      entry={a}
                      onAuthChanged={() => {
                        loadAuthStatus();
                        syncNow();
                      }}
                    />
                  ))}
                </div>
              )}

              {/* Source status bar */}
              <div className="flex flex-wrap items-center gap-1.5 mb-3">
                {Object.entries(PLATFORM_LABELS).map(([key, label]) => {
                  const st = platformStatus[key];
                  const auth = authByPlatform[key];
                  const needsLogin = auth?.requiresAuth && !auth?.authenticated;
                  const isUnknown = !st;
                  return (
                    <Tooltip key={key}>
                      <TooltipTrigger asChild>
                        <div
                          className={cn(
                            "flex items-center gap-1.5 text-[10px] px-2 py-1 rounded border font-medium transition-colors cursor-default",
                            needsLogin
                              ? "border-amber-500/40 bg-amber-500/10 text-amber-500"
                              : isUnknown
                                ? "border-border bg-muted/40 text-muted-foreground"
                                : st.ok
                                  ? "border-status-success/30 bg-status-success/10 text-status-success"
                                  : "border-status-error/30 bg-status-error/10 text-status-error",
                          )}
                        >
                          {needsLogin ? (
                            <KeyRound className="h-3 w-3" />
                          ) : isUnknown ? (
                            <div className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
                          ) : st.ok ? (
                            <CheckCircle2 className="h-3 w-3" />
                          ) : (
                            <XCircle className="h-3 w-3" />
                          )}
                          <span>{label}</span>
                          {st && st.count > 0 && (
                            <span className="opacity-60 font-mono">{st.count}</span>
                          )}
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">
                        {needsLogin ? (
                          <span className="text-xs">API key required — click Connect above</span>
                        ) : isUnknown ? (
                          <span className="text-xs">No sync yet</span>
                        ) : st.ok ? (
                          <span className="text-xs">{st.count} programs · live source OK</span>
                        ) : (
                          <span className="text-xs">Failed: {st.error}</span>
                        )}
                      </TooltipContent>
                    </Tooltip>
                  );
                })}
              </div>

              {/* Filter bar */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-[160px] max-w-md">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search programs, industry, platform..."
                    className="pl-9 h-9"
                  />
                </div>
                <Select value={platform} onValueChange={setPlatform}>
                  <SelectTrigger className="h-9 w-[130px]">
                    <SelectValue placeholder="Platform" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Platforms</SelectItem>
                    {Object.entries(PLATFORM_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={type} onValueChange={setType}>
                  <SelectTrigger className="h-9 w-[110px]">
                    <SelectValue placeholder="Type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Types</SelectItem>
                    <SelectItem value="bbp">BBP</SelectItem>
                    <SelectItem value="vdp">VDP</SelectItem>
                    <SelectItem value="private">Private</SelectItem>
                    <SelectItem value="web3">Web3</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={sort} onValueChange={setSort}>
                  <SelectTrigger className="h-9 w-[150px]">
                    <SelectValue placeholder="Sort" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="newest">Newest</SelectItem>
                    <SelectItem value="scope-updated">Scope Updated</SelectItem>
                    <SelectItem value="bounty-high">Max Bounty ↓</SelectItem>
                    <SelectItem value="bounty-avg">Avg Bounty ↓</SelectItem>
                    <SelectItem value="total-paid">Total Paid ↓</SelectItem>
                    <SelectItem value="fastest">Fastest Response</SelectItem>
                    <SelectItem value="acceptance">Acceptance ↓</SelectItem>
                    <SelectItem value="name">Name A–Z</SelectItem>
                  </SelectContent>
                </Select>
                <div className="flex items-center gap-2 px-3 h-9 rounded-md border border-border bg-card">
                  <Switch id="only-new-dialog" checked={onlyNew} onCheckedChange={setOnlyNew} className="scale-90" />
                  <Label htmlFor="only-new-dialog" className="text-xs cursor-pointer flex items-center gap-1">
                    <Sparkles className="h-3 w-3 text-primary" />
                    New
                  </Label>
                </div>
                <Button variant="outline" size="sm" onClick={load} disabled={loading || syncing} className="h-9">
                  <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", loading && "animate-spin")} />
                  <span className="hidden sm:inline">Reload</span>
                </Button>
              </div>

              {/* Stats summary */}
              <div className="mt-3 flex flex-wrap gap-4 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <span className="font-semibold text-foreground tabular-nums">{programs.length}</span> programs
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse-live" />
                  <span className="font-semibold text-foreground tabular-nums">{newCount}</span> new
                </span>
                <span className="hidden sm:flex items-center gap-1">
                  <DollarSign className="h-3 w-3" />
                  <span className="font-semibold text-foreground tabular-nums">{formatMoney(totalBounties)}</span> known paid
                </span>
              </div>
            </div>

            {/* Programs grid — native scrolling */}
            <div className="flex-1 overflow-y-auto min-h-0">
              <div className="p-4 sm:p-6">
                {loading || syncing ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {Array.from({ length: 9 }).map((_, i) => (
                      <Skeleton key={i} className="h-56 rounded-xl" />
                    ))}
                  </div>
                ) : programs.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border py-16 text-center">
                    <Globe className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                    <h3 className="font-semibold mb-1">No programs match</h3>
                    <p className="text-sm text-muted-foreground mb-4">
                      Try adjusting filters or sync live sources.
                    </p>
                    <Button onClick={syncNow} className="bg-primary hover:bg-primary/90">
                      <Cloud className="h-3.5 w-3.5 mr-1.5" />
                      Sync live sources
                    </Button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    <AnimatePresence mode="popLayout">
                      {programs.map((p) => (
                        <ProgramCard
                          key={p.id}
                          program={p}
                          onOpen={() => setSelectedProgramId(p.id)}
                        />
                      ))}
                    </AnimatePresence>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ProgramCard({ program, onOpen }: { program: Program; onOpen: () => void }) {
  const typeInfo = TYPE_LABELS[program.type] || TYPE_LABELS.bbp;
  const platformLabel = PLATFORM_LABELS[program.platform] || program.platform;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
    >
      <Card
        className="group cursor-pointer transition-all hover:border-primary/40 hover:shadow-xl hover:-translate-y-0.5"
        onClick={onOpen}
      >
        <CardContent className="p-5">
          {/* Header */}
          <div className="flex items-start justify-between gap-2 mb-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <Badge className={cn("text-[9px] px-1.5 py-0.5 font-bold uppercase tracking-wider", typeInfo.color)} variant="secondary">
                  {typeInfo.label}
                </Badge>
                {program.isNew && <NewBadge />}
                {program.state === "paused" && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-status-warning/15 text-status-warning font-semibold uppercase">
                    Paused
                  </span>
                )}
              </div>
              <h3 className="font-semibold text-sm truncate group-hover:text-primary transition-colors">
                {program.name}
              </h3>
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5 flex-wrap">
                <span className="font-medium">{platformLabel}</span>
                {program.industry && <><span>·</span><span className="truncate max-w-[140px]">{program.industry}</span></>}
              </div>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
          </div>

          {/* Bounty */}
          {program.type !== "vdp" && (
            <div className="flex items-baseline gap-3 mb-3 pb-3 border-b border-border">
              <div>
                <div className="text-[9px] text-muted-foreground uppercase tracking-wider">Max</div>
                <div className="text-lg font-semibold text-primary tabular-nums">{formatMoney(program.maxBounty ?? null)}</div>
              </div>
              <div>
                <div className="text-[9px] text-muted-foreground uppercase tracking-wider">Avg</div>
                <div className="text-sm font-medium tabular-nums">{formatMoney(program.avgBounty ?? null)}</div>
              </div>
              <div className="ml-auto">
                <div className="text-[9px] text-muted-foreground uppercase tracking-wider">Paid</div>
                <div className="text-sm font-medium tabular-nums">{formatMoney(program.totalPaid ?? null)}</div>
              </div>
            </div>
          )}

          {/* Stats grid */}
          <div className="grid grid-cols-3 gap-2 text-center">
            <MiniStat icon={<Clock className="h-3 w-3" />} label="Resp" value={formatHours(program.avgResponseHrs ?? null)} />
            <MiniStat icon={<TrendingUp className="h-3 w-3" />} label="Accept" value={program.acceptanceRate != null ? `${program.acceptanceRate}%` : "—"} />
            <MiniStat icon={<Globe className="h-3 w-3" />} label="In/Out" value={`${program.inScope.length}/${program.outScope.length}`} />
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between mt-3 pt-3 border-t border-border text-[10px] text-muted-foreground">
            <span>Synced {timeAgo(program.lastSyncAt)}</span>
            <span>{program.inScope.length} in / {program.outScope.length} out</span>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function MiniStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-md bg-muted/40 py-1.5 px-2">
      <div className="flex items-center justify-center text-muted-foreground mb-0.5">{icon}</div>
      <div className="text-xs font-semibold tabular-nums">{value}</div>
      <div className="text-[9px] text-muted-foreground uppercase tracking-wider">{label}</div>
    </div>
  );
}
