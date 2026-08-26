// ============================================================================
// ANTLION — Platform metadata (client-safe)
// ----------------------------------------------------------------------------
// Pure data: which platforms exist, whether they need an API key, the key form
// fields, and where the key is created. No server imports — safe to import
// from client components. The server-side auth store lives in
// @/lib/platform-auth, which re-exports everything from here.
// ============================================================================

export type PlatformId =
  | "hackerone"
  | "bugcrowd"
  | "intigriti"
  | "yeswehack"
  | "immunefi"
  | "disclose";

/** One input field in the API-key form for a platform. */
export interface ApiKeyField {
  key: string;
  label: string;
  placeholder?: string;
  /** secret → masked input */
  secret?: boolean;
}

export const PLATFORM_META: Record<
  PlatformId,
  {
    label: string;
    requiresAuth: boolean;
    /** Auth fields rendered in the connect form (empty = public, no key). */
    apiKeyFields?: ApiKeyField[];
    /** Where the user creates the credential. */
    keyUrl?: string;
    hint?: string;
  }
> = {
  hackerone: {
    label: "HackerOne",
    requiresAuth: false, // public data works; API key adds private + user programs
    apiKeyFields: [
      { key: "identifier", label: "API Token identifier", placeholder: "e.g. 1bdotYF0n…", secret: false },
      { key: "secret", label: "API Token value (secret)", placeholder: "shown once when created", secret: true },
    ],
    keyUrl: "https://hackerone.com/settings/api_tokens",
    hint:
      "Optional. Public programs load without a key. Create an API token (Settings → API Tokens) to also load programs visible only to your account and fetch scope through the official Hacker API.",
  },
  bugcrowd: {
    label: "Bugcrowd",
    requiresAuth: true,
    apiKeyFields: [
      { key: "username", label: "Token username", placeholder: "shown on the API credentials page", secret: false },
      { key: "password", label: "Token password", placeholder: "shown once when created", secret: true },
    ],
    keyUrl: "https://tracker.bugcrowd.com/user/api_credentials",
    hint:
      "Create API credentials (profile menu → API Credentials), then paste the token username and password here. Required to load program scope through the official Bugcrowd API.",
  },
  intigriti: {
    label: "Intigriti",
    requiresAuth: true,
    apiKeyFields: [
      { key: "token", label: "Personal Access Token", placeholder: "created in your profile settings", secret: true },
    ],
    keyUrl: "https://app.intigriti.com/profile/personal-access-tokens",
    hint:
      "Create a Personal Access Token (app.intigriti.com → profile → Personal Access Tokens). Required — Intigriti program data is only available through the authenticated researcher API.",
  },
  yeswehack: {
    label: "YesWeHack",
    requiresAuth: false,
    hint: "Fully public — YesWeHack's researcher program data needs no API key.",
  },
  immunefi: {
    label: "Immunefi",
    requiresAuth: false,
    hint: "Fully public — Immunefi exposes no researcher API keys; program data is fetched live.",
  },
  disclose: {
    label: "disclose.io",
    requiresAuth: false, // fully public static registry — no auth needed
  },
};
