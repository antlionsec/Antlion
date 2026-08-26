"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  Bug,
  Globe,
  Server,
  Key,
  AlertTriangle,
  Link2,
  Cpu,
  Filter,
  Download,
  ChevronDown,
  ChevronRight,
  Tag,
  X,
  FileText,
  Eye,
  ExternalLink,
  Loader2,
  Shield,
  Activity,
  Pin,
  Trash2,
  Plus,
} from "lucide-react";
import { useAppStore } from "@/lib/stores/app-store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SeverityBadge, StatusBadge } from "@/components/antlion/badges";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { Severity, FindingType } from "@/lib/types";

interface Finding {
  id: string;
  type: FindingType;
  severity: Severity;
  title: string;
  description?: string;
  evidence?: string;
  remediation?: string;
  target?: string;
  url?: string;
  cvssScore?: number;
  cveId?: string;
  tags: string;
  status: string;
  source?: string;
  rawOutput?: string;
  firstSeenAt: string;
}

interface NoteRow {
  id: string;
  content: string;
  pinned: boolean;
  createdAt: string;
}

const TYPE_ICONS: Record<string, React.ElementType> = {
  vulnerability: Bug,
  subdomain: Globe,
  asset: Server,
  port: Server,
  secret: Key,
  takeover: AlertTriangle,
  endpoint: Link2,
  tech: Cpu,
};

const TYPE_LABELS: Record<string, string> = {
  vulnerability: "Vulnerabilities",
  subdomain: "Subdomains",
  asset: "Live Assets",
  port: "Open Ports",
  secret: "Secrets",
  takeover: "Takeover Candidates",
  endpoint: "Endpoints",
  tech: "Technologies",
};

export function ResultsView() {
  const { activeProjectId, setView } = useAppStore();
  const [findings, setFindings] = useState<Finding[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeType, setActiveType] = useState<string>("vulnerability");
  const [severityFilter, setSeverityFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [selectedFinding, setSelectedFinding] = useState<Finding | null>(null);

  const load = useCallback(async () => {
    if (!activeProjectId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams({ projectId: activeProjectId, q: query });
      if (severityFilter !== "all") params.set("severity", severityFilter);
      if (statusFilter !== "all") params.set("status", statusFilter);
      const r = await fetch(`/api/findings?${params}`);
      const d = await r.json();
      setFindings(d.findings || []);
    } catch (e) {
      toast.error("Failed to load findings");
    } finally {
      setLoading(false);
    }
  }, [activeProjectId, query, severityFilter, statusFilter]);

  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);

  // Group by type for tab counts
  const byType = useMemo(() => {
    const grouped: Record<string, Finding[]> = {};
    for (const f of findings) {
      if (!grouped[f.type]) grouped[f.type] = [];
      grouped[f.type].push(f);
    }
    return grouped;
  }, [findings]);

  const sevCounts = useMemo(() => {
    const counts: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    for (const f of findings) counts[f.severity]++;
    return counts;
  }, [findings]);

  const visibleFindings = byType[activeType] || [];

  const updateFindingStatus = async (finding: Finding, status: string) => {
    await fetch(`/api/findings/${finding.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status, projectId: activeProjectId }),
      headers: { "Content-Type": "application/json" },
    });
    setFindings((prev) => prev.map((f) => f.id === finding.id ? { ...f, status } : f));
    if (selectedFinding?.id === finding.id) {
      setSelectedFinding({ ...finding, status });
    }
  };

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Top: severity summary */}
      <div className="flex-shrink-0 px-4 sm:px-6 py-4 border-b border-border bg-background/40">
        <div className="flex items-start justify-between gap-4 mb-3 flex-wrap">
          <div>
            <h2 className="text-lg sm:text-xl font-semibold tracking-tight">Results Dashboard</h2>
            <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
              Severity-aware aggregation of pipeline findings · filter, tag, triage, and export
            </p>
          </div>
          <Button onClick={() => setView("reports")} className="bg-primary hover:bg-primary/90">
            <FileText className="h-4 w-4 mr-1.5" />
            Generate Report
          </Button>
        </div>

        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
          {(["critical", "high", "medium", "low", "info"] as Severity[]).map((sev) => (
            <button
              key={sev}
              onClick={() => setSeverityFilter(severityFilter === sev ? "all" : sev)}
              className={cn(
                "rounded-lg border p-2.5 text-left transition-all",
                severityFilter === sev ? "border-primary/50 bg-primary/5" : "border-border bg-card hover:border-primary/30",
              )}
            >
              <div className="flex items-center justify-between mb-1">
                <SeverityBadge severity={sev} variant="dot" />
                <span className="text-xl font-semibold tabular-nums">{sevCounts[sev]}</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Filters */}
      <div className="flex-shrink-0 px-4 sm:px-6 py-3 border-b border-border bg-background/20 flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search findings by title..."
            className="pl-9 h-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-9 w-[120px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="new">New</SelectItem>
            <SelectItem value="todo">To-Do</SelectItem>
            <SelectItem value="in-progress">In-Progress</SelectItem>
            <SelectItem value="reported">Reported</SelectItem>
            <SelectItem value="closed">Closed</SelectItem>
            <SelectItem value="false-positive">False Positive</SelectItem>
          </SelectContent>
        </Select>
        {severityFilter !== "all" && (
          <Button variant="outline" size="sm" onClick={() => setSeverityFilter("all")}>
            <SeverityBadge severity={severityFilter as Severity} size="sm" />
            <X className="h-3 w-3 ml-1" />
          </Button>
        )}
        <div className="ml-auto text-[11px] text-muted-foreground">
          {findings.length} total findings · showing {visibleFindings.length} {TYPE_LABELS[activeType]?.toLowerCase() || activeType}
        </div>
      </div>

      {/* Type tabs */}
      <div className="flex-shrink-0 px-4 sm:px-6 border-b border-border bg-background/20">
        <div className="flex items-center gap-1 overflow-x-auto py-2">
          {Object.entries(TYPE_LABELS).map(([type, label]) => {
            const count = (byType[type] || []).length;
            if (count === 0 && type !== activeType) return null;
            const Icon = TYPE_ICONS[type] || Bug;
            return (
              <button
                key={type}
                onClick={() => setActiveType(type)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs whitespace-nowrap transition-colors",
                  activeType === type ? "bg-primary/15 text-primary font-medium" : "text-muted-foreground hover:bg-muted/50",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
                <Badge variant="secondary" className="text-[9px] px-1 py-0">{count}</Badge>
              </button>
            );
          })}
        </div>
      </div>

      {/* Findings list */}
      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="p-4">
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-16 rounded-lg border border-border bg-card animate-pulse" />
              ))}
            </div>
          ) : visibleFindings.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border py-16 text-center">
              <Bug className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
              <div className="font-semibold mb-1">No findings of this type</div>
              <div className="text-xs text-muted-foreground">
                {findings.length === 0 ? "Run the pipeline to generate findings." : "Adjust filters or try another type."}
              </div>
            </div>
          ) : (
            <AnimatePresence mode="popLayout">
              {visibleFindings.map((f, i) => (
                <motion.div
                  key={f.id}
                  layout
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.15, delay: Math.min(i * 0.01, 0.1) }}
                >
                  <FindingRow
                    finding={f}
                    onOpen={() => setSelectedFinding(f)}
                    onStatusChange={(status) => updateFindingStatus(f, status)}
                  />
                </motion.div>
              ))}
            </AnimatePresence>
          )}
        </div>
      </div>

      {/* Finding detail dialog */}
      <Dialog open={!!selectedFinding} onOpenChange={(v) => !v && setSelectedFinding(null)}>
        <DialogContent className="sm:max-w-[720px] max-h-[80vh] overflow-hidden flex flex-col">
          {selectedFinding && <FindingDetail finding={selectedFinding} onStatusChange={(s) => updateFindingStatus(selectedFinding, s)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FindingRow({
  finding,
  onOpen,
  onStatusChange,
}: {
  finding: Finding;
  onOpen: () => void;
  onStatusChange: (status: string) => void;
}) {
  const Icon = TYPE_ICONS[finding.type] || Bug;
  const [statusOpen, setStatusOpen] = useState(false);

  return (
    <Card
      className="mb-1.5 cursor-pointer hover:border-primary/30 hover:shadow-md transition-all"
      onClick={onOpen}
    >
      <CardContent className="p-3">
        <div className="flex items-start gap-3">
          <div className="mt-0.5">
            <SeverityBadge severity={finding.severity} variant="dot" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Icon className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
              <span className="text-sm font-medium truncate flex-1">{finding.title}</span>
              {finding.cveId && (
                <Badge variant="secondary" className="text-[9px] bg-status-error/15 text-status-error font-mono">
                  {finding.cveId}
                </Badge>
              )}
              {finding.cvssScore && (
                <Badge variant="outline" className="text-[9px] font-mono">
                  CVSS {finding.cvssScore}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
              {finding.target && (
                <span className="font-mono truncate flex items-center gap-1">
                  <Globe className="h-2.5 w-2.5" />
                  {finding.target}
                </span>
              )}
              {finding.source && (
                <span className="flex items-center gap-1">
                  <Tag className="h-2.5 w-2.5" />
                  {finding.source}
                </span>
              )}
              <span className="flex items-center gap-1">
                <Activity className="h-2.5 w-2.5" />
                {new Date(finding.firstSeenAt).toLocaleDateString()}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={(e) => {
                e.stopPropagation();
                const next = nextStatus(finding.status);
                onStatusChange(next);
              }}
              className="opacity-0 group-hover:opacity-100 transition-opacity"
              title="Cycle status"
            >
              <StatusBadge status={finding.status} />
            </button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function FindingDetail({
  finding,
  onStatusChange,
}: {
  finding: Finding;
  onStatusChange: (status: string) => void;
}) {
  const { activeProjectId } = useAppStore();
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [noteText, setNoteText] = useState("");
  const [notesBusy, setNotesBusy] = useState(false);

  const loadNotes = useCallback(async () => {
    if (!activeProjectId) return;
    try {
      const r = await fetch(`/api/notes?projectId=${activeProjectId}&findingId=${finding.id}`);
      const d = await r.json();
      if (r.ok) setNotes(d.notes || []);
    } catch {
      // ignore
    }
  }, [activeProjectId, finding.id]);

  useEffect(() => {
    loadNotes();
  }, [loadNotes]);

  const addNote = async () => {
    if (!activeProjectId || !noteText.trim()) return;
    setNotesBusy(true);
    try {
      const r = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: activeProjectId, findingId: finding.id, content: noteText.trim() }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Could not save note");
      setNoteText("");
      await loadNotes();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setNotesBusy(false);
    }
  };

  const togglePin = async (note: NoteRow) => {
    try {
      await fetch("/api/notes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: note.id, pinned: !note.pinned }),
      });
      await loadNotes();
    } catch {
      toast.error("Could not pin note");
    }
  };

  const deleteNote = async (note: NoteRow) => {
    try {
      await fetch(`/api/notes?id=${note.id}`, { method: "DELETE" });
      await loadNotes();
    } catch {
      toast.error("Could not delete note");
    }
  };

  return (
    <>
      <DialogHeader>
        <div className="flex items-center gap-2 mb-1">
          <SeverityBadge severity={finding.severity} variant="subtle" size="md" />
          {finding.cveId && (
            <Badge variant="secondary" className="text-[10px] font-mono bg-status-error/15 text-status-error">
              {finding.cveId}
            </Badge>
          )}
          {finding.cvssScore && (
            <Badge variant="outline" className="text-[10px] font-mono">CVSS {finding.cvssScore}</Badge>
          )}
          <StatusBadge status={finding.status} />
        </div>
        <DialogTitle className="text-base">{finding.title}</DialogTitle>
        <DialogDescription className="text-xs">
          Source: {finding.source || "—"} · Type: {finding.type} · First seen: {new Date(finding.firstSeenAt).toLocaleString()}
        </DialogDescription>
      </DialogHeader>

      <div className="flex-1 overflow-y-auto max-h-[55vh] min-h-0">
        <div className="space-y-4 pr-2">
          {finding.target && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Target</div>
              <div className="font-mono text-xs bg-muted/40 rounded-md p-2 break-all">
                {finding.url || finding.target}
                {finding.url && (
                  <a href={finding.url} target="_blank" rel="noreferrer" className="ml-2 inline-flex items-center gap-0.5 text-primary hover:underline">
                    <ExternalLink className="h-3 w-3" /> Open
                  </a>
                )}
              </div>
            </div>
          )}

          {finding.description && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Description</div>
              <p className="text-sm leading-relaxed">{finding.description}</p>
            </div>
          )}

          {finding.evidence && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Evidence</div>
              <pre className="text-[11px] font-mono bg-[#0a0f1a] dark:bg-[#0a0f1a] bg-muted/40 p-3 rounded-md overflow-x-auto whitespace-pre-wrap break-all">
                {finding.evidence}
              </pre>
            </div>
          )}

          {finding.remediation && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Remediation</div>
              <p className="text-sm leading-relaxed">{finding.remediation}</p>
            </div>
          )}

          {finding.rawOutput && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Raw Tool Output</div>
              <pre className="text-[11px] font-mono bg-muted/30 p-3 rounded-md overflow-x-auto whitespace-pre-wrap">
                {finding.rawOutput}
              </pre>
            </div>
          )}

          {/* Notes — persisted via /api/notes */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Notes ({notes.length})</div>
            </div>
            {notes.length > 0 && (
              <div className="space-y-1.5 mb-2">
                {notes.map((n) => (
                  <div key={n.id} className="group flex items-start gap-2 rounded-md border border-border bg-muted/20 p-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-xs whitespace-pre-wrap break-words leading-relaxed">{n.content}</div>
                      <div className="text-[10px] text-muted-foreground mt-1">
                        {new Date(n.createdAt).toLocaleString()}
                      </div>
                    </div>
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => togglePin(n)}
                        className={cn(
                          "p-1 rounded text-[10px]",
                          n.pinned ? "text-status-warning" : "text-muted-foreground hover:text-foreground",
                        )}
                        title={n.pinned ? "Unpin note" : "Pin note"}
                      >
                        <Pin className={cn("h-3 w-3", n.pinned && "fill-current")} />
                      </button>
                      <button
                        onClick={() => deleteNote(n)}
                        className="p-1 rounded text-muted-foreground hover:text-destructive"
                        title="Delete note"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <textarea
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="Add a note for this finding — triage thoughts, report drafts, links…"
                rows={2}
                className="flex-1 text-xs rounded-md border border-border bg-transparent px-2.5 py-1.5 outline-none focus:border-primary/50 resize-y"
              />
              <Button size="sm" variant="outline" onClick={addNote} disabled={notesBusy || !noteText.trim()} className="self-end">
                {notesBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 pt-3 border-t border-border">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Update status:</div>
        {["new", "todo", "in-progress", "reported", "closed", "false-positive"].map((s) => (
          <button
            key={s}
            onClick={() => onStatusChange(s)}
            className={cn(
              "px-2 py-0.5 rounded text-[10px] uppercase tracking-wider font-medium transition-colors",
              finding.status === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70",
            )}
          >
            {s.replace("-", " ")}
          </button>
        ))}
      </div>
    </>
  );
}

function nextStatus(current: string): string {
  const order = ["new", "todo", "in-progress", "reported", "closed"];
  const idx = order.indexOf(current);
  if (idx < 0 || idx === order.length - 1) return order[0];
  return order[idx + 1];
}
