// ============================================================================
// ANTLION — Discovery Tree builder
// Pure, isomorphic logic that turns a project's scope (targets) + findings
// into a hierarchical tree: project -> domains -> subdomains -> categories ->
// findings. No server or client dependencies — safe to import anywhere.
// ============================================================================

import type { Severity } from "./types";

export interface TreeTargetRaw {
  id: string;
  value: string;
  type: string; // wildcard|domain|url|ip|cidr|mobile|api|other
  origin: string;
  inScope: boolean;
  addedAt: string;
}

export interface TreeFindingRaw {
  id: string;
  type: string; // vulnerability|asset|subdomain|port|secret|takeover|endpoint|tech
  severity: Severity;
  title: string;
  description?: string | null;
  evidence?: string | null;
  remediation?: string | null;
  target?: string | null;
  url?: string | null;
  cvssScore?: number | null;
  cveId?: string | null;
  tags?: string | null;
  status?: string | null;
  source?: string | null;
  firstSeenAt: string;
  updatedAt?: string | null;
}

export interface TreeProjectRaw {
  id: string;
  name: string;
  description?: string | null;
  createdAt?: string | null;
  lastActivityAt?: string | null;
  targetCount?: number;
  findingCount?: number;
  runCount?: number;
}

export interface DiscoveryTreeData {
  project: TreeProjectRaw;
  targets: TreeTargetRaw[];
  findings: TreeFindingRaw[];
  stats: { runCount: number; lastRunAt: string | null };
}

export type DiscoveryNodeKind =
  | "root"
  | "target"
  | "subdomain"
  | "category"
  | "finding";

export interface SeverityCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
  total: number;
}

export interface ScopeEntry {
  value: string;
  type: string;
  origin: string;
  addedAt: string;
}

export interface TargetNodeInfo {
  hostname: string;
  kind: "domain" | "wildcard" | "url" | "other";
  scopeEntries: ScopeEntry[];
  subdomainCount: number;
}

export interface SubdomainNodeInfo {
  host: string;
  sources: string[];
  firstSeenAt: string;
  discoveries: { title: string; source: string; firstSeenAt: string }[];
}

export interface CategoryNodeInfo {
  type: string;
  label: string;
}

export interface DiscoveryNode {
  id: string;
  label: string;
  kind: DiscoveryNodeKind;
  severity?: Severity;
  counts: SeverityCounts;
  childCount: number; // total descendant nodes
  finding?: TreeFindingRaw;
  target?: TargetNodeInfo;
  subdomain?: SubdomainNodeInfo;
  category?: CategoryNodeInfo;
  children: DiscoveryNode[];
}

export interface DiscoveryTreeMeta {
  domains: number;
  subdomains: number;
  findings: number;
  severityCounts: SeverityCounts;
  otherHosts: number;
  otherScope: number;
}

export interface BuiltDiscoveryTree {
  root: DiscoveryNode;
  meta: DiscoveryTreeMeta;
  totalNodes: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low", "info"];

const SEVERITY_RANK: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

export const CATEGORY_ORDER = [
  "vulnerability",
  "takeover",
  "secret",
  "port",
  "endpoint",
  "tech",
  "asset",
  "subdomain",
] as const;

export const CATEGORY_LABELS: Record<string, string> = {
  vulnerability: "Vulnerabilities",
  takeover: "Takeover Candidates",
  secret: "Secrets",
  port: "Open Ports",
  endpoint: "Endpoints",
  tech: "Technologies",
  asset: "Live Assets",
  subdomain: "Subdomains",
};

export function emptyCounts(): SeverityCounts {
  return { critical: 0, high: 0, medium: 0, low: 0, info: 0, total: 0 };
}

// ---------------------------------------------------------------------------
// Host normalization
// ---------------------------------------------------------------------------

/**
 * Extracts a bare lowercase hostname from a scope value or finding target/url.
 * "https://gitlab.com/gitlab-org/gitlab" -> "gitlab.com"
 * "about.gitlab.com:443" -> "about.gitlab.com"
 * "*.gitlab.org" -> "*.gitlab.org"
 */
export function hostnameOf(value?: string | null): string {
  let v = (value || "").trim().toLowerCase();
  if (!v) return "";
  v = v.replace(/^[a-z][a-z0-9+.-]*:\/\//, ""); // strip scheme
  const at = v.indexOf("@");
  if (at >= 0) v = v.slice(at + 1); // strip credentials
  v = v.split(/[/?#\\]/)[0]; // strip path/query/fragment
  const colon = v.lastIndexOf(":");
  if (colon >= 0 && /^\d+$/.test(v.slice(colon + 1))) v = v.slice(0, colon); // strip port
  return v;
}

/** True when the string plausibly identifies a network host (domain, wildcard, IP). */
export function isHostLike(host: string): boolean {
  if (!host || host.includes(" ")) return false;
  if (!host.includes(".")) return false;
  return /^[a-z0-9*_-]+(\.[a-z0-9*_-]+)+$/.test(host);
}

// ---------------------------------------------------------------------------
// Tree building
// ---------------------------------------------------------------------------

interface HostBranch {
  hostname: string;
  kind: "target" | "subdomain" | "other-host";
  targetInfo?: TargetNodeInfo;
  subdomainInfo?: SubdomainNodeInfo;
  categories: Map<string, TreeFindingRaw[]>;
  children: HostBranch[]; // nested subdomain branches
  subdomainBranches: number; // descendant branch count (computed later)
  findingsUnder: number; // direct findings attached via categories
}

export interface BuildTreeOptions {
  /** When set, only findings whose severity is included are placed in the tree. */
  severities?: Set<Severity>;
}

function sortFindings(a: TreeFindingRaw, b: TreeFindingRaw): number {
  const r = (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9);
  if (r !== 0) return r;
  return a.title.localeCompare(b.title);
}

export function buildDiscoveryTree(data: DiscoveryTreeData, options: BuildTreeOptions = {}): BuiltDiscoveryTree {
  const sevFilter = options.severities;
  const findings = sevFilter
    ? data.findings.filter((f) => sevFilter.has(f.severity))
    : data.findings;

  // ---- 1. Group scope targets by normalized hostname -----------------------
  interface TargetGroup {
    hostname: string;
    wildcardBase: string | null;
    entries: TreeTargetRaw[];
    branch: HostBranch;
  }
  const targetGroups = new Map<string, TargetGroup>();
  const otherScopeTargets: TreeTargetRaw[] = [];

  for (const t of data.targets) {
    const h = hostnameOf(t.value);
    if (isHostLike(h)) {
      let g = targetGroups.get(h);
      if (!g) {
        g = {
          hostname: h,
          wildcardBase: h.startsWith("*.") ? h.slice(2) : null,
          entries: [],
          branch: {
            hostname: h,
            kind: "target",
            categories: new Map(),
            children: [],
            findingsUnder: 0,
            subdomainBranches: 0,
          },
        };
        targetGroups.set(h, g);
      }
      g.entries.push(t);
    } else {
      otherScopeTargets.push(t);
    }
  }

  // Populate target info payloads
  for (const g of targetGroups.values()) {
    g.branch.targetInfo = {
      hostname: g.hostname,
      kind: g.wildcardBase ? "wildcard" : g.entries.some((e) => e.type === "url") ? "url" : "domain",
      scopeEntries: [...g.entries]
        .sort((a, b) => a.addedAt.localeCompare(b.addedAt))
        .map((e) => ({ value: e.value, type: e.type, origin: e.origin, addedAt: e.addedAt })),
      subdomainCount: 0,
    };
  }

  /** Best target group for a host: exact > wildcard > longest domain suffix. */
  const findTargetGroup = (host: string): TargetGroup | null => {
    if (!isHostLike(host)) return null;
    const exact = targetGroups.get(host);
    if (exact) return exact;
    let best: TargetGroup | null = null;
    let bestLen = -1;
    for (const g of targetGroups.values()) {
      if (g.wildcardBase) {
        if ((host === g.wildcardBase || host.endsWith("." + g.wildcardBase)) && g.wildcardBase.length > bestLen) {
          best = g;
          bestLen = g.wildcardBase.length;
        }
      }
    }
    if (best) return best;
    for (const g of targetGroups.values()) {
      if (!g.wildcardBase && host.endsWith("." + g.hostname) && g.hostname.length > bestLen) {
        best = g;
        bestLen = g.hostname.length;
      }
    }
    return best;
  };

  // ---- 2. Index of host branches (targets now; subdomains added below) -----
  const hostIndex = new Map<string, HostBranch>();
  for (const g of targetGroups.values()) hostIndex.set(g.hostname, g.branch);

  const otherHostsRoot: HostBranch = {
    hostname: "",
    kind: "other-host",
    categories: new Map(),
    children: [],
    findingsUnder: 0,
    subdomainBranches: 0,
  };

  const generalFindings: TreeFindingRaw[] = [];

  /**
   * Creates (or fetches) a subdomain branch for `host`, nesting it under its
   * nearest existing ancestor host within the same group. `poolRoots` are the
   * anchor hostnames of the group (e.g. a target hostname, or "" for the
   * other-hosts bucket).
   */
  const ensureSubdomainBranch = (
    host: string,
    groupRoots: HostBranch[],
    existingHosts: Set<string>,
  ): HostBranch => {
    const found = hostIndex.get(host);
    if (found) return found;

    const branch: HostBranch = {
      hostname: host,
      kind: "subdomain",
      subdomainInfo: { host, sources: [], firstSeenAt: "", discoveries: [] },
      categories: new Map(),
      children: [],
      findingsUnder: 0,
      subdomainBranches: 0,
    };
    hostIndex.set(host, branch);

    // Find nearest existing ancestor by walking label suffixes, longest first.
    const labels = host.split(".");
    let parent: HostBranch | null = null;
    for (let i = 1; i < labels.length; i++) {
      const suffix = labels.slice(i).join(".");
      const p = hostIndex.get(suffix);
      if (p && p.kind !== "other-host") {
        parent = p;
        break;
      }
    }
    if (!parent) {
      // Anchor to the matching group root (first root whose hostname is a suffix).
      for (const root of groupRoots) {
        if (!root.hostname) {
          parent = root;
          break;
        }
        const rb = root.hostname.startsWith("*.") ? root.hostname.slice(2) : root.hostname;
        if (host === rb || host.endsWith("." + rb)) {
          parent = root;
          break;
        }
      }
    }
    (parent || otherHostsRoot).children.push(branch);
    existingHosts.add(host);
    return branch;
  };

  // ---- 3. Place subdomain findings -----------------------------------------
  // Phase A: collect subdomain hosts per target group (or the other-hosts bucket).
  interface SubdomainPlacement {
    host: string;
    finding: TreeFindingRaw;
    groupRoots: HostBranch[];
    inScope: boolean;
  }
  const placements: SubdomainPlacement[] = [];

  for (const f of findings) {
    if (f.type !== "subdomain") continue;
    const host =
      hostnameOf(f.target) ||
      hostnameOf(f.url) ||
      hostnameOf(f.title.replace(/^subdomain[^:]*:\s*/i, ""));
    if (!host) continue;

    const exactScope = targetGroups.get(host);
    if (exactScope) {
      // The discovered subdomain is itself a scope entry — record it as a
      // confirming finding under that target's "Subdomains" category.
      const list = exactScope.branch.categories.get("subdomain") || [];
      list.push(f);
      exactScope.branch.categories.set("subdomain", list);
      exactScope.branch.findingsUnder++;
      continue;
    }

    const g = findTargetGroup(host);
    placements.push({
      host,
      finding: f,
      groupRoots: g ? [g.branch] : [otherHostsRoot],
      inScope: false,
    });
  }

  // Phase B: create branches in label-count order so parents exist first.
  placements.sort((a, b) => {
    const la = a.host.split(".").length - b.host.split(".").length;
    if (la !== 0) return la;
    return a.host.localeCompare(b.host);
  });

  const subdomainHostsSeen = new Set<string>();
  for (const p of placements) {
    const branch = ensureSubdomainBranch(p.host, p.groupRoots, subdomainHostsSeen);
    const info = branch.subdomainInfo!;
    info.sources = Array.from(new Set([...info.sources, p.finding.source || "unknown"]));
    info.discoveries.push({
      title: p.finding.title,
      source: p.finding.source || "unknown",
      firstSeenAt: p.finding.firstSeenAt,
    });
    if (!info.firstSeenAt || p.finding.firstSeenAt < info.firstSeenAt) {
      info.firstSeenAt = p.finding.firstSeenAt;
    }
  }

  // ---- 4. Place all other findings -----------------------------------------
  for (const f of findings) {
    if (f.type === "subdomain") continue;
    const host = hostnameOf(f.url) || hostnameOf(f.target);

    if (host && isHostLike(host)) {
      // Exact host branch (target or discovered subdomain)?
      let branch = hostIndex.get(host);
      if (!branch) {
        const g = findTargetGroup(host);
        if (g) branch = g.branch;
      }
      if (branch) {
        const list = branch.categories.get(f.type) || [];
        list.push(f);
        branch.categories.set(f.type, list);
        branch.findingsUnder++;
        continue;
      }
      // Host matches no scope entry — other-hosts bucket (hierarchical too).
      const b = ensureSubdomainBranch(host, [otherHostsRoot], subdomainHostsSeen);
      const info = b.subdomainInfo!;
      if (!info.firstSeenAt) info.firstSeenAt = f.firstSeenAt;
      const list = b.categories.get(f.type) || [];
      list.push(f);
      b.categories.set(f.type, list);
      b.findingsUnder++;
      continue;
    }

    // No usable host — park under root-level general findings.
    generalFindings.push(f);
  }

  // ---- 5. Convert branches to nodes ----------------------------------------
  const buildFindingNode = (f: TreeFindingRaw): DiscoveryNode => ({
    id: `finding:${f.id}`,
    label: f.title,
    kind: "finding",
    severity: f.severity,
    counts: { ...emptyCounts(), [f.severity]: 1, total: 1 } as SeverityCounts,
    childCount: 0,
    finding: f,
    children: [],
  });

  const categoryNodeFor = (branch: HostBranch, type: string): DiscoveryNode | null => {
    const list = branch.categories.get(type);
    if (!list || list.length === 0) return null;
    const kids = [...list].sort(sortFindings).map(buildFindingNode);
    const counts = emptyCounts();
    for (const k of kids) {
      counts[k.severity as Severity]++;
      counts.total++;
    }
    return {
      id: `cat:${branch.hostname || "other"}:${type}`,
      label: CATEGORY_LABELS[type] || type,
      kind: "category",
      counts,
      childCount: kids.length,
      category: { type, label: CATEGORY_LABELS[type] || type },
      children: kids,
    };
  };

  const branchChildren = (branch: HostBranch): DiscoveryNode[] => {
    // Subdomain branches first (alphabetical), then category branches in fixed order.
    const subNodes = [...branch.children]
      .sort((a, b) => a.hostname.localeCompare(b.hostname))
      .map(branchToNode);
    const catNodes: DiscoveryNode[] = [];
    for (const type of CATEGORY_ORDER) {
      const n = categoryNodeFor(branch, type);
      if (n) catNodes.push(n);
    }
    return [...subNodes, ...catNodes];
  };

  function branchToNode(branch: HostBranch): DiscoveryNode {
    if (branch.kind === "target") {
      const info = branch.targetInfo!;
      info.subdomainCount = countSubdomainBranches(branch);
      return {
        id: `target:${branch.hostname}`,
        label: branch.hostname,
        kind: "target",
        counts: subtreeCounts(branch),
        childCount: countDescendants(branch),
        target: info,
        children: branchChildren(branch),
      };
    }
    // subdomain or other-host branch
    const info = branch.subdomainInfo!;
    return {
      id: `host:${branch.hostname}`,
      label: branch.hostname,
      kind: "subdomain",
      counts: subtreeCounts(branch),
      childCount: countDescendants(branch),
      subdomain: info,
      children: branchChildren(branch),
    };
  }

  function countSubdomainBranches(branch: HostBranch): number {
    let n = 0;
    for (const c of branch.children) {
      n += 1 + countSubdomainBranches(c);
    }
    return n;
  }

  function countDescendants(branch: HostBranch): number {
    let n = branch.findingsUnder + branch.categories.size + branch.children.length;
    for (const c of branch.children) n += countDescendants(c);
    return n;
  }

  function subtreeCounts(branch: HostBranch): SeverityCounts {
    const counts = emptyCounts();
    for (const list of branch.categories.values()) {
      for (const f of list) {
        counts[f.severity as Severity]++;
        counts.total++;
      }
    }
    // Each nested subdomain branch represents >= 1 subdomain discovery (info severity).
    for (const c of branch.children) {
      counts.info++;
      counts.total++;
      const sub = subtreeCounts(c);
      for (const s of SEVERITY_ORDER) counts[s] += sub[s];
      counts.total += sub.total;
    }
    return counts;
  }

  // ---- 6. Assemble root -----------------------------------------------------
  const targetNodes = Array.from(targetGroups.values())
    .map((g) => branchToNode(g.branch))
    .sort((a, b) => {
      if (b.counts.total !== a.counts.total) return b.counts.total - a.counts.total;
      const sd = (b.target?.subdomainCount || 0) - (a.target?.subdomainCount || 0);
      if (sd !== 0) return sd;
      return a.label.localeCompare(b.label);
    });

  const rootChildren: DiscoveryNode[] = [...targetNodes];

  // Other scope entries (non-host scope items)
  if (otherScopeTargets.length > 0) {
    const kids = [...otherScopeTargets]
      .sort((a, b) => a.value.localeCompare(b.value))
      .map((t): DiscoveryNode => ({
        id: `scope-item:${t.id}`,
        label: t.value,
        kind: "target",
        counts: emptyCounts(),
        childCount: 0,
        target: {
          hostname: t.value,
          kind: "other",
          scopeEntries: [
            { value: t.value, type: t.type, origin: t.origin, addedAt: t.addedAt },
          ],
          subdomainCount: 0,
        },
        children: [],
      }));
    rootChildren.push({
      id: "other-scope",
      label: "Other Scope Items",
      kind: "category",
      counts: emptyCounts(),
      childCount: kids.length,
      category: { type: "scope", label: "Other Scope Items" },
      children: kids,
    });
  }

  // Findings on hosts that match no scope entry
  const otherHostKids = [...otherHostsRoot.children]
    .sort((a, b) => a.hostname.localeCompare(b.hostname))
    .map(branchToNode);
  if (otherHostKids.length > 0) {
    const counts = emptyCounts();
    let descendants = 0;
    for (const k of otherHostKids) {
      for (const s of SEVERITY_ORDER) counts[s] += k.counts[s];
      counts.total += k.counts.total;
      descendants += 1 + k.childCount;
    }
    rootChildren.push({
      id: "other-hosts",
      label: "Other Discovered Hosts",
      kind: "category",
      counts,
      childCount: descendants,
      category: { type: "other-hosts", label: "Other Discovered Hosts" },
      children: otherHostKids,
    });
  }

  // Findings with no host at all
  if (generalFindings.length > 0) {
    const kids = [...generalFindings].sort(sortFindings).map(buildFindingNode);
    const counts = emptyCounts();
    for (const k of kids) {
      counts[k.severity as Severity]++;
      counts.total++;
    }
    rootChildren.push({
      id: "general",
      label: "General Findings",
      kind: "category",
      counts,
      childCount: kids.length,
      category: { type: "general", label: "General Findings" },
      children: kids,
    });
  }

  const root: DiscoveryNode = {
    id: "root",
    label: data.project.name || "Project",
    kind: "root",
    counts: emptyCounts(),
    childCount: 0,
    children: rootChildren,
  };

  // Roll up counts + node totals
  const meta: DiscoveryTreeMeta = {
    domains: targetNodes.length,
    subdomains: 0,
    findings: 0,
    severityCounts: emptyCounts(),
    otherHosts: otherHostKids.length,
    otherScope: otherScopeTargets.length,
  };

  const walk = (n: DiscoveryNode): void => {
    if (n.kind === "finding") {
      meta.findings++;
      meta.severityCounts[n.severity as Severity]++;
      meta.severityCounts.total++;
      n.counts = { ...emptyCounts(), [n.severity as Severity]: 1, total: 1 } as SeverityCounts;
      return;
    }
    const counts = emptyCounts();
    let childCount = 0;
    if (n.kind === "subdomain") {
      // The branch node itself represents a subdomain discovery (info severity).
      counts.info = 1;
      counts.total = 1;
      meta.findings++;
      meta.severityCounts.info++;
      meta.severityCounts.total++;
      meta.subdomains++;
    }
    for (const c of n.children) {
      walk(c);
      for (const s of SEVERITY_ORDER) counts[s] += c.counts[s];
      counts.total += c.counts.total;
      childCount += 1 + c.childCount;
    }
    n.counts = counts;
    n.childCount = childCount;
  };
  walk(root);

  const countNodes = (n: DiscoveryNode): number => 1 + n.children.reduce((acc, c) => acc + countNodes(c), 0);

  return { root, meta, totalNodes: countNodes(root) };
}

// ---------------------------------------------------------------------------
// Helpers used by the UI
// ---------------------------------------------------------------------------

/** Collects ids of every ancestor of nodes matching `predicate`. */
export function ancestorsOfMatches(
  root: DiscoveryNode,
  predicate: (n: DiscoveryNode) => boolean,
): Set<string> {
  const ids = new Set<string>();
  const walk = (n: DiscoveryNode): boolean => {
    let any = predicate(n);
    for (const c of n.children) {
      if (walk(c)) any = true;
    }
    if (any && n.children.length > 0) ids.add(n.id);
    return any;
  };
  walk(root);
  return ids;
}

/** Returns a pruned copy of the tree keeping only nodes that match or contain matches. */
export function filterTree(root: DiscoveryNode, query: string): DiscoveryNode | null {
  const q = query.trim().toLowerCase();
  if (!q) return root;
  const prune = (n: DiscoveryNode): DiscoveryNode | null => {
    const selfMatch = n.label.toLowerCase().includes(q);
    const kids: DiscoveryNode[] = [];
    for (const c of n.children) {
      const kept = prune(c);
      if (kept) kids.push(kept);
    }
    if (!selfMatch && kids.length === 0) return null;
    return { ...n, children: kids };
  };
  return prune(root);
}

/** Builds an id -> label-path map for breadcrumbs. */
export function buildPaths(root: DiscoveryNode): Map<string, string[]> {
  const map = new Map<string, string[]>();
  const walk = (n: DiscoveryNode, acc: string[]) => {
    const path = [...acc, n.label];
    map.set(n.id, path);
    for (const c of n.children) walk(c, path);
  };
  walk(root, []);
  return map;
}
