"use client";

// ============================================================================
// ANTLION — Interactive Discovery Tree
// A pan/zoom tree graph rendered for every project's Reports view.
// Project root -> scope domains -> discovered subdomains -> type branches ->
// findings. Clicking any node opens a detail popup.
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Search,
  X,
  FolderTree,
  Crosshair,
  Globe,
  ZoomIn,
  ZoomOut,
  Maximize,
  RotateCw,
  UnfoldVertical,
  FoldVertical,
  Loader2,
  MousePointerClick,
} from "lucide-react";
import { useAppStore } from "@/lib/stores/app-store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { Severity } from "@/lib/types";
import {
  buildDiscoveryTree,
  filterTree,
  buildPaths,
  type DiscoveryNode,
  type DiscoveryTreeData,
  SEVERITY_ORDER,
} from "@/lib/discovery-tree";
import { DiscoveryNodeDialog, FINDING_TYPE_ICONS } from "./discovery-tree-dialogs";

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

const NODE_W = 232;
const NODE_H = 40;
const H_GAP = 64;
const V_GAP = 10;
const PAD = 20;
const MIN_ZOOM = 0.12;
const MAX_ZOOM = 2.5;
const AUTO_EXPAND_NODE_LIMIT = 180;
const SEARCH_EXPAND_LIMIT = 520;

// Literal class maps (Tailwind needs full class names at build time).
const SEV_DOT: Record<Severity, string> = {
  critical: "bg-severity-critical",
  high: "bg-severity-high",
  medium: "bg-severity-medium",
  low: "bg-severity-low",
  info: "bg-severity-info",
};
const SEV_BORDER: Record<Severity, string> = {
  critical: "border-severity-critical/45",
  high: "border-severity-high/45",
  medium: "border-severity-medium/45",
  low: "border-severity-low/45",
  info: "border-border",
};

interface PositionedNode {
  node: DiscoveryNode;
  x: number;
  y: number;
  depth: number;
}

interface TreeEdge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  severity?: Severity;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DiscoveryTree({ projectId }: { projectId: string | null }) {
  const { setView } = useAppStore();

  // Data
  const [data, setData] = useState<DiscoveryTreeData | null>(null);
  const [loading, setLoading] = useState(true);

  // Filters
  const [query, setQuery] = useState("");
  const [severityFilter, setSeverityFilter] = useState<Set<Severity>>(
    () => new Set(SEVERITY_ORDER),
  );

  // Expansion + selection
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["root"]));
  const [selectedNode, setSelectedNode] = useState<DiscoveryNode | null>(null);

  // Viewport
  const viewportRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const viewRef = useRef({ zoom: 1, pan: { x: 0, y: 0 } });
  const didFitRef = useRef(false);
  const pendingFitRef = useRef(false);

  useEffect(() => {
    viewRef.current = { zoom, pan };
  }, [zoom, pan]);

  // ---- Data loading -------------------------------------------------------
  const load = useCallback(async () => {
    if (!projectId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const r = await fetch(`/api/reports/tree?projectId=${projectId}`);
      if (!r.ok) throw new Error("Request failed");
      const d = await r.json();
      setData(d);
      didFitRef.current = false;
    } catch {
      toast.error("Failed to load discovery tree");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  // Stay fresh when the project mutates (runs finishing, targets changing...)
  useEffect(() => {
    const handler = () => load();
    window.addEventListener("antlion:project-updated", handler);
    return () => window.removeEventListener("antlion:project-updated", handler);
  }, [load]);

  // ---- Tree building ------------------------------------------------------
  const built = useMemo(() => {
    if (!data) return null;
    return buildDiscoveryTree(data, { severities: severityFilter });
  }, [data, severityFilter]);

  const paths = useMemo(
    () => (built ? buildPaths(built.root) : new Map<string, string[]>()),
    [built],
  );

  // Default expansion: everything when small, otherwise just root + first level.
  useEffect(() => {
    if (!built) return;
    const all = new Set<string>();
    const top = new Set<string>(["root"]);
    const walk = (n: DiscoveryNode, depth: number) => {
      if (n.children.length === 0) return;
      all.add(n.id);
      if (depth <= 1) top.add(n.id);
      for (const c of n.children) walk(c, depth + 1);
    };
    walk(built.root, 0);
    setExpanded(built.totalNodes <= AUTO_EXPAND_NODE_LIMIT ? all : top);
  }, [built]);

  // ---- Search ---------------------------------------------------------------
  const searchActive = query.trim().length > 0;
  const normalizedQuery = query.trim().toLowerCase();

  const displayRoot = useMemo(() => {
    if (!built) return null;
    if (!searchActive) return built.root;
    return filterTree(built.root, normalizedQuery);
  }, [built, searchActive, normalizedQuery]);

  const matchCount = useMemo(() => {
    if (!searchActive || !displayRoot) return 0;
    let n = 0;
    const walk = (node: DiscoveryNode) => {
      if (node.label.toLowerCase().includes(normalizedQuery)) n++;
      for (const c of node.children) walk(c);
    };
    walk(displayRoot);
    return n;
  }, [displayRoot, searchActive, normalizedQuery]);

  // While searching, auto-expand the ancestors of every match.
  const effectiveExpanded = useMemo(() => {
    if (!searchActive || !built) return expanded;
    const ids = new Set<string>();
    const matched = (n: DiscoveryNode) => n.label.toLowerCase().includes(normalizedQuery);
    const walk = (n: DiscoveryNode): boolean => {
      let any = matched(n);
      for (const c of n.children) {
        if (walk(c)) any = true;
      }
      if (any && n.children.length > 0) ids.add(n.id);
      return any;
    };
    walk(built.root);
    if (ids.size > SEARCH_EXPAND_LIMIT) {
      // Too many matches to expand — keep it shallow so the browser stays fast.
      const shallow = new Set<string>(["root"]);
      const walkShallow = (n: DiscoveryNode, depth: number) => {
        if (n.children.length === 0) return;
        if (depth <= 1) shallow.add(n.id);
        for (const c of n.children) walkShallow(c, depth + 1);
      };
      walkShallow(built.root, 0);
      return shallow;
    }
    return ids;
  }, [searchActive, built, expanded, normalizedQuery]);

  // ---- Layout ---------------------------------------------------------------
  const layout = useMemo(() => {
    if (!displayRoot) return null;
    const nodes: PositionedNode[] = [];
    const edges: TreeEdge[] = [];
    let cursorY = PAD;
    let maxDepth = 0;

    const isExpanded = (n: DiscoveryNode) =>
      n.children.length === 0 || effectiveExpanded.has(n.id);

    const walk = (n: DiscoveryNode, depth: number): number => {
      if (depth > maxDepth) maxDepth = depth;
      const x = PAD + depth * (NODE_W + H_GAP);
      const kids = isExpanded(n) ? n.children : [];
      let y: number;
      if (kids.length === 0) {
        y = cursorY;
        cursorY += NODE_H + V_GAP;
      } else {
        const childYs = kids.map((k) => walk(k, depth + 1));
        y = (childYs[0] + childYs[childYs.length - 1]) / 2;
        for (let i = 0; i < kids.length; i++) {
          edges.push({
            x1: x + NODE_W,
            y1: y + NODE_H / 2,
            x2: x + NODE_W + H_GAP,
            y2: childYs[i] + NODE_H / 2,
            severity: kids[i].kind === "finding" ? kids[i].severity : undefined,
          });
        }
      }
      nodes.push({ node: n, x, y, depth });
      return y;
    };

    walk(displayRoot, 0);

    const width = PAD + maxDepth * (NODE_W + H_GAP) + NODE_W + PAD;
    const height = Math.max(cursorY - V_GAP + PAD, NODE_H + PAD * 2);
    return { nodes, edges, width, height };
  }, [displayRoot, effectiveExpanded]);

  // ---- Viewport behaviour ---------------------------------------------------

  const fit = useCallback(() => {
    const el = viewportRef.current;
    if (!el || !layout) return;
    const rect = el.getBoundingClientRect();
    const z = clamp(
      Math.min((rect.width - 24) / layout.width, (rect.height - 24) / layout.height, 1),
      MIN_ZOOM,
      1,
    );
    setZoom(z);
    setPan({
      x: Math.max(12, (rect.width - layout.width * z) / 2),
      y: Math.max(12, (rect.height - layout.height * z) / 2),
    });
  }, [layout]);

  // Fit once per data load (and whenever explicitly requested).
  useEffect(() => {
    if (!layout) return;
    if (!didFitRef.current || pendingFitRef.current) {
      pendingFitRef.current = false;
      didFitRef.current = true;
      fit();
    }
  }, [layout, fit]);

  // Non-passive wheel zoom around the cursor.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const v = viewRef.current;
      const nz = clamp(v.zoom * Math.exp(-e.deltaY * 0.0012), MIN_ZOOM, MAX_ZOOM);
      const nx = mx - (mx - v.pan.x) * (nz / v.zoom);
      const ny = my - (my - v.pan.y) * (nz / v.zoom);
      viewRef.current = { zoom: nz, pan: { x: nx, y: ny } };
      setZoom(nz);
      setPan({ x: nx, y: ny });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Pointer panning (mouse: both axes; touch: horizontal, vertical scrolls page).
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number; moved: boolean } | null>(null);
  const suppressClickRef = useRef(0);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const v = viewRef.current;
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      panX: v.pan.x,
      panY: v.pan.y,
      moved: false,
    };
  };

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      if (!d.moved && Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
      if (d.moved) setPan({ x: d.panX + dx, y: d.panY + dy });
    };
    const onUp = () => {
      const d = dragRef.current;
      if (d?.moved) suppressClickRef.current = Date.now() + 150;
      dragRef.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  const zoomAtCenter = useCallback((nz: number) => {
    const el = viewportRef.current;
    const v = viewRef.current;
    const r = el ? el.getBoundingClientRect() : { width: 800, height: 500 };
    const cx = r.width / 2;
    const cy = r.height / 2;
    const target = clamp(nz, MIN_ZOOM, MAX_ZOOM);
    const nx = cx - (cx - v.pan.x) * (target / v.zoom);
    const ny = cy - (cy - v.pan.y) * (target / v.zoom);
    viewRef.current = { zoom: target, pan: { x: nx, y: ny } };
    setZoom(target);
    setPan({ x: nx, y: ny });
  }, []);

  const openNode = useCallback((node: DiscoveryNode) => {
    if (Date.now() < suppressClickRef.current) return;
    setSelectedNode(node);
  }, []);

  const toggleExpand = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    if (!built) return;
    const ids = new Set<string>();
    const walk = (n: DiscoveryNode) => {
      if (n.children.length === 0) return;
      ids.add(n.id);
      for (const c of n.children) walk(c);
    };
    walk(built.root);
    setExpanded(ids);
    pendingFitRef.current = true;
  }, [built]);

  const collapseAll = useCallback(() => {
    setExpanded(new Set(["root"]));
    pendingFitRef.current = true;
  }, []);

  const toggleSeverity = useCallback((sev: Severity) => {
    setSeverityFilter((prev) => {
      const next = new Set(prev);
      if (next.has(sev)) next.delete(sev);
      else next.add(sev);
      return next;
    });
  }, []);

  // ---- Derived UI state -----------------------------------------------------
  const meta = built?.meta;
  const isEmpty = !!data && data.targets.length === 0 && data.findings.length === 0;
  const hasScopeNoFindings = !!data && data.targets.length > 0 && data.findings.length === 0;
  const selectedPath = selectedNode
    ? paths.get(selectedNode.id) || [selectedNode.label]
    : [];

  // ---- Render ----------------------------------------------------------------
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <FolderTree className="h-4 w-4 text-primary" />
          Discovery Tree
        </CardTitle>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Every scoped domain of this project and everything discovered beneath it — subdomains nest
          under their parents, findings group by type. Click any node for its details.
        </p>
      </CardHeader>
      <CardContent className="pt-0">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search nodes..."
              className="h-8 pl-8 pr-7 w-40 sm:w-56 text-xs"
              aria-label="Search tree nodes"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          {searchActive && (
            <span className="text-[10px] text-muted-foreground whitespace-nowrap">
              {matchCount} match{matchCount === 1 ? "" : "es"}
            </span>
          )}

          <div className="flex items-center gap-1" role="group" aria-label="Severity filter">
            {SEVERITY_ORDER.map((sev) => {
              const active = severityFilter.has(sev);
              return (
                <button
                  key={sev}
                  onClick={() => toggleSeverity(sev)}
                  aria-pressed={active}
                  title={`${active ? "Hide" : "Show"} ${sev} findings`}
                  className={cn(
                    "flex items-center gap-1 rounded-md border px-1.5 py-1 transition-all",
                    active ? "border-border bg-card" : "border-transparent opacity-35",
                  )}
                >
                  <span className={cn("h-1.5 w-1.5 rounded-full", SEV_DOT[sev])} aria-hidden />
                  <span className="text-[10px] font-semibold tabular-nums text-muted-foreground">
                    {meta?.severityCounts[sev] ?? 0}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost" size="icon" className="h-7 w-7" title="Expand all branches"
              onClick={expandAll} disabled={!built}
            >
              <UnfoldVertical className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost" size="icon" className="h-7 w-7" title="Collapse to project root"
              onClick={collapseAll} disabled={!built}
            >
              <FoldVertical className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost" size="icon" className="h-7 w-7" title="Reload tree data"
              onClick={load} disabled={loading}
            >
              <RotateCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            </Button>
          </div>
        </div>

        {/* Canvas */}
        <div
          ref={viewportRef}
          onPointerDown={onPointerDown}
          className="relative h-[420px] sm:h-[520px] rounded-xl border border-border bg-background overflow-hidden cursor-grab active:cursor-grabbing touch-pan-y select-none"
          style={{
            backgroundImage:
              "radial-gradient(circle, color-mix(in oklab, var(--border) 55%, transparent) 1px, transparent 1px)",
            backgroundSize: "24px 24px",
          }}
          role="application"
          aria-label="Interactive discovery tree graph"
        >
          {layout && (
            <div
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                width: layout.width,
                height: layout.height,
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transformOrigin: "0 0",
              }}
            >
              <svg
                width={layout.width}
                height={layout.height}
                className="absolute left-0 top-0 pointer-events-none overflow-visible"
                aria-hidden
              >
                {layout.edges.map((e, i) => (
                  <path
                    key={i}
                    d={`M ${e.x1} ${e.y1} C ${e.x1 + (e.x2 - e.x1) / 2} ${e.y1}, ${e.x2 - (e.x2 - e.x1) / 2} ${e.y2}, ${e.x2} ${e.y2}`}
                    fill="none"
                    strokeWidth={1.5}
                    style={{
                      stroke: e.severity ? `var(--severity-${e.severity})` : "var(--border)",
                      opacity: e.severity ? 0.55 : 1,
                    }}
                  />
                ))}
              </svg>

              {layout.nodes.map(({ node, x, y }) => (
                <TreeNodeBox
                  key={node.id}
                  node={node}
                  x={x}
                  y={y}
                  isOpen={effectiveExpanded.has(node.id)}
                  isMatch={searchActive && node.label.toLowerCase().includes(normalizedQuery)}
                  onOpen={() => openNode(node)}
                  onToggle={() => toggleExpand(node.id)}
                />
              ))}
            </div>
          )}

          {/* Overlays */}
          {loading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/70 backdrop-blur-[1px]">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <span className="text-xs text-muted-foreground">Building discovery tree...</span>
            </div>
          )}

          {!loading && isEmpty && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center px-6">
              <Crosshair className="h-8 w-8 text-muted-foreground" />
              <div className="text-sm font-semibold">Nothing to map yet</div>
              <p className="text-xs text-muted-foreground max-w-sm leading-relaxed">
                This project has no scope targets and no findings. Add targets, then run the
                pipeline — every domain, subdomain and finding will grow into this tree.
              </p>
              <Button size="sm" onClick={() => setView("target-selection")}>
                <Crosshair className="h-3.5 w-3.5 mr-1.5" />
                Choose targets
              </Button>
            </div>
          )}

          {!loading && searchActive && !displayRoot && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center px-6">
              <Search className="h-6 w-6 text-muted-foreground" />
              <div className="text-sm font-semibold">No nodes match &ldquo;{query}&rdquo;</div>
              <p className="text-xs text-muted-foreground">
                Try a domain, subdomain, finding title, or category name.
              </p>
            </div>
          )}

          {!loading && hasScopeNoFindings && (
            <div className="absolute top-2.5 left-2.5 rounded-md border border-border bg-background/85 backdrop-blur px-2.5 py-1.5 text-[10px] text-muted-foreground pointer-events-none">
              Scope only — no findings yet. Run the pipeline to grow this tree.
            </div>
          )}

          {/* Zoom controls */}
          <div className="absolute bottom-2.5 right-2.5 flex items-center gap-0.5 rounded-lg border border-border bg-background/90 backdrop-blur px-1 py-0.5 shadow-sm">
            <Button
              variant="ghost" size="icon" className="h-6 w-6" title="Zoom out"
              onClick={() => zoomAtCenter(viewRef.current.zoom / 1.25)}
            >
              <ZoomOut className="h-3 w-3" />
            </Button>
            <button
              className="text-[10px] font-mono tabular-nums w-11 text-center text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => zoomAtCenter(1)}
              title="Reset zoom to 100%"
            >
              {Math.round(zoom * 100)}%
            </button>
            <Button
              variant="ghost" size="icon" className="h-6 w-6" title="Zoom in"
              onClick={() => zoomAtCenter(viewRef.current.zoom * 1.25)}
            >
              <ZoomIn className="h-3 w-3" />
            </Button>
            <span className="w-px h-4 bg-border mx-0.5" aria-hidden />
            <Button variant="ghost" size="icon" className="h-6 w-6" title="Fit tree to view" onClick={fit}>
              <Maximize className="h-3 w-3" />
            </Button>
          </div>
        </div>

        {/* Legend / stats */}
        <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[10px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Crosshair className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
            {meta?.domains ?? 0} scope domains
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Globe className="h-3 w-3 text-teal-600 dark:text-teal-400" />
            {meta?.subdomains ?? 0} subdomains
          </span>
          <span>{meta?.findings ?? 0} findings</span>
          {(meta?.otherHosts ?? 0) > 0 && (
            <span>{meta?.otherHosts} hosts outside scope</span>
          )}
          <span className="ml-auto hidden md:inline-flex items-center gap-1.5">
            <MousePointerClick className="h-3 w-3" />
            Click a node for details · drag to pan · scroll to zoom
          </span>
        </div>
      </CardContent>

      <DiscoveryNodeDialog
        node={selectedNode}
        path={selectedPath}
        data={data}
        open={!!selectedNode}
        onOpenChange={(v) => !v && setSelectedNode(null)}
      />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Node box
// ---------------------------------------------------------------------------

function TreeNodeBox({
  node,
  x,
  y,
  isOpen,
  isMatch,
  onOpen,
  onToggle,
}: {
  node: DiscoveryNode;
  x: number;
  y: number;
  isOpen: boolean;
  isMatch: boolean;
  onOpen: () => void;
  onToggle: () => void;
}) {
  const type =
    node.kind === "category" ? node.category?.type : node.finding?.type;
  const Icon =
    node.kind === "root"
      ? FolderTree
      : node.kind === "target"
        ? Crosshair
        : node.kind === "subdomain"
          ? Globe
          : FINDING_TYPE_ICONS[type || ""] || Globe;
  const hasKids = node.children.length > 0;

  const containerCls =
    node.kind === "root"
      ? "border-primary/40 bg-primary/10"
      : node.kind === "target"
        ? "border-emerald-500/40"
        : node.kind === "subdomain"
          ? "border-teal-500/35"
          : node.kind === "finding" && node.severity
            ? SEV_BORDER[node.severity]
            : "border-border";

  const iconCls =
    node.kind === "root"
      ? "bg-primary/15 text-primary"
      : node.kind === "target"
        ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
        : node.kind === "subdomain"
          ? "bg-teal-500/10 text-teal-600 dark:text-teal-400"
          : "bg-muted text-muted-foreground";

  const badge =
    node.kind === "category"
      ? node.childCount
      : node.kind === "finding"
        ? null
        : node.counts.total;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${node.label} — ${node.kind}`}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        "absolute flex items-center gap-2 rounded-lg border bg-card pl-2 pr-1.5 shadow-sm cursor-pointer transition-shadow outline-none",
        "hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring",
        containerCls,
        isMatch && "ring-2 ring-primary border-primary/60",
      )}
      style={{ left: x, top: y, width: NODE_W, height: NODE_H }}
    >
      <span className={cn("h-6 w-6 rounded-md flex items-center justify-center flex-shrink-0", iconCls)}>
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span
        className={cn(
          "flex-1 truncate text-[12px] min-w-0",
          node.kind === "root" || node.kind === "target" ? "font-semibold" : "font-medium",
          node.kind === "finding" && "font-normal",
        )}
        title={node.label}
      >
        {node.label}
      </span>
      {node.kind === "finding" && node.severity && (
        <span className={cn("h-1.5 w-1.5 rounded-full flex-shrink-0", SEV_DOT[node.severity])} aria-hidden />
      )}
      {badge != null && badge > 0 && (
        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-semibold tabular-nums text-muted-foreground flex-shrink-0">
          {badge}
        </span>
      )}
      {hasKids && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.stopPropagation();
              e.preventDefault();
              onToggle();
            }
          }}
          className="h-5 w-5 rounded flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground flex-shrink-0"
          aria-label={isOpen ? `Collapse ${node.label}` : `Expand ${node.label}`}
          title={isOpen ? "Collapse branch" : "Expand branch"}
        >
          <ChevronRotated open={isOpen} />
        </button>
      )}
    </div>
  );
}

function ChevronRotated({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn("h-3.5 w-3.5 transition-transform duration-150", open && "rotate-90")}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}
