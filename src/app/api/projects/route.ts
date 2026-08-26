import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { v4 as uuid } from "uuid";

// GET /api/projects — list all non-soft-deleted projects
export async function GET(req: NextRequest) {
  try {
    const status = req.nextUrl.searchParams.get("status") || "active";
    const q = req.nextUrl.searchParams.get("q") || "";
    const sort = req.nextUrl.searchParams.get("sort") || "lastActivity";

    let items = await db.project.findMany({
      where: { status },
      orderBy: sort === "name"
        ? { name: "asc" }
        : sort === "created"
          ? { createdAt: "desc" }
          : { lastActivityAt: "desc" },
    });

    if (q) {
      const lower = q.toLowerCase();
      items = items.filter(
        (p) =>
          p.name.toLowerCase().includes(lower) ||
          (p.description || "").toLowerCase().includes(lower) ||
          (p.tags || "").toLowerCase().includes(lower),
      );
    }

    const enriched = await Promise.all(
      items.map(async (p) => {
        const [targetCount, excludedCount, runCount, findingCount] = await Promise.all([
          db.target.count({ where: { projectId: p.id } }),
          db.excludedTarget.count({ where: { projectId: p.id } }),
          db.pipelineRun.count({ where: { projectId: p.id } }),
          db.finding.count({ where: { projectId: p.id } }),
        ]);
        return {
          ...p,
          targetCount,
          excludedCount,
          runCount,
          findingCount,
          tags: p.tags ? p.tags.split(",").filter(Boolean) : [],
        };
      }),
    );

    return NextResponse.json({ projects: enriched });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST /api/projects — create a new project
// Body may include duplicateOf: <projectId> to deep-copy targets and
// exclusions from an existing project (Dashboard → Duplicate).
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const id = uuid();

    const project = await db.project.create({
      data: {
        id,
        name: body.name,
        description: body.description || null,
        color: body.color || "slate",
        tags: (body.tags || []).join(","),
        status: "active",
        programId: body.programId || null,
        programName: body.programName || null,
        programPlatform: body.programPlatform || null,
      },
    });

    let copiedTargets = 0;
    let copiedExcluded = 0;
    if (body.duplicateOf) {
      const source = await db.project.findUnique({ where: { id: body.duplicateOf } });
      if (source) {
        const [targets, excluded] = await Promise.all([
          db.target.findMany({ where: { projectId: source.id } }),
          db.excludedTarget.findMany({ where: { projectId: source.id } }),
        ]);
        for (const t of targets) {
          await db.target
            .create({
              data: {
                id: uuid(), projectId: id, value: t.value, type: t.type,
                origin: "manual", validated: t.validated, metadata: t.metadata,
                inScope: t.inScope,
              },
            })
            .catch(() => {}); // unique [projectId, value] — skip dupes
          copiedTargets++;
        }
        for (const t of excluded) {
          await db.excludedTarget
            .create({
              data: { id: uuid(), projectId: id, value: t.value, type: t.type, origin: "manual", reason: t.reason },
            })
            .catch(() => {});
          copiedExcluded++;
        }
        await db.project.update({
          where: { id },
          data: {
            targetCount: await db.target.count({ where: { projectId: id } }),
            excludedCount: await db.excludedTarget.count({ where: { projectId: id } }),
          },
        });
      }
    }

    await db.auditLog.create({
      data: {
        projectId: id,
        actor: "user",
        action: body.duplicateOf ? "project.duplicate" : "project.create",
        target: project.name,
        details: JSON.stringify({
          id,
          ...(body.duplicateOf ? { duplicatedFrom: body.duplicateOf, copiedTargets, copiedExcluded } : {}),
        }),
      },
    });

    return NextResponse.json({ project }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
