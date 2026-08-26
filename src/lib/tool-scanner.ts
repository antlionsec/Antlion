// ============================================================================
// ANTLION — Tool Scanner
// ----------------------------------------------------------------------------
// Detects which external CLI tools are actually installed on this machine by
// checking the command line (via `which`), optionally probing their versions.
// Results are cached in-memory and in the DB (Setting key `tools.scan`) so the
// whole app — pipeline executor, settings UI, pipeline config — shares one
// source of truth. NO hardcoded binary paths, NO fake "Found" badges.
// ============================================================================

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface ToolStatus {
  id: string;
  name: string;
  binary: string;
  category: string;
  installed: boolean;
  path: string | null;
  version: string | null;
  requiresApiKey: boolean;
  apiKeyName?: string;
  apiKeyPresent: boolean;
}

export interface ToolScanResult {
  tools: ToolStatus[];
  scannedAt: string;
  durationMs: number;
  installedCount: number;
  totalCount: number;
  apiKeyMap: Record<string, boolean>;
}

// In-memory cache — survives across requests within the same server process
let cachedScan: ToolScanResult | null = null;

/** Which API key env/settings names the pipeline tools need. */
const TOOL_KEY_DEFS: Record<string, { apiKeyName: string }> = {
  shodan: { apiKeyName: "SHODAN_API_KEY" },
  censys: { apiKeyName: "CENSYS_API_ID" },
  zoomeye: { apiKeyName: "ZOOMEYE_API_KEY" },
};

export async function getApiKeyPresence(): Promise<Record<string, boolean>> {
  // Lazy-import db to avoid circular deps in edge contexts
  const { db } = await import("@/lib/db");
  try {
    const rows = await db.setting.findMany({
      where: { id: { startsWith: "apikey_" } },
    });
    const map: Record<string, boolean> = {};
    for (const r of rows) {
      const name = r.id.replace(/^apikey_/, "");
      map[name] = Boolean(r.value && r.value.trim());
    }
    // Env vars are a fallback for users who prefer .env configuration
    for (const def of Object.values(TOOL_KEY_DEFS)) {
      if (!(def.apiKeyName in map)) {
        map[def.apiKeyName] = Boolean(process.env[def.apiKeyName]);
      }
    }
    return map;
  } catch {
    return {};
  }
}

/**
 * Look up a single binary on the command line.
 * Uses `which` (Linux/macOS). Falls back to `command -v` shell builtin when
 * `which` is unavailable. Returns null when the binary is not installed.
 */
async function whichBinary(binary: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("which", [binary], {
      timeout: 5000,
    });
    const path = stdout.trim().split("\n")[0];
    return path || null;
  } catch {
    // ENOENT for `which` itself, or non-zero exit for a missing binary
    try {
      const { stdout } = await execFileAsync("sh", ["-c", `command -v ${JSON.stringify(binary)}`], {
        timeout: 5000,
      });
      const path = stdout.trim();
      return path || null;
    } catch {
      return null;
    }
  }
}

/**
 * Probe a tool's version string. Each tool family has its own version flag —
 * we try a short, curated list and take the first that exits 0 with output.
 */
async function probeVersion(binary: string, path: string): Promise<string | null> {
  const attempts = [
    ["--version"],
    ["version"],
    ["-V"],
  ];
  for (const args of attempts) {
    try {
      const { stdout, stderr } = await execFileAsync(path, args, {
        timeout: 4000,
        env: process.env,
      });
      const text = (stdout || stderr || "").trim();
      if (text) {
        // Take the first line, trim to something readable
        const first = text.split("\n")[0].trim();
        const vmatch = first.match(/v?\d+\.\d+[\w.\-+]*/);
        if (vmatch) return vmatch[0];
        return first.slice(0, 40);
      }
    } catch {
      // try next flag
    }
  }
  return null;
}

/**
 * Scan every tool in the registry. Reads the registry from
 * `@/lib/pipeline-config` (single source of truth for binaries).
 */
export async function scanTools(force = false): Promise<ToolScanResult> {
  if (!force && cachedScan && Date.now() - new Date(cachedScan.scannedAt).getTime() < 5 * 60_000) {
    return cachedScan;
  }

  const t0 = Date.now();
  const { TOOLS } = await import("@/lib/pipeline-config");
  const apiKeyMap = await getApiKeyPresence();

  const results = await Promise.all(
    TOOLS.map(async (tool): Promise<ToolStatus> => {
      const path = await whichBinary(tool.binary);
      let version: string | null = null;
      if (path) {
        version = await probeVersion(tool.binary, path);
      }
      const keyDef = TOOL_KEY_DEFS[tool.id];
      return {
        id: tool.id,
        name: tool.name,
        binary: tool.binary,
        category: tool.category,
        installed: Boolean(path),
        path,
        version,
        requiresApiKey: tool.requiresApiKey === true,
        apiKeyName: tool.requiresApiKey ? tool.apiKeyName : keyDef?.apiKeyName,
        apiKeyPresent: tool.requiresApiKey
          ? Boolean(tool.apiKeyName && apiKeyMap[tool.apiKeyName])
          : true,
      };
    }),
  );

  const scan: ToolScanResult = {
    tools: results,
    scannedAt: new Date().toISOString(),
    durationMs: Date.now() - t0,
    installedCount: results.filter((t) => t.installed).length,
    totalCount: results.length,
    apiKeyMap,
  };

  cachedScan = scan;

  // Persist to DB so the scan survives server restarts and can be shown
  // before a fresh scan completes.
  try {
    const { db } = await import("@/lib/db");
    await db.setting.upsert({
      where: { id: "tools.scan" },
      create: { id: "tools.scan", value: JSON.stringify(scan) },
      update: { value: JSON.stringify(scan) },
    });
  } catch {
    // DB unavailable — in-memory cache still works
  }

  return scan;
}

/** Fast lookup used by the pipeline executor before spawning processes. */
export async function getToolStatusMap(): Promise<Record<string, ToolStatus>> {
  const scan = await scanTools();
  const map: Record<string, ToolStatus> = {};
  for (const t of scan.tools) map[t.id] = t;
  return map;
}

/** Load the last persisted scan from the DB (without running a new one). */
export async function getLastScan(): Promise<ToolScanResult | null> {
  if (cachedScan) return cachedScan;
  try {
    const { db } = await import("@/lib/db");
    const row = await db.setting.findUnique({ where: { id: "tools.scan" } });
    if (row) {
      try {
        const parsed = JSON.parse(row.value) as ToolScanResult;
        cachedScan = parsed;
        return parsed;
      } catch {
        return null;
      }
    }
  } catch {
    return null;
  }
  return null;
}
