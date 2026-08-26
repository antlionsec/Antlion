import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// GET /api/settings
export async function GET() {
  try {
    const rows = await db.setting.findMany();
    const settings: Record<string, string> = {};
    for (const r of rows) settings[r.id] = r.value;
    return NextResponse.json({ settings });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// PUT /api/settings — upsert one or multiple settings
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    for (const [key, value] of Object.entries(body)) {
      await db.setting.upsert({
        where: { id: key },
        create: { id: key, value: String(value) },
        update: { value: String(value) },
      });
    }
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
