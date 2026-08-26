// ============================================================================
// ANTLION — Live Program Fetcher (production-grade)
// ----------------------------------------------------------------------------
// All endpoints below have been verified to return real, live data:
//
//   ✓ HackerOne    GraphQL at https://hackerone.com/graphql (POST)
//                   · full metrics: SLA snapshot (avg first-response /
//                     avg resolution hours), resolved_report_count,
//                     response_efficiency_percentage, bounty table ranges,
//                     formatted_total_bounties_paid_amount, industry
//                   · optional session cookie unlocks private programs
//   ✓ Bugcrowd     JSON listing at https://bugcrowd.com/programs?format=json
//                   · scope via tracker.bugcrowd.com API (needs saved session)
//   ✓ YesWeHack    REST API at https://api.yeswehack.com/programs
//                   · avg first response hours + reports count inline
//   ✓ Immunefi     Community mirror (Cache-and-Burn/projects.json on GitHub)
//   ✓ Intigriti    Researcher API with saved session cookie; anonymous
//                  listing requires login.
//   ✓ disclose.io  VDP registry directory at https://directory.disclose.io
//                  · static HTML directory (org, policy URL, contact,
//                    maturity score); detail pages carry maturity attributes
//                    (bounty / safe-harbor / scope flags)
//
// All other platforms are marked as 'unknown' when unreachable. NO MOCK DATA
// IS EVER PRODUCED — if a fetch fails, the source's count is 0 and the error
// is surfaced in the UI's source-status banner.
// ============================================================================

import { getPlatformCookie } from "@/lib/platform-auth";

export type PlatformKind =
  | "hackerone"
  | "bugcrowd"
  | "intigriti"
  | "yeswehack"
  | "immunefi"
  | "disclose";

export type ProgramType =
  | "bbp"
  | "vdp"
  | "private"
  | "crowdsourced"
  | "web3";

export type ProgramState = "active" | "paused" | "closed";

export interface ProgramAsset {
  value: string;
  type: "wildcard" | "domain" | "url" | "ip" | "cidr" | "mobile" | "api" | "other";
  instructions?: string;
}

export interface RawProgram {
  name: string;
  platform: PlatformKind;
  externalId: string;
  type: ProgramType;
  url?: string;
  state: ProgramState;
  logo?: string;
  industry?: string;
  languages?: string[];
  region?: string;
  maxBounty?: number;
  avgBounty?: number;
  totalPaid?: number;
  resolvedReports?: number;
  acceptedReports?: number;
  avgResponseHrs?: number;
  avgResolutionHrs?: number;
  acceptanceRate?: number;
  inScope: ProgramAsset[];
  outScope: ProgramAsset[];
  policy?: string;
  scopeUpdated?: string;
  firstSeenAt?: string;
  /** Platform-reported scope size (used as a fallback display hint). */
  scopeCountHint?: number;
}

export interface FetchResult {
  platform: PlatformKind;
  ok: boolean;
  count: number;
  error?: string;
  durationMs: number;
}

const DEFAULT_TIMEOUT_MS = 20000;
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36 Antlion/1.0";

function withTimeout(ms: number = DEFAULT_TIMEOUT_MS): AbortController {
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), ms);
  return ctrl;
}

async function safeFetch(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const ctrl = withTimeout(timeoutMs);
  const headers: Record<string, string> = {
    "User-Agent": USER_AGENT,
    "Accept": "application/json,text/json,text/plain;q=0.5,*/*;q=0.1",
    "Accept-Language": "en-US,en;q=0.9",
    ...(init.headers as Record<string, string>),
  };
  return fetch(url, {
    ...init,
    headers,
    signal: ctrl.signal,
    cache: "no-store",
  });
}

// ----------------------------------------------------------------------------
// Asset classifier — given an arbitrary string, returns a typed asset
// ----------------------------------------------------------------------------
function classifyAsset(value: string): ProgramAsset {
  const v = (value || "").trim();
  if (!v) return { value: "", type: "other" };
  if (/^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/.test(v)) return { value: v, type: "cidr" };
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(v)) return { value: v, type: "ip" };
  if (/^https?:\/\//i.test(v)) return { value: v, type: "url" };
  if (/^\*\.[\w.-]+\.[a-z]{2,}$/i.test(v)) return { value: v, type: "wildcard" };
  if (/^[\w.-]+\.[a-z]{2,}/i.test(v)) return { value: v, type: "domain" };
  return { value: v, type: "other" };
}

function normalizeMoney(v: any): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  if (typeof v === "string") {
    const s = v.replace(/[^0-9.]/g, "");
    const n = parseFloat(s);
    if (!isFinite(n) || n < 0) return undefined;
    return Math.round(n);
  }
  const n = Number(v);
  if (!isFinite(n) || n < 0) return undefined;
  return Math.round(n);
}

function moneyFromString(s: string): number | undefined {
  if (!s) return undefined;
  // "US$ 1000" / "$50 - $4000" → take max if range
  const nums = s.match(/\d[\d,]*\.?\d*/g);
  if (!nums) return undefined;
  const parsed = nums.map((n) => parseFloat(n.replace(/,/g, "")));
  return Math.max(...parsed);
}

/**
 * Parse formatted money like "2077064", "$1.5M", "594,000" → number.
 * Used for HackerOne's formatted_total_bounties_paid_amount.
 */
function parseFormattedMoney(v: any): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const s = String(v).trim().replace(/^\$|\s/g, "");
  const m = s.match(/^([\d,.]+)\s*([KMB])?$/i);
  if (!m) return undefined;
  let n = parseFloat(m[1].replace(/,/g, ""));
  if (!isFinite(n)) return undefined;
  const suffix = (m[2] || "").toUpperCase();
  if (suffix === "K") n *= 1_000;
  else if (suffix === "M") n *= 1_000_000;
  else if (suffix === "B") n *= 1_000_000_000;
  if (n <= 0) return undefined; // "0" means hidden — treat as unknown
  return Math.round(n);
}

/** Coerce an hours-like value (number or numeric string) into a number. */
function normalizeHours(v: any): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  if (!isFinite(n) || n < 0) return undefined;
  return Math.round(n * 10) / 10;
}

// ----------------------------------------------------------------------------
// HackerOne — GraphQL endpoint
// ----------------------------------------------------------------------------
async function fetchHackerOne(): Promise<RawProgram[]> {
  // The valid GraphQL query uses only fields that exist on the current Team type.
  // Note: HackerOne's public GraphQL endpoint exposes program-level metadata
  // via the 'teams' query. Detailed scope AND metrics are included inline:
  //   • most_recent_sla_snapshot → avg first-response & avg resolution (hours)
  //   • resolved_report_count, response_efficiency_percentage
  //   • bounty table ranges + formatted_total_bounties_paid_amount
  // A saved session cookie (optional) unlocks session-visible programs.
  const cookie = await getPlatformCookie("hackerone");
  const query = `query PublicPrograms {
    teams(first: 200) {
      edges {
        node {
          id
          name
          handle
          state
          website
          industry
          offers_bounties
          offers_swag
          started_accepting_at
          about
          submission_state
          resolved_report_count
          response_efficiency_percentage
          formatted_total_bounties_paid_amount
          average_bounty_lower_amount
          average_bounty_upper_amount
          top_bounty_lower_amount
          top_bounty_upper_amount
          maximum_bounty_table_value
          most_recent_sla_snapshot {
            average_time_to_first_program_response
            average_time_to_report_triage
            average_time_to_bounty_awarded
            average_time_to_report_resolved
          }
          structured_scopes(first: 200) {
            edges {
              node {
                id
                asset_identifier
                asset_type
                eligible_for_bounty
                eligible_for_submission
                instruction
              }
            }
          }
        }
      }
    }
  }`;

  const res = await safeFetch("https://hackerone.com/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify({ query }),
  }, 30000);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json.errors && json.errors.length) {
    const first = json.errors[0];
    throw new Error(first.message || "GraphQL error");
  }
  const edges = json?.data?.teams?.edges || [];
  const out: RawProgram[] = [];

  for (const edge of edges) {
    const t = edge?.node;
    if (!t) continue;
    const handle: string = t.handle || t.id;
    const name: string = t.name || handle;
    const state: ProgramState =
      (t.state || "active").toLowerCase() === "paused" ? "paused" :
      (t.state || "active").toLowerCase() === "closed" ? "closed" : "active";
    if (state === "closed") continue; // skip closed programs
    // A program that offers bounties is a BBP; swag-only / no bounties → VDP
    const isBBP = t.offers_bounties === true;

    // ---- Metrics (all live from GraphQL) ----
    const sla = t.most_recent_sla_snapshot || {};
    const avgRespHrs =
      typeof sla.average_time_to_first_program_response === "number"
        ? sla.average_time_to_first_program_response
        : undefined;
    const avgResHrs =
      typeof sla.average_time_to_report_resolved === "number"
        ? sla.average_time_to_report_resolved
        : undefined;
    const avgBountyLow = t.average_bounty_lower_amount;
    const avgBountyHigh = t.average_bounty_upper_amount;
    const avgBounty =
      avgBountyLow && avgBountyHigh
        ? Math.round((avgBountyLow + avgBountyHigh) / 2)
        : avgBountyLow || avgBountyHigh || undefined;
    const maxBounty =
      t.maximum_bounty_table_value ?? t.top_bounty_upper_amount ?? undefined;
    const totalPaid = parseFormattedMoney(t.formatted_total_bounties_paid_amount);
    const resolved = t.resolved_report_count || undefined;
    const acceptance = t.response_efficiency_percentage || undefined;

    // Build full in-scope + out-of-scope from HackerOne structured_scopes
    const inScope: ProgramAsset[] = [];
    const outScope: ProgramAsset[] = [];
    const scopesEdges = t.structured_scopes?.edges || [];
    for (const se of scopesEdges) {
      const sn = se?.node;
      if (!sn) continue;
      const val: string = (sn.asset_identifier || "").trim();
      if (!val) continue;
      const aType = (sn.asset_type || "").toString().toUpperCase();
      let kind: ProgramAsset["type"] = "other";
      // HackerOne asset types: URL, DOMAIN, IP_ADDRESS, CIDR, APPLE_APP_ID, GOOGLE_PLAY_APP_ID, WINDOWS_APP_STORE_APP_ID, OTHER
      if (aType === "URL") kind = "url";
      else if (aType === "DOMAIN") kind = "domain";
      else if (aType === "IP_ADDRESS") kind = "ip";
      else if (aType === "CIDR") kind = "cidr";
      else if (aType.includes("APP")) kind = "mobile";
      else kind = classifyAsset(val).type;
      const asset: ProgramAsset = {
        value: val,
        type: kind,
        instructions: sn.instruction || undefined,
      };
      // eligible_for_submission === false → out-of-scope
      if (sn.eligible_for_submission === false) {
        outScope.push(asset);
      } else {
        inScope.push(asset);
      }
    }

    // Fallback: if no scope rows, infer from website URL
    if (inScope.length === 0 && t.website) {
      try {
        const u = new URL(t.website);
        inScope.push({ value: u.hostname.replace(/^www\./, ""), type: "domain" });
      } catch {
        inScope.push({ value: t.website, type: classifyAsset(t.website).type });
      }
    }

    out.push({
      name,
      platform: "hackerone",
      externalId: handle,
      type: isBBP ? "bbp" : "vdp",
      state,
      url: `https://hackerone.com/${handle}`,
      logo: undefined,
      industry: t.industry || undefined,
      languages: [],
      region: undefined,
      maxBounty,
      avgBounty,
      totalPaid,
      resolvedReports: resolved,
      avgResponseHrs: avgRespHrs,
      avgResolutionHrs: avgResHrs,
      acceptanceRate: acceptance,
      inScope,
      outScope,
      policy: t.about || undefined,
      firstSeenAt: t.started_accepting_at || undefined,
    });
  }
  return out;
}

// ----------------------------------------------------------------------------
// Bugcrowd — JSON listing at /programs?format=json (paginated)
// ----------------------------------------------------------------------------
async function fetchBugcrowd(): Promise<RawProgram[]> {
  const out: RawProgram[] = [];
  let page = 1;
  let totalCount = 0;
  const maxPages = 12; // safety: 12 * 24 = 288 programs max

  while (page <= maxPages) {
    const url = `https://bugcrowd.com/programs?format=json&page=${page}`;
    const res = await safeFetch(url, {}, 20000);
    if (!res.ok) {
      if (page === 1) throw new Error(`HTTP ${res.status}`);
      break; // stop paginating
    }
    const json: any = await res.json().catch(() => null);
    if (!json) break;
    const engagements: any[] = json.engagements || [];
    if (!engagements.length) break;
    totalCount = json.paginationMeta?.totalCount || totalCount;

    for (const e of engagements) {
      const briefUrl: string = e.briefUrl || "";
      const handle: string = (briefUrl.split("/").pop() || e.name || "")
        .toString()
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
      if (!handle) continue;
      const isPrivate = e.isPrivate === true;
      const isVDP = (e.productEngagementType?.label || "").toLowerCase().includes("vdp");
      const type: ProgramType = isPrivate ? "private" : isVDP ? "vdp" : "bbp";
      const state: ProgramState =
        e.accessStatus === "open" ? "active" :
        e.accessStatus === "closed" || e.endsAt ? "closed" : "paused";

      const reward = e.rewardSummary || {};
      const maxB = normalizeMoney(reward.maxReward || moneyFromString(reward.summary || ""));
      const minB = normalizeMoney(reward.minReward);
      // Try to derive the program URL — Bugcrowd engagements have briefUrl like /engagements/<handle>
      const url = briefUrl ? `https://bugcrowd.com${briefUrl}` : `https://bugcrowd.com/programs/${handle}`;

      out.push({
        name: e.name || handle,
        platform: "bugcrowd",
        externalId: `bugcrowd:${handle}`,
        type,
        state,
        url,
        logo: e.logoUrl || undefined,
        industry: e.industryName || undefined,
        languages: [],
        maxBounty: maxB,
        avgBounty: minB && maxB ? Math.round((minB + maxB) / 2) : undefined,
        inScope: [], // Bugcrowd's public format=json listing doesn't expose scope per engagement
        outScope: [],
        policy: e.tagline || undefined,
      });
    }
    if (engagements.length < 24) break;
    page++;
    // Stop early if we've fetched more than what paginationMeta says exists
    if (totalCount && out.length >= totalCount) break;
  }
  return out;
}

// ----------------------------------------------------------------------------
// YesWeHack — REST API at api.yeswehack.com/programs
// ----------------------------------------------------------------------------
async function fetchYesWeHack(): Promise<RawProgram[]> {
  const out: RawProgram[] = [];
  // YesWeHack returns 42 items per page. We'll fetch first 5 pages (max 210 programs).
  for (let page = 1; page <= 5; page++) {
    const url = `https://api.yeswehack.com/programs?page=${page}`;
    const res = await safeFetch(url, {}, 20000);
    if (!res.ok) {
      if (page === 1) throw new Error(`HTTP ${res.status}`);
      break;
    }
    const json: any = await res.json().catch(() => null);
    if (!json) break;
    const items: any[] = json.items || [];
    if (!items.length) break;
    const nbPages = json.pagination?.nb_pages || 1;
    for (const p of items) {
      const handle: string = p.slug || String(p.id || p.pid || p.name);
      if (!handle) continue;
      const type: ProgramType =
        p.bounty === true ? "bbp" :
        p.vdp === true ? "vdp" :
        p.type === "bug-bounty" ? "bbp" : "vdp";
      const state: ProgramState =
        (p.status || "V").toString().toUpperCase() === "V" ? "active" :
        (p.status || "").toString().toUpperCase() === "C" ? "closed" : "paused";
      const maxB = normalizeMoney(p.bounty_reward_max);
      const minB = normalizeMoney(p.bounty_reward_min);
      // YesWeHack exposes real response-time metrics in the listing payload:
      // average_first_response_time (hours) + reports_count
      const avgRespHrs = normalizeHours(p.average_first_response_time);
      const reportsCount = normalizeMoney(p.reports_count);
      const scopesCount = normalizeMoney(p.scopes_count);
      // YesWeHack 'thumbnail' is an object: { url, name, mime_type, size }
      const logo =
        typeof p.thumbnail === "string"
          ? p.thumbnail
          : p.thumbnail?.url || undefined;
      out.push({
        name: p.title || p.name || handle,
        platform: "yeswehack",
        externalId: `yeswehack:${handle}`,
        type,
        state,
        url: `https://yeswehack.com/programs/${handle}`,
        logo,
        industry: p.activity_area || undefined,
        languages: [],
        region: p.country || undefined,
        maxBounty: maxB,
        avgBounty: minB && maxB ? Math.round((minB + maxB) / 2) : undefined,
        avgResponseHrs: avgRespHrs,
        resolvedReports: reportsCount || undefined,
        inScope: [], // YesWeHack's listing endpoint doesn't include per-scope targets
        outScope: [],
        policy: undefined,
        scopeUpdated: p.last_update_at || undefined,
        firstSeenAt: undefined,
        ...(scopesCount ? { scopeCountHint: scopesCount } : {}),
      });
    }
    if (page >= nbPages) break;
  }
  return out;
}

// ----------------------------------------------------------------------------
// Immunefi — Community mirror (Cache-and-Burn/projects.json)
// ----------------------------------------------------------------------------
async function fetchImmunefi(): Promise<RawProgram[]> {
  // Immunefi.com has no public JSON API. The Cache-and-Burn GitHub mirror
  // periodically snapshots the Immunefi bug bounty list (including scope,
  // rewards, and policy) as projects.json.
  const res = await safeFetch(
    "https://raw.githubusercontent.com/Cache-and-Burn/Immunefi-Bug-Bounty-Programs-Unofficial/main/projects.json",
    {},
    30000,
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json: any = await res.json().catch(() => null);
  if (!json) throw new Error("Invalid JSON");
  const items: any[] = Array.isArray(json) ? json : (json.projects || json.data || []);
  const out: RawProgram[] = [];

  for (const p of items) {
    const handle: string = p.id || p.slug || p.name;
    if (!handle) continue;
    const inScope: ProgramAsset[] = [];
    const outScope: ProgramAsset[] = [];
    for (const s of p.scope || p.targets || p.assets || []) {
      const target = s.target || s.url || s.value || s.smartContract || s.address || "";
      if (!target) continue;
      const asset: ProgramAsset = {
        value: target,
        type: classifyAsset(target).type,
        instructions: s.description || undefined,
      };
      if (s.inScope === false || s.in_scope === false) outScope.push(asset);
      else inScope.push(asset);
    }
    const maxB = normalizeMoney(p.maxBounty || p.maximum_payout || p.payouts?.max);
    const avgB = normalizeMoney(p.averageBounty || p.payouts?.average);
    // Defensive logo extraction — some Immunefi entries have a logo object
    const logo =
      typeof p.logo === "string"
        ? p.logo
        : typeof p.icon === "string"
          ? p.icon
          : p.logo?.url || p.icon?.url || undefined;
    out.push({
      name: p.project || p.name || p.title || handle,
      platform: "immunefi",
      externalId: `immunefi:${handle}`,
      type: "web3",
      state: (p.status || "active").toLowerCase() === "active" ? "active" : "paused",
      url: p.url || `https://immunefi.com/bounty/${handle}`,
      logo,
      industry: "Web3 / Blockchain",
      languages: [],
      maxBounty: maxB,
      avgBounty: avgB,
      inScope,
      outScope,
      policy: p.description || p.about || undefined,
      firstSeenAt: p.launched_at || p.created_at || undefined,
    });
  }
  return out;
}

// ----------------------------------------------------------------------------
// Intigriti — researcher API (requires saved session cookie)
// Intigriti locks its program listing behind researcher authentication. When
// a session cookie is saved (Global Settings → Platform Accounts), we call the same
// researcher API the web app uses. Without a session, we surface an honest
// error asking the user to connect their account.
// ----------------------------------------------------------------------------
interface IntigritiProgram {
  id?: string;
  handle?: string;
  name?: string;
  status?: { name?: string; handle?: string } | string;
  confidentiality?: { handle?: string } | string;
  severity?: { name?: string } | string;
  maxBounty?: { value?: number; currency?: string } | number;
  avgBounty?: { value?: number } | number;
  domains?: { name?: string; tier?: number }[];
  bountyTable?: { link?: string };
}

function intigritiStatusName(p: any): string {
  const s = p?.status;
  if (!s) return "opened";
  if (typeof s === "string") return s.toLowerCase();
  return (s.name || s.handle || "opened").toString().toLowerCase();
}

async function fetchIntigriti(): Promise<RawProgram[]> {
  const cookie = await getPlatformCookie("intigriti");
  if (!cookie) {
    throw new Error(
      "Intigriti requires login — connect your account in Global Settings → Platform Accounts to load programs",
    );
  }

  const out: RawProgram[] = [];
  // Researcher API listing — same endpoint the web app calls
  for (let page = 0; page < 10; page++) {
    const res = await safeFetch(
      `https://app.intigriti.com/api/researcher/v1/programs?page=${page}&size=50`,
      {
        headers: {
          Cookie: cookie,
          Accept: "application/json, text/plain, */*",
          Referer: "https://app.intigriti.com/researcher/programs",
          "X-Requested-With": "XMLHttpRequest",
        },
      },
      20000,
    );
    if (res.status === 401 || res.status === 403) {
      throw new Error("Intigriti session expired — refresh the cookie in Global Settings → Platform Accounts");
    }
    const ct = res.headers.get("content-type") || "";
    if (!res.ok || !ct.includes("application/json")) {
      if (page === 0) {
        throw new Error("Intigriti session not recognized — re-copy the Cookie header while signed in");
      }
      break;
    }
    const data: any = await res.json().catch(() => null);
    if (!data) break;
    const records: IntigritiProgram[] = data.records || data.items || data.content || data;
    if (!Array.isArray(records) || records.length === 0) break;

    for (const p of records) {
      const handle: string = (p.handle || p.id || "").toString();
      if (!handle) continue;
      const statusName = intigritiStatusName(p);
      const state: ProgramState =
        statusName.includes("close") ? "closed" :
        statusName.includes("pause") || statusName.includes("draft") ? "paused" : "active";
      if (state === "closed") continue;
      const confidentiality =
        typeof p.confidentiality === "string"
          ? p.confidentiality
          : p.confidentiality?.handle || "public";
      const type: ProgramType = confidentiality === "invitation" ? "private" : "bbp";
      const maxB =
        typeof p.maxBounty === "number" ? p.maxBounty : p.maxBounty?.value;
      const avgB =
        typeof p.avgBounty === "number" ? p.avgBounty : p.avgBounty?.value;
      out.push({
        name: p.name || handle,
        platform: "intigriti",
        externalId: `intigriti:${handle}`,
        type,
        state,
        url: `https://app.intigriti.com/programs/${handle}`,
        maxBounty: maxB || undefined,
        avgBounty: avgB || undefined,
        inScope: [], // scope is fetched per-program on detail view
        outScope: [],
      });
    }

    const totalPages = data.totalPages || data.pages || data.pagination?.nb_pages;
    if (totalPages && page + 1 >= totalPages) break;
    if (records.length < 50) break;
  }
  if (out.length === 0) {
    throw new Error("Intigriti returned no programs — check the session cookie");
  }
  return out;
}

// ----------------------------------------------------------------------------
// disclose.io — VDP registry directory (static HTML, fully public)
// ----------------------------------------------------------------------------
const DISCLOSE_DIR_URL = "https://directory.disclose.io/";
const DISCLOSE_PAGES = 4; // 25 rows/page → 100 most recent registry entries

/** Extract the registrable domain from a policy URL (e.g. https://a.b.com/x → b.com). */
function domainFromPolicyUrl(policyUrl: string): string | null {
  try {
    const u = new URL(policyUrl);
    const host = u.hostname.replace(/^www\./i, "");
    if (!host || !host.includes(".")) return null;
    return host;
  } catch {
    return null;
  }
}

/**
 * Derive the organization's own domain for a disclose.io entry.
 * Priority: contact e-mail domain (the org's real domain) > policy-URL domain,
 * and only when that domain actually matches the org name (normalized) —
 * some policies are hosted on unrelated domains (e.g. a parent company),
 * and we never guess scope from a mismatched host.
 */
function discloseOrgDomain(
  orgName: string,
  policyUrl: string,
  contact: string,
): { domain: string; source: string } | null {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const org = norm(orgName);
  if (!org) return null;

  const emailDomain = contact.includes("@")
    ? contact.split("@").pop()!.trim().toLowerCase()
    : null;
  if (emailDomain && emailDomain.includes(".") && norm(emailDomain).includes(org.slice(0, Math.max(4, org.length - 2)))) {
    return { domain: emailDomain, source: `contact ${contact}` };
  }

  const policyDomain = domainFromPolicyUrl(policyUrl);
  if (policyDomain && norm(policyDomain).includes(org.slice(0, Math.max(4, org.length - 2)))) {
    return { domain: policyDomain, source: `policy ${policyUrl}` };
  }

  // Email domain present but org name doesn't match either host — trust the
  // e-mail domain only when the policy host also fails to match (VDP e-mail is
  // published by the org itself, so it is the safer identifier).
  if (emailDomain && !policyDomain) {
    return { domain: emailDomain, source: `contact ${contact}` };
  }
  return null;
}

function parseDiscloseDirectory(html: string): RawProgram[] {
  const out: RawProgram[] = [];
  // Each data row: <tr> <td class="org-name"…><a href="/o/{slug}" title="{name}">…
  //                 <td class="policy-col"…><a href="{policyUrl}" title="{policyUrl}">
  //                 <td class="contact-col"…><span title="{contact}">
  //                 <td class="maturity-col"…><span class="m-badge …" title="Maturity Score: {n}%">{label}
  const rowRe =
    /<td class="org-name"[^>]*>\s*<a href="(\/o\/[^"]+)"[^>]*title="([^"]*)"[^>]*>([\s\S]*?)<\/td>\s*<td class="policy-col"[\s\S]*?<a href="([^"]*)"[^>]*title="([^"]*)"[\s\S]*?<td class="contact-col"[^>]*>\s*<span title="([^"]*)"[\s\S]*?<td class="maturity-col"[^>]*>\s*<span class="m-badge[^"]*"[^>]*title="[^"]*"[^>]*>([^<]*)<\/span>/g;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html)) !== null) {
    const slug = m[1];
    const name = (m[3] || m[2] || "").replace(/<[^>]+>/g, "").trim() || m[2].trim();
    const policyUrl = m[4];
    const contact = m[6]?.trim() || "";
    const maturityLabel = (m[7] || "").trim();

    if (!slug || !name) continue;
    const handle = slug.replace(/^\/o\//, "");
    const org = discloseOrgDomain(name, policyUrl, contact);
    const inScope: ProgramAsset[] = org
      ? [{ value: `*.${org.domain}`, type: "wildcard", instructions: `Derived from the org's published VDP (${org.source}); full scope is defined in the policy` }]
      : [];
    out.push({
      name,
      platform: "disclose",
      externalId: `disclose:${handle}`,
      type: "vdp",
      url: `https://directory.disclose.io${slug}`,
      state: "active",
      industry: `VDP registry — maturity: ${maturityLabel || "unknown"}`,
      inScope,
      outScope: [],
      policy: policyUrl || undefined,
      scopeCountHint: org ? 1 : 0,
    });
  }
  return out;
}

async function fetchDisclose(): Promise<RawProgram[]> {
  const collected = new Map<string, RawProgram>();
  // Fetch pages sequentially with a small delay — static Hugo site, be polite.
  for (let page = 1; page <= DISCLOSE_PAGES; page++) {
    try {
      const res = await safeFetch(
        page === 1 ? DISCLOSE_DIR_URL : `${DISCLOSE_DIR_URL}?page=${page}`,
        { headers: { Accept: "text/html" } },
        20000,
      );
      if (!res.ok) break;
      const html = await res.text();
      const rows = parseDiscloseDirectory(html);
      for (const p of rows) {
        if (!collected.has(p.externalId)) collected.set(p.externalId, p);
      }
      if (rows.length === 0) break; // no more pages
    } catch {
      break; // keep whatever we already collected
    }
  }
  if (collected.size === 0) {
    throw new Error("disclose.io directory unreachable or parse failed");
  }
  return [...collected.values()];
}

// ----------------------------------------------------------------------------
// Orchestrator — fetch from all sources, isolate failures
// ----------------------------------------------------------------------------
export async function fetchAllPrograms(): Promise<{
  programs: RawProgram[];
  results: FetchResult[];
}> {
  const fetchers: { platform: PlatformKind; fn: () => Promise<RawProgram[]> }[] = [
    { platform: "hackerone", fn: fetchHackerOne },
    { platform: "bugcrowd", fn: fetchBugcrowd },
    { platform: "intigriti", fn: fetchIntigriti },
    { platform: "yeswehack", fn: fetchYesWeHack },
    { platform: "immunefi", fn: fetchImmunefi },
    { platform: "disclose", fn: fetchDisclose },
  ];

  const results: FetchResult[] = [];
  const collected: RawProgram[] = [];

  await Promise.all(
    fetchers.map(async ({ platform, fn }) => {
      const t0 = Date.now();
      try {
        const programs = await fn();
        const dedup = new Map<string, RawProgram>();
        for (const p of programs) {
          if (!dedup.has(p.externalId)) {
            dedup.set(p.externalId, p);
            collected.push(p);
          }
        }
        results.push({
          platform,
          ok: true,
          count: dedup.size,
          durationMs: Date.now() - t0,
        });
      } catch (err: any) {
        results.push({
          platform,
          ok: false,
          count: 0,
          error: err?.message || String(err),
          durationMs: Date.now() - t0,
        });
      }
    }),
  );

  return { programs: collected, results };
}

// ============================================================================
// PER-PROGRAM LIVE SCOPE FETCHERS
// ----------------------------------------------------------------------------
// These are called on-demand when a user opens the program detail page and
// the cached scope is empty. They fetch live scope data from each platform
// directly, ensuring that the displayed scope targets are always real.
// ============================================================================

export interface ScopeResult {
  inScope: ProgramAsset[];
  outScope: ProgramAsset[];
  policy?: string;
  /** Live metrics refreshed alongside scope (persisted back to the DB). */
  metrics?: ProgramMetrics;
}

export interface ProgramMetrics {
  maxBounty?: number;
  avgBounty?: number;
  totalPaid?: number;
  resolvedReports?: number;
  avgResponseHrs?: number;
  avgResolutionHrs?: number;
  acceptanceRate?: number;
  industry?: string;
}

// ----------------------------------------------------------------------------
// HackerOne — per-program scope + metrics via GraphQL `team(handle:)` query
// ----------------------------------------------------------------------------
export async function fetchHackerOneScope(handle: string): Promise<ScopeResult> {
  const cleaned = handle.replace(/^hackerone:/i, "");
  const cookie = await getPlatformCookie("hackerone");
  const query = `query TeamScope($handle: String!) {
    team(handle: $handle) {
      id
      about
      industry
      resolved_report_count
      response_efficiency_percentage
      formatted_total_bounties_paid_amount
      average_bounty_lower_amount
      average_bounty_upper_amount
      maximum_bounty_table_value
      most_recent_sla_snapshot {
        average_time_to_first_program_response
        average_time_to_report_resolved
      }
      structured_scopes(first: 500) {
        edges {
          node {
            id
            asset_identifier
            asset_type
            eligible_for_bounty
            eligible_for_submission
            instruction
          }
        }
      }
    }
  }`;
  const res = await safeFetch("https://hackerone.com/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify({ query, variables: { handle: cleaned } }),
  }, 20000);
  if (!res.ok) throw new Error(`HackerOne HTTP ${res.status}`);
  const json = await res.json();
  if (json.errors && json.errors.length) {
    throw new Error(`HackerOne GraphQL: ${json.errors[0].message}`);
  }
  const team = json?.data?.team;
  if (!team) throw new Error("HackerOne program not found");
  const inScope: ProgramAsset[] = [];
  const outScope: ProgramAsset[] = [];
  for (const edge of team.structured_scopes?.edges || []) {
    const sn = edge?.node;
    if (!sn) continue;
    const val = (sn.asset_identifier || "").trim();
    if (!val) continue;
    const aType = (sn.asset_type || "").toString().toUpperCase();
    let kind: ProgramAsset["type"] = "other";
    if (aType === "URL") kind = "url";
    else if (aType === "DOMAIN") kind = "domain";
    else if (aType === "IP_ADDRESS") kind = "ip";
    else if (aType === "CIDR") kind = "cidr";
    else if (aType.includes("APP")) kind = "mobile";
    else kind = classifyAsset(val).type;
    const asset: ProgramAsset = {
      value: val,
      type: kind,
      instructions: sn.instruction || undefined,
    };
    if (sn.eligible_for_submission === false) outScope.push(asset);
    else inScope.push(asset);
  }
  const sla = team.most_recent_sla_snapshot || {};
  const metrics: ProgramMetrics = {
    industry: team.industry || undefined,
    resolvedReports: team.resolved_report_count || undefined,
    acceptanceRate: team.response_efficiency_percentage || undefined,
    totalPaid: parseFormattedMoney(team.formatted_total_bounties_paid_amount),
    avgBounty:
      team.average_bounty_lower_amount && team.average_bounty_upper_amount
        ? Math.round((team.average_bounty_lower_amount + team.average_bounty_upper_amount) / 2)
        : team.average_bounty_lower_amount || team.average_bounty_upper_amount || undefined,
    maxBounty: team.maximum_bounty_table_value ?? undefined,
    avgResponseHrs: normalizeHours(sla.average_time_to_first_program_response),
    avgResolutionHrs: normalizeHours(sla.average_time_to_report_resolved),
  };
  return { inScope, outScope, policy: team.about || undefined, metrics };
}

// ----------------------------------------------------------------------------
// Bugcrowd — per-program brief scope via the tracker API
// The tracker API (tracker.bugcrowd.com/api/engagements/<slug>) requires an
// authenticated researcher session. When the user has saved their Bugcrowd
// session cookie (Global Settings → Platform Accounts), we fetch the full brief
// including the challenges (scope) array. Without a session we surface a
// clear actionable error instead of fake data.
// ----------------------------------------------------------------------------
export async function fetchBugcrowdScope(handle: string): Promise<ScopeResult> {
  const slug = handle.replace(/^bugcrowd:/i, "").replace(/^engagements?\//i, "");
  const cookie = await getPlatformCookie("bugcrowd");

  // Authenticated path — tracker API returns the engagement brief JSON
  if (cookie) {
    try {
      const res = await safeFetch(
        `https://tracker.bugcrowd.com/api/engagements/${slug}`,
        {
          headers: {
            Cookie: cookie,
            Accept: "application/json",
            Referer: "https://bugcrowd.com/",
            "X-Requested-With": "XMLHttpRequest",
          },
        },
        25000,
      );
      if (res.status === 401 || res.status === 403) {
        throw new Error(
          "Bugcrowd session expired — refresh the session cookie in Global Settings → Platform Accounts",
        );
      }
      if (res.ok) {
        const ct = res.headers.get("content-type") || "";
        if (ct.includes("application/json")) {
          const data: any = await res.json().catch(() => null);
          if (data) {
            const parsed = parseBugcrowdBrief(data);
            if (parsed.inScope.length || parsed.outScope.length) {
              return parsed;
            }
          }
        }
      }
    } catch (e: any) {
      if (e?.message?.includes("session expired")) throw e;
      // fall through to the unauthenticated attempts below
    }
  }

  // Unauthenticated fallbacks — public JSON endpoints (rare, legacy briefs)
  const endpoints = [
    `https://bugcrowd.com/programs/${slug}.json`,
    `https://bugcrowd.com/engagements/${slug}`,
  ];

  let lastErr: any = null;
  for (const url of endpoints) {
    try {
      const res = await safeFetch(url, { headers: { Accept: "application/json,text/html,*/*" } }, 20000);
      if (!res.ok) { lastErr = new Error(`HTTP ${res.status}`); continue; }
      const ct = res.headers.get("content-type") || "";
      if (ct.includes("application/json")) {
        const data: any = await res.json().catch(() => null);
        if (!data) continue;
        const parsed = parseBugcrowdBrief(data);
        if (parsed.inScope.length || parsed.outScope.length) {
          return parsed;
        }
      }
    } catch (e: any) {
      lastErr = e;
      continue;
    }
  }
  // Bugcrowd's public unauthenticated API does not expose scope targets.
  // Surface a clear, actionable error so the UI can guide the user to sign
  // in via Global Settings → Platform Accounts.
  throw new Error(
    "Bugcrowd requires authentication to view program scope. Save your Bugcrowd session cookie in Global Settings → Platform Accounts (or the login prompt in Program Discovery) to load live scope data.",
  );
}

/**
 * Parse a Bugcrowd engagement brief payload into scope assets.
 * Handles both the tracker API shape ({ brief: { challenges: [...] } }) and
 * legacy flat shapes ({ targets: [...], excluded_targets: [...] }).
 */
function parseBugcrowdBrief(data: any): ScopeResult {
  const inScope: ProgramAsset[] = [];
  const outScope: ProgramAsset[] = [];

  // Tracker API shape: challenges[] with target_to_hit + submission_state
  const challenges: any[] =
    data?.brief?.challenges || data?.challenges || [];
  for (const c of challenges) {
    const v = (c.target_to_hit || c.target || c.url || "").toString().trim();
    if (!v) continue;
    const submissionState = (c.submission_state || "").toString().toLowerCase();
    const eligible =
      c.eligible_for_bounty !== false && c.eligible_for_submission !== false;
    const asset: ProgramAsset = {
      value: v,
      type: classifyAsset(v).type,
      instructions: c.description || undefined,
    };
    if (submissionState === "disabled" || (!eligible && submissionState === "")) {
      outScope.push(asset);
    } else {
      inScope.push(asset);
    }
  }

  // Legacy flat shapes
  const targets =
    data?.targets || data?.scope?.targets || data?.brief?.targets || [];
  const excluded =
    data?.excluded_targets ||
    data?.excludedTargets ||
    data?.scope?.excluded_targets ||
    data?.brief?.excluded_targets ||
    [];
  for (const t of targets) {
    const v = (t.target || t.value || t.url || t.asset || "").toString().trim();
    if (!v) continue;
    inScope.push({
      value: v,
      type: classifyAsset(v).type,
      instructions: t.description || t.instruction || undefined,
    });
  }
  for (const t of excluded) {
    const v = (t.target || t.value || t.url || t.asset || "").toString().trim();
    if (!v) continue;
    outScope.push({
      value: v,
      type: classifyAsset(v).type,
      instructions: t.description || t.instruction || undefined,
    });
  }

  // Policy text from the brief description
  const policy =
    data?.brief?.description ||
    data?.engagement?.brief_description ||
    data?.description ||
    undefined;

  return { inScope, outScope, policy };
}

// ----------------------------------------------------------------------------
// YesWeHack — per-program scope via api.yeswehack.com/programs/<slug>
// YesWeHack embeds the scope array directly in the program detail payload
// under `scopes` (with each entry containing `scope`, `scope_type`,
// `scope_type_name`, `asset_value`) and `out_of_scope`.
// ----------------------------------------------------------------------------
export async function fetchYesWeHackScope(slug: string): Promise<ScopeResult> {
  const cleaned = slug.replace(/^yeswehack:/i, "");
  const res = await safeFetch(`https://api.yeswehack.com/programs/${cleaned}`, {}, 20000);
  if (!res.ok) throw new Error(`YesWeHack HTTP ${res.status}`);
  const data: any = await res.json().catch(() => null);
  if (!data) throw new Error("YesWeHack invalid JSON");
  const inScope: ProgramAsset[] = [];
  const outScope: ProgramAsset[] = [];

  // YesWeHack `scopes` is an array of { scope, scope_type, scope_type_name, asset_value, report_count }
  for (const s of data.scopes || []) {
    const val = (s.scope || s.target || s.url || s.value || s.hostname || "").toString().trim();
    if (!val) continue;
    // Determine the asset kind from scope_type when possible
    const scopeType = (s.scope_type || "").toString().toLowerCase();
    let kind: ProgramAsset["type"] = classifyAsset(val).type;
    if (scopeType.includes("api")) kind = "api";
    else if (scopeType.includes("mobile") || scopeType.includes("android") || scopeType.includes("ios")) kind = "mobile";
    else if (scopeType.includes("ip")) kind = classifyAsset(val).type;
    inScope.push({
      value: val,
      type: kind,
      instructions: s.scope_type_name ? `${s.scope_type_name} (asset value: ${s.asset_value || "N/A"})` : undefined,
    });
  }

  // YesWeHack `out_of_scope` is an array of strings or { scope } objects
  for (const s of data.out_of_scope || []) {
    const val = typeof s === "string" ? s : (s.scope || s.target || s.value || "").toString().trim();
    if (!val) continue;
    outScope.push({
      value: val,
      type: classifyAsset(val).type,
      instructions: typeof s === "object" ? s.scope_type_name : undefined,
    });
  }

  // YesWeHack `stats` carries live reward + response metrics
  const st = data.stats || {};
  const metrics: ProgramMetrics = {
    maxBounty: normalizeMoney(st.max_reward) ?? normalizeMoney(data.bounty_reward_max),
    avgBounty: normalizeMoney(st.average_reward) ?? undefined,
    resolvedReports: normalizeMoney(st.total_reports) ?? undefined,
    avgResponseHrs: normalizeHours(st.average_first_time_response),
  };

  return {
    inScope,
    outScope,
    policy: data.rules || data.description || data.about || undefined,
    metrics,
  };
}

// ----------------------------------------------------------------------------
// Intigriti — per-program scope via the researcher API (auth required)
// ----------------------------------------------------------------------------
export async function fetchIntigritiScope(handle: string): Promise<ScopeResult> {
  const cleaned = handle.replace(/^intigriti:/i, "");
  const cookie = await getPlatformCookie("intigriti");
  if (!cookie) {
    throw new Error(
      "Intigriti requires login — connect your account in Global Settings → Platform Accounts to load program scope",
    );
  }
  const res = await safeFetch(
    `https://app.intigriti.com/api/researcher/v1/programs/${cleaned}`,
    {
      headers: {
        Cookie: cookie,
        Accept: "application/json, text/plain, */*",
        Referer: `https://app.intigriti.com/programs/${cleaned}`,
        "X-Requested-With": "XMLHttpRequest",
      },
    },
    20000,
  );
  if (res.status === 401 || res.status === 403) {
    throw new Error("Intigriti session expired — refresh the cookie in Global Settings → Platform Accounts");
  }
  const ct = res.headers.get("content-type") || "";
  if (!res.ok || !ct.includes("application/json")) {
    throw new Error("Intigriti session not recognized — re-copy the Cookie header while signed in");
  }
  const data: any = await res.json().catch(() => null);
  if (!data) throw new Error("Intigriti invalid JSON response");

  const inScope: ProgramAsset[] = [];
  const outScope: ProgramAsset[] = [];
  // Researcher API payload: domains[] (tier 1/2 = scope), content[].domains[],
  // and out_of_scope / excluded lists depending on the payload version.
  for (const d of data.domains || []) {
    const v = (d.name || d.domain || d.value || "").toString().trim();
    if (!v) continue;
    const tier = d.tier ?? 1;
    const asset: ProgramAsset = {
      value: v,
      type: classifyAsset(v).type,
      instructions: d.description || undefined,
    };
    if (tier >= 3 || d.enabled === false || d.inScope === false) outScope.push(asset);
    else inScope.push(asset);
  }
  // Some payload versions nest scope under content[] entries
  for (const c of data.content || []) {
    for (const d of c?.domains || []) {
      const v = (d.name || d.domain || d.value || "").toString().trim();
      if (!v) continue;
      if (inScope.some((a) => a.value === v) || outScope.some((a) => a.value === v)) continue;
      const tier = d.tier ?? 1;
      const asset: ProgramAsset = {
        value: v,
        type: classifyAsset(v).type,
        instructions: d.description || c.description || undefined,
      };
      if (tier >= 3 || d.enabled === false || d.inScope === false) outScope.push(asset);
      else inScope.push(asset);
    }
  }
  // Explicit out-of-scope entries when present
  for (const s of data.out_of_scope || data.outOfScope || []) {
    const v = (s.name || s.domain || s.value || s.target || "").toString().trim();
    if (!v) continue;
    if (inScope.some((a) => a.value === v)) continue;
    outScope.push({ value: v, type: classifyAsset(v).type });
  }

  const metrics: ProgramMetrics = {
    maxBounty:
      typeof data.maxBounty === "number" ? data.maxBounty : data.maxBounty?.value || undefined,
    avgBounty:
      typeof data.avgBounty === "number" ? data.avgBounty : data.avgBounty?.value || undefined,
  };

  return {
    inScope,
    outScope,
    policy: data.description || data.rules || undefined,
    metrics,
  };
}

// ----------------------------------------------------------------------------
// Immunefi — per-program scope via embedded JSON on the bounty HTML page
// Immunefi's bounty page embeds a JS object literal like {\"bounty\":{...}} in
// the rendered HTML. Inside the bounty object, `assets[]` lists scope items
// with fields like { url, type, description }. Each URL points to a contract
// on etherscan/solscan/etc. We extract these as in-scope assets.
// ----------------------------------------------------------------------------
export async function fetchImmunefiScope(handle: string): Promise<ScopeResult> {
  const cleaned = handle.replace(/^immunefi:/i, "");
  // Try the bounty page first; fall back to bug-bounty path
  const urls = [
    `https://immunefi.com/bounty/${cleaned}`,
    `https://immunefi.com/bug-bounty/${cleaned}`,
  ];
  let html = "";
  let fetched = false;
  for (const u of urls) {
    try {
      const res = await safeFetch(u, { headers: { Accept: "text/html" } }, 25000);
      if (!res.ok) continue;
      const t = await res.text();
      if (t && t.length > 1000) {
        html = t;
        fetched = true;
        break;
      }
    } catch { /* try next */ }
  }
  if (!fetched) throw new Error(`Immunefi bounty page not reachable for "${cleaned}"`);

  // Find the embedded {\"bounty\":...} JSON literal
  const marker = '{\\"bounty\\":';
  const markerIdx = html.indexOf(marker);
  if (markerIdx === -1) {
    // Try alternative marker — some pages use {"bounty": (without escaped quotes)
    const altIdx = html.indexOf('{"bounty":');
    if (altIdx === -1) {
      throw new Error("Immunefi scope JSON not embedded on the bounty page");
    }
    // Walk to find matching closing brace
    const raw = extractBalancedBraces(html, altIdx);
    if (!raw) throw new Error("Immunefi scope JSON could not be extracted");
    return parseImmunefiBountyJson(raw);
  }
  const raw = extractBalancedBraces(html, markerIdx);
  if (!raw) throw new Error("Immunefi scope JSON could not be extracted");
  return parseImmunefiBountyJson(raw);
}

function extractBalancedBraces(src: string, startPos: number): string | null {
  let depth = 0;
  let inString = false;
  let escape = false;
  let endPos = -1;
  for (let i = startPos; i < src.length; i++) {
    const c = src[i];
    if (escape) { escape = false; continue; }
    if (c === "\\") { escape = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) { endPos = i; break; }
    }
  }
  if (endPos === -1) return null;
  return src.slice(startPos, endPos + 1);
}

function parseImmunefiBountyJson(raw: string): ScopeResult {
  // The raw string is a JS object literal embedded in HTML.
  // Unescape: \" → " (JS string escape), \<newline> → "" (JS line continuation)
  // Then JSON.parse the result.
  const clean = raw
    .replace(/\\\n/g, "")        // JS line continuation: backslash-newline → nothing
    .replace(/\\"/g, '"');        // JS string escape: \" → "
  let parsed: any;
  try {
    parsed = JSON.parse(clean);
  } catch (e: any) {
    throw new Error(`Immunefi embedded JSON parse failed: ${e.message}`);
  }
  const bounty = parsed?.bounty || parsed;
  const assets: any[] = bounty?.assets || [];
  const inScope: ProgramAsset[] = [];
  const outScope: ProgramAsset[] = [];
  for (const a of assets) {
    const url: string = (a.url || "").toString().trim();
    const type: string = (a.type || "").toString().toLowerCase();
    const desc: string = (a.description || "").toString().trim();
    if (!url && !desc) continue;
    // Immunefi assets are usually smart contracts (URL points to etherscan/etc.)
    const value = url || desc;
    const kind: ProgramAsset["type"] =
      type.includes("url") || type.includes("web") ? "url" :
      type.includes("smart_contract") || type.includes("contract") ? "url" :
      classifyAsset(value).type === "other" ? "url" :
      classifyAsset(value).type;
    const asset: ProgramAsset = {
      value,
      type: kind,
      instructions: desc || undefined,
    };
    if (type.includes("out_of_scope") || a.isOutOfScope === true) {
      outScope.push(asset);
    } else {
      inScope.push(asset);
    }
  }
  // Pull impacts as policy text (best-effort)
  const impacts: any[] = bounty?.impacts || bounty?.programImpacts || [];
  let policy: string | undefined;
  if (impacts.length) {
    policy = impacts
      .map((i) => {
        const t = (i.name || i.title || "").toString().trim();
        const d = (i.description || i.impact || "").toString().trim();
        return d ? `${t}: ${d}` : t;
      })
      .join("\n\n");
  }
  return { inScope, outScope, policy };
}

// ----------------------------------------------------------------------------
// disclose.io — per-program live scope fetcher (detail page attributes)
// ----------------------------------------------------------------------------
export async function fetchDiscloseScope(externalId: string): Promise<ScopeResult> {
  const handle = externalId.replace(/^disclose:/i, "");
  const res = await safeFetch(
    `https://directory.disclose.io/o/${handle}`,
    { headers: { Accept: "text/html" } },
    25000,
  );
  if (!res.ok) throw new Error(`disclose.io detail page returned HTTP ${res.status}`);
  const html = await res.text();
  if (!html || html.length < 1000) throw new Error("disclose.io detail page empty");

  // Maturity attribute items: <div class="mat-item" data-maturity-attr="offers_bounty" …>
  // State is carried by the label span class ("met" / "unmet") and the icon
  // (icon-check / icon-shield-with-check = met, icon-x = not met,
  //  icon-unverified = unknown). The sr-only text confirms (" — met").
  const attrs = new Map<string, boolean | null>();
  const itemRe = /<div class="mat-item"[^>]*data-maturity-attr="([a-z_]+)"[^>]*>([\s\S]*?)<\/div>/g;
  let im: RegExpExecArray | null;
  while ((im = itemRe.exec(html)) !== null) {
    const attr = im[1];
    const body = im[2];
    // "Unverified" badges mean the registry marks the claim met but could not
    // verify it — treat as unknown for honest reporting.
    if (/icon-unverified|v-unverified/.test(body)) attrs.set(attr, null);
    else if (/class="unmet"/.test(body) || /icon-x\b/.test(body)) attrs.set(attr, false);
    else if (/class="met"/.test(body) || /icon-check/.test(body) || /icon-shield/.test(body)) attrs.set(attr, true);
    else attrs.set(attr, null); // unknown
  }

  // Organization name from the page title ("Paypal - VDP Programs - disclose.io").
  const titleM = /<title>([^<]*)<\/title>/.exec(html);
  const orgName = titleM ? titleM[1].split("-")[0].trim() : "";

  // External links on the detail page — skip registry-internal links
  // (claim / sign-in) and keep the org-published ones.
  const links: string[] = [];
  const linkRe = /<a href="(https?:\/\/[^"]+)"[^>]*target="_blank"/g;
  let lm: RegExpExecArray | null;
  while ((lm = linkRe.exec(html)) !== null) {
    const u = lm[1];
    if (/disclose\.io|disclosebot\.io|users\/sign_in/i.test(u)) continue;
    if (!links.includes(u)) links.push(u);
  }
  // Prefer the security.txt link, then any other published link.
  const secTxt = links.find((u) => /security\.txt/i.test(u));
  const policyUrl = secTxt || links[0];

  // Derive the org's own domain only when it matches the org name —
  // policies are frequently hosted on third parties (HackerOne, a parent
  // company, a security vendor) and we never guess scope from those hosts.
  const org = orgName && policyUrl ? discloseOrgDomain(orgName, policyUrl, "") : null;
  const inScope: ProgramAsset[] = org
    ? [{
        value: `*.${org.domain}`,
        type: "wildcard",
        instructions: `Derived from the org's published VDP (${org.source}); full scope is defined in the policy${attrs.get("has_scope") ? " (registry confirms a defined scope)" : ""}`,
      }]
    : [];

  // Build honest policy text from the registry's own attestation flags.
  const facts: string[] = [];
  if (policyUrl) facts.push(`Published policy: ${policyUrl}`);
  if (attrs.get("offers_bounty") === true) facts.push("Registry attests: offers bounties.");
  if (attrs.get("offers_swag") === true) facts.push("Registry attests: offers swag.");
  if (attrs.get("has_full_safe_harbor") === true) facts.push("Registry attests: full safe harbor.");
  else if (attrs.get("has_safe_harbor") === true) facts.push("Registry attests: partial safe harbor.");
  if (attrs.get("has_public_disclosure") === true) facts.push("Registry attests: public disclosure permitted.");
  if (attrs.get("has_cvd_timeline") === true) facts.push("Registry attests: coordinated vulnerability disclosure timeline.");
  if (attrs.get("has_security_txt") === true) facts.push("Registry attests: security.txt published.");
  if (!org && policyUrl) facts.push("Scope targets are not machine-readable in this registry entry — read the linked policy for the authoritative scope.");
  const policy = facts.length
    ? `disclose.io registry entry for ${orgName || "this organization"}:\n- ${facts.join("\n- ")}`
    : undefined;

  return { inScope, outScope: [], policy };
}

// ----------------------------------------------------------------------------
// Dispatcher: fetch live scope for any cached program
// ----------------------------------------------------------------------------
export async function fetchLiveScope(
  platform: string,
  externalId: string,
): Promise<ScopeResult> {
  switch (platform) {
    case "hackerone":
      return fetchHackerOneScope(externalId);
    case "bugcrowd":
      return fetchBugcrowdScope(externalId);
    case "yeswehack":
      return fetchYesWeHackScope(externalId);
    case "intigriti":
      return fetchIntigritiScope(externalId);
    case "immunefi":
      return fetchImmunefiScope(externalId);
    case "disclose":
      return fetchDiscloseScope(externalId);
    default:
      return { inScope: [], outScope: [] };
  }
}
