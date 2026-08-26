// ============================================================================
// ANTLION — Platform Authentication (API-key based, project-independent)
// ----------------------------------------------------------------------------
// Bug bounty platforms expose official APIs for program + scope data. Antlion
// authenticates with the platform-issued API credentials — never with copied
// browser cookies:
//
//   • HackerOne — Hacker API (https://api.hackerone.com)
//       HTTP Basic auth: API Token identifier + API Token value.
//       Tokens are created in hackerone.com → Settings → API Tokens.
//       Unlocks: /v1/hackers/programs (incl. programs visible only to you),
//       /v1/hackers/programs/{handle}/structured_scopes, scope_exclusions.
//       Public program data keeps working without any key.
//
//   • Bugcrowd — JSON API (https://api.bugcrowd.com)
//       `Authorization: Token TOKEN_USERNAME:TOKEN_PASSWORD` with
//       `Accept: application/vnd.bugcrowd+json`.
//       Credentials are created in bugcrowd.com → profile → API Credentials.
//       Unlocks: /engagements (briefs + target groups + targets = scope).
//       The public program listing keeps working without any key.
//
//   • Intigriti — Researcher API (https://api.intigriti.com/external/researcher)
//       `Authorization: Bearer <PAT>`.
//       Personal Access Tokens are created in app.intigriti.com → profile →
//       Personal Access Tokens. Required: Intigriti program data is only
//       available through the authenticated researcher API.
//
//   • YesWeHack — fully public REST API, no researcher API keys exist
//       (their PATs are issued only to Program Manager / BU roles).
//   • Immunefi — public program data, no researcher API keys exist.
//   • disclose.io — fully public static registry.
//
// Credentials are stored ONCE in the local SQLite database (Setting key
// "platformAuth") and are therefore available to every project container /
// pipeline run. They are never sent anywhere except the platform they belong
// to.
// ============================================================================

const SETTING_KEY = "platformAuth";

import {
  PLATFORM_META,
  type PlatformId,
  type ApiKeyField,
} from "@/lib/platform-meta";

export { PLATFORM_META };
export type { PlatformId, ApiKeyField };

export interface StoredCredential {
  kind: "apikey";
  /** Field values keyed by ApiKeyField.key (e.g. { identifier, secret }). */
  fields: Record<string, string>;
  savedAt: string;
  verifiedAt?: string;
  account?: string;
}

export type AuthStore = Partial<Record<PlatformId, StoredCredential>>;

export interface AuthStatusEntry {
  platform: PlatformId;
  requiresAuth: boolean;
  authenticated: boolean;
  account?: string;
  savedAt?: string;
  verifiedAt?: string;
  hint?: string;
}

// ----------------------------------------------------------------------------
// Persistence
// ----------------------------------------------------------------------------
async function getDb() {
  const { db } = await import("@/lib/db");
  return db;
}

export async function getAuthStore(): Promise<AuthStore> {
  try {
    const db = await getDb();
    const row = await db.setting.findUnique({ where: { id: SETTING_KEY } });
    if (!row) return {};
    try {
      const parsed = JSON.parse(row.value) as AuthStore;
      // Drop credentials stored by the retired cookie-based flow — they are
      // no longer used by any fetcher and must not show as "connected".
      let changed = false;
      for (const k of Object.keys(parsed) as PlatformId[]) {
        const c = parsed[k];
        if (c && (c as any).kind !== "apikey") {
          delete parsed[k];
          changed = true;
        }
      }
      if (changed) {
        await db.setting.upsert({
          where: { id: SETTING_KEY },
          create: { id: SETTING_KEY, value: JSON.stringify(parsed) },
          update: { value: JSON.stringify(parsed) },
        });
      }
      return parsed;
    } catch {
      return {};
    }
  } catch {
    return {};
  }
}

export async function saveCredential(
  platform: PlatformId,
  cred: StoredCredential,
): Promise<void> {
  const db = await getDb();
  const store = await getAuthStore();
  store[platform] = cred;
  await db.setting.upsert({
    where: { id: SETTING_KEY },
    create: { id: SETTING_KEY, value: JSON.stringify(store) },
    update: { value: JSON.stringify(store) },
  });
}

export async function removeCredential(platform: PlatformId): Promise<void> {
  const db = await getDb();
  const store = await getAuthStore();
  delete store[platform];
  await db.setting.upsert({
    where: { id: SETTING_KEY },
    create: { id: SETTING_KEY, value: JSON.stringify(store) },
    update: { value: JSON.stringify(store) },
  });
}

export async function getCredential(
  platform: PlatformId,
): Promise<StoredCredential | undefined> {
  const store = await getAuthStore();
  return store[platform];
}

// ----------------------------------------------------------------------------
// Auth headers — the single source of truth every fetcher uses
// ----------------------------------------------------------------------------

/**
 * Build the Authorization (+ Accept where needed) headers for a platform's
 * official API from the stored API-key credential. Returns an empty object
 * when the platform is public or no key is saved.
 */
export async function getPlatformAuthHeaders(
  platform: PlatformId,
): Promise<Record<string, string>> {
  const cred = await getCredential(platform);
  if (!cred || cred.kind !== "apikey") return {};
  const f = cred.fields || {};
  switch (platform) {
    case "hackerone": {
      if (!f.identifier || !f.secret) return {};
      const basic = Buffer.from(`${f.identifier}:${f.secret}`).toString("base64");
      return { Authorization: `Basic ${basic}`, Accept: "application/json" };
    }
    case "bugcrowd": {
      if (!f.username || !f.password) return {};
      return {
        Authorization: `Token ${f.username}:${f.password}`,
        Accept: "application/vnd.bugcrowd+json",
      };
    }
    case "intigriti": {
      if (!f.token) return {};
      return { Authorization: `Bearer ${f.token}`, Accept: "application/json" };
    }
    default:
      return {};
  }
}

/** True when a usable API-key credential exists for the platform. */
export async function hasPlatformApiKey(platform: PlatformId): Promise<boolean> {
  const cred = await getCredential(platform);
  if (!cred || cred.kind !== "apikey") return false;
  const f = cred.fields || {};
  switch (platform) {
    case "hackerone":
      return Boolean(f.identifier && f.secret);
    case "bugcrowd":
      return Boolean(f.username && f.password);
    case "intigriti":
      return Boolean(f.token);
    default:
      return false;
  }
}

// ----------------------------------------------------------------------------
// Validation — each platform is validated against its real API before the
// credential is persisted. A key that doesn't authenticate is never saved.
// ----------------------------------------------------------------------------

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36 Antlion/1.0";

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 15000,
): Promise<Response> {
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), timeoutMs);
  return fetch(url, {
    ...init,
    signal: ctrl.signal,
    cache: "no-store",
    headers: {
      "User-Agent": UA,
      Accept: "application/json",
      ...(init.headers as Record<string, string>),
    },
  });
}

export interface ValidationResult {
  ok: boolean;
  account?: string;
  error?: string;
}

/**
 * Validate a HackerOne API token via the official Hacker API `me` endpoint.
 * Basic auth (identifier:secret). 200 → username; 401 → rejected.
 */
export async function validateHackerOne(fields: Record<string, string>): Promise<ValidationResult> {
  const { identifier, secret } = fields;
  if (!identifier || !secret) {
    return { ok: false, error: "Both the token identifier and its value are required" };
  }
  try {
    const basic = Buffer.from(`${identifier}:${secret}`).toString("base64");
    const res = await fetchWithTimeout("https://api.hackerone.com/v1/hackers/me", {
      headers: { Authorization: `Basic ${basic}` },
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: `Token rejected (HTTP ${res.status}) — check the identifier and value` };
    }
    if (res.status === 429) {
      return { ok: false, error: "Rate limited by HackerOne — try again in a minute" };
    }
    if (!res.ok) {
      return { ok: false, error: `HackerOne API returned HTTP ${res.status}` };
    }
    const json = await res.json().catch(() => null);
    const attrs = json?.data?.attributes;
    if (attrs?.username || attrs?.name) {
      return { ok: true, account: attrs.username || attrs.name };
    }
    // Authenticated but unexpected body — still a valid token per the status.
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "network error" };
  }
}

/**
 * Validate Bugcrowd API credentials against the official JSON API.
 * `Authorization: Token username:password` — 200 = valid, 401/403 = invalid.
 */
export async function validateBugcrowd(fields: Record<string, string>): Promise<ValidationResult> {
  const { username, password } = fields;
  if (!username || !password) {
    return { ok: false, error: "Both the token username and password are required" };
  }
  try {
    const res = await fetchWithTimeout(
      "https://api.bugcrowd.com/programs?page[limit]=1",
      {
        headers: {
          Authorization: `Token ${username}:${password}`,
          Accept: "application/vnd.bugcrowd+json",
        },
      },
    );
    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        error: `Token rejected (HTTP ${res.status}) — re-create the credentials and copy both values`,
      };
    }
    if (res.ok) {
      const json = await res.json().catch(() => null);
      const first = Array.isArray(json?.data) ? json.data[0] : null;
      return { ok: true, account: first?.attributes?.name };
    }
    if (res.status === 404) {
      return {
        ok: false,
        error:
          "Bugcrowd API endpoint unreachable (HTTP 404) — verify the credentials or check whether your network blocks api.bugcrowd.com",
      };
    }
    return { ok: false, error: `Bugcrowd API returned HTTP ${res.status}` };
  } catch (e: any) {
    return { ok: false, error: e?.message || "network error" };
  }
}

/**
 * Validate an Intigriti PAT against the researcher API program listing.
 * `Authorization: Bearer <token>` — 200 = valid, 401 = invalid.
 */
export async function validateIntigriti(fields: Record<string, string>): Promise<ValidationResult> {
  const { token } = fields;
  if (!token) {
    return { ok: false, error: "Personal Access Token required" };
  }
  try {
    const res = await fetchWithTimeout(
      "https://api.intigriti.com/external/researcher/v1/programs?limit=1",
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: `Token rejected (HTTP ${res.status}) — create a fresh PAT and paste it here` };
    }
    if (res.ok) {
      return { ok: true };
    }
    return { ok: false, error: `Intigriti API returned HTTP ${res.status}` };
  } catch (e: any) {
    return { ok: false, error: e?.message || "network error" };
  }
}

/** Validate the API-key fields for a platform (dispatch by id). */
export async function validatePlatformApiKey(
  platform: PlatformId,
  fields: Record<string, string>,
): Promise<ValidationResult> {
  switch (platform) {
    case "hackerone":
      return validateHackerOne(fields);
    case "bugcrowd":
      return validateBugcrowd(fields);
    case "intigriti":
      return validateIntigriti(fields);
    default:
      return { ok: false, error: "This platform needs no API key — its data is public" };
  }
}

// ----------------------------------------------------------------------------
// Status — masked summary for the client (never leaks the raw credential)
// ----------------------------------------------------------------------------

export async function getAuthStatus(): Promise<AuthStatusEntry[]> {
  const store = await getAuthStore();
  const hasKey = Object.fromEntries(
    await Promise.all(
      (Object.keys(PLATFORM_META) as PlatformId[]).map(async (p) => [p, await hasPlatformApiKey(p)]),
    ),
  );
  return (Object.keys(PLATFORM_META) as PlatformId[]).map((platform) => {
    const meta = PLATFORM_META[platform];
    const cred = store[platform];
    return {
      platform,
      requiresAuth: meta.requiresAuth,
      authenticated: Boolean(hasKey[platform]),
      account: cred?.account,
      savedAt: cred?.savedAt,
      verifiedAt: cred?.verifiedAt,
      hint: meta.hint,
    };
  });
}

export function platformRequiresAuth(platform: string): boolean {
  const meta = PLATFORM_META[platform as PlatformId];
  return Boolean(meta?.requiresAuth);
}
