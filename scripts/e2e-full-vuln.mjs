#!/usr/bin/env node
// Final integration: the complete Vulnerability Scanning stage (all 7 tools)
// runs against the WordPress test target in ONE pipeline run.
const BASE = "http://localhost:3000";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function j(method, path, body) {
  const r = await fetch(BASE + path, {
    method, headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await r.json(); } catch {}
  return { status: r.status, data };
}

(async () => {
  const wp = spawn("node", [join(HERE, "test-wp-target.mjs"), "9997"], { stdio: "ignore", detached: true });
  wp.unref();
  await sleep(1200);

  const proj = await j("POST", "/api/projects", { name: `E2E Full Vuln ${new Date().toISOString().slice(11, 19)}` });
  const projectId = proj.data.project?.id || proj.data.id;
  const start = await j("POST", "/api/runs", {
    projectId,
    targetValues: ["http://localtest.me:9997"],
    config: {
      stages: [{
        name: "Vulnerability Scanning",
        toolIds: ["nuclei", "nikto", "dalfox", "tlsx", "cariddi", "whatweb", "wpscan"],
        enabled: true,
      }],
      toolOverrides: { nikto: { timeout: 5 } },
    },
  });
  console.log("run:", start.data?.runId || start.data?.error);
  const runId = start.data?.runId;

  let detail;
  for (let i = 0; i < 150; i++) {
    await sleep(4000);
    detail = (await j("GET", `/api/runs/${runId}`)).data;
    if (["completed", "failed", "cancelled"].includes(detail?.run?.status)) break;
    if (i % 10 === 9) console.log(`  t=${(i + 1) * 4}s status=${detail?.run?.status}`);
  }
  console.log("final status:", detail?.run?.status);

  const logs = detail?.stages?.[0]?.logs || [];
  for (const t of ["Nuclei", "Nikto", "Dalfox", "tlsx", "cariddi", "WhatWeb", "WPScan"]) {
    const line = logs.find((l) => l.text.includes(`Running ${t}`));
    const res = logs.find((l) => l.text.includes(`Running ${t}`) && false) || logs.filter((l) => l.text.includes(t)).slice(-1)[0];
    console.log(`  ${t.padEnd(8)} ${line ? "ran" : "MISSING"}  | ${(res?.text || "").slice(0, 90)}`);
  }

  const findings = (await j("GET", `/api/findings?projectId=${projectId}`)).data.findings || [];
  const bySource = {};
  for (const f of findings) bySource[f.source] = (bySource[f.source] || 0) + 1;
  console.log("findings by source:", JSON.stringify(bySource));

  const del = await j("DELETE", `/api/projects/${projectId}`);
  try { process.kill(-wp.pid, "SIGKILL"); } catch {}
  console.log("cleanup:", del.status);
})().catch((e) => { console.error(e); process.exit(1); });
