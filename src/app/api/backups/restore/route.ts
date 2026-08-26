import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { readFile } from "node:fs/promises";
import { parseArchive, restoreSnapshot, isEncryptedBlob } from "@/lib/backup";

// POST /api/backups/restore — restore a project from a stored backup record.
// Body: { projectId, recordId, passphrase? }
export async function POST(req: NextRequest) {
  try {
    const { projectId, recordId, passphrase } = await req.json();
    if (!projectId || !recordId) {
      return NextResponse.json({ error: "projectId and recordId required" }, { status: 400 });
    }

    const project = await db.project.findUnique({ where: { id: projectId } });
    if (!project) return NextResponse.json({ error: "project not found" }, { status: 404 });

    const record = await db.backupRecord.findUnique({ where: { id: recordId } });
    if (!record || !record.path.includes(projectId)) {
      return NextResponse.json({ error: "backup record not found for this project" }, { status: 404 });
    }

    let blob: Buffer;
    try {
      blob = await readFile(record.path);
    } catch {
      return NextResponse.json({ error: "Backup file is missing on disk (deleted externally?)" }, { status: 404 });
    }

    if (isEncryptedBlob(blob) && !passphrase) {
      return NextResponse.json({ error: "This backup is encrypted — provide the passphrase" }, { status: 400 });
    }

    let snapshot;
    try {
      snapshot = parseArchive(blob, passphrase);
    } catch (e: any) {
      return NextResponse.json({ error: e?.message || "Could not read backup" }, { status: 400 });
    }

    const res = await restoreSnapshot(snapshot, {
      projectIds: { project: projectId, finding: new Map(), run: new Map() },
    });
    await db.auditLog.create({
      data: { projectId, action: "backup.restore", target: recordId, details: JSON.stringify(res.counts) },
    });
    return NextResponse.json({ ok: true, counts: res.counts });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
