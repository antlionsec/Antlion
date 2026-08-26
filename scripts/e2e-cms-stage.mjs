#!/usr/bin/env node
// E2E: CMS scanning layer of the Vulnerability Scanning stage — cariddi,
// whatweb and wpscan run as REAL subprocesses against local test targets and
// their findings must land in the database with correct types/severities.
//
// Run A (cariddi)  — http://localtest.me:9998/?q=test
//   • secret: AWS access key leaked in an HTML comment on /admin/
//   • endpoint: juicy parameter 'q' (XSS attack vector)
//   • vulnerability: PHP/MySQL error + stack trace leaked on /debug/
//   • vulnerability: exposed .env file linked from /admin/
// Run B (whatweb + wpscan) — http://localtest.me:9997 (fake WordPress)
//   • whatweb: WordPress 6.2 / Apache / PHP tech fingerprints
//   • wpscan: WordPress 6.2 (insecure) version finding, outdated theme,
//     debug.log exposure, upload directory listing, readme exposure
const BASE = "http://localhost:3000";
import { spawn } from "node:child_process";
import { connect as tcpConnect } from "node:net";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const HTTP_PORT = 9998;
const WP_PORT = 9997;

function startTarget(script, port) {
  const child = spawn("node", [join(HERE, script), String(port)], {
    stdio: ["ignore", "ignore", "ignore"],
    detached: true,
  });
  child.unref();
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
  const wpTarget = startTarget("test-wp-target.mjs", WP_PORT);
  ok("HTTP test target up", await waitFor(`http://127.0.0.1:${HTTP_PORT}/`));
  ok("WordPress test target up", await waitFor(`http://127.0.0.1:${WP_PORT}/`));

  // 0b. Tool scanner must see the three new tools with real versions
  const scan = await j("GET", "/api/tools?refresh=1");
  const tools = scan.data?.tools || [];
  for (const id of ["cariddi", "whatweb", "wpscan"]) {
    const t = tools.find((x) => x.id === id);
    ok(`tool scanner: ${id} installed with version`, Boolean(t?.installed && t?.version), `v${t?.version}`);
  }

  const proj = await j("POST", "/api/projects", {
    name: `E2E CMS Stage ${new Date().toISOString().slice(11, 19)}`,
    description: "cms-stage e2e",
  });
  ok("project created", proj.status === 200 || proj.status === 201);
  const projectId = proj.data.project?.id || proj.data.id;

  // ---------------- Run A: cariddi against the buggy web app ----------------
  console.log("\n— Run A: cariddi against http://localtest.me:9998/?q=test —");
  const a = await runStage(projectId, ["http://localtest.me:9998/?q=test"], ["cariddi"],
    { cariddi: { timeout: 3, concurrency: 5, max_depth: 2 } });
  ok("run A accepted", Boolean(a.runId), a.error?.error || "");
  ok("run A completed", a.detail?.run?.status === "completed", `status=${a.detail?.run?.status}`);

  const logsA = a.detail?.stages?.[0]?.logs || [];
  ok("cariddi executed", logsA.some((l) => l.text.includes("Running cariddi")));
  ok("cariddi: targets piped via stdin", logsA.some((l) => l.text.includes("piped via stdin")));

  const findingsA = (await j("GET", `/api/findings?projectId=${projectId}`)).data.findings || [];
  const cariddiF = findingsA.filter((f) => f.source === "cariddi");
  console.log(`  cariddi findings: ${cariddiF.length}`);
  for (const f of cariddiF) console.log(`    [${f.type}/${f.severity}] ${f.title}`);

  ok("cariddi: secret (AWS key) detected", cariddiF.some((f) => f.type === "secret" && /aws access key/i.test(f.title)));
  const secret = cariddiF.find((f) => f.type === "secret");
  if (secret) {
    ok("cariddi: secret has evidence + remediation", Boolean(secret.evidence && secret.remediation));
    ok("cariddi: secret severity high", secret.severity === "high");
  }
  ok("cariddi: juicy parameter 'q' detected", cariddiF.some((f) => f.type === "endpoint" && /'q'/.test(f.title)));
  const param = cariddiF.find((f) => f.type === "endpoint" && /'q'/.test(f.title));
  if (param) ok("cariddi: parameter names XSS attack vector", /XSS/.test(param.description || ""));
  ok("cariddi: leaked errors detected", cariddiF.some((f) => f.type === "vulnerability" && /error|Debug information/i.test(f.title)));
  ok("cariddi: exposed .env file detected", cariddiF.some((f) => f.type === "vulnerability" && /\.ENV/i.test(f.title)));
  ok("cariddi: findings have remediation", cariddiF.filter((f) => f.severity !== "info").every((f) => Boolean(f.remediation)));

  // ---------------- Run B: whatweb + wpscan against WordPress ----------------
  console.log("\n— Run B: whatweb + wpscan against http://localtest.me:9997 (WordPress 6.2) —");
  const b = await runStage(projectId, ["http://localtest.me:9997"], ["whatweb", "wpscan"],
    { whatweb: { aggression: "1" }, wpscan: { detection_mode: "mixed" } });
  ok("run B accepted", Boolean(b.runId), b.error?.error || "");
  ok("run B completed", b.detail?.run?.status === "completed", `status=${b.detail?.run?.status}`);

  const logsB = b.detail?.stages?.[0]?.logs || [];
  ok("whatweb executed", logsB.some((l) => l.text.includes("Running WhatWeb")));
  ok("wpscan executed", logsB.some((l) => l.text.includes("Running WPScan")));

  const findingsB = (await j("GET", `/api/findings?projectId=${projectId}`)).data.findings || [];
  const whatwebF = findingsB.filter((f) => f.source === "WhatWeb");
  const wpscanF = findingsB.filter((f) => f.source === "WPScan");
  console.log(`  whatweb findings: ${whatwebF.length}`);
  for (const f of whatwebF) console.log(`    [${f.type}/${f.severity}] ${f.title}`);
  console.log(`  wpscan findings: ${wpscanF.length}`);
  for (const f of wpscanF) console.log(`    [${f.type}/${f.severity}] ${f.title}`);

  // whatweb assertions
  ok("whatweb: WordPress 6.2 fingerprinted", whatwebF.some((f) => /WordPress 6\.2/i.test(f.title)));
  ok("whatweb: Apache version detected", whatwebF.some((f) => /Apache/i.test(f.title)));
  ok("whatweb: PHP version detected", whatwebF.some((f) => /PHP/i.test(f.title)));
  ok("whatweb: findings are type tech", whatwebF.every((f) => f.type === "tech"));

  // wpscan assertions
  ok("wpscan: WordPress 6.2 version finding", wpscanF.some((f) => /WordPress 6\.2/i.test(f.title)));
  const wpVersion = wpscanF.find((f) => /WordPress 6\.2/i.test(f.title));
  if (wpVersion) {
    ok("wpscan: insecure core marked high severity", wpVersion.severity === "high", `severity=${wpVersion.severity}`);
    ok("wpscan: version finding has evidence (found_by/entries)", Boolean(wpVersion.evidence));
  }
  ok("wpscan: outdated theme flagged", wpscanF.some((f) => /outdated theme/i.test(f.title)));
  ok("wpscan: debug.log exposure flagged", wpscanF.some((f) => /debug log/i.test(f.title)));
  ok("wpscan: upload directory listing flagged", wpscanF.some((f) => /directory has listing/i.test(f.title)));
  ok("wpscan: readme exposure flagged", wpscanF.some((f) => /readme/i.test(f.title)));
  ok("wpscan: actionable findings have remediation",
    wpscanF.filter((f) => f.severity !== "info").every((f) => Boolean(f.remediation)));

  // ---------------- cleanup ----------------
  const del = await j("DELETE", `/api/projects/${projectId}`);
  ok("cleanup", del.status === 200 || del.status === 204);
  try { process.kill(-httpTarget.pid, "SIGKILL"); } catch {}
  try { process.kill(-wpTarget.pid, "SIGKILL"); } catch {}

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
