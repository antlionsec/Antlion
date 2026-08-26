import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// GET /api/reports/tree?projectId=...
// Raw scope + findings + run stats for the interactive discovery tree.
// The tree itself is assembled client-side (src/lib/discovery-tree.ts) so the
// UI can re-filter (severity, search) without extra round-trips.
export async function GET(req: NextRequest) {
  try {
    const projectId = req.nextUrl.searchParams.get("projectId");
    if (!projectId) {
      return NextResponse.json({ error: "projectId required" }, { status: 400 });
    }

    const [project, targets, findings, runAgg] = await Promise.all([
      db.project.findUnique({
        where: { id: projectId },
        select: {
          id: true,
          name: true,
          description: true,
          createdAt: true,
          lastActivityAt: true,
          targetCount: true,
          findingCount: true,
          runCount: true,
        },
      }),
      db.target.findMany({
        where: { projectId },
        orderBy: { addedAt: "asc" },
        select: {
          id: true,
          value: true,
          type: true,
          origin: true,
          inScope: true,
          addedAt: true,
        },
      }),
      db.finding.findMany({
        where: { projectId },
        orderBy: [{ severity: "desc" }, { firstSeenAt: "desc" }],
        take: 5000,
        select: {
          id: true,
          type: true,
          severity: true,
          title: true,
          description: true,
          evidence: true,
          remediation: true,
          target: true,
          url: true,
          cvssScore: true,
          cveId: true,
          tags: true,
          status: true,
          source: true,
          firstSeenAt: true,
          updatedAt: true,
        },
      }),
      db.pipelineRun.aggregate({
        where: { projectId },
        _count: { _all: true },
        _max: { finishedAt: true },
      }),
    ]);

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    return NextResponse.json({
      project,
      targets,
      findings,
      stats: {
        runCount: runAgg._count._all,
        lastRunAt: runAgg._max.finishedAt,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
