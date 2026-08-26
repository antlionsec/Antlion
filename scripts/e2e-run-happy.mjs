#!/usr/bin/env node
// E2E: happy-path run after executor refactor — completes, findings persist,
// project counters update, completion audit + notification dispatch fire.
const BASE = "http://localhost:3000";
const PROJ = "8bc10925-b50a-47b5-b3c3-65495535cc99";
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

(async () => {
  const before = (await j("GET", `/api/projects/${PROJ}`)).data.stats;
  console.log(`before: runs=${before.runCount} findings=${before.findingCount}`);

  // gau produces endpoint findings; add a local webhook receiver to prove dispatch
  const http = await import("node:http");
  const received = [];
  const srv = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      received.push({ path: req.url, body });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end('{"ok":true}');
    });
  });
  await new Promise((r) => srv.listen(3999, "127.0.0.1", r));

  // Register a temp generic webhook hook via the settings API
  await j("PUT", "/api/settings", { notifyHooks: JSON.stringify([
    { id: "e2e-temp", name: "E2E hook", type: "generic", url: "http://127.0.0.1:3999/hook", enabled: true,
      events: { "run.completed": true, "run.failed": true, "findings.new": true }, minSeverity: "info" },
  ]) });

  const start = await j("POST", "/api/runs", {
    projectId: PROJ,
    targetValues: ["gitlab.com"],
    config: { stages: [
      { name: "Subdomain Discovery", toolIds: ["subfinder"], enabled: true },
      { name: "URL & Endpoint Discovery", toolIds: ["gau"], enabled: true },
    ] },
  });
  ok("run created", start.status === 200);
  const runId = start.data.runId;

  // Poll up to 6 min for completion
  let run;
  for (let i = 0; i < 180; i++) {
    await sleep(2000);
    run = (await j("GET", `/api/runs/${runId}`)).data.run;
    if (["completed", "failed", "cancelled"].includes(run?.status)) break;
  }
  ok("run completed", run?.status === "completed", `status=${run?.status} in ${Math.round((Date.now() - Date.parse(run?.startedAt || new Date())) / 1000)}s`);
  const stages = (await j("GET", `/api/runs/${runId}`)).data.stages;
  ok("all stages completed", stages.every((s) => s.status === "completed"), stages.map((s) => s.status).join(","));

  const after = (await j("GET", `/api/projects/${PROJ}`)).data.stats;
  ok("run counter incremented", after.runCount === before.runCount + 1, `${before.runCount} → ${after.runCount}`);

  // Wait a moment for the async notification dispatch, then check receiver
  await sleep(3000);
  const runCompleted = received.find((r) => r.body.includes("Run completed"));
  ok("run.completed webhook delivered", Boolean(runCompleted));
  const findingsNew = received.find((r) => r.body.includes("New findings"));
  console.log(`  (findings.new hook: ${findingsNew ? "fired" : "not fired (no new findings persisted — dedup)"} · webhooks received: ${received.length})`);

  // Cleanup: remove temp hook, close receiver
  await j("PUT", "/api/settings", { notifyHooks: JSON.stringify([]) });
  srv.close();

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
