// ============================================================================
// ANTLION — Platform Authentication (persistent, project-independent)
// ----------------------------------------------------------------------------
// Some bug bounty platforms restrict program listings / scope data to
// authenticated researchers:
//
//   • Bugcrowd  — tracker.bugcrowd.com API returns 401 without a session
//   • Intigriti — full program list + scope requires a researcher session
//                 (login form is protected by reCAPTCHA, so programmatic
//                 email/password login is not possible — a browser session
//                 cookie is used instead)
//   • HackerOne — public data works anonymously; a session cookie unlocks
//                 session-visible programs
//   • YesWeHack / Immunefi / disclose.io — fully public, no auth required
//
// Credentials are stored ONCE in the local SQLite database (Setting key
// "platformAuth") and are therefore available to every project container /
// pipeline run — there is a single shared, persistent credential store.
// They are never sent anywhere except the platform they belong to.
// ============================================================================

const SETTING_KEY = "platformAuth";

export type PlatformId =
  | "hackerone"
  | "bugcrowd"
  | "intigriti"
  | "yeswehack"
  | "immunefi"
  | "disclose";

export interface StoredCredential {
  kind: "cookie" | "token";
  value: string; // cookie header value or API token
  savedAt: string;
  verifiedAt?: string;
  account?: string; // username / account identifier when detectable
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

const PLATFORM_META: Record<
  PlatformId,
  { label: string; requiresAuth: boolean; method?: "cookie" | "token"; hint?: string }
> = {
  hackerone: {
    label: "HackerOne",
    requiresAuth: false, // public data works; session unlocks private programs
    method: "cookie",
    hint:
      "Optional. Public programs work without login. Sign in on hackerone.com, then copy your session cookie to also see session-visible programs.",
  },
  bugcrowd: {
    label: "Bugcrowd",
    requiresAuth: true,
    method: "cookie",
    hint:
      "Sign in on bugcrowd.com in your browser, open DevTools → Network → any request to bugcrowd.com → copy the full Cookie request header, and paste it here. Required to load program scope.",
  },
  intigriti: {
    label: "Intigriti",
    requiresAuth: true,
    method: "cookie",
    hint:
      "Sign in on app.intigriti.com in your browser, open DevTools → Network → any request to app.intigriti.com → copy the full Cookie request header, and paste it here. Required to load the full program list and scope.",
  },
  yeswehack: { label: "YesWeHack", requiresAuth: false },
  immunefi: { label: "Immunefi", requiresAuth: false },
  disclose: {
    label: "disclose.io",
    requiresAuth: false, // fully public static registry — no auth needed
  },
};

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
      return JSON.parse(row.value) as AuthStore;
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

/** Get the Cookie header value for a platform (empty string when anonymous). */
export async function getPlatformCookie(platform: PlatformId): Promise<string> {
  const cred = await getCredential(platform);
  if (cred && cred.kind === "cookie" && cred.value) return cred.value;
  return "";
}

// ----------------------------------------------------------------------------
// Validation — each platform has a cheap endpoint that behaves differently
// for anonymous vs authenticated requests.
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
      Accept: "application/json,text/html;q=0.8,*/*;q=0.5",
      ...(init.headers as Record<string, string>),
    },
  });
}

export interface ValidationResult {
  ok: boolean;
  account?: string;
  error?: string;
}

/** Validate a HackerOne session cookie via the GraphQL `me` query. */
export async function validateHackerOne(cookie: string): Promise<ValidationResult> {
  try {
    const res = await fetchWithTimeout("https://hackerone.com/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
      },
      body: JSON.stringify({ query: "query { me { username name } }" }),
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: `Session rejected (HTTP ${res.status})` };
    }
    const json = await res.json().catch(() => null);
    const me = json?.data?.me;
    if (me) {
      return { ok: true, account: me.username || me.name };
    }
    return { ok: false, error: "Cookie not recognized as a signed-in session" };
  } catch (e: any) {
    return { ok: false, error: e?.message || "network error" };
  }
}

/**
 * Validate a Bugcrowd session cookie against the tracker API.
 * Anonymous requests get 401 {"error":"You need to sign in..."}.
 */
export async function validateBugcrowd(cookie: string): Promise<ValidationResult> {
  try {
    const res = await fetchWithTimeout(
      "https://tracker.bugcrowd.com/api/engagements?per_page=1",
      {
        headers: {
          Cookie: cookie,
          Accept: "application/json",
          Referer: "https://bugcrowd.com/",
          "X-Requested-With": "XMLHttpRequest",
        },
      },
    );
    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        error: "Session invalid or expired — re-copy the Cookie header from your browser",
      };
    }
    if (res.ok) {
      // Try to detect the researcher handle from the session endpoints
      let account: string | undefined;
      try {
        const j = await res.json();
        account =
          j?.researcher?.email || j?.user?.email || j?.current_researcher?.email;
      } catch {
        // JSON body unavailable — still authenticated per status code
      }
      return { ok: true, account };
    }
    if (res.status === 302 || res.status === 301) {
      return { ok: false, error: "Redirected to login — session cookie invalid" };
    }
    return { ok: false, error: `Unexpected HTTP ${res.status}` };
  } catch (e: any) {
    return { ok: false, error: e?.message || "network error" };
  }
}

/**
 * Validate an Intigriti session cookie via the researcher API.
 * Anonymous requests receive the HTML SPA shell instead of JSON.
 */
export async function validateIntigriti(cookie: string): Promise<ValidationResult> {
  try {
    const res = await fetchWithTimeout(
      "https://app.intigriti.com/api/researcher/v1/programs?limit=1",
      {
        headers: {
          Cookie: cookie,
          Accept: "application/json, text/plain, */*",
          Referer: "https://app.intigriti.com/researcher/programs",
          "X-Requested-With": "XMLHttpRequest",
        },
      },
    );
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      const j = await res.json().catch(() => null);
      const account =
        j?.user?.email ||
        j?.researcher?.email ||
        (typeof j?.email === "string" ? j.email : undefined);
      return { ok: true, account };
    }
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: `Session rejected (HTTP ${res.status})` };
    }
    return {
      ok: false,
      error: "Cookie not recognized — copy the Cookie header while signed in to app.intigriti.com",
    };
  } catch (e: any) {
    return { ok: false, error: e?.message || "network error" };
  }
}

// ----------------------------------------------------------------------------
// Status — masked summary for the client (never leaks the raw credential)
// ----------------------------------------------------------------------------

export async function getAuthStatus(): Promise<AuthStatusEntry[]> {
  const store = await getAuthStore();
  return (Object.keys(PLATFORM_META) as PlatformId[]).map((platform) => {
    const meta = PLATFORM_META[platform];
    const cred = store[platform];
    return {
      platform,
      requiresAuth: meta.requiresAuth,
      authenticated: Boolean(cred?.value),
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

export { PLATFORM_META };
