import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { v4 as uuid } from "uuid";

// GET /api/targets?projectId=...  — list all targets + excluded targets for a project
export async function GET(req: NextRequest) {
  try {
    const projectId = req.nextUrl.searchParams.get("projectId");
    if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });
    const [targets, excluded] = await Promise.all([
      db.target.findMany({ where: { projectId }, orderBy: { addedAt: "asc" } }),
      db.excludedTarget.findMany({ where: { projectId }, orderBy: { addedAt: "asc" } }),
    ]);
    return NextResponse.json({ targets, excluded });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST /api/targets — bulk add targets (with classification + validation)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const projectId: string = body.projectId;
    const items: { value: string; type?: string; origin?: string; inScope?: boolean }[] = body.items;

    if (!projectId || !Array.isArray(items)) {
      return NextResponse.json({ error: "projectId and items[] required" }, { status: 400 });
    }

    const created: any[] = [];
    const createdExcluded: any[] = [];

    for (const item of items) {
      const value = (item.value || "").trim();
      if (!value) continue;
      const inferredType = item.type || classifyTarget(value);
      const inScope = item.inScope !== false;

      if (inScope) {
        try {
          const t = await db.target.create({
            data: {
              id: uuid(),
              projectId,
              value,
              type: inferredType,
              origin: item.origin || "manual",
              metadata: "{}",
            },
          });
          created.push(t);
        } catch (e) {
          // unique constraint — skip duplicates
        }
      } else {
        try {
          const t = await db.excludedTarget.create({
            data: {
              id: uuid(),
              projectId,
              value,
              type: inferredType,
              origin: item.origin || "manual",
            },
          });
          createdExcluded.push(t);
        } catch (e) {}
      }
    }

    await db.project.update({
      where: { id: projectId },
      data: {
        targetCount: await db.target.count({ where: { projectId } }),
        excludedCount: await db.excludedTarget.count({ where: { projectId } }),
        lastActivityAt: new Date(),
      },
    });

    await db.auditLog.create({
      data: {
        projectId,
        action: "targets.add",
        target: `${created.length} targets, ${createdExcluded.length} excluded`,
      },
    });

    return NextResponse.json({ added: created.length, excluded: createdExcluded.length });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// DELETE /api/targets?projectId=...&id=...
export async function DELETE(req: NextRequest) {
  try {
    const projectId = req.nextUrl.searchParams.get("projectId");
    const id = req.nextUrl.searchParams.get("id");
    const scope = req.nextUrl.searchParams.get("scope") || "in"; // in|out
    if (!projectId || !id) return NextResponse.json({ error: "projectId and id required" }, { status: 400 });

    if (scope === "in") await db.target.delete({ where: { id } });
    else await db.excludedTarget.delete({ where: { id } });

    await db.project.update({
      where: { id: projectId },
      data: {
        targetCount: await db.target.count({ where: { projectId } }),
        excludedCount: await db.excludedTarget.count({ where: { projectId } }),
        lastActivityAt: new Date(),
      },
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// ----------------------------------------------------------------------------
// TARGET CLASSIFIER — determines type from raw input
// ----------------------------------------------------------------------------
export function classifyTarget(raw: string): string {
  const v = raw.trim();
  if (/^https?:\/\//i.test(v)) return "url";
  if (/^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/.test(v)) return "cidr";
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(v)) return "ip";
  if (/^\*\..+\.[a-z]{2,}$/i.test(v)) return "wildcard";
  if (/^.+\.[a-z]{2,}$/i.test(v)) return "domain";
  if (/^com\..+\.mobile$/i.test(v) || /^io\..+\.mobile$/i.test(v)) return "mobile";
  if (/^\/.+$/.test(v)) return "url";
  return "domain";
}

// Pre-flight validation: warns about broad wildcards, missing scope, etc.
export function preflightCheck(targets: { value: string; type: string }[]): {
  warnings: { level: "warning" | "error"; code: string; message: string; target?: string }[];
} {
  const warnings: { level: "warning" | "error"; code: string; message: string; target?: string }[] = [];
  const roots = new Set<string>();
  for (const t of targets) {
    if (t.type === "wildcard") {
      const root = t.value.replace(/^\*\./, "");
      if (roots.has(root)) {
        warnings.push({ level: "warning", code: "duplicate-wildcard-root", message: `Multiple wildcards sharing root ${root} — consider consolidating.`, target: t.value });
      }
      roots.add(root);
    }
    if (t.type === "ip" || t.type === "cidr") {
      warnings.push({ level: "warning", code: "ip-target", message: `IP/CIDR targets require explicit authorization verification. Confirm with program owner before scanning.`, target: t.value });
    }
    if (t.value.includes("localhost") || t.value.includes("127.0.0.1") || t.value.includes("0.0.0.0")) {
      warnings.push({ level: "error", code: "loopback-target", message: `Loopback addresses are never in scope.`, target: t.value });
    }
  }
  if (targets.length === 0) {
    warnings.push({ level: "error", code: "no-targets", message: "No targets selected. Add at least one in-scope asset before launching." });
  }
  if (targets.length > 500) {
    warnings.push({ level: "warning", code: "large-scope", message: `Large scope (${targets.length} targets) — consider staging with lower concurrency to avoid rate-limit bans.` });
  }
  return { warnings };
}
