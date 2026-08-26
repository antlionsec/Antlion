import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

interface Params {
  params: Promise<{ id: string }>;
}

// GET /api/runs/:id — full run state including stages
export async function GET(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const run = await db.pipelineRun.findUnique({ where: { id } });
    if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const stages = await db.pipelineStage.findMany({
      where: { runId: id },
      orderBy: { order: "asc" },
    });
    return NextResponse.json({
      run: {
        ...run,
        config: JSON.parse(run.config || "{}"),
        checkpoint: JSON.parse(run.checkpoint || "{}"),
        resourceStats: JSON.parse(run.resourceStats || "{}"),
      },
      stages: stages.map((s) => ({
        id: s.id,
        runId: s.runId,
        name: s.name,
        tool: s.tool,
        order: s.order,
        status: s.status,
        progress: s.progress,
        logs: JSON.parse(s.logLines || "[]"),
        outputSummary: JSON.parse(s.outputSummary || "{}"),
        startedAt: s.startedAt,
        finishedAt: s.finishedAt,
        error: s.error,
      })),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// PATCH — pause / resume / cancel (the executor polls this status and acts
// on it: pause waits between tools, cancel kills the in-flight subprocess)
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const body = await req.json();
    const desired = body.status;
    if (!["paused", "running", "cancelled"].includes(desired)) {
      return NextResponse.json({ error: "status must be paused, running or cancelled" }, { status: 400 });
    }

    const run = await db.pipelineRun.findUnique({ where: { id } });
    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

    // Only allow sensible transitions from the CURRENT state
    const from = run.status;
    const ok: Record<string, string[]> = {
      paused: ["running"],
      running: ["paused", "cancelled"],
      cancelled: [],
      completed: [],
      failed: [],
      pending: ["cancelled"],
    };
    if (!(ok[from] || []).includes(desired)) {
      return NextResponse.json(
        { error: `Cannot ${desired === "running" ? "resume" : desired} a run that is ${from}` },
        { status: 409 },
      );
    }

    await db.pipelineRun.update({
      where: { id },
      data: { status: desired, updatedAt: new Date() },
    });
    await db.auditLog.create({
      data: { projectId: body.projectId || run.projectId, action: `pipeline.run.${desired}`, target: id },
    });
    return NextResponse.json({ ok: true, status: desired });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
