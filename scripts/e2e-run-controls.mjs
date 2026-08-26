#!/usr/bin/env node
// E2E test: cooperative run controls — pause → resume → cancel with REAL
// subprocesses. Uses subfinder + amass + assetfinder (installed) so the run
// lasts long enough to control mid-flight.
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
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await r.json(); } catch {}
  return { status: r.status, data };
}

(async () => {
  console.log("== Start a real multi-tool run ==");
  const start = await j("POST", "/api/runs", {
    projectId: PROJ,
    targetValues: ["gitlab.com"],
    config: {
      stages: [
        { name: "Subdomain Discovery", toolIds: ["subfinder", "amass", "assetfinder"], enabled: true },
        { name: "URL & Endpoint Discovery", toolIds: ["gau"], enabled: true },
        { name: "Secrets Hunt", toolIds: ["trufflehog"], enabled: true },
      ],
    },
  });
  ok("run created", start.status === 200 && start.data.runId, `runId ${start.data.runId?.slice(0, 8)}`);
  const runId = start.data.runId;

  // Wait for the first tool (subfinder) to be in-flight
  let run;
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    run = (await j("GET", `/api/runs/${runId}`)).data.run;
    if (run?.status === "running" && run?.doneStages === 0) break;
  }
  ok("run is running", run?.status === "running", `status=${run?.status}`);

  console.log("== PAUSE ==");
  const pause = await j("PATCH", `/api/runs/${runId}`, { status: "paused", projectId: PROJ });
  ok("pause accepted", pause.status === 200);
  const badPause = await j("PATCH", `/api/runs/${runId}`, { status: "paused", projectId: PROJ });
  ok("double-pause rejected (409)", badPause.status === 409, `status=${badPause.status}`);

  // Wait until the executor honors the pause (current tool finishes first)
  let paused;
  for (let i = 0; i < 90; i++) {
    await sleep(2000);
    paused = (await j("GET", `/api/runs/${runId}`)).data.run;
    if (paused?.status === "paused") break;
  }
  ok("executor reached paused state", paused?.status === "paused", `status=${paused?.status}`);

  console.log("== RESUME ==");
  const resume = await j("PATCH", `/api/runs/${runId}`, { status: "running", projectId: PROJ });
  ok("resume accepted", resume.status === 200);
  let resumed;
  for (let i = 0; i < 30; i++) {
    await sleep(2000);
    resumed = (await j("GET", `/api/runs/${runId}`)).data.run;
    if (resumed?.status === "running") break;
  }
  ok("run running again", resumed?.status === "running", `status=${resumed?.status}`);

  console.log("== CANCEL mid-flight ==");
  const cancel = await j("PATCH", `/api/runs/${runId}`, { status: "cancelled", projectId: PROJ });
  ok("cancel accepted", cancel.status === 200);
  let cancelled;
  for (let i = 0; i < 60; i++) {
    await sleep(2000);
    cancelled = (await j("GET", `/api/runs/${runId}`)).data.run;
    if (cancelled?.status === "cancelled") break;
  }
  ok("run finalized as cancelled", cancelled?.status === "cancelled", `status=${cancelled?.status}`);
  ok("finishedAt set", Boolean(cancelled?.finishedAt));

  const stages = (await j("GET", `/api/runs/${runId}`)).data.stages;
  const stageStatuses = stages.map((s) => `${s.name}: ${s.status}`).join(" | ");
  console.log("  stage statuses:", stageStatuses);
  const anyRunning = stages.some((s) => s.status === "running" || s.status === "pending");
  ok("no stage left running/pending", !anyRunning);
  const hasCancelledStage = stages.some((s) => s.status === "cancelled");
  const hasSkipped = stages.some((s) => s.status === "skipped");
  ok("current stage cancelled + rest skipped", hasCancelledStage && hasSkipped);

  // Cancel log line must mention the kill
  const cancelledStage = stages.find((s) => s.status === "cancelled");
  const logText = (cancelledStage?.logs || []).map((l) => l.text).join("\n");
  ok("log shows cancellation", /Cancelled by user/i.test(logText), logText.split("\n").slice(-1)[0]?.slice(0, 80));

  console.log("== Transition guards on terminal states ==");
  const g1 = await j("PATCH", `/api/runs/${runId}`, { status: "running", projectId: PROJ });
  ok("resume cancelled run rejected", g1.status === 409);
  const g2 = await j("PATCH", `/api/runs/${runId}`, { status: "paused", projectId: PROJ });
  ok("pause cancelled run rejected", g2.status === 409);

  console.log("== No completion notification was dispatched ==");
  // (Hook-less check: audit log entry for cancellation exists)
  const audit = await j("GET", `/api/audit?projectId=${PROJ}&limit=30`);
  const hasCancelAudit = audit.data.logs.some((l) => l.action === "pipeline.run.cancelled" && l.target === runId);
  ok("audit log records cancellation", hasCancelAudit);

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
