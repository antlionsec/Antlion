import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { fetchAllPrograms, type RawProgram } from "@/lib/program-fetcher";

const CACHE_TTL_MS = 1000 * 60 * 60 * 6; // 6 hour cache

async function refreshFromSources(): Promise<{
  count: number;
  results: any[];
}> {
  const { programs, results } = await fetchAllPrograms();
  if (programs.length === 0) {
    return { count: 0, results };
  }

  // Mark existing entries as no-longer-new (compared to incoming set)
  const incomingIds = new Set(programs.map((p) => p.externalId));
  const existing = await db.program.findMany({ select: { externalId: true } });
  const priorIds = new Set(existing.map((e) => e.externalId));
  const brandNew = programs.filter((p) => !priorIds.has(p.externalId));

  // Upsert every program
  for (const p of programs) {
    const isNew = !priorIds.has(p.externalId);
    // Scope is either provided by the platform listing (HackerOne, Immunefi)
    // or left empty — the detail view lazy-fetches REAL live scope from the
    // platform per-program. We never infer fake scope from the program URL.
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
      lastSyncAt: new Date(),
      isNew,
    };
    // Prisma treats `undefined` as "leave unchanged" — when this sync returned
    // no value for a metric field, keep whatever was previously stored
    // (platforms intermittently hide some values).
    const keepIfUndefined = (v: any, field: string) =>
      v === undefined ? { [field]: undefined } : {};
    await db.program.upsert({
      where: { externalId: p.externalId },
      create: data,
      update: {
        ...data,
        isNew: false, // subsequent syncs do not flag as new
        ...keepIfUndefined(p.maxBounty, "maxBounty"),
        ...keepIfUndefined(p.avgBounty, "avgBounty"),
        ...keepIfUndefined(p.totalPaid, "totalPaid"),
        ...keepIfUndefined(p.resolvedReports, "resolvedReports"),
        ...keepIfUndefined(p.avgResponseHrs, "avgResponseHrs"),
        ...keepIfUndefined(p.avgResolutionHrs, "avgResolutionHrs"),
        ...keepIfUndefined(p.acceptanceRate, "acceptanceRate"),
        ...keepIfUndefined(p.industry, "industry"),
        // Never wipe previously-fetched scope with an empty inference —
        // scope is lazily fetched per-program for some platforms.
        ...(inScope.length === 0 ? { inScopeRaw: undefined } : {}),
        ...(outScope.length === 0 ? { outScopeRaw: undefined } : {}),
      },
    });
  }

  // Persist source-time summary for the source-status banner
  await db.setting.upsert({
    where: { id: "programs.lastSync" },
    create: {
      id: "programs.lastSync",
      value: JSON.stringify({
        at: new Date().toISOString(),
        results,
        count: programs.length,
      }),
    },
    update: {
      value: JSON.stringify({
        at: new Date().toISOString(),
        results,
        count: programs.length,
      }),
    },
  });

  return { count: programs.length, results };
}

// Note: no scope inference — programs without platform-provided scope stay
// empty until the user opens the detail view, which lazy-fetches REAL live
// scope data from the platform (see /api/programs/[id]).

// GET /api/programs — list cached programs (sync if stale)
export async function GET(req: NextRequest) {
  try {
    const forceRefresh = req.nextUrl.searchParams.get("refresh") === "1";
    const lastSyncSetting = await db.setting.findUnique({
      where: { id: "programs.lastSync" },
    });
    let lastSync: any = null;
    if (lastSyncSetting) {
      try {
        lastSync = JSON.parse(lastSyncSetting.value);
      } catch {
        lastSync = null;
      }
    }

    const needsRefresh =
      forceRefresh ||
      !lastSync ||
      (lastSync && Date.now() - new Date(lastSync.at).getTime() > CACHE_TTL_MS);

    if (needsRefresh) {
      // Trigger a sync in the background if not forced — return cached data
      // immediately to keep UX responsive, but only do so if we have at least
      // some cache. On first run, do it synchronously to avoid blank page.
      const cachedCount = await db.program.count();
      if (cachedCount === 0 || forceRefresh) {
        await refreshFromSources();
      } else {
        // Non-blocking refresh
        refreshFromSources().catch((e) => {
          console.error("Background refresh failed:", e?.message);
        });
      }
    }

    // Now serve from DB
    const platform = req.nextUrl.searchParams.get("platform");
    const type = req.nextUrl.searchParams.get("type");
    const industry = req.nextUrl.searchParams.get("industry");
    const q = req.nextUrl.searchParams.get("q") || "";
    const sort = req.nextUrl.searchParams.get("sort") || "newest";
    const onlyNew = req.nextUrl.searchParams.get("onlyNew") === "1";
    const limit = parseInt(req.nextUrl.searchParams.get("limit") || "0") || 0;

    let where: any = {};
    if (platform && platform !== "all") where.platform = platform;
    if (type && type !== "all") where.type = type;
    if (industry && industry !== "all") where.industry = industry;
    if (onlyNew) where.isNew = true;
    if (q) {
      where = {
        ...where,
        OR: [
          { name: { contains: q } },
          { industry: { contains: q } },
          { platform: { contains: q } },
        ],
      };
    }

    let orderBy: any = {};
    switch (sort) {
      case "name": orderBy = { name: "asc" }; break;
      case "bounty-high": orderBy = { maxBounty: "desc" }; break;
      case "bounty-avg": orderBy = { avgBounty: "desc" }; break;
      case "total-paid": orderBy = { totalPaid: "desc" }; break;
      case "fastest": orderBy = { avgResponseHrs: "asc" }; break;
      case "acceptance": orderBy = { acceptanceRate: "desc" }; break;
      case "scope-updated": orderBy = { scopeUpdated: "desc" }; break;
      case "newest":
      default: orderBy = { firstSeenAt: "desc" };
    }

    let programs = await db.program.findMany({ where, orderBy });
    if (limit > 0) programs = programs.slice(0, limit);

    const enriched = programs.map((p) => ({
      ...p,
      languages: JSON.parse(p.languages || "[]"),
      inScope: JSON.parse(p.inScopeRaw || "[]"),
      outScope: JSON.parse(p.outScopeRaw || "[]"),
      scopeHistory: JSON.parse(p.scopeHistory || "[]"),
    }));

    // Read updated sync info
    const syncInfo = await db.setting.findUnique({ where: { id: "programs.lastSync" } });
    let syncData: any = null;
    if (syncInfo) {
      try { syncData = JSON.parse(syncInfo.value); } catch {}
    }

    return NextResponse.json({
      programs: enriched,
      count: enriched.length,
      sync: syncData,
    });
  } catch (err: any) {
    console.error("GET /api/programs error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST /api/programs — force a refresh from upstream sources
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const scope = body?.scope || "all"; // 'all' | platform name
    if (scope !== "all") {
      // The fetcher already runs all sources; we just filter results
      const { count, results } = await refreshFromSources();
      return NextResponse.json({ ok: true, count, results });
    }
    const { count, results } = await refreshFromSources();
    return NextResponse.json({ ok: true, count, results });
  } catch (err: any) {
    console.error("POST /api/programs error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
