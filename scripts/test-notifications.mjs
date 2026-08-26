// End-to-end notification test:
// 1. Save a global hook (generic → local receiver, minSeverity info)
// 2. Create a throwaway project with one target
// 3. Start a 1-stage run (URL discovery via gau — fast, produces findings)
// 4. Poll until the run completes
// 5. Report which notification events arrived at the receiver log
const BASE = "http://localhost:3000";
const RECEIVER_LOG = "/tmp/webhook-received.log";
const fs = await import("node:fs");

async function j(method, path, body) {
  const r = await fetch(BASE + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return r.json();
}

// 1. Save global hook
await j("PUT", "/api/settings", {
  notifyHooks: JSON.stringify([
    {
      id: "hook_e2e",
      name: "E2E receiver",
      type: "generic",
      url: "http://127.0.0.1:3999/hook",
      enabled: true,
      events: { runCompleted: true, runFailed: true, newFindings: true, minSeverity: "info" },
    },
  ]),
});
console.log("hook saved");

// 2. Create test project + target
const { project } = await j("POST", "/api/projects", {
  name: "Notify E2E Test",
  description: "throwaway",
});
await j("POST", "/api/targets", { projectId: project.id, values: ["gitlab.com"] });
console.log("project created:", project.id);

fs.writeFileSync(RECEIVER_LOG, ""); // clear receiver log from here on

// 3. Start 1-stage run: URL discovery with gau only
const cfg = {
  stages: [
    {
      id: "stage_url",
      name: "URL & Endpoint Discovery",
      toolIds: ["gau"],
      enabled: true,
      intensity: "normal",
      parallelSafe: true,
      description: "test",
      category: "url-discovery",
      required: true,
    },
  ],
};
const { runId } = await j("POST", "/api/runs", {
  projectId: project.id,
  config: cfg,
  targetValues: ["gitlab.com"],
});
console.log("run started:", runId);

// 4. Poll for completion (max 180s)
let status = "running";
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 3000));
  const d = await j("GET", `/api/runs/${runId}`);
  status = d.run?.status || status;
  if (status === "completed" || status === "failed") break;
}
console.log("run status:", status);

// 5. Inspect receiver log
await new Promise((r) => setTimeout(r, 2500));
const log = fs.readFileSync(RECEIVER_LOG, "utf8");
const events = [...log.matchAll(/"event":"([a-z.]+)"/g)].map((m) => m[1]);
console.log("notification events delivered:", JSON.stringify(events));

// cleanup: soft-delete throwaway project
await fetch(`${BASE}/api/projects/${project.id}`, { method: "DELETE" });
console.log("test project deleted");
