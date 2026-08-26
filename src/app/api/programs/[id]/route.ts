import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { fetchLiveScope } from "@/lib/program-fetcher";

interface Params {
  params: Promise<{ id: string }>;
}

// GET /api/programs/:id — full program detail
// If scope is empty (cached row didn't include scope), lazy-fetch it live from
// the platform and persist back to the DB before returning.
export async function GET(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const p = await db.program.findUnique({ where: { id } });
    if (!p) return NextResponse.json({ error: "Not found" }, { status: 404 });

    let inScope: any[] = JSON.parse(p.inScopeRaw || "[]");
    let outScope: any[] = JSON.parse(p.outScopeRaw || "[]");
    let policy: string | null = p.policy;

    const wantLive = req.nextUrl.searchParams.get("live") === "1";
    const empty = inScope.length === 0 && outScope.length === 0;
    // disclose.io listings cache a bare policy URL; the registry detail page
    // carries the richer attestation text — enrich once on first open.
    const needsEnrichment =
      p.platform === "disclose" && (!policy || !policy.includes("\n"));

    // If we have no scope rows OR the user explicitly asked for a live refresh
    // (e.g. by clicking a "Refresh scope" button), fetch live from platform.
    // Skip for platforms that have no public scope API.
    const supportsLive = ["hackerone", "bugcrowd", "yeswehack", "intigriti", "immunefi", "disclose"].includes(
      p.platform,
    );
    let liveMetrics: any = null;
    if ((empty || wantLive || needsEnrichment) && supportsLive) {
      try {
        const live = await fetchLiveScope(p.platform, p.externalId);
        if (live.inScope.length || live.outScope.length || wantLive || needsEnrichment) {
          // Persist back to the DB so next load is fast
          const newIn = [...live.inScope, ...inScope];
          // Dedupe by value, prefer the live (newer) entry
          const seen = new Map<string, any>();
          for (const a of newIn) {
            if (!seen.has(a.value)) seen.set(a.value, a);
          }
          const mergedIn = [...seen.values()];
          const newOut = [...live.outScope, ...outScope];
          const seenOut = new Map<string, any>();
          for (const a of newOut) {
            if (!seenOut.has(a.value)) seenOut.set(a.value, a);
          }
          const mergedOut = [...seenOut.values()];
          inScope = mergedIn;
          outScope = mergedOut;
          // Prefer the more informative policy text (live scope fetches can
          // return richer attestation text than the bare listing URL).
          if (live.policy && (!policy || live.policy.length > policy.length)) policy = live.policy;
          if (live.metrics) liveMetrics = live.metrics;
          // Persist live metrics alongside the scope (only overwrite fields
          // the platform actually returned — Prisma `undefined` = untouched)
          const m = live.metrics || {};
          await db.program.update({
            where: { id },
            data: {
              inScopeRaw: JSON.stringify(mergedIn),
              outScopeRaw: JSON.stringify(mergedOut),
              policy: policy || null,
              scopeUpdated: new Date(),
              lastSyncAt: new Date(),
              ...(m.maxBounty !== undefined ? { maxBounty: m.maxBounty } : {}),
              ...(m.avgBounty !== undefined ? { avgBounty: m.avgBounty } : {}),
              ...(m.totalPaid !== undefined ? { totalPaid: m.totalPaid } : {}),
              ...(m.resolvedReports !== undefined ? { resolvedReports: m.resolvedReports } : {}),
              ...(m.avgResponseHrs !== undefined ? { avgResponseHrs: m.avgResponseHrs } : {}),
              ...(m.avgResolutionHrs !== undefined ? { avgResolutionHrs: m.avgResolutionHrs } : {}),
              ...(m.acceptanceRate !== undefined ? { acceptanceRate: m.acceptanceRate } : {}),
              ...(m.industry ? { industry: m.industry } : {}),
            },
          });
        }
      } catch (e: any) {
        // Live fetch failed — keep returning cached data, but surface the
        // error as a non-fatal hint via the response shape.
        console.warn(`Live scope fetch for ${p.platform}/${p.externalId} failed:`, e?.message);
        return NextResponse.json({
          ...p,
          languages: JSON.parse(p.languages || "[]"),
          inScope,
          outScope,
          scopeHistory: JSON.parse(p.scopeHistory || "[]"),
          policy,
          liveScopeError: e?.message || String(e),
        });
      }
    }

    return NextResponse.json({
      ...p,
      languages: JSON.parse(p.languages || "[]"),
      inScope,
      outScope,
      scopeHistory: JSON.parse(p.scopeHistory || "[]"),
      policy,
      // Merge any live-refreshed metrics over the cached row values
      ...(liveMetrics?.maxBounty !== undefined ? { maxBounty: liveMetrics.maxBounty } : {}),
      ...(liveMetrics?.avgBounty !== undefined ? { avgBounty: liveMetrics.avgBounty } : {}),
      ...(liveMetrics?.totalPaid !== undefined ? { totalPaid: liveMetrics.totalPaid } : {}),
      ...(liveMetrics?.resolvedReports !== undefined ? { resolvedReports: liveMetrics.resolvedReports } : {}),
      ...(liveMetrics?.avgResponseHrs !== undefined ? { avgResponseHrs: liveMetrics.avgResponseHrs } : {}),
      ...(liveMetrics?.avgResolutionHrs !== undefined ? { avgResolutionHrs: liveMetrics.avgResolutionHrs } : {}),
      ...(liveMetrics?.acceptanceRate !== undefined ? { acceptanceRate: liveMetrics.acceptanceRate } : {}),
      ...(liveMetrics?.industry ? { industry: liveMetrics.industry } : {}),
    });
  } catch (err: any) {
    console.error("GET /api/programs/[id] error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST /api/programs/:id — refresh scope live for this program
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const p = await db.program.findUnique({ where: { id } });
    if (!p) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const live = await fetchLiveScope(p.platform, p.externalId);
    // Only persist back if the live fetch returned data — otherwise keep
    // the cached scope intact (don't wipe a non-empty cache just because
    // the live fetch hit an empty result for a program with no public scope).
    if (live.inScope.length || live.outScope.length) {
      // Merge with existing cached scope, deduping by value (prefer live entries)
      const cachedIn: any[] = JSON.parse(p.inScopeRaw || "[]");
      const cachedOut: any[] = JSON.parse(p.outScopeRaw || "[]");
      const seenIn = new Map<string, any>();
      for (const a of [...live.inScope, ...cachedIn]) {
        if (!seenIn.has(a.value)) seenIn.set(a.value, a);
      }
      const seenOut = new Map<string, any>();
      for (const a of [...live.outScope, ...cachedOut]) {
        if (!seenOut.has(a.value)) seenOut.set(a.value, a);
      }
      const mergedIn = [...seenIn.values()];
      const mergedOut = [...seenOut.values()];
      const m = live.metrics || {};
      await db.program.update({
        where: { id },
        data: {
          inScopeRaw: JSON.stringify(mergedIn),
          outScopeRaw: JSON.stringify(mergedOut),
          policy: live.policy || p.policy || null,
          scopeUpdated: new Date(),
          lastSyncAt: new Date(),
          ...(m.maxBounty !== undefined ? { maxBounty: m.maxBounty } : {}),
          ...(m.avgBounty !== undefined ? { avgBounty: m.avgBounty } : {}),
          ...(m.totalPaid !== undefined ? { totalPaid: m.totalPaid } : {}),
          ...(m.resolvedReports !== undefined ? { resolvedReports: m.resolvedReports } : {}),
          ...(m.avgResponseHrs !== undefined ? { avgResponseHrs: m.avgResponseHrs } : {}),
          ...(m.avgResolutionHrs !== undefined ? { avgResolutionHrs: m.avgResolutionHrs } : {}),
          ...(m.acceptanceRate !== undefined ? { acceptanceRate: m.acceptanceRate } : {}),
          ...(m.industry ? { industry: m.industry } : {}),
        },
      });
      return NextResponse.json({
        ok: true,
        inScopeCount: mergedIn.length,
        outScopeCount: mergedOut.length,
        inScope: mergedIn,
        outScope: mergedOut,
      });
    }
    // Live fetch returned no scope rows — return what we have without
    // changing the DB. The error field (if any) is surfaced so the UI
    // can show a meaningful message.
    return NextResponse.json({
      ok: true,
      inScopeCount: 0,
      outScopeCount: 0,
      inScope: [],
      outScope: [],
      note: "Live fetch returned no scope rows; cached data unchanged.",
    });
  } catch (err: any) {
    console.error("POST /api/programs/[id] error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
