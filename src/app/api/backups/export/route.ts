import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { buildSnapshot, snapshotToZip, encryptBuffer, verifyPassphrase } from "@/lib/backup";

// POST /api/backups/export — download this project as a ZIP archive.
// Body: { projectId, passphrase? }
//   • No passphrase  → plain ZIP (readable anywhere)
//   • With passphrase → AES-256-GCM encrypted archive (.enc)
// When project encryption is enabled the passphrase is REQUIRED and must
// match the stored verifier.
export async function POST(req: NextRequest) {
  try {
    const { projectId, passphrase } = await req.json();
    if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

    const project = await db.project.findUnique({ where: { id: projectId } });
    if (!project) return NextResponse.json({ error: "project not found" }, { status: 404 });

    if (project.encryptionEnabled) {
      if (!passphrase) {
        return NextResponse.json({ error: "Encryption is enabled — provide the project passphrase to export" }, { status: 400 });
      }
      const verifier = await db.setting.findUnique({ where: { id: `encver.${projectId}` } });
      if (!verifyPassphrase(passphrase, verifier?.value)) {
        return NextResponse.json({ error: "Passphrase does not match this project" }, { status: 400 });
      }
    }

    const snapshot = await buildSnapshot(projectId);
    let blob = snapshotToZip(snapshot);
    if (passphrase) blob = encryptBuffer(blob, passphrase);

    const safeBase =
      project.name
        .normalize("NFKD")
        .replace(/[^\w\s.-]+/g, "")
        .trim()
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .toLowerCase() || "project";

    await db.auditLog.create({
      data: {
        projectId,
        action: "backup.export",
        target: passphrase ? "encrypted" : "plain",
        details: JSON.stringify({ size: blob.length }),
      },
    });

    const filename = `${safeBase}-export.${passphrase ? "enc" : "zip"}`;
    return new NextResponse(new Uint8Array(blob), {
      headers: {
        "Content-Type": passphrase ? "application/octet-stream" : "application/zip",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(blob.length),
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
