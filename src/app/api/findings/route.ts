import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// GET /api/findings?projectId=...&severity=...&type=...&status=...&q=...
export async function GET(req: NextRequest) {
  try {
    const projectId = req.nextUrl.searchParams.get("projectId");
    if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

    const severity = req.nextUrl.searchParams.get("severity");
    const type = req.nextUrl.searchParams.get("type");
    const status = req.nextUrl.searchParams.get("status");
    const q = req.nextUrl.searchParams.get("q") || "";
    const source = req.nextUrl.searchParams.get("source");
    const limit = parseInt(req.nextUrl.searchParams.get("limit") || "0") || 1000;

    const where: any = { projectId };
    if (severity && severity !== "all") where.severity = severity;
    if (type && type !== "all") where.type = type;
    if (status && status !== "all") where.status = status;
    if (source && source !== "all") where.source = source;
    if (q) where.title = { contains: q };

    const findings = await db.finding.findMany({
      where,
      orderBy: [{ severity: "desc" }, { firstSeenAt: "desc" }],
      take: limit,
    });

    return NextResponse.json({ findings, count: findings.length });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
