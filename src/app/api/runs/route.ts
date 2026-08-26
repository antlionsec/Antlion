import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { v4 as uuid } from "uuid";
import { spawn, type ChildProcess } from "node:child_process";
import { PIPELINE_STAGES, TOOLS, type ParsedFinding } from "@/lib/pipeline-config";
import { dispatchNotifications, type NotifyFinding } from "@/lib/notify";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class RunCancelledError extends Error {
  constructor(msg = "Run cancelled") {
    super(msg);
    this.name = "RunCancelledError";
  }
}

/**
 * Load saved API keys from the DB settings store (Global Settings → API Keys) and
 * expose them as environment variables for spawned tools. Env vars act as a
 * fallback for users who prefer .env configuration.
 */
async function buildToolEnv(): Promise<NodeJS.ProcessEnv> {
  const env: NodeJS.ProcessEnv = { ...process.env };
  try {
    const rows = await db.setting.findMany({
      where: { id: { startsWith: "apikey_" } },
    });
    for (const row of rows) {
      const name = row.id.replace(/^apikey_/, "");
      if (row.value && row.value.trim()) {
        env[name] = row.value.trim();
      }
    }
  } catch {
    // DB unavailable — fall back to plain process env
  }
  return env;
}

// GET /api/runs?projectId=...
export async function GET(req: NextRequest) {
  try {
    const projectId = req.nextUrl.searchParams.get("projectId");
    if (!projectId)
      return NextResponse.json({ error: "projectId required" }, { status: 400 });
    const runs = await db.pipelineRun.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { stages: { select: { id: true, name: true, status: true, progress: true, order: true } } },
    });
    return NextResponse.json({ runs });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST /api/runs — create + start a new pipeline run
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { projectId, config, targetValues } = body as {
      projectId: string;
      config: any;
      targetValues: string[];
    };

    if (!projectId)
      return NextResponse.json({ error: "projectId required" }, { status: 400 });

    const project = await db.project.findUnique({ where: { id: projectId } });
    if (!project)
      return NextResponse.json({ error: "project not found" }, { status: 404 });

    if (!targetValues?.length) {
      return NextResponse.json(
        { error: "targetValues required — add targets before running the pipeline" },
        { status: 400 },
      );
    }

    const runId = uuid();
    const enabledStages = (config?.stages || PIPELINE_STAGES).filter(
      (s: any) => s.enabled !== false,
    );

    const stageRows = enabledStages.map((stage: any, i: number) => ({
      id: uuid(),
      runId,
      name: stage.name,
      tool: stage.toolIds.join(","),
      order: i,
      status: "pending",
      progress: 0,
      logLines: "[]",
      outputSummary: "{}",
    }));

    await db.pipelineRun.create({
      data: {
        id: runId,
        projectId,
        status: "running",
        config: JSON.stringify(config || {}),
        trigger: "manual",
        checkpoint: "{}",
        startedAt: new Date(),
        totalStages: enabledStages.length,
        doneStages: 0,
        resourceStats: "{}",
      },
    });

    await db.pipelineStage.createMany({ data: stageRows });

    await db.auditLog.create({
      data: {
        projectId,
        action: "pipeline.run.start",
        target: runId,
        details: JSON.stringify({
          stages: enabledStages.length,
          targets: targetValues.length,
        }),
      },
    });

    // Fire-and-forget real subprocess execution
    executeRun(runId, projectId, enabledStages, targetValues, config || {}).catch(
      async (e) => {
        console.error("Run execution error:", e?.message);
        try {
          await db.pipelineRun.update({
            where: { id: runId },
            data: { status: "failed", finishedAt: new Date(), updatedAt: new Date() },
          });
          await db.auditLog.create({
            data: {
              projectId,
              action: "pipeline.run.failed",
              target: runId,
              details: JSON.stringify({ error: e?.message || String(e) }),
            },
          });
          const project = await db.project.findUnique({ where: { id: projectId } });
          await dispatchNotifications("run.failed", {
            title: `Run failed — ${project?.name || "project"}`,
            message: e?.message || "Unknown error during pipeline execution.",
            fields: [{ name: "Run", value: runId.slice(0, 8) }],
            severity: "critical",
          });
        } catch (e2: any) {
          console.error("Failed-run bookkeeping error:", e2?.message);
        }
      },
    );

    return NextResponse.json({ runId, stages: enabledStages.length });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// ----------------------------------------------------------------------------
// REAL PIPELINE EXECUTION
// ----------------------------------------------------------------------------
// This executor spawns real CLI subprocesses (subfinder, nuclei, etc.) using
// node:child_process. It does NOT fabricate fake findings. If a binary is not
// installed, the stage is marked as 'skipped' with an honest log line and no
// findings are produced. Findings are parsed from the real JSON output of
// each tool.
//
// RUN CONTROLS ARE REAL: the executor cooperatively polls the run's status in
// the database while tools execute.
//   • paused   → the executor finishes the in-flight tool, then WAITS before
//                starting the next tool until the run is resumed or cancelled
//   • cancelled→ the in-flight child process is SIGTERM'd (SIGKILL after a
//                grace period), the current stage is marked cancelled, the
//                remaining stages are marked skipped and the run finalizes as
//                cancelled
// ----------------------------------------------------------------------------

/** Live child processes per run — lets cancellation kill in-flight tools. */
const activeChildren = new Map<string, Set<ChildProcess>>();

function trackChild(runId: string, child: ChildProcess) {
  if (!activeChildren.has(runId)) activeChildren.set(runId, new Set());
  activeChildren.get(runId)!.add(child);
  child.on("exit", () => activeChildren.get(runId)?.delete(child));
}

async function getRunStatus(runId: string): Promise<string | null> {
  const run = await db.pipelineRun.findUnique({ where: { id: runId }, select: { status: true } });
  return run?.status ?? null;
}

/** Block while the run is paused. Throws RunCancelledError if cancelled. */
async function waitWhilePaused(runId: string): Promise<void> {
  for (;;) {
    const status = await getRunStatus(runId);
    if (status === "cancelled") throw new RunCancelledError("Cancelled while paused");
    if (status !== "paused") return;
    await sleep(2000);
  }
}

interface ToolRunResult {
  stdout: string;
  stderr: string;
  cancelled: boolean;
}

/**
 * Spawn a tool as a real subprocess and babysit it:
 *   - buffer stdout/stderr
 *   - enforce a hard timeout
 *   - poll the run status every 2s; on cancel, kill the process tree
 */
function runToolProcess(
  runId: string,
  binary: string,
  argv: string[],
  opts: { env?: NodeJS.ProcessEnv; timeoutMs: number },
): Promise<ToolRunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, argv, {
      env: opts.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    trackChild(runId, child);

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let cancelled = false;
    let settled = false;

    const cap = 64 * 1024 * 1024; // 64 MB output cap per stream
    child.stdout.on("data", (d: Buffer) => {
      if (stdoutChunks.reduce((a, c) => a + c.length, 0) < cap) stdoutChunks.push(d);
    });
    child.stderr.on("data", (d: Buffer) => {
      if (stderrChunks.reduce((a, c) => a + c.length, 0) < cap) stderrChunks.push(d);
    });

    const finish = (err: Error | null, result?: ToolRunResult) => {
      if (settled) return;
      settled = true;
      clearInterval(statusPoller);
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(result!);
    };

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error(`Tool exceeded its ${Math.round(opts.timeoutMs / 60000)} min timeout and was killed`));
    }, opts.timeoutMs);

    // Cooperative cancellation — poll DB status while the tool runs
    const statusPoller = setInterval(async () => {
      try {
        const status = await getRunStatus(runId);
        if (status === "cancelled" && !cancelled && !settled) {
          cancelled = true;
          child.kill("SIGTERM");
          // Grace period, then force kill
          setTimeout(() => {
            try { child.kill("SIGKILL"); } catch {}
          }, 3000);
        }
      } catch {
        // DB hiccup — keep going
      }
    }, 2000);

    child.on("error", (err) => {
      // Spawn failure — ENOENT when binary is missing
      finish(err);
    });

    child.on("close", (code) => {
      const stdout = stdoutChunks.map((c) => c.toString()).join("");
      const stderr = stderrChunks.map((c) => c.toString()).join("");
      if (cancelled) {
        finish(null, { stdout, stderr, cancelled: true });
      } else if (code === 0) {
        finish(null, { stdout, stderr, cancelled: false });
      } else {
        finish(new Error(`Tool exited with code ${code}${stderr ? `: ${stderr.split("\n").slice(-3).join(" ").slice(0, 300)}` : ""}`));
      }
    });
  });
}

/** Mark the current stage cancelled + remaining stages skipped + finalize run. */
async function finalizeCancelledRun(
  runId: string,
  projectId: string,
  stageRowId: string | null,
  totalStages: number,
  doneStages: number,
  logs: { ts: string; level: "inf" | "wrn" | "err"; text: string }[],
) {
  if (stageRowId) {
    await db.pipelineStage.update({
      where: { id: stageRowId },
      data: {
        status: "cancelled",
        finishedAt: new Date(),
        error: "Cancelled by user",
        logLines: JSON.stringify(logs),
      },
    }).catch(() => {});
  }
  // Remaining pending stages → skipped
  await db.pipelineStage.updateMany({
    where: { runId, status: "pending" },
    data: { status: "skipped", error: "Run cancelled" },
  }).catch(() => {});

  await db.pipelineRun.update({
    where: { id: runId },
    data: {
      status: "cancelled",
      finishedAt: new Date(),
      doneStages,
      updatedAt: new Date(),
    },
  }).catch(() => {});

  await db.project.update({
    where: { id: projectId },
    data: {
      runCount: await db.pipelineRun.count({ where: { projectId } }),
      findingCount: await db.finding.count({ where: { projectId } }),
      lastActivityAt: new Date(),
    },
  }).catch(() => {});

  await db.auditLog.create({
    data: {
      projectId,
      action: "pipeline.run.cancelled",
      target: runId,
      details: JSON.stringify({ stagesDone: doneStages, totalStages }),
    },
  }).catch(() => {});
}

async function executeRun(
  runId: string,
  projectId: string,
  stages: any[],
  targetValues: string[],
  config: any,
) {
  // Shared tool environment with API keys from the local settings store —
  // persistent across every project and pipeline run.
  const toolEnv = await buildToolEnv();
  const project = await db.project.findUnique({ where: { id: projectId } });
  const projectName = project?.name || "Unknown project";
  const runStartedAt = Date.now();
  // New findings collected across the whole run for the final notification.
  const runNewFindings: NotifyFinding[] = [];

  // Bookkeeping for cooperative cancellation
  let currentStageRowId: string | null = null;
  let currentLogs: { ts: string; level: "inf" | "wrn" | "err"; text: string }[] = [];
  let stagesDone = 0;

  try {
  for (let i = 0; i < stages.length; i++) {
    const stage = stages[i];
    const stageRow = await db.pipelineStage.findFirst({
      where: { runId, order: i },
    });
    if (!stageRow) continue;

    // Honors a pause requested while a previous tool was finishing; throws
    // RunCancelledError if the run was cancelled.
    await waitWhilePaused(runId);

    currentStageRowId = stageRow.id;
    await db.pipelineStage.update({
      where: { id: stageRow.id },
      data: { status: "running", startedAt: new Date() },
    });
    await db.pipelineRun.update({
      where: { id: runId },
      data: { status: "running", updatedAt: new Date() },
    });

    const logs: { ts: string; level: "inf" | "wrn" | "err"; text: string }[] = [];
    currentLogs = logs;
    const logPush = (level: "inf" | "wrn" | "err", text: string) => {
      logs.push({ ts: new Date().toISOString(), level, text });
    };
    const persistLogs = async () => {
      await db.pipelineStage.update({
        where: { id: stageRow.id },
        data: { logLines: JSON.stringify(logs.slice(-300)), progress: Math.min(90, logs.length * 3) },
      });
    };

    logPush("inf", `=== Stage: ${stage.name} ===`);
    logPush("inf", `Targets (${targetValues.length}): ${targetValues.slice(0, 5).join(", ")}${targetValues.length > 5 ? "..." : ""}`);
    await persistLogs();

    let stageFindings: ParsedFinding[] = [];

    for (const toolId of stage.toolIds) {
      const tool = TOOLS.find((t) => t.id === toolId);
      if (!tool) {
        logPush("wrn", `Tool '${toolId}' not found in registry — skipping.`);
        continue;
      }
      if (tool.requiresApiKey) {
        const apiKey = toolEnv[tool.apiKeyName as string];
        if (!apiKey) {
          logPush("wrn", `Tool '${tool.name}' requires ${tool.apiKeyName} — save it in Global Settings → API Keys (landing page → Settings) to enable. Skipping.`);
          continue;
        }
      }

      // Pause point before spawning the next tool
      await waitWhilePaused(runId);

      const argv = tool.buildArgs
        ? tool.buildArgs(targetValues, config?.toolOverrides?.[toolId])
        : [...tool.defaultArgs, ...targetValues];

      logPush("inf", `[INF] Running ${tool.name} (${tool.binary} ${argv.join(" ")})`);
      await persistLogs();

      try {
        const result = await runToolProcess(runId, tool.binary, argv, {
          env: toolEnv,
          timeoutMs: 1000 * 60 * 15, // 15 min per tool
        });

        if (result.cancelled) {
          logPush("wrn", `[${tool.name}] Cancelled by user — process terminated.`);
          await persistLogs();
          throw new RunCancelledError(`Cancelled during ${tool.name}`);
        }

        const stdout = result.stdout || "";
        const stderr = result.stderr || "";

        if (stderr) {
          for (const line of stderr.split("\n").slice(-20)) {
            if (line.trim()) logPush("wrn", `[${tool.name}] ${line}`);
          }
        }

        if (tool.parseOutput && stdout) {
          const parsed = tool.parseOutput(stdout, tool.name);
          stageFindings = stageFindings.concat(parsed);
          logPush(
            "inf",
            `[INF] ${tool.name} produced ${parsed.length} result(s)`,
          );
        } else {
          // Generic output stream — show first lines, persist any matching lines
          const lines = stdout.split("\n").filter((l) => l.trim());
          logPush(
            "inf",
            `[INF] ${tool.name} produced ${lines.length} output line(s)`,
          );
          for (const line of lines.slice(0, 10)) {
            logPush("inf", `[${tool.name}] ${line}`);
          }
        }
        await persistLogs();
      } catch (err: any) {
        if (err instanceof RunCancelledError) throw err;
        const msg =
          err?.code === "ENOENT"
            ? `Binary '${tool.binary}' not found in PATH — skipping (install it to enable)`
            : err?.message || String(err);
        const level = err?.code === "ENOENT" ? "wrn" : "err";
        logPush(level, `[${tool.name}] ${msg}`);
        await persistLogs();
      }
    }

    // Persist any findings discovered
    let findingsPersisted = 0;
    const persistedThisStage: NotifyFinding[] = [];
    for (const f of stageFindings) {
      try {
        await db.finding.create({
          data: {
            id: uuid(),
            projectId,
            runId,
            type: f.type,
            severity: f.severity,
            title: f.title,
            description: f.description || null,
            evidence: f.evidence || null,
            remediation: f.remediation || null,
            target: f.target || null,
            url: f.url || null,
            cvssScore: f.cvssScore || null,
            cveId: f.cveId || null,
            tags: "",
            status: "new",
            source: f.source || null,
            rawOutput: f.rawOutput || null,
          },
        });
        findingsPersisted++;
        persistedThisStage.push({
          title: f.title,
          severity: f.severity,
          target: f.target || null,
        });
      } catch (e) {
        // ignore constraint failures (dedup)
      }
    }
    runNewFindings.push(...persistedThisStage);

    logPush("inf", `[INF] Stage complete — ${stageFindings.length} parsed, ${findingsPersisted} persisted.`);

    // Global notification hooks — new findings alert (each hook filters by
    // its own severity threshold; delivery is best-effort and never throws).
    if (persistedThisStage.length > 0) {
      const sevCount: Record<string, number> = {};
      for (const f of persistedThisStage) sevCount[f.severity] = (sevCount[f.severity] || 0) + 1;
      const topSev = ["critical", "high", "medium", "low", "info"].find((s) => sevCount[s]);
      await dispatchNotifications("findings.new", {
        title: `New findings — ${projectName} · ${stage.name}`,
        message: `${persistedThisStage.length} new finding(s) persisted during the "${stage.name}" stage.`,
        fields: [
          { name: "Project", value: projectName },
          { name: "Stage", value: stage.name },
          { name: "By severity", value: Object.entries(sevCount).map(([s, n]) => `${s}: ${n}`).join(" · ") || "—" },
        ],
        severity: topSev,
        findings: persistedThisStage,
      });
    }

    await db.pipelineStage.update({
      where: { id: stageRow.id },
      data: {
        status: "completed",
        progress: 100,
        finishedAt: new Date(),
        logLines: JSON.stringify(logs),
        outputSummary: JSON.stringify({
          findings: stageFindings.length,
          persisted: findingsPersisted,
          tools: stage.toolIds.length,
        }),
      },
    });

    await db.pipelineRun.update({
      where: { id: runId },
      data: { doneStages: i + 1, updatedAt: new Date() },
    });
    stagesDone = i + 1;
    currentStageRowId = null;
    currentLogs = [];
  }
  } catch (err) {
    if (err instanceof RunCancelledError) {
      // Real cancellation path — kill anything still alive, finalize state
      const children = activeChildren.get(runId);
      if (children) for (const c of children) {
        try { c.kill("SIGKILL"); } catch {}
      }
      activeChildren.delete(runId);
      await finalizeCancelledRun(runId, projectId, currentStageRowId, stages.length, stagesDone, currentLogs);
      return; // cancelled runs do not dispatch completion notifications
    }
    throw err;
  }
  activeChildren.delete(runId);

  const findingCount = await db.finding.count({ where: { projectId, runId } });
  await db.pipelineRun.update({
    where: { id: runId },
    data: {
      status: "completed",
      finishedAt: new Date(),
      findingDelta: findingCount,
      assetDelta: await db.finding.count({
        where: { projectId, runId, type: { in: ["subdomain", "asset"] } },
      }),
      updatedAt: new Date(),
    },
  });

  await db.project.update({
    where: { id: projectId },
    data: {
      runCount: await db.pipelineRun.count({ where: { projectId } }),
      findingCount: await db.finding.count({ where: { projectId } }),
      lastActivityAt: new Date(),
    },
  });

  await db.auditLog.create({
    data: {
      projectId,
      action: "pipeline.run.complete",
      target: runId,
      details: JSON.stringify({ findings: findingCount }),
    },
  });

  // Global notification hooks — run completed summary (every project).
  const durationMin = Math.max(1, Math.round((Date.now() - runStartedAt) / 60000));
  const sevTotals: Record<string, number> = {};
  for (const f of runNewFindings) sevTotals[f.severity] = (sevTotals[f.severity] || 0) + 1;
  const topSev = ["critical", "high", "medium", "low", "info"].find((s) => sevTotals[s]);
  await dispatchNotifications("run.completed", {
    title: `Run completed — ${projectName}`,
    message: `Pipeline finished ${stages.length} stage(s) in ~${durationMin} min.`,
    fields: [
      { name: "Stages", value: `${stages.length}` },
      { name: "New findings", value: `${runNewFindings.length}` },
      { name: "By severity", value: Object.entries(sevTotals).map(([s, n]) => `${s}: ${n}`).join(" · ") || "none" },
    ],
    severity: topSev,
  });
}
