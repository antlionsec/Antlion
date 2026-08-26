// Sanity check: build the discovery tree from real DB data and print it.
import { PrismaClient } from "@prisma/client";
import { buildDiscoveryTree } from "../src/lib/discovery-tree";

const db = new PrismaClient();

const project = await db.project.findFirst({ where: { status: "active" } });
if (!project) { console.log("no active project"); process.exit(0); }

const [targets, findings, runAgg] = await Promise.all([
  db.target.findMany({ where: { projectId: project.id }, orderBy: { addedAt: "asc" } }),
  db.finding.findMany({ where: { projectId: project.id }, orderBy: [{ severity: "desc" }, { firstSeenAt: "desc" }] }),
  db.pipelineRun.aggregate({ where: { projectId: project.id }, _count: true, _max: { finishedAt: true } }),
]);

const data = {
  project: { id: project.id, name: project.name, description: project.description },
  targets: targets.map((t) => ({
    id: t.id, value: t.value, type: t.type, origin: t.origin,
    inScope: t.inScope, addedAt: t.addedAt.toISOString(),
  })),
  findings: findings.map((f) => ({
    id: f.id, type: f.type, severity: f.severity, title: f.title,
    description: f.description, evidence: f.evidence, remediation: f.remediation,
    target: f.target, url: f.url, cvssScore: f.cvssScore, cveId: f.cveId,
    tags: f.tags, status: f.status, source: f.source,
    firstSeenAt: f.firstSeenAt.toISOString(), updatedAt: f.updatedAt.toISOString(),
  })),
  stats: { runCount: runAgg._count, lastRunAt: runAgg._max.finishedAt?.toISOString() || null },
};

const built = buildDiscoveryTree(data as any);
console.log("META:", JSON.stringify(built.meta), "totalNodes:", built.totalNodes);

const print = (n: any, depth: number) => {
  const badge = n.counts.total > 0 ? ` [findings=${n.counts.total} c=${n.counts.critical} h=${n.counts.high} m=${n.counts.medium} l=${n.counts.low} i=${n.counts.info}]` : "";
  console.log("  ".repeat(depth) + `- (${n.kind}) ${n.label}${badge}`);
  for (const c of n.children) print(c, depth + 1);
};
print(built.root, 0);

// Simulate an out-of-scope host finding + deep subdomain to test nesting:
data.findings.push({
  id: "test-1", type: "subdomain", severity: "info", title: "Subdomain discovered: api.dev.gitlab.com",
  target: "api.dev.gitlab.com", url: null, source: "subfinder", firstSeenAt: new Date().toISOString(),
} as any);
data.findings.push({
  id: "test-2", type: "subdomain", severity: "info", title: "Subdomain discovered: dev.gitlab.com",
  target: "dev.gitlab.com", url: null, source: "subfinder", firstSeenAt: new Date().toISOString(),
} as any);
data.findings.push({
  id: "test-3", type: "vulnerability", severity: "high", title: "RCE on api.dev.gitlab.com",
  target: "api.dev.gitlab.com", url: "https://api.dev.gitlab.com/x", source: "nuclei", firstSeenAt: new Date().toISOString(),
} as any);
data.findings.push({
  id: "test-4", type: "vulnerability", severity: "critical", title: "RCE on unscoped.evil.net",
  target: "unscoped.evil.net", url: "https://unscoped.evil.net/x", source: "nuclei", firstSeenAt: new Date().toISOString(),
} as any);

console.log("\n=== WITH SYNTHETIC FINDINGS ===");
const built2 = buildDiscoveryTree(data as any);
console.log("META:", JSON.stringify(built2.meta));
print(built2.root, 0);

await db.$disconnect();
