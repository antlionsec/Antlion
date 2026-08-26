#!/usr/bin/env node
// E2E: Vulnerability Scanning stage with the expanded toolset — nuclei, nikto,
// dalfox and tlsx run as REAL subprocesses against local test targets and
// their findings must land in the database with correct types/severities.
//
// Targets (scripts/test-target-server.mjs + test-tls-target.mjs):
//   Run A (HTTP) — http://localtest.me:9999/?q=test
//     • nikto: verbose banners, outdated software, missing security headers
//     • dalfox: reflected XSS on the q parameter
//     • nuclei: runs honestly (no templates fire on this toy server)
//   Run B (TLS) — localtest.me:8443
//     • tlsx: self-signed cert, TLS1.0/1.1, weak cipher enumeration
const BASE = "http://localhost:3000";
import { spawn } from "node:child_process";
import { connect as tcpConnect } from "node:net";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const HTTP_PORT = 9999;
const TLS_PORT = 8443;

/** Start one of the local test-target servers and wait for readiness. */
function startTarget(script, port) {
  const child = spawn("node", [join(HERE, script), String(port)], {
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });
  child.stdout.on("data", () => {});
  child.stderr.on("data", () => {});
  return child;
}

async function waitFor(url, ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      await fetch(url, { signal: AbortSignal.timeout(1000) });
      return true;
    } catch {
      await sleep(300);
    }
  }
  return false;
}

/** TCP-level readiness (for TLS targets where fetch would fail on the self-signed cert). */
function waitForPort(port, ms = 20000) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const tryOnce = () => {
      const sock = tcpConnect(port, "127.0.0.1");
      sock.once("connect", () => { sock.destroy(); resolve(true); });
      sock.once("error", () => {
        sock.destroy();
        if (Date.now() - t0 > ms) resolve(false);
        else setTimeout(tryOnce, 300);
      });
    };
    tryOnce();
  });
}

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ✓ ${name}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${name}${extra ? " — " + extra : ""}`); }
};
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

async function runStage(projectId, targetValues, toolIds, toolOverrides) {
  const start = await j("POST", "/api/runs", {
    projectId,
    targetValues,
    config: {
      stages: [{ name: "Vulnerability Scanning", toolIds, enabled: true }],
      toolOverrides,
    },
  });
  if (!start.data?.runId) return { error: start.data };
  const runId = start.data.runId;
  let detail;
  for (let i = 0; i < 150; i++) {
    await sleep(3000);
    detail = (await j("GET", `/api/runs/${runId}`)).data;
    if (detail?.run && ["completed", "failed", "cancelled"].includes(detail.run.status)) break;
  }
  return { runId, detail };
}

(async () => {
  // 0. Start the local test targets (they die with this script)
  const httpTarget = startTarget("test-target-server.mjs", HTTP_PORT);
  const tlsTarget = startTarget("test-tls-target.mjs", TLS_PORT);
  ok("HTTP test target up", await waitFor(`http://127.0.0.1:${HTTP_PORT}/`));
  ok("TLS test target up", await waitForPort(TLS_PORT));

  const proj = await j("POST", "/api/projects", {
    name: `E2E Vuln Stage ${new Date().toISOString().slice(11, 19)}`,
    description: "vuln-stage e2e",
  });
  ok("project created", proj.status === 200 || proj.status === 201);
  const projectId = proj.data.project?.id || proj.data.id;

  // ---------------- Run A: HTTP target ----------------
  console.log("\n— Run A: nikto + dalfox + nuclei against http://localtest.me:9999 —");
  const a = await runStage(projectId, ["http://localtest.me:9999/?q=test"],
    ["nikto", "dalfox", "nuclei"], { nikto: { timeout: 5 } });
  ok("run A accepted", Boolean(a.runId), a.error?.error || "");
  ok("run A completed", a.detail?.run?.status === "completed", `status=${a.detail?.run?.status}`);

  const logsA = a.detail?.stages?.[0]?.logs || [];
  const ran = (tool) => logsA.some((l) => l.text.includes(`Running ${tool}`));
  ok("nikto executed", ran("Nikto"));
  ok("dalfox executed", ran("Dalfox"));
  ok("nuclei executed", ran("Nuclei"));

  const findingsA = (await j("GET", `/api/findings?projectId=${projectId}`)).data.findings || [];
  const bySource = {};
  for (const f of findingsA) bySource[f.source] = (bySource[f.source] || 0) + 1;
  console.log("  findings by source:", JSON.stringify(bySource));

  ok("nikto findings persisted", (bySource["Nikto"] || 0) >= 5, `${bySource["Nikto"] || 0}`);
  const niktoT = findingsA.filter((f) => f.source === "Nikto").map((f) => f.title);
  ok("nikto: outdated software detected", niktoT.some((t) => /outdated/i.test(t)));
  ok("nikto: missing security header detected", niktoT.some((t) => /header missing/i.test(t)));
  ok("nikto: findings have evidence", findingsA.filter((f) => f.source === "Nikto").every((f) => Boolean(f.evidence)));

  ok("dalfox XSS finding persisted", (bySource["Dalfox"] || 0) >= 1, `${bySource["Dalfox"] || 0}`);
  const xss = findingsA.find((f) => f.source === "Dalfox");
  if (xss) {
    ok("dalfox: vulnerability/high severity", xss.type === "vulnerability" && xss.severity === "high");
    ok("dalfox: evidence + remediation present", Boolean(xss.evidence && xss.remediation));
    ok("dalfox: parameter named in title", /'q'/.test(xss.title), xss.title);
  }

  // ---------------- Run B: TLS target ----------------
  console.log("\n— Run B: tlsx against localtest.me:8443 (TLS 1.0-1.2, self-signed) —");
  const b = await runStage(projectId, ["localtest.me:8443"], ["tlsx"], { tlsx: { enum_ciphers: true } });
  ok("run B accepted", Boolean(b.runId), b.error?.error || "");
  ok("run B completed", b.detail?.run?.status === "completed", `status=${b.detail?.run?.status}`);
  ok("tlsx executed", (b.detail?.stages?.[0]?.logs || []).some((l) => l.text.includes("Running tlsx")));

  const findingsB = (await j("GET", `/api/findings?projectId=${projectId}`)).data.findings || [];
  const tlsT = findingsB.filter((f) => f.source === "tlsx").map((f) => f.title);
  console.log(`  tlsx findings: ${tlsT.length}`);
  ok("tlsx: self-signed certificate detected", tlsT.some((t) => /self-signed/i.test(t)));
  ok("tlsx: deprecated TLS version detected", tlsT.some((t) => /deprecated tls/i.test(t)));
  ok("tlsx: weak ciphers enumerated", tlsT.some((t) => /ciphers accepted/i.test(t)));
  ok("tlsx: findings have remediation", findingsB.filter((f) => f.source === "tlsx").every((f) => Boolean(f.remediation)));

  const tlsSample = findingsB.find((f) => f.source === "tlsx");
  if (tlsSample) {
    ok("tlsx: severities within valid set", ["low", "medium", "high", "critical"].includes(tlsSample.severity));
  }

  // ---------------- cleanup ----------------
  const del = await j("DELETE", `/api/projects/${projectId}`);
  ok("cleanup", del.status === 200 || del.status === 204);
  httpTarget.kill();
  tlsTarget.kill();

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
