import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
const projects = await db.project.findMany({ where: { status: "active" } });
for (const p of projects) {
  console.log("PROJECT:", p.id, p.name, "| targets:", p.targetCount, "| findings:", p.findingCount);
  const targets = await db.target.findMany({ where: { projectId: p.id }, take: 50 });
  console.log("  TARGETS:");
  for (const t of targets) console.log(`   - [${t.type}] ${t.value} (origin=${t.origin}, inScope=${t.inScope})`);
  const findings = await db.finding.findMany({ where: { projectId: p.id }, take: 100 });
  console.log("  FINDINGS:", findings.length);
  for (const f of findings) console.log(`   - [${f.type}/${f.severity}] "${f.title}" target=${JSON.stringify(f.target)} url=${JSON.stringify(f.url?.slice(0,60))} source=${f.source}`);
}
await db.$disconnect();
