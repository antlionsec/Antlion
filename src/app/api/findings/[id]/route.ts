import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

interface Params {
  params: Promise<{ id: string }>;
}

// PATCH /api/findings/:id — update status, tags, etc.
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const body = await req.json();
    const data: Record<string, any> = { updatedAt: new Date() };
    if (body.status !== undefined) data.status = body.status;
    if (body.tags !== undefined) data.tags = Array.isArray(body.tags) ? body.tags.join(",") : body.tags;
    if (body.severity !== undefined) data.severity = body.severity;
    const f = await db.finding.update({ where: { id }, data });
    await db.auditLog.create({
      data: { projectId: body.projectId || null, action: "finding.update", target: id, details: JSON.stringify(body) },
    });
    return NextResponse.json({ finding: f });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// DELETE
export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    await db.finding.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
