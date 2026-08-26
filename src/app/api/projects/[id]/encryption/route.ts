import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { makeVerifier, verifyPassphrase } from "@/lib/backup";

interface Params {
  params: Promise<{ id: string }>;
}

// POST /api/projects/:id/encryption — enable export encryption
// Body: { passphrase }
// Stores ONLY a scrypt+AES-GCM verifier (never the passphrase itself).
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const { passphrase } = await req.json();

    if (!passphrase || typeof passphrase !== "string" || passphrase.length < 8) {
      return NextResponse.json({ error: "Passphrase must be at least 8 characters" }, { status: 400 });
    }

    const project = await db.project.findUnique({ where: { id } });
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
    if (project.encryptionEnabled) {
      return NextResponse.json({ error: "Encryption is already enabled for this project" }, { status: 409 });
    }

    const verifier = makeVerifier(passphrase);
    await db.setting.upsert({
      where: { id: `encver.${id}` },
      create: { id: `encver.${id}`, value: verifier },
      update: { value: verifier },
    });
    await db.project.update({
      where: { id },
      data: { encryptionEnabled: true },
    });
    await db.auditLog.create({
      data: { projectId: id, action: "encryption.enabled", target: "export-encryption" },
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// PUT /api/projects/:id/encryption — verify a passphrase against the stored verifier
// Body: { passphrase }  → { ok: true } | 400
export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const { passphrase } = await req.json();
    const row = await db.setting.findUnique({ where: { id: `encver.${id}` } });
    if (!row) return NextResponse.json({ error: "No passphrase set for this project" }, { status: 404 });
    if (!verifyPassphrase(passphrase || "", row.value)) {
      return NextResponse.json({ error: "Passphrase does not match" }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// DELETE /api/projects/:id/encryption — disable encryption (requires the passphrase)
// Body: { passphrase }
export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));

    const project = await db.project.findUnique({ where: { id } });
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
    if (!project.encryptionEnabled) {
      return NextResponse.json({ error: "Encryption is not enabled" }, { status: 409 });
    }

    const row = await db.setting.findUnique({ where: { id: `encver.${id}` } });
    if (!verifyPassphrase(body.passphrase || "", row?.value)) {
      return NextResponse.json({ error: "Passphrase does not match" }, { status: 400 });
    }

    await db.setting.deleteMany({ where: { id: `encver.${id}` } });
    await db.project.update({ where: { id }, data: { encryptionEnabled: false } });
    await db.auditLog.create({
      data: { projectId: id, action: "encryption.disabled", target: "export-encryption" },
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
