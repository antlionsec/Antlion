import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// GET /api/audit?projectId=...
export async function GET(req: NextRequest) {
  try {
    const projectId = req.nextUrl.searchParams.get("projectId");
    const limit = parseInt(req.nextUrl.searchParams.get("limit") || "200");
    const where: any = projectId ? { projectId } : {};
    const logs = await db.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return NextResponse.json({ logs });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
