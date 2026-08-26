import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { v4 as uuid } from "uuid";

// GET /api/notes?projectId=...&findingId=...
//   findingId omitted → project-level notes; provided → notes for that finding
export async function GET(req: NextRequest) {
  try {
    const projectId = req.nextUrl.searchParams.get("projectId");
    const findingId = req.nextUrl.searchParams.get("findingId");
    if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

    const where: any = { projectId };
    if (findingId) where.findingId = findingId;

    const notes = await db.note.findMany({
      where,
      orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
      take: 200,
    });
    return NextResponse.json({ notes });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST /api/notes — add a note
// Body: { projectId, findingId?, content, pinned? }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const projectId: string = body.projectId;
    const findingId: string | undefined = body.findingId || undefined;
    const content: string = (body.content || "").trim();

    if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });
    if (!content) return NextResponse.json({ error: "content required" }, { status: 400 });
    if (content.length > 8000) {
      return NextResponse.json({ error: "note too long (max 8000 chars)" }, { status: 400 });
    }

    if (findingId) {
      const finding = await db.finding.findUnique({ where: { id: findingId } });
      if (!finding || finding.projectId !== projectId) {
        return NextResponse.json({ error: "finding not found in this project" }, { status: 404 });
      }
    }

    const note = await db.note.create({
      data: {
        id: uuid(),
        projectId,
        findingId: findingId || null,
        content,
        pinned: body.pinned === true,
      },
    });
    return NextResponse.json({ note }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// PATCH /api/notes — edit content / toggle pin
// Body: { id, content?, pinned?, projectId? }
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const id: string = body.id;
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    const existing = await db.note.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "note not found" }, { status: 404 });

    const data: Record<string, any> = { updatedAt: new Date() };
    if (body.content !== undefined) {
      const content = String(body.content).trim();
      if (!content) return NextResponse.json({ error: "content cannot be empty" }, { status: 400 });
      if (content.length > 8000) return NextResponse.json({ error: "note too long (max 8000 chars)" }, { status: 400 });
      data.content = content;
    }
    if (body.pinned !== undefined) data.pinned = body.pinned === true;

    const note = await db.note.update({ where: { id }, data });
    return NextResponse.json({ note });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// DELETE /api/notes?id=...
export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    await db.note.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
