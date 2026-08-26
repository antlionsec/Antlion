import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { v4 as uuid } from "uuid";
import { parseArchive, restoreSnapshot } from "@/lib/backup";

// POST /api/backups/import — import a project from an exported archive.
// Body: { dataBase64, passphrase?, asNew?: boolean, projectId? }
//   • asNew=true        → create a brand-new project from the snapshot
//   • asNew=false       → replace the data of `projectId` with the snapshot
// The archive may be a plain ZIP or an encrypted .enc blob.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { dataBase64, passphrase, asNew, projectId } = body as {
      dataBase64: string;
      passphrase?: string;
      asNew?: boolean;
      projectId?: string;
    };

    if (!dataBase64 || typeof dataBase64 !== "string") {
      return NextResponse.json({ error: "dataBase64 required (the archive file contents)" }, { status: 400 });
    }

    let blob: Buffer;
    try {
      blob = Buffer.from(dataBase64, "base64");
    } catch {
      return NextResponse.json({ error: "dataBase64 is not valid base64" }, { status: 400 });
    }
    if (blob.length < 64) {
      return NextResponse.json({ error: "File too small to be an Antlion archive" }, { status: 400 });
    }

    let snapshot;
    try {
      snapshot = parseArchive(blob, passphrase);
    } catch (e: any) {
      // Distinguish wrong passphrase from a corrupt/foreign archive
      const msg = e?.message || "";
      if (/passphrase/i.test(msg)) return NextResponse.json({ error: msg }, { status: 400 });
      return NextResponse.json({ error: `Could not read archive: ${msg}` }, { status: 400 });
    }

    const p = snapshot.project as any;

    if (asNew) {
      // Create a fresh project, then restore the snapshot into it
      const newId = uuid();
      await db.project.create({
        data: {
          id: newId,
          name: `${p.name || "Imported project"} (imported)`,
          description: p.description ?? null,
          color: p.color ?? "slate",
          tags: p.tags ?? "",
          status: "active",
          programId: p.programId ?? null,
          programName: p.programName ?? null,
          programPlatform: p.programPlatform ?? null,
          encryptionEnabled: false, // verifier is NOT copied — set a new passphrase
        },
      });
      const res = await restoreSnapshot(snapshot, {
        projectIds: { project: newId, finding: new Map(), run: new Map() },
      });
      await db.auditLog.create({
        data: { projectId: newId, action: "project.import", target: snapshot.exportedAt, details: JSON.stringify(res.counts) },
      });
      return NextResponse.json({ ok: true, projectId: newId, counts: res.counts, created: true });
    }

    // Replace-in-place mode
    if (!projectId) {
      return NextResponse.json({ error: "projectId required when asNew is false" }, { status: 400 });
    }
    const target = await db.project.findUnique({ where: { id: projectId } });
    if (!target) return NextResponse.json({ error: "target project not found" }, { status: 404 });

    const res = await restoreSnapshot(snapshot, {
      projectIds: { project: projectId, finding: new Map(), run: new Map() },
    });
    await db.auditLog.create({
      data: { projectId, action: "project.import", target: "replace", details: JSON.stringify(res.counts) },
    });
    return NextResponse.json({ ok: true, projectId, counts: res.counts, created: false });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
