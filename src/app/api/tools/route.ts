import { NextRequest, NextResponse } from "next/server";
import { scanTools, getLastScan } from "@/lib/tool-scanner";

// GET /api/tools — command-line tool detection status
//   ?refresh=1  force a fresh scan (ignore cache)
// Startup behavior: first call runs a real `which` scan for every registered
// tool and caches the result (memory + DB). Subsequent calls are instant.
export async function GET(req: NextRequest) {
  try {
    const force = req.nextUrl.searchParams.get("refresh") === "1";
    if (force) {
      const scan = await scanTools(true);
      return NextResponse.json(scan);
    }
    // Serve stale-while-revalidate: if we have a recent in-memory scan, use
    // it; otherwise run a scan now (startup detection).
    const recent = await getLastScan();
    const isFresh =
      recent && Date.now() - new Date(recent.scannedAt).getTime() < 5 * 60_000;
    if (isFresh && recent) {
      return NextResponse.json(recent);
    }
    const scan = await scanTools(true);
    return NextResponse.json(scan);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
