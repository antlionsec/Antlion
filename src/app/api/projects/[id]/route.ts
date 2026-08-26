import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

interface Params {
  params: Promise<{ id: string }>;
}

// GET /api/projects/:id — full project record
export async function GET(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const project = await db.project.findUnique({ where: { id } });
    if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const [targetCount, excludedCount, runCount, findingCount, recentRuns, recentFindings] = await Promise.all([
      db.target.count({ where: { projectId: id } }),
      db.excludedTarget.count({ where: { projectId: id } }),
      db.pipelineRun.count({ where: { projectId: id } }),
      db.finding.count({ where: { projectId: id } }),
      db.pipelineRun.findMany({ where: { projectId: id }, orderBy: { createdAt: "desc" }, take: 5 }),
      db.finding.findMany({ where: { projectId: id }, orderBy: { firstSeenAt: "desc" }, take: 8 }),
    ]);
    return NextResponse.json({
      project: {
        ...project,
        tags: project.tags ? project.tags.split(",").filter(Boolean) : [],
      },
      stats: { targetCount, excludedCount, runCount, findingCount },
      recentRuns,
      recentFindings,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// PATCH /api/projects/:id
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const body = await req.json();
    const data: Record<string, any> = { updatedAt: new Date() };
    if (body.name !== undefined) data.name = body.name;
    if (body.description !== undefined) data.description = body.description;
    if (body.color !== undefined) data.color = body.color;
    if (body.tags !== undefined) data.tags = (body.tags || []).join(",");
    if (body.status !== undefined) data.status = body.status;
    if (body.encryptionEnabled !== undefined) data.encryptionEnabled = body.encryptionEnabled;
    if (body.programId !== undefined) data.programId = body.programId;
    if (body.programName !== undefined) data.programName = body.programName;
    if (body.programPlatform !== undefined) data.programPlatform = body.programPlatform;

    const project = await db.project.update({ where: { id }, data });
    await db.auditLog.create({
      data: { projectId: id, action: "project.update", target: project.name, details: JSON.stringify(body) },
    });
    return NextResponse.json({ project });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// DELETE
export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const hard = req.nextUrl.searchParams.get("hard") === "1";
    if (hard) {
      await db.project.delete({ where: { id } });
      await db.auditLog.create({
        data: { projectId: null, action: "project.hard-delete", target: id },
      });
    } else {
      await db.project.update({ where: { id }, data: { status: "soft-deleted" } });
      await db.auditLog.create({
        data: { projectId: id, action: "project.soft-delete", target: id },
      });
    }
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
