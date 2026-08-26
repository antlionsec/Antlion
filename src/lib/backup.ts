// ============================================================================
// ANTLION — Backup & Export library
// ----------------------------------------------------------------------------
// REAL backup engine. Everything here is genuinely implemented:
//   • ZIP writer/reader (PKZIP APPNOTE format, DEFLATE via node:zlib)
//   • AES-256-GCM encryption with a scrypt-derived key (node:crypto)
//   • Full project snapshots (project, targets, exclusions, findings, notes,
//     runs + stages) serialized to JSON inside the archive
//   • Backup records persisted in the DB, files under db/backups/<projectId>/
//   • Retention pruning (configurable, default 7 days)
//   • Automatic backup scheduler (started from src/instrumentation.ts)
//
// NO placeholders: restoring a snapshot really deletes and re-creates the
// project's data inside a Prisma transaction.
// ============================================================================

import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { mkdir, readFile, writeFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { v4 as uuid } from "uuid";
import { db } from "@/lib/db";

// ---------------------------------------------------------------------------
// CRC-32 (required by the ZIP spec)
// ---------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------------------
// ZIP writer — local file headers + central directory + EOCD, DEFLATE method
// ---------------------------------------------------------------------------
export function zipCreate(files: { name: string; data: Buffer | string }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  const now = new Date();
  const dosTime =
    ((now.getHours() & 0x1f) << 11) | ((now.getMinutes() & 0x3f) << 5) | ((now.getSeconds() / 2) & 0x1f);
  const dosDate =
    (((now.getFullYear() - 1980) & 0x7f) << 9) | (((now.getMonth() + 1) & 0xf) << 5) | (now.getDate() & 0x1f);

  for (const f of files) {
    const raw = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, "utf8");
    const nameBuf = Buffer.from(f.name, "utf8");
    const comp = deflateRawSync(raw, { level: 6 });
    const crc = crc32(raw);

    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0); // local file header signature
    lfh.writeUInt16LE(20, 4); // version needed
    lfh.writeUInt16LE(0, 6); // flags
    lfh.writeUInt16LE(8, 8); // method: deflate
    lfh.writeUInt16LE(dosTime, 10);
    lfh.writeUInt16LE(dosDate, 12);
    lfh.writeUInt32LE(crc, 14);
    lfh.writeUInt32LE(comp.length, 18);
    lfh.writeUInt32LE(raw.length, 22);
    lfh.writeUInt16LE(nameBuf.length, 26);
    lfh.writeUInt16LE(0, 28); // extra len

    locals.push(lfh, nameBuf, comp);

    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0); // central directory header signature
    cdh.writeUInt16LE(0x031e, 4); // version made by (UNIX)
    cdh.writeUInt16LE(20, 6); // version needed
    cdh.writeUInt16LE(0, 8); // flags
    cdh.writeUInt16LE(8, 10); // method
    cdh.writeUInt16LE(dosTime, 12);
    cdh.writeUInt16LE(dosDate, 14);
    cdh.writeUInt32LE(crc, 16);
    cdh.writeUInt32LE(comp.length, 20);
    cdh.writeUInt32LE(raw.length, 24);
    cdh.writeUInt16LE(nameBuf.length, 28);
    cdh.writeUInt16LE(0, 30); // extra
    cdh.writeUInt16LE(0, 32); // comment
    cdh.writeUInt16LE(0, 34); // disk number
    cdh.writeUInt16LE(0, 36); // internal attrs
    cdh.writeUInt32LE(0o644 << 16, 38); // external attrs (unix perms)
    cdh.writeUInt32LE(offset, 42); // local header offset
    centrals.push(cdh, nameBuf);

    offset += 30 + nameBuf.length + comp.length;
  }

  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20); // comment len
  return Buffer.concat([...locals, cd, eocd]);
}

// ---------------------------------------------------------------------------
// ZIP reader — locate EOCD, walk the central directory, inflate entries
// ---------------------------------------------------------------------------
export function zipRead(zip: Buffer): { name: string; data: Buffer }[] {
  const eocdSig = 0x06054b50;
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 65536); i--) {
    if (zip.readUInt32LE(i) === eocdSig) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Not a ZIP archive (EOCD not found)");
  const count = zip.readUInt16LE(eocd + 10);
  let ptr = zip.readUInt32LE(eocd + 16);

  const out: { name: string; data: Buffer }[] = [];
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(ptr) !== 0x02014b50) throw new Error("Corrupt central directory");
    const method = zip.readUInt16LE(ptr + 10);
    const csize = zip.readUInt32LE(ptr + 20);
    const usize = zip.readUInt32LE(ptr + 24);
    const nameLen = zip.readUInt16LE(ptr + 28);
    const extraLen = zip.readUInt16LE(ptr + 30);
    const commentLen = zip.readUInt16LE(ptr + 32);
    const lfhOffset = zip.readUInt32LE(ptr + 42);
    const name = zip.subarray(ptr + 46, ptr + 46 + nameLen).toString("utf8");

    // Local header: skip to the actual data (its own name/extra lengths rule)
    const lNameLen = zip.readUInt16LE(lfhOffset + 26);
    const lExtraLen = zip.readUInt16LE(lfhOffset + 28);
    const dataStart = lfhOffset + 30 + lNameLen + lExtraLen;
    const comp = zip.subarray(dataStart, dataStart + csize);
    const data = method === 0 ? Buffer.from(comp) : inflateRawSync(comp);
    if (data.length !== usize) throw new Error(`Entry '${name}' corrupt (size mismatch)`);
    out.push({ name, data });
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

// ---------------------------------------------------------------------------
// AES-256-GCM envelope encryption (scrypt key derivation)
// ---------------------------------------------------------------------------
const ENC_MAGIC = Buffer.from("ANTLIONENC1", "ascii");
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export function encryptBuffer(plain: Buffer, passphrase: string): Buffer {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(passphrase, salt, 32, SCRYPT_PARAMS);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([ENC_MAGIC, salt, iv, tag, ct]);
}

export function decryptBuffer(blob: Buffer, passphrase: string): Buffer {
  if (!blob.subarray(0, ENC_MAGIC.length).equals(ENC_MAGIC)) {
    throw new Error("Not an encrypted Antlion backup");
  }
  let p = ENC_MAGIC.length;
  const salt = blob.subarray(p, p + 16); p += 16;
  const iv = blob.subarray(p, p + 12); p += 12;
  const tag = blob.subarray(p, p + 16); p += 16;
  const ct = blob.subarray(p);
  const key = scryptSync(passphrase, salt, 32, SCRYPT_PARAMS);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ct), decipher.final()]);
  } catch {
    throw new Error("Wrong passphrase (decryption failed)");
  }
}

export function isEncryptedBlob(blob: Buffer): boolean {
  return blob.length > ENC_MAGIC.length + 44 && blob.subarray(0, ENC_MAGIC.length).equals(ENC_MAGIC);
}

/** Passphrase verifier — proves a passphrase matches without storing it. */
const VERIFY_PLAINTEXT = Buffer.from("antlion-passphrase-verifier-v1", "utf8");

export function makeVerifier(passphrase: string): string {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(passphrase, salt, 32, SCRYPT_PARAMS);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(VERIFY_PLAINTEXT), cipher.final()]);
  return JSON.stringify({ v: 1, salt: salt.toString("base64"), iv: iv.toString("base64"), ct: ct.toString("base64"), tag: cipher.getAuthTag().toString("base64") });
}

export function verifyPassphrase(passphrase: string, verifierJson: string | null | undefined): boolean {
  if (!verifierJson) return false;
  try {
    const v = JSON.parse(verifierJson);
    const key = scryptSync(passphrase, Buffer.from(v.salt, "base64"), 32, SCRYPT_PARAMS);
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(v.iv, "base64"));
    decipher.setAuthTag(Buffer.from(v.tag, "base64"));
    const pt = Buffer.concat([decipher.update(Buffer.from(v.ct, "base64")), decipher.final()]);
    return timingSafeEqual(pt, VERIFY_PLAINTEXT);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Project snapshot
// ---------------------------------------------------------------------------
export interface ProjectSnapshot {
  format: "antlion-project-export";
  version: 1;
  exportedAt: string;
  encrypted: boolean;
  project: Record<string, unknown>;
  targets: Record<string, unknown>[];
  excluded: Record<string, unknown>[];
  findings: Record<string, unknown>[];
  notes: Record<string, unknown>[];
  runs: (Record<string, unknown> & { stages: Record<string, unknown>[] })[];
}

const PROJECT_FIELDS = ["name", "description", "color", "tags", "programId", "programName", "programPlatform", "encryptionEnabled"] as const;

export async function buildSnapshot(projectId: string): Promise<ProjectSnapshot> {
  const project = await db.project.findUnique({ where: { id: projectId } });
  if (!project) throw new Error("Project not found");
  const [targets, excluded, findings, notes, runs] = await Promise.all([
    db.target.findMany({ where: { projectId } }),
    db.excludedTarget.findMany({ where: { projectId } }),
    db.finding.findMany({ where: { projectId }, orderBy: { firstSeenAt: "asc" } }),
    db.note.findMany({ where: { projectId }, orderBy: { createdAt: "asc" } }),
    db.pipelineRun.findMany({ where: { projectId }, orderBy: { createdAt: "asc" } }),
  ]);
  const stages = await db.pipelineStage.findMany({
    where: { runId: { in: runs.map((r) => r.id) } },
    orderBy: { order: "asc" },
  });

  const proj: Record<string, unknown> = {};
  for (const f of PROJECT_FIELDS) proj[f] = (project as any)[f];

  return {
    format: "antlion-project-export",
    version: 1,
    exportedAt: new Date().toISOString(),
    encrypted: false, // caller flips this after encrypting
    project: proj,
    targets: targets.map(({ id, projectId: _p, ...rest }) => rest),
    excluded: excluded.map(({ id, projectId: _p, ...rest }) => rest),
    findings: findings.map(({ id, projectId: _p, ...rest }) => rest),
    notes: notes.map(({ id, projectId: _p, ...rest }) => rest),
    runs: runs.map((r) => {
      const { id, projectId: _p, ...rest } = r;
      const runStages = stages
        .filter((s) => s.runId === id)
        .map(({ id: _sid, runId: _sr, ...srest }) => {
          // Trim stored logs to keep archives small
          let logs: unknown[] = [];
          try { logs = JSON.parse(srest.logLines || "[]").slice(-40); } catch { logs = []; }
          return { ...srest, logLines: JSON.stringify(logs) };
        });
      return { ...rest, stages: runStages };
    }),
  };
}

export function snapshotToZip(snapshot: ProjectSnapshot): Buffer {
  return zipCreate([{ name: "project.json", data: JSON.stringify(snapshot, null, 2) }]);
}

/** Parse an (optionally encrypted) archive back into a snapshot. */
export function parseArchive(blob: Buffer, passphrase?: string): ProjectSnapshot {
  let zip = blob;
  let encrypted = false;
  if (isEncryptedBlob(blob)) {
    if (!passphrase) throw new Error("This archive is passphrase-encrypted — provide the passphrase to import it");
    zip = decryptBuffer(blob, passphrase);
    encrypted = true;
  }
  const entries = zipRead(zip);
  const entry = entries.find((e) => e.name === "project.json");
  if (!entry) throw new Error("Archive does not contain a project.json snapshot");
  const snapshot = JSON.parse(entry.data.toString("utf8")) as ProjectSnapshot;
  if (snapshot.format !== "antlion-project-export") throw new Error("Not an Antlion project archive");
  snapshot.encrypted = encrypted;
  return snapshot;
}

// ---------------------------------------------------------------------------
// Restore / import — re-creates data inside a transaction
// ---------------------------------------------------------------------------
export async function restoreSnapshot(snapshot: ProjectSnapshot, opts: { projectIds: { project: string; finding: Map<string, string>; run: Map<string, string> } }): Promise<{ counts: Record<string, number> }> {
  const { projectIds } = opts;
  const projectId = projectIds.project;
  const counts: Record<string, number> = { targets: 0, excluded: 0, findings: 0, notes: 0, runs: 0 };

  await db.$transaction(async (tx) => {
    // Wipe current project data (notes cascade from findings; stages from runs)
    await tx.note.deleteMany({ where: { projectId } });
    await tx.finding.deleteMany({ where: { projectId } });
    await tx.pipelineRun.deleteMany({ where: { projectId } });
    await tx.target.deleteMany({ where: { projectId } });
    await tx.excludedTarget.deleteMany({ where: { projectId } });

    // Project fields from the snapshot (keep the current id)
    const p = snapshot.project as any;
    await tx.project.update({
      where: { id: projectId },
      data: {
        name: p.name ?? "Restored project",
        description: p.description ?? null,
        color: p.color ?? "slate",
        tags: p.tags ?? "",
        programId: p.programId ?? null,
        programName: p.programName ?? null,
        programPlatform: p.programPlatform ?? null,
        encryptionEnabled: p.encryptionEnabled === true,
      },
    });

    // Targets + exclusions (fresh ids)
    for (const t of snapshot.targets as any[]) {
      await tx.target.create({
        data: {
          id: uuid(), projectId,
          value: t.value, type: t.type ?? "domain", origin: t.origin ?? "manual",
          validated: t.validated ?? true, metadata: t.metadata ?? "{}", inScope: t.inScope ?? true,
          addedAt: t.addedAt ? new Date(t.addedAt) : new Date(),
        },
      }).catch(() => {}); // unique constraint — skip dupes
      counts.targets++;
    }
    for (const t of snapshot.excluded as any[]) {
      await tx.excludedTarget.create({
        data: {
          id: uuid(), projectId,
          value: t.value, type: t.type ?? "domain", origin: t.origin ?? "manual",
          reason: t.reason ?? null,
          addedAt: t.addedAt ? new Date(t.addedAt) : new Date(),
        },
      }).catch(() => {});
      counts.excluded++;
    }

    // Runs + stages FIRST so findings can reference the new run ids
    for (const r of snapshot.runs as any[]) {
      const newRunId = uuid();
      if (r.id) projectIds.run.set(r.id, newRunId);
      await tx.pipelineRun.create({
        data: {
          id: newRunId, projectId,
          status: ["completed", "failed", "cancelled"].includes(r.status) ? r.status : "completed",
          config: r.config ?? "{}", trigger: r.trigger ?? "manual", checkpoint: r.checkpoint ?? "{}",
          startedAt: r.startedAt ? new Date(r.startedAt) : null,
          finishedAt: r.finishedAt ? new Date(r.finishedAt) : null,
          totalStages: r.totalStages ?? 0, doneStages: r.doneStages ?? 0,
          findingDelta: r.findingDelta ?? 0, assetDelta: r.assetDelta ?? 0,
          resourceStats: r.resourceStats ?? "{}", errorMessage: r.errorMessage ?? null,
          createdAt: r.createdAt ? new Date(r.createdAt) : new Date(),
        },
      });
      counts.runs++;
      for (const s of (r.stages || []) as any[]) {
        await tx.pipelineStage.create({
          data: {
            id: uuid(), runId: newRunId,
            name: s.name ?? "stage", tool: s.tool ?? "", order: s.order ?? 0,
            status: ["completed", "failed", "skipped", "cancelled"].includes(s.status) ? s.status : "completed",
            progress: s.progress ?? 100, logLines: s.logLines ?? "[]", outputSummary: s.outputSummary ?? "{}",
            startedAt: s.startedAt ? new Date(s.startedAt) : null,
            finishedAt: s.finishedAt ? new Date(s.finishedAt) : null, error: s.error ?? null,
          },
        });
      }
    }

    // Findings (run ids now mapped)
    for (const f of snapshot.findings as any[]) {
      const newId = uuid();
      if (f.id) projectIds.finding.set(f.id, newId);
      await tx.finding.create({
        data: {
          id: newId, projectId,
          runId: f.runId && projectIds.run.has(f.runId) ? projectIds.run.get(f.runId)! : null,
          type: f.type ?? "vulnerability", severity: f.severity ?? "info",
          title: f.title ?? "Untitled finding",
          description: f.description ?? null, evidence: f.evidence ?? null, remediation: f.remediation ?? null,
          target: f.target ?? null, url: f.url ?? null,
          cvssScore: f.cvssScore ?? null, cveId: f.cveId ?? null,
          tags: f.tags ?? "", status: f.status ?? "new",
          source: f.source ?? null, rawOutput: f.rawOutput ?? null,
          firstSeenAt: f.firstSeenAt ? new Date(f.firstSeenAt) : new Date(),
        },
      });
      counts.findings++;
    }

    // Notes (finding ids now mapped)
    for (const n of snapshot.notes as any[]) {
      await tx.note.create({
        data: {
          id: uuid(), projectId,
          findingId: n.findingId && projectIds.finding.has(n.findingId) ? projectIds.finding.get(n.findingId)! : null,
          content: n.content ?? "", pinned: n.pinned === true,
          createdAt: n.createdAt ? new Date(n.createdAt) : new Date(),
        },
      });
      counts.notes++;
    }

    // Recompute denormalized counters
    await tx.project.update({
      where: { id: projectId },
      data: {
        targetCount: await tx.target.count({ where: { projectId } }),
        excludedCount: await tx.excludedTarget.count({ where: { projectId } }),
        runCount: await tx.pipelineRun.count({ where: { projectId } }),
        findingCount: await tx.finding.count({ where: { projectId } }),
        lastActivityAt: new Date(),
      },
    });
  });

  return { counts };
}

// ---------------------------------------------------------------------------
// Backup records (files on disk + rows in the DB)
// ---------------------------------------------------------------------------
export function backupsDir(projectId?: string): string {
  const base = process.env.ANTLION_DATA_DIR
    ? path.join(process.env.ANTLION_DATA_DIR, "backups")
    : path.join(process.cwd(), "db", "backups");
  return projectId ? path.join(base, projectId) : base;
}

export async function createBackup(
  projectId: string,
  opts: { passphrase?: string; kind?: "automatic" | "manual" | "pre-import" } = {},
): Promise<{ record: { id: string; size: number; kind: string; createdAt: Date }; file: string }> {
  const snapshot = await buildSnapshot(projectId);
  let blob = snapshotToZip(snapshot);
  if (opts.passphrase) {
    blob = encryptBuffer(blob, opts.passphrase);
    snapshot.encrypted = true;
  }
  const dir = backupsDir(projectId);
  await mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filename = `backup-${stamp}-${uuid().slice(0, 4)}.${opts.passphrase ? "enc" : "zip"}`;
  const file = path.join(dir, filename);
  await writeFile(file, blob);

  const record = await db.backupRecord.create({
    data: { id: uuid(), path: file, size: blob.length, kind: opts.kind ?? "manual" },
  });
  await db.auditLog.create({
    data: { projectId, action: "backup.create", target: record.id, details: JSON.stringify({ file: filename, size: blob.length, encrypted: Boolean(opts.passphrase), kind: opts.kind ?? "manual" }) },
  });
  await pruneBackups(projectId);
  return { record: { id: record.id, size: record.size, kind: record.kind, createdAt: record.createdAt }, file: filename };
}

export async function pruneBackups(projectId?: string): Promise<number> {
  const days = await getRetentionDays();
  const cutoff = Date.now() - days * 86400_000;
  const stale = await db.backupRecord.findMany({ where: { createdAt: { lt: new Date(cutoff) } } });
  let removed = 0;
  for (const r of stale) {
    if (projectId && !r.path.includes(projectId)) continue;
    await rm(r.path, { force: true }).catch(() => {});
    await db.backupRecord.delete({ where: { id: r.id } }).catch(() => {});
    removed++;
  }
  // Drop records whose file vanished (external deletion)
  const all = await db.backupRecord.findMany();
  for (const r of all) {
    try { await stat(r.path); } catch {
      await db.backupRecord.delete({ where: { id: r.id } }).catch(() => {});
      removed++;
    }
  }
  return removed;
}

export async function getRetentionDays(): Promise<number> {
  try {
    const row = await db.setting.findUnique({ where: { id: "backups.retentionDays" } });
    const n = parseInt(row?.value || "", 10);
    if (Number.isFinite(n) && n >= 1 && n <= 365) return n;
  } catch {}
  return 7;
}

// ---------------------------------------------------------------------------
// Automatic backup scheduler — started by src/instrumentation.ts on boot
// ---------------------------------------------------------------------------
let schedulerStarted = false;

export function startAutoBackupScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;
  const CHECK_INTERVAL = 30 * 60_000; // check every 30 min
  const BACKUP_EVERY = 24 * 3600_000; // backup each project at most daily

  const tick = async () => {
    try {
      const rows = await db.setting.findMany({ where: { id: { startsWith: "backups.auto." } } });
      for (const row of rows) {
        if (row.value !== "true") continue;
        const projectId = row.id.replace("backups.auto.", "");
        const project = await db.project.findUnique({ where: { id: projectId } });
        if (!project || project.status === "soft-deleted") continue;
        const latest = await db.backupRecord.findFirst({
          where: { path: { contains: projectId }, kind: "automatic" },
          orderBy: { createdAt: "desc" },
        });
        if (latest && Date.now() - new Date(latest.createdAt).getTime() < BACKUP_EVERY) continue;
        await createBackup(projectId, { kind: "automatic" }).catch((e) =>
          console.error(`[backups] auto backup failed for ${projectId}:`, e?.message),
        );
      }
      await pruneBackups();
    } catch {
      // DB not ready yet (boot race) — next tick retries
    }
  };

  setTimeout(tick, 15_000); // first check shortly after boot
  setInterval(tick, CHECK_INTERVAL).unref?.();
  console.log("[backups] automatic backup scheduler started (checks every 30 min)");
}
