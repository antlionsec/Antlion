import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  createBackup,
  getRetentionDays,
  pruneBackups,
  verifyPassphrase,
  isEncryptedBlob,
} from "@/lib/backup";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";

// GET /api/backups?projectId=... — list backup records + settings state
export async function GET(req: NextRequest) {
  try {
    const projectId = req.nextUrl.searchParams.get("projectId");
    if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

    const project = await db.project.findUnique({ where: { id: projectId } });
    if (!project) return NextResponse.json({ error: "project not found" }, { status: 404 });

    const [records, autoRow, verifierRow, retentionDays] = await Promise.all([
      db.backupRecord.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
      db.setting.findUnique({ where: { id: `backups.auto.${projectId}` } }),
      db.setting.findUnique({ where: { id: `encver.${projectId}` } }),
      getRetentionDays(),
    ]);

    // Only records whose file lives in this project's backup folder
    const mine = records.filter((r) => r.path.includes(projectId));
    const list = await Promise.all(
      mine.map(async (r) => {
        let encrypted = false;
        try {
          const head = await readFile(r.path);
          encrypted = isEncryptedBlob(head);
        } catch {
          // file missing — prune will clean it up
        }
        return {
          id: r.id,
          kind: r.kind,
          size: r.size,
          createdAt: r.createdAt,
          file: path.basename(r.path),
          encrypted,
        };
      }),
    );

    return NextResponse.json({
      backups: list,
      autoBackup: autoRow?.value === "true",
      encryptionEnabled: project.encryptionEnabled === true,
      hasVerifier: Boolean(verifierRow?.value),
      retentionDays,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST /api/backups — create a backup snapshot now
// Body: { projectId, passphrase? }
export async function POST(req: NextRequest) {
  try {
    const { projectId, passphrase } = await req.json();
    if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

    const project = await db.project.findUnique({ where: { id: projectId } });
    if (!project) return NextResponse.json({ error: "project not found" }, { status: 404 });

    // If the project has encryption enabled, a passphrase is required and must
    // match the stored verifier (wrong passphrase => refuse, don't silently
    // write a plaintext backup).
    if (project.encryptionEnabled) {
      if (!passphrase) {
        return NextResponse.json({ error: "Encryption is enabled — provide the project passphrase" }, { status: 400 });
      }
      const verifier = await db.setting.findUnique({ where: { id: `encver.${projectId}` } });
      if (!verifyPassphrase(passphrase, verifier?.value)) {
        return NextResponse.json({ error: "Passphrase does not match this project" }, { status: 400 });
      }
    }

    const { record, file } = await createBackup(projectId, {
      passphrase: passphrase || undefined,
      kind: "manual",
    });
    return NextResponse.json({ ok: true, record, file, encrypted: Boolean(passphrase) });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// DELETE /api/backups?id=... — delete one backup record + its file
export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    const record = await db.backupRecord.findUnique({ where: { id } });
    if (!record) return NextResponse.json({ error: "backup not found" }, { status: 404 });
    await rm(record.path, { force: true }).catch(() => {});
    await db.backupRecord.delete({ where: { id } });
    await pruneBackups().catch(() => {});
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// PUT /api/backups — toggle auto-backup / set retention
// Body: { projectId?, autoBackup?: boolean, retentionDays?: number }
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();

    if (body.retentionDays !== undefined) {
      const n = parseInt(String(body.retentionDays), 10);
      if (!Number.isFinite(n) || n < 1 || n > 365) {
        return NextResponse.json({ error: "retentionDays must be 1-365" }, { status: 400 });
      }
      await db.setting.upsert({
        where: { id: "backups.retentionDays" },
        create: { id: "backups.retentionDays", value: String(n) },
        update: { value: String(n) },
      });
      await pruneBackups().catch(() => {});
      return NextResponse.json({ ok: true, retentionDays: n });
    }

    if (body.projectId !== undefined && body.autoBackup !== undefined) {
      const key = `backups.auto.${body.projectId}`;
      await db.setting.upsert({
        where: { id: key },
        create: { id: key, value: body.autoBackup ? "true" : "false" },
        update: { value: body.autoBackup ? "true" : "false" },
      });
      await db.auditLog.create({
        data: {
          projectId: body.projectId,
          action: "backup.auto",
          target: body.autoBackup ? "enabled" : "disabled",
        },
      });
      return NextResponse.json({ ok: true, autoBackup: body.autoBackup === true });
    }

    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
