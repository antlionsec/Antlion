"use client";

// ============================================================================
// ANTLION — Discovery Tree node detail popup
// Renders a dialog with the full details of whichever tree node the user
// clicked: project root, scope target, discovered subdomain, category, or
// individual finding.
// ============================================================================

import {
  Globe,
  Crosshair,
  Network,
  ChevronRight,
  ExternalLink,
  Bug,
  Server,
  KeyRound,
  AlertTriangle,
  Link2,
  Cpu,
  Inbox,
  ListTree,
  Calendar,
  Tag,
  Activity,
  Shield,
  MapPin,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { SeverityBadge, StatusBadge } from "@/components/antlion/badges";
import { cn } from "@/lib/utils";
import type { Severity } from "@/lib/types";
import {
  type DiscoveryNode,
  type DiscoveryTreeData,
  type SeverityCounts,
  SEVERITY_ORDER,
} from "@/lib/discovery-tree";

export const FINDING_TYPE_ICONS: Record<string, React.ElementType> = {
  vulnerability: Bug,
  subdomain: Globe,
  asset: Server,
  port: Server,
  secret: KeyRound,
  takeover: AlertTriangle,
  endpoint: Link2,
  tech: Cpu,
  scope: ListTree,
  "other-hosts": Globe,
  general: Inbox,
};

const TARGET_KIND_LABEL: Record<string, string> = {
  domain: "Domain",
  wildcard: "Wildcard scope",
  url: "URL scope",
  other: "Scope item",
};

function fmtDate(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">
      {children}
    </div>
  );
}

function SeverityBreakdown({ counts }: { counts: SeverityCounts }) {
  const hasAny = counts.total > 0;
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {hasAny ? (
        SEVERITY_ORDER.map((sev) =>
          counts[sev] > 0 ? (
            <span
              key={sev}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1"
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", `bg-severity-${sev}`)} aria-hidden />
              <span className="text-[11px] text-muted-foreground uppercase tracking-wide">{sev}</span>
              <span className="text-[11px] font-semibold tabular-nums">{counts[sev]}</span>
            </span>
          ) : null,
        )
      ) : (
        <span className="text-xs text-muted-foreground">No findings recorded under this node yet.</span>
      )}
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card p-2.5">
      <div className="text-lg font-semibold tabular-nums leading-tight">{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">{label}</div>
    </div>
  );
}

export function DiscoveryNodeDialog({
  node,
  path,
  data,
  open,
  onOpenChange,
}: {
  node: DiscoveryNode | null;
  path: string[];
  data: DiscoveryTreeData | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px] max-h-[85vh] overflow-hidden flex flex-col">
        {node && <NodeDetailBody node={node} path={path} data={data} />}
      </DialogContent>
    </Dialog>
  );
}

function NodeDetailBody({
  node,
  path,
  data,
}: {
  node: DiscoveryNode;
  path: string[];
  data: DiscoveryTreeData | null;
}) {
  const kindLabel =
    node.kind === "root"
      ? "Project"
      : node.kind === "target"
        ? "Scope target"
        : node.kind === "subdomain"
          ? "Discovered subdomain"
          : node.kind === "category"
            ? "Branch"
            : "Finding";

  return (
    <>
      <DialogHeader className="pb-0">
        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
          <Badge variant="outline" className="text-[9px] uppercase tracking-widest font-semibold">
            {kindLabel}
          </Badge>
          {node.severity && <SeverityBadge severity={node.severity} variant="subtle" />}
          {node.kind === "finding" && node.finding?.status && <StatusBadge status={node.finding.status} />}
        </div>
        <DialogTitle className="text-base leading-snug break-all pr-6">{node.label}</DialogTitle>
        {path.length > 0 && (
          <DialogDescription className="text-[11px] leading-relaxed break-all">
            {path.slice(0, -1).map((p, i) => (
              <span key={i} className="text-muted-foreground/70">
                {p}
                <ChevronRight className="inline h-2.5 w-2.5 mx-0.5 -mt-0.5" />
              </span>
            ))}
            <span className="text-foreground/80">{path[path.length - 1]}</span>
          </DialogDescription>
        )}
      </DialogHeader>

      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="space-y-4 pt-2 pb-1">
          {node.kind === "root" && <RootDetail node={node} data={data} />}
          {node.kind === "target" && <TargetDetail node={node} />}
          {node.kind === "subdomain" && <SubdomainDetail node={node} />}
          {node.kind === "category" && <CategoryDetail node={node} />}
          {node.kind === "finding" && <FindingDetail node={node} />}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Root — project overview
// ---------------------------------------------------------------------------

function RootDetail({ node, data }: { node: DiscoveryNode; data: DiscoveryTreeData | null }) {
  const project = data?.project;
  const stats = data?.stats;
  return (
    <>
      {project?.description && (
        <div>
          <SectionLabel>Description</SectionLabel>
          <p className="text-sm leading-relaxed">{project.description}</p>
        </div>
      )}

      <div>
        <SectionLabel>Snapshot</SectionLabel>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <StatTile label="Scope targets" value={data?.targets.length ?? 0} />
          <StatTile label="Findings" value={node.counts.total} />
          <StatTile label="Pipeline runs" value={stats?.runCount ?? 0} />
          <StatTile
            label="Last run"
            value={
              <span className="text-xs font-medium">
                {stats?.lastRunAt ? new Date(stats.lastRunAt).toLocaleDateString() : "never"}
              </span>
            }
          />
        </div>
      </div>

      <div>
        <SectionLabel>Findings by severity</SectionLabel>
        <SeverityBreakdown counts={node.counts} />
      </div>

      <div>
        <SectionLabel>Project info</SectionLabel>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
          <InfoRow icon={Tag} label="Project ID" value={<span className="font-mono">{project?.id?.slice(0, 8) ?? "—"}</span>} />
          <InfoRow icon={Calendar} label="Created" value={fmtDate(project?.createdAt)} />
          <InfoRow icon={Activity} label="Last activity" value={fmtDate(project?.lastActivityAt)} />
          <InfoRow icon={Shield} label="Status" value={<span className="capitalize">active</span>} />
        </div>
      </div>
    </>
  );
}

function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <Icon className="h-3 w-3 text-muted-foreground flex-shrink-0" />
      <span className="text-muted-foreground flex-shrink-0">{label}:</span>
      <span className="truncate">{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Target — scope entry
// ---------------------------------------------------------------------------

function TargetDetail({ node }: { node: DiscoveryNode }) {
  const info = node.target!;
  return (
    <>
      <div>
        <SectionLabel>Scope entry</SectionLabel>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="secondary" className="text-[10px] uppercase tracking-wider font-semibold">
            {TARGET_KIND_LABEL[info.kind] || info.kind}
          </Badge>
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Crosshair className="h-3 w-3" />
            <span className="font-mono break-all">{info.hostname}</span>
          </span>
        </div>
      </div>

      {info.scopeEntries.length > 1 && (
        <div>
          <SectionLabel>Scope entries merged under this host ({info.scopeEntries.length})</SectionLabel>
          <div className="space-y-1">
            {info.scopeEntries.map((e, i) => (
              <div key={i} className="flex items-center gap-2 text-xs bg-muted/40 rounded-md px-2 py-1.5">
                <span className="font-mono break-all flex-1">{e.value}</span>
                <Badge variant="outline" className="text-[9px] uppercase flex-shrink-0">{e.type}</Badge>
                <span className="text-[10px] text-muted-foreground flex-shrink-0">{e.origin}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {info.scopeEntries.length === 1 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
          <InfoRow icon={Crosshair} label="Original value" value={<span className="font-mono break-all">{info.scopeEntries[0].value}</span>} />
          <InfoRow icon={Tag} label="Origin" value={<span className="capitalize">{info.scopeEntries[0].origin}</span>} />
          <InfoRow icon={Calendar} label="Added" value={fmtDate(info.scopeEntries[0].addedAt)} />
        </div>
      )}

      <div>
        <SectionLabel>Discoveries under this scope ({node.counts.total})</SectionLabel>
        <SeverityBreakdown counts={node.counts} />
        <div className="mt-2 text-xs text-muted-foreground">
          {info.subdomainCount > 0 && (
            <>Includes {info.subdomainCount} discovered subdomain{info.subdomainCount === 1 ? "" : "s"} nested beneath this host.</>
          )}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Subdomain — discovered host branch
// ---------------------------------------------------------------------------

function SubdomainDetail({ node }: { node: DiscoveryNode }) {
  const info = node.subdomain!;
  return (
    <>
      <div>
        <SectionLabel>Discovered host</SectionLabel>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center gap-1.5 font-mono text-xs bg-muted/40 rounded-md px-2 py-1.5 break-all">
            <Globe className="h-3 w-3 text-muted-foreground flex-shrink-0" />
            {info.host}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
        <InfoRow icon={Tag} label="Discovered by" value={info.sources.join(", ") || "—"} />
        <InfoRow icon={Calendar} label="First seen" value={fmtDate(info.firstSeenAt)} />
      </div>

      {info.discoveries.length > 1 && (
        <div>
          <SectionLabel>Discovery events ({info.discoveries.length})</SectionLabel>
          <div className="space-y-1">
            {info.discoveries.map((d, i) => (
              <div key={i} className="flex items-center gap-2 text-xs bg-muted/30 rounded-md px-2 py-1.5">
                <Network className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                <span className="truncate flex-1">{d.title}</span>
                <span className="text-[10px] text-muted-foreground flex-shrink-0">{d.source}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <SectionLabel>Findings under this host ({node.counts.total})</SectionLabel>
        <SeverityBreakdown counts={node.counts} />
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Category — grouped branch
// ---------------------------------------------------------------------------

const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  vulnerability: "Security issues detected by scanners or manual analysis on this host.",
  takeover: "Subdomain takeover candidates — dangling DNS records pointing at claimable services.",
  secret: "Exposed secrets such as API keys, tokens, or credentials found in responses or archives.",
  port: "Open network ports observed during service discovery.",
  endpoint: "URLs and endpoints archived from public sources or crawled during recon.",
  tech: "Technology fingerprints identified from responses (servers, frameworks, CDNs).",
  asset: "Hosts confirmed live and responding during asset validation.",
  subdomain: "Subdomain discoveries that are themselves in-scope entries for this program.",
  scope: "Scope entries that are not network hosts — platform plugins, mobile apps, or notes.",
  "other-hosts": "Findings on hosts that do not match any in-scope target. Review scope coverage.",
  general: "Findings that could not be attributed to a specific host.",
};

function CategoryDetail({ node }: { node: DiscoveryNode }) {
  const info = node.category!;
  const Icon = FINDING_TYPE_ICONS[info.type] || Inbox;
  return (
    <>
      <div>
        <SectionLabel>Branch</SectionLabel>
        <div className="flex items-center gap-2">
          <span className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center">
            <Icon className="h-4 w-4 text-muted-foreground" />
          </span>
          <div>
            <div className="text-sm font-medium">{info.label}</div>
            <div className="text-[11px] text-muted-foreground">{node.children.length} item{node.children.length === 1 ? "" : "s"} in this branch</div>
          </div>
        </div>
      </div>

      <div>
        <SectionLabel>What this branch contains</SectionLabel>
        <p className="text-sm leading-relaxed">
          {CATEGORY_DESCRIPTIONS[info.type] || "Grouped discoveries of the same type."}
        </p>
      </div>

      <div>
        <SectionLabel>Severity mix</SectionLabel>
        <SeverityBreakdown counts={node.counts} />
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Finding — full detail
// ---------------------------------------------------------------------------

function FindingDetail({ node }: { node: DiscoveryNode }) {
  const f = node.finding!;
  const Icon = FINDING_TYPE_ICONS[f.type] || Bug;
  return (
    <>
      <div className="flex items-center gap-3">
        <span className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
          <Icon className="h-4.5 w-4.5 text-muted-foreground" />
        </span>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs flex-1">
          <InfoRow icon={Tag} label="Type" value={<span className="capitalize">{f.type}</span>} />
          <InfoRow icon={MapPin} label="Source" value={f.source || "—"} />
          <InfoRow icon={Calendar} label="First seen" value={fmtDate(f.firstSeenAt)} />
          <InfoRow icon={Activity} label="Updated" value={fmtDate(f.updatedAt)} />
        </div>
      </div>

      {(f.cvssScore != null || f.cveId) && (
        <div className="flex items-center gap-2">
          {f.cveId && (
            <Badge variant="secondary" className="text-[10px] font-mono bg-status-error/15 text-status-error">
              {f.cveId}
            </Badge>
          )}
          {f.cvssScore != null && (
            <Badge variant="outline" className="text-[10px] font-mono">CVSS {f.cvssScore}</Badge>
          )}
        </div>
      )}

      {(f.target || f.url) && (
        <div>
          <SectionLabel>Target</SectionLabel>
          <div className="font-mono text-xs bg-muted/40 rounded-md p-2 break-all">
            {f.url || f.target}
            {f.url && (
              <a
                href={f.url}
                target="_blank"
                rel="noreferrer"
                className="ml-2 inline-flex items-center gap-0.5 text-primary hover:underline"
              >
                <ExternalLink className="h-3 w-3" /> Open
              </a>
            )}
          </div>
        </div>
      )}

      {f.description && (
        <div>
          <SectionLabel>Description</SectionLabel>
          <p className="text-sm leading-relaxed">{f.description}</p>
        </div>
      )}

      {f.evidence && (
        <div>
          <SectionLabel>Evidence</SectionLabel>
          <pre className="text-[11px] font-mono bg-muted/40 p-3 rounded-md overflow-x-auto whitespace-pre-wrap break-all max-h-60 overflow-y-auto">
            {f.evidence}
          </pre>
        </div>
      )}

      {f.remediation && (
        <div>
          <SectionLabel>Remediation</SectionLabel>
          <p className="text-sm leading-relaxed">{f.remediation}</p>
        </div>
      )}

      {f.tags && (
        <div>
          <SectionLabel>Tags</SectionLabel>
          <div className="flex items-center gap-1.5 flex-wrap">
            {f.tags.split(",").map((t) => t.trim()).filter(Boolean).map((t, i) => (
              <Badge key={i} variant="secondary" className="text-[10px]">{t}</Badge>
            ))}
          </div>
        </div>
      )}

      <Separator className="!my-1" />
      <p className="text-[10px] text-muted-foreground leading-relaxed">
        Triage and status changes for this finding live in the Results Dashboard — this popup is a
        read-only view for exploring the discovery tree.
      </p>
    </>
  );
}
