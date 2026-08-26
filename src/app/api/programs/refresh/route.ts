import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { fetchAllPrograms } from "@/lib/program-fetcher";

// POST /api/programs/refresh — force a re-sync from upstream sources
export async function POST(req: NextRequest) {
  try {
    const t0 = Date.now();
    const { programs, results } = await fetchAllPrograms();
    const ts = new Date();

    // Upsert every program into the DB
    const priorIds = new Set(
      (await db.program.findMany({ select: { externalId: true } })).map(
        (p) => p.externalId,
      ),
    );

    let upserted = 0;
    for (const p of programs) {
      const isNew = !priorIds.has(p.externalId);
      const inScope = p.inScope;
      const outScope = p.outScope;
      // Defensive: ensure logo is a string or null (some platform APIs return objects)
      const logo =
        typeof p.logo === "string"
          ? p.logo
          : p.logo && typeof p.logo === "object" && "url" in p.logo
            ? String((p.logo as any).url)
            : null;

      const data = {
        externalId: p.externalId,
        name: p.name,
        platform: p.platform,
        type: p.type,
        url: p.url || null,
        state: p.state,
        logo,
        industry: p.industry || null,
        languages: JSON.stringify(p.languages || []),
        region: p.region || null,
        maxBounty: p.maxBounty ?? null,
        avgBounty: p.avgBounty ?? null,
        totalPaid: p.totalPaid ?? null,
        resolvedReports: p.resolvedReports ?? null,
        acceptedReports: p.acceptedReports ?? null,
        avgResponseHrs: p.avgResponseHrs ?? null,
        avgResolutionHrs: p.avgResolutionHrs ?? null,
        acceptanceRate: p.acceptanceRate ?? null,
        inScopeRaw: JSON.stringify(inScope),
        outScopeRaw: JSON.stringify(outScope),
        scopeHistory: JSON.stringify([]),
        policy: p.policy || null,
        scopeUpdated: p.scopeUpdated ? new Date(p.scopeUpdated) : null,
        firstSeenAt: p.firstSeenAt ? new Date(p.firstSeenAt) : new Date(),
        lastSyncAt: ts,
        isNew,
      };
      await db.program.upsert({
        where: { externalId: p.externalId },
        create: data,
        update: { ...data, isNew: false },
      });
      upserted++;
    }

    await db.setting.upsert({
      where: { id: "programs.lastSync" },
      create: {
        id: "programs.lastSync",
        value: JSON.stringify({
          at: ts.toISOString(),
          results,
          count: programs.length,
          durationMs: Date.now() - t0,
        }),
      },
      update: {
        value: JSON.stringify({
          at: ts.toISOString(),
          results,
          count: programs.length,
          durationMs: Date.now() - t0,
        }),
      },
    });

    return NextResponse.json({
      ok: true,
      count: upserted,
      results,
      durationMs: Date.now() - t0,
    });
  } catch (err: any) {
    console.error("POST /api/programs/refresh error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
