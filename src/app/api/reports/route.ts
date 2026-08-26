import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// POST /api/reports — generate a report in requested format
// Body: { projectId, format: "html"|"md"|"json"|"txt" }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { projectId, format } = body;
    if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

    const project = await db.project.findUnique({ where: { id: projectId } });
    if (!project) return NextResponse.json({ error: "project not found" }, { status: 404 });

    const findings = await db.finding.findMany({ where: { projectId }, orderBy: [{ severity: "desc" }, { firstSeenAt: "desc" }] });
    const targets = await db.target.findMany({ where: { projectId } });
    const excluded = await db.excludedTarget.findMany({ where: { projectId } });
    const runs = await db.pipelineRun.findMany({ where: { projectId }, orderBy: { createdAt: "desc" } });

    const stats = computeStats(findings, targets, excluded, runs);

    const fmt = format || "html";
    let content = "";
    let contentType = "text/html; charset=utf-8";
    // Content-Disposition headers must be ASCII (ByteString). Strip anything
    // outside [A-Za-z0-9._-] so unicode project names (e.g. "GitLab — HackerOne")
    // don't blow up the response, and keep the name readable.
    const safeBase =
      project.name
        .normalize("NFKD")
        .replace(/[^\w\s.-]+/g, "")
        .trim()
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .toLowerCase() || "project";
    let filename = `${safeBase}-report.${fmt === "html" ? "html" : fmt === "md" ? "md" : fmt === "json" ? "json" : "txt"}`;

    if (fmt === "json") {
      content = JSON.stringify({ project, stats, findings, targets, excluded, runs }, null, 2);
      contentType = "application/json; charset=utf-8";
    } else if (fmt === "md") {
      content = buildMarkdown(project, stats, findings, targets, excluded, runs);
      contentType = "text/markdown; charset=utf-8";
    } else if (fmt === "txt") {
      content = buildText(project, stats, findings, targets, excluded, runs);
      contentType = "text/plain; charset=utf-8";
    } else {
      content = buildHTML(project, stats, findings, targets, excluded, runs);
    }

    await db.auditLog.create({
      data: { projectId, action: "report.generate", target: fmt, details: JSON.stringify({ findings: findings.length }) },
    });

    return new NextResponse(content, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

function computeStats(findings: any[], targets: any[], excluded: any[], runs: any[]) {
  const severityCount: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  const typeCount: Record<string, number> = {};
  for (const f of findings) {
    severityCount[f.severity] = (severityCount[f.severity] || 0) + 1;
    typeCount[f.type] = (typeCount[f.type] || 0) + 1;
  }
  return {
    total: findings.length,
    severityCount,
    typeCount,
    targetCount: targets.length,
    excludedCount: excluded.length,
    runCount: runs.length,
    lastRun: runs[0] || null,
  };
}

function severityColor(sev: string): string {
  return {
    critical: "#dc2626",
    high: "#ea580c",
    medium: "#d97706",
    low: "#0284c7",
    info: "#64748b",
  }[sev] || "#64748b";
}

function buildHTML(project: any, stats: any, findings: any[], targets: any[], excluded: any[], runs: any[]): string {
  const sev = (s: string) => `<span style="display:inline-block;padding:2px 8px;border-radius:4px;background:${severityColor(s)};color:white;font-size:11px;font-weight:600;letter-spacing:0.4px;text-transform:uppercase;">${s}</span>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Antlion Report — ${escapeHtml(project.name)}</title>
<style>
  :root {
    --bg: #0f1419;
    --card: #1a1f2e;
    --fg: #e8eef5;
    --muted: #94a3b8;
    --border: #2a3142;
    --accent: #3ec7b8;
  }
  body { background: var(--bg); color: var(--fg); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; margin: 0; padding: 40px; line-height: 1.6; }
  .container { max-width: 1100px; margin: 0 auto; }
  header { border-bottom: 1px solid var(--border); padding-bottom: 20px; margin-bottom: 32px; }
  h1 { font-size: 28px; margin: 0 0 8px 0; color: var(--fg); }
  h2 { font-size: 22px; margin: 32px 0 12px 0; padding-bottom: 8px; border-bottom: 1px solid var(--border); }
  h3 { font-size: 16px; margin: 24px 0 8px 0; color: var(--accent); }
  .meta { color: var(--muted); font-size: 13px; }
  .stats-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin: 16px 0 32px 0; }
  .stat { background: var(--card); padding: 16px; border-radius: 8px; border: 1px solid var(--border); text-align: center; }
  .stat-value { font-size: 28px; font-weight: 700; }
  .stat-label { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.6px; margin-top: 4px; }
  .finding { background: var(--card); padding: 16px; border-radius: 8px; border: 1px solid var(--border); margin: 8px 0; }
  .finding-title { font-weight: 600; margin-bottom: 4px; display: flex; align-items: center; gap: 8px; }
  .finding-target { color: var(--accent); font-size: 13px; font-family: "SF Mono", Menlo, monospace; }
  .finding-meta { color: var(--muted); font-size: 12px; margin-top: 4px; }
  pre { background: #0a0f1a; padding: 12px; border-radius: 6px; overflow-x: auto; font-size: 12px; color: #cbd5e1; }
  code { font-family: "SF Mono", Menlo, monospace; }
  .severity-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin: 16px 0; }
  .severity-card { padding: 12px; border-radius: 6px; text-align: center; color: white; }
  .severity-card .count { font-size: 24px; font-weight: 700; }
  .severity-card .label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0; }
  th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid var(--border); font-size: 13px; }
  th { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
  footer { margin-top: 60px; padding-top: 16px; border-top: 1px solid var(--border); color: var(--muted); font-size: 12px; }
  .badge { display:inline-block;padding:2px 6px;border-radius:3px;font-size:10px;background:#2a3142;color:#cbd5e1;margin-left:8px; }
</style>
</head>
<body>
<div class="container">
  <header>
    <h1>Antlion Report — ${escapeHtml(project.name)}</h1>
    <div class="meta">
      Project ID: <code>${project.id}</code> · Generated: ${new Date().toISOString()} · Runs: ${stats.runCount} · Targets: ${stats.targetCount}
    </div>
  </header>

  <h2>Executive Summary</h2>
  <p>This report summarizes findings from automated reconnaissance and vulnerability scanning conducted against the in-scope assets defined in this Antlion project. The pipeline executed ${stats.runCount} run(s), producing ${stats.total} findings across ${stats.targetCount} targets.</p>

  <div class="severity-grid">
    ${["critical", "high", "medium", "low", "info"].map((s) => `
    <div class="severity-card" style="background:${severityColor(s)};">
      <div class="count">${stats.severityCount[s] || 0}</div>
      <div class="label">${s}</div>
    </div>`).join("")}
  </div>

  <h2>Scope</h2>
  <h3>In-Scope Assets (${targets.length})</h3>
  <table>
    <thead><tr><th>Target</th><th>Type</th><th>Origin</th></tr></thead>
    <tbody>
    ${targets.map((t) => `<tr><td><code>${escapeHtml(t.value)}</code></td><td>${t.type}</td><td>${t.origin}</td></tr>`).join("")}
    </tbody>
  </table>

  ${excluded.length ? `
  <h3>Out-of-Scope Assets (${excluded.length})</h3>
  <table>
    <thead><tr><th>Target</th><th>Type</th><th>Reason</th></tr></thead>
    <tbody>
    ${excluded.map((t) => `<tr><td><code>${escapeHtml(t.value)}</code></td><td>${t.type}</td><td>${t.reason || "Program-defined exclusion"}</td></tr>`).join("")}
    </tbody>
  </table>` : ""}

  <h2>Findings (${findings.length})</h2>
  ${findings.map((f) => `
  <div class="finding">
    <div class="finding-title">${sev(f.severity)} ${escapeHtml(f.title)}</div>
    <div class="finding-target">${f.url ? escapeHtml(f.url) : f.target ? escapeHtml(f.target) : ""}</div>
    ${f.description ? `<p style="margin:8px 0 0 0;font-size:13px;">${escapeHtml(f.description)}</p>` : ""}
    ${f.evidence ? `<h3 style="margin-top:12px;">Evidence</h3><pre>${escapeHtml(f.evidence)}</pre>` : ""}
    ${f.remediation ? `<h3 style="margin-top:12px;">Remediation</h3><p style="font-size:13px;">${escapeHtml(f.remediation)}</p>` : ""}
    <div class="finding-meta">
      ${f.source ? `Source: ${f.source}` : ""} · Type: ${f.type} · Status: ${f.status} · First seen: ${new Date(f.firstSeenAt).toISOString()}
    </div>
  </div>`).join("")}

  <footer>
    Generated by Antlion — local-first bug bounty recon workspace.
    All findings subject to ethical disclosure policies of the originating program.
  </footer>
</div>
</body>
</html>`;
}

function buildMarkdown(project: any, stats: any, findings: any[], targets: any[], excluded: any[], runs: any[]): string {
  let md = `# Antlion Report — ${project.name}\n\n`;
  md += `**Project ID:** \`${project.id}\`  \n`;
  md += `**Generated:** ${new Date().toISOString()}  \n`;
  md += `**Runs:** ${stats.runCount} · **Targets:** ${stats.targetCount} · **Findings:** ${stats.total}\n\n`;

  md += `## Executive Summary\n\nThis report summarizes findings from automated reconnaissance and vulnerability scanning conducted against the in-scope assets defined in this Antlion project. The pipeline executed ${stats.runCount} run(s), producing ${stats.total} findings across ${stats.targetCount} targets.\n\n`;

  md += `### Severity Breakdown\n\n| Severity | Count |\n|----------|-------|\n`;
  for (const s of ["critical", "high", "medium", "low", "info"]) {
    md += `| ${s} | ${stats.severityCount[s] || 0} |\n`;
  }
  md += `\n`;

  md += `## Scope\n\n### In-Scope Assets (${targets.length})\n\n| Target | Type | Origin |\n|--------|------|--------|\n`;
  for (const t of targets) md += `| \`${t.value}\` | ${t.type} | ${t.origin} |\n`;

  if (excluded.length) {
    md += `\n### Out-of-Scope Assets (${excluded.length})\n\n| Target | Type | Reason |\n|--------|------|--------|\n`;
    for (const t of excluded) md += `| \`${t.value}\` | ${t.type} | ${t.reason || "Program-defined exclusion"} |\n`;
  }

  md += `\n## Findings (${findings.length})\n\n`;
  for (const f of findings) {
    md += `### [${f.severity.toUpperCase()}] ${f.title}\n\n`;
    if (f.target || f.url) md += `**Target:** ${f.url || f.target}\n\n`;
    if (f.description) md += `${f.description}\n\n`;
    if (f.evidence) md += `**Evidence:**\n\`\`\`\n${f.evidence}\n\`\`\`\n\n`;
    if (f.remediation) md += `**Remediation:** ${f.remediation}\n\n`;
    md += `*Source: ${f.source || "—"} · Type: ${f.type} · Status: ${f.status} · First seen: ${new Date(f.firstSeenAt).toISOString()}*\n\n---\n\n`;
  }

  md += `\n---\n\n*Generated by Antlion — local-first bug bounty recon workspace. All findings subject to ethical disclosure policies of the originating program.*\n`;
  return md;
}

function buildText(project: any, stats: any, findings: any[], targets: any[], excluded: any[], runs: any[]): string {
  let t = `ANTLION REPORT\n${"=".repeat(80)}\n\n`;
  t += `Project: ${project.name}\nProject ID: ${project.id}\nGenerated: ${new Date().toISOString()}\n`;
  t += `Runs: ${stats.runCount} | Targets: ${stats.targetCount} | Findings: ${stats.total}\n\n`;
  t += `EXECUTIVE SUMMARY\n${"-".repeat(80)}\n`;
  t += `This report summarizes findings from automated reconnaissance and vulnerability scanning conducted against the in-scope assets defined in this Antlion project. The pipeline executed ${stats.runCount} run(s), producing ${stats.total} findings across ${stats.targetCount} targets.\n\n`;
  t += `SEVERITY BREAKDOWN\n${"-".repeat(80)}\n`;
  for (const s of ["critical", "high", "medium", "low", "info"]) {
    t += `  ${s.toUpperCase().padEnd(10)} ${stats.severityCount[s] || 0}\n`;
  }
  t += `\nSCOPE — IN-SCOPE (${targets.length})\n${"-".repeat(80)}\n`;
  for (const tg of targets) t += `  ${tg.type.padEnd(10)} ${tg.value}  (via ${tg.origin})\n`;
  if (excluded.length) {
    t += `\nSCOPE — OUT-OF-SCOPE (${excluded.length})\n${"-".repeat(80)}\n`;
    for (const e of excluded) t += `  ${e.type.padEnd(10)} ${e.value}  (${e.reason || "excluded"})\n`;
  }
  t += `\nFINDINGS (${findings.length})\n${"=".repeat(80)}\n\n`;
  for (const f of findings) {
    t += `[${f.severity.toUpperCase()}] ${f.title}\n`;
    if (f.url || f.target) t += `  Target: ${f.url || f.target}\n`;
    if (f.description) t += `  ${f.description}\n`;
    if (f.evidence) t += `  Evidence:\n${f.evidence.split("\n").map((l: string) => `    ${l}`).join("\n")}\n`;
    if (f.remediation) t += `  Remediation: ${f.remediation}\n`;
    t += `  Source: ${f.source || "—"} | Status: ${f.status} | First seen: ${new Date(f.firstSeenAt).toISOString()}\n\n${"-".repeat(80)}\n\n`;
  }
  t += `\nGenerated by Antlion — local-first bug bounty recon workspace.\n`;
  return t;
}

function escapeHtml(s: string): string {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
