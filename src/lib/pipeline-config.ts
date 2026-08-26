// ============================================================================
// ANTLION — Pipeline Configuration
// ----------------------------------------------------------------------------
// Real, declarative configuration of the recon pipeline tool registry and
// stage orchestration. These are NOT mock data — they describe the real CLI
// tools that the pipeline can invoke (subfinder, nuclei, httpx, etc.).
//
// The pipeline executor in src/app/api/runs/route.ts spawns these binaries as
// real subprocesses. If a binary is missing, the stage logs an honest
// "binary not found" message and is marked as skipped — NO fake findings
// are ever generated.
// ============================================================================

export type Severity = "critical" | "high" | "medium" | "low" | "info";
export type FindingType =
  | "vulnerability"
  | "subdomain"
  | "asset"
  | "port"
  | "secret"
  | "takeover"
  | "endpoint"
  | "tech";

export interface ToolConfig {
  id: string;
  name: string;
  category:
    | "subdomain"
    | "url-discovery"
    | "probing"
    | "vulnerability"
    | "intelligence"
    | "secret"
    | "portscan"
    | "content"
    | "screenshot";
  description: string;
  binary: string;
  defaultArgs: string[];
  configurable: {
    key: string;
    label: string;
    type: "string" | "int" | "select" | "bool";
    default: string | number | boolean;
    options?: string[];
  }[];
  intensityLevels?: ("stealth" | "normal" | "aggressive")[];
  requiresApiKey?: boolean;
  apiKeyName?: string;
  enabled: boolean;
  // How to invoke the tool given a list of target values.
  // Returns the argv array (binary + args + target insertion).
  buildArgs?: (targets: string[], opts?: Record<string, any>) => string[];
  // How to parse the tool's stdout into findings.
  parseOutput?: (stdout: string, source: string) => ParsedFinding[];
}

export interface ParsedFinding {
  type: FindingType;
  severity: Severity;
  title: string;
  description?: string;
  evidence?: string;
  remediation?: string;
  target?: string;
  url?: string;
  cvssScore?: number;
  cveId?: string;
  source?: string;
  rawOutput?: string;
}

// ----------------------------------------------------------------------------
// TOOL REGISTRY — describes all CLI tools the pipeline can invoke
// ----------------------------------------------------------------------------
export const TOOLS: ToolConfig[] = [
  {
    id: "subfinder",
    name: "Subfinder",
    category: "subdomain",
    description: "Fast passive subdomain enumeration from 30+ public sources.",
    binary: "subfinder",
    defaultArgs: ["-silent", "-json"],
    configurable: [
      { key: "timeout", label: "Timeout (min)", type: "int", default: 30 },
      { key: "sources", label: "Source list", type: "string", default: "all" },
      { key: "recursive", label: "Recursive enumeration", type: "bool", default: false },
    ],
    intensityLevels: ["stealth", "normal", "aggressive"],
    enabled: true,
    buildArgs: (targets: string[]) => [
      "-d",
      targets[0].replace(/^\*\./, "").replace(/^https?:\/\//, "").split("/")[0],
      "-silent",
      "-json",
    ],
    parseOutput: (stdout, source) => {
      const findings: ParsedFinding[] = [];
      for (const line of stdout.split("\n")) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line);
          if (obj.host) {
            findings.push({
              type: "subdomain",
              severity: "info",
              title: obj.host,
              target: obj.host,
              source,
              description: `Subdomain discovered via ${obj.source || "passive source"}.`,
            });
          }
        } catch {
          // not JSON, ignore
        }
      }
      return findings;
    },
  },
  {
    id: "amass",
    name: "Amass",
    category: "subdomain",
    description: "Active & passive enumeration with DNS graphing.",
    binary: "amass",
    defaultArgs: ["enum", "-active"],
    configurable: [
      { key: "timeout", label: "Timeout (min)", type: "int", default: 60 },
      { key: "passive", label: "Passive only", type: "bool", default: false },
    ],
    intensityLevels: ["stealth", "normal", "aggressive"],
    enabled: true,
  },
  {
    id: "assetfinder",
    name: "Assetfinder",
    category: "subdomain",
    description: "Lightweight passive subdomain discovery.",
    binary: "assetfinder",
    defaultArgs: ["--subs-only"],
    configurable: [{ key: "timeout", label: "Timeout (min)", type: "int", default: 15 }],
    enabled: true,
    buildArgs: (targets) => ["--subs-only", targets[0].replace(/^\*\./, "")],
    parseOutput: (stdout, source) =>
      stdout
        .split("\n")
        .filter((l) => l.trim())
        .map((host) => ({
          type: "subdomain" as FindingType,
          severity: "info" as Severity,
          title: host.trim(),
          target: host.trim(),
          source,
          description: "Subdomain discovered via assetfinder.",
        })),
  },
  {
    id: "shuffledns",
    name: "ShuffleDNS",
    category: "subdomain",
    description: "Mass-resolve subdomains via bruteforce + passive sources.",
    binary: "shuffledns",
    defaultArgs: ["-r", "/etc/resolvers.txt"],
    configurable: [
      { key: "wordlist", label: "Wordlist", type: "string", default: "/usr/share/wordlists/subdomains.txt" },
      { key: "threads", label: "Threads", type: "int", default: 5000 },
    ],
    enabled: true,
  },
  {
    id: "dnsx",
    name: "dnsx",
    category: "subdomain",
    description: "Fast DNS probing with resolution & fingerprinting.",
    binary: "dnsx",
    defaultArgs: ["-a", "-resp", "-json"],
    configurable: [{ key: "threads", label: "Threads", type: "int", default: 100 }],
    enabled: true,
  },
  {
    id: "cloudenum",
    name: "CloudEnum",
    category: "subdomain",
    description: "Enumerate cloud buckets (S3, GCS, Azure).",
    binary: "cloud_enum",
    defaultArgs: ["-k"],
    configurable: [{ key: "threads", label: "Threads", type: "int", default: 20 }],
    enabled: false,
  },
  {
    id: "gau",
    name: "GAU (GetAllUrls)",
    category: "url-discovery",
    description: "Pull known URLs from Wayback & CommonCrawl.",
    binary: "gau",
    defaultArgs: ["--subs"],
    configurable: [{ key: "threads", label: "Threads", type: "int", default: 10 }],
    enabled: true,
    buildArgs: (targets) => ["--subs", targets[0].replace(/^\*\./, "")],
    parseOutput: (stdout, source) =>
      stdout
        .split("\n")
        .filter((l) => l.trim())
        .map((url) => ({
          type: "endpoint" as FindingType,
          severity: "info" as Severity,
          title: url.trim(),
          url: url.trim(),
          source,
          description: "URL discovered via Wayback/CommonCrawl.",
        })),
  },
  {
    id: "katana",
    name: "Katana",
    category: "url-discovery",
    description: "Modern crawling/spidering with JS rendering.",
    binary: "katana",
    defaultArgs: ["-jc", "-d", "3"],
    configurable: [
      { key: "depth", label: "Crawl depth", type: "int", default: 3 },
      { key: "js_render", label: "JS rendering", type: "bool", default: true },
    ],
    intensityLevels: ["stealth", "normal", "aggressive"],
    enabled: true,
  },
  {
    id: "gospider",
    name: "GoSpider",
    category: "url-discovery",
    description: "Fast concurrent web spider.",
    binary: "gospider",
    defaultArgs: ["-S"],
    configurable: [{ key: "concurrent", label: "Concurrency", type: "int", default: 25 }],
    enabled: true,
  },
  {
    id: "waybackurls",
    name: "Waybackurls",
    category: "url-discovery",
    description: "Fetch all URLs the Wayback Machine knows about.",
    binary: "waybackurls",
    defaultArgs: [],
    configurable: [],
    enabled: true,
    buildArgs: (targets) => [targets[0].replace(/^\*\./, "")],
    parseOutput: (stdout, source) =>
      stdout
        .split("\n")
        .filter((l) => l.trim())
        .map((url) => ({
          type: "endpoint" as FindingType,
          severity: "info" as Severity,
          title: url.trim(),
          url: url.trim(),
          source,
          description: "URL discovered via Wayback Machine.",
        })),
  },
  {
    id: "httpx",
    name: "httpx",
    category: "probing",
    description: "Live probing & rich tech fingerprinting.",
    binary: "httpx",
    defaultArgs: ["-title", "-tech-detect", "-status-code", "-json"],
    configurable: [
      { key: "threads", label: "Threads", type: "int", default: 50 },
      { key: "timeout", label: "Timeout (s)", type: "int", default: 10 },
      { key: "follow_redirects", label: "Follow redirects", type: "bool", default: true },
    ],
    intensityLevels: ["stealth", "normal", "aggressive"],
    enabled: true,
    buildArgs: (targets) => ["-title", "-tech-detect", "-status-code", "-json", "-l", "-"],
    parseOutput: (stdout, source) => {
      const findings: ParsedFinding[] = [];
      for (const line of stdout.split("\n")) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line);
          const url = obj.url || obj.input || "";
          const title = obj.title || "";
          const tech = (obj.tech || []).join(", ");
          const status = obj.status_code || obj["status-code"] || "";
          findings.push({
            type: "asset",
            severity: "info",
            title: `${url} [${status}] ${title}`.trim(),
            target: url.replace(/^https?:\/\//, "").split("/")[0],
            url,
            source,
            description: `Live host: ${status} | Tech: ${tech || "n/a"}`,
          });
        } catch {
          // ignore
        }
      }
      return findings;
    },
  },
  {
    id: "nuclei",
    name: "Nuclei",
    category: "vulnerability",
    description: "Template-based vulnerability scanner with severity classification.",
    binary: "nuclei",
    defaultArgs: ["-templates", "cves,vulnerabilities,misconfiguration", "-json"],
    configurable: [
      { key: "templates", label: "Template sets", type: "select", default: "cves,vulnerabilities,misconfiguration", options: ["cves", "vulnerabilities", "misconfiguration", "exposures", "takeovers", "all"] },
      { key: "severity", label: "Min severity", type: "select", default: "low", options: ["info", "low", "medium", "high", "critical"] },
      { key: "concurrency", label: "Concurrency", type: "int", default: 25 },
      { key: "rate_limit", label: "Rate limit (req/s)", type: "int", default: 150 },
    ],
    intensityLevels: ["stealth", "normal", "aggressive"],
    enabled: true,
    buildArgs: (targets) => [
      "-json",
      "-u",
      targets[0].replace(/^\*\./, "https://"),
    ],
    parseOutput: (stdout, source) => {
      const findings: ParsedFinding[] = [];
      for (const line of stdout.split("\n")) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line);
          const sev = (obj.info?.severity || "info").toLowerCase() as Severity;
          const tmplId = obj["template-id"] || obj.template_id || obj.templateID || "";
          const name = obj.info?.name || tmplId;
          const url = obj.matched_at || obj.host || obj.url || "";
          findings.push({
            type: "vulnerability",
            severity: sev,
            title: `${name} on ${url}`,
            target: url.replace(/^https?:\/\//, "").split("/")[0],
            url,
            cveId: tmplId.startsWith("CVE") ? tmplId : undefined,
            cvssScore: obj.info?.classification?.cvss_score,
            source,
            description: obj.info?.description || `Matched template: ${tmplId}`,
            evidence: JSON.stringify(obj, null, 2),
            remediation: obj.info?.remediation,
            rawOutput: line,
          });
        } catch {
          // ignore
        }
      }
      return findings;
    },
  },
  {
    id: "shodan",
    name: "Shodan",
    category: "intelligence",
    description: "Search internet-exposed services by fingerprint.",
    binary: "shodan",
    defaultArgs: ["search"],
    configurable: [{ key: "query", label: "Search query", type: "string", default: "hostname:" }],
    requiresApiKey: true,
    apiKeyName: "SHODAN_API_KEY",
    enabled: true,
  },
  {
    id: "censys",
    name: "Censys",
    category: "intelligence",
    description: "Search host & certificate data across IPv4 space.",
    binary: "censys",
    defaultArgs: ["search"],
    configurable: [{ key: "query", label: "Search query", type: "string", default: "services:" }],
    requiresApiKey: true,
    apiKeyName: "CENSYS_API_ID",
    enabled: true,
  },
  {
    id: "zoomeye",
    name: "ZoomEye",
    category: "intelligence",
    description: "Cyberspace search engine for devices & services.",
    binary: "zoomeye-cli",
    defaultArgs: ["search"],
    configurable: [{ key: "query", label: "Search query", type: "string", default: "hostname:" }],
    requiresApiKey: true,
    apiKeyName: "ZOOMEYE_API_KEY",
    enabled: false,
  },
  {
    id: "trufflehog",
    name: "Trufflehog",
    category: "secret",
    description: "Scan repos, buckets, and pages for leaked secrets.",
    binary: "trufflehog",
    defaultArgs: ["--json"],
    configurable: [
      { key: "verification", label: "Verify secrets", type: "bool", default: true },
      { key: "depth", label: "Scan depth", type: "int", default: 50 },
    ],
    enabled: true,
  },
  {
    id: "gitleaks",
    name: "Gitleaks",
    category: "secret",
    description: "Detect committed secrets in source code.",
    binary: "gitleaks",
    defaultArgs: ["detect", "--report-format", "json"],
    configurable: [{ key: "config", label: "Rules config", type: "string", default: "default" }],
    enabled: false,
  },
  {
    id: "nmap",
    name: "Nmap",
    category: "portscan",
    description: "Port & service detection with NSE scripts.",
    binary: "nmap",
    defaultArgs: ["-sV", "-sS", "-T4"],
    configurable: [
      { key: "ports", label: "Port range", type: "string", default: "1-65535" },
      { key: "timing", label: "Timing template", type: "select", default: "T4", options: ["T0", "T1", "T2", "T3", "T4", "T5"] },
      { key: "scripts", label: "NSE scripts", type: "string", default: "default,vuln" },
    ],
    intensityLevels: ["stealth", "normal", "aggressive"],
    enabled: true,
    buildArgs: (targets) => ["-sV", "-T4", targets[0].replace(/^\*\./, "").replace(/^https?:\/\//, "").split("/")[0]],
    parseOutput: (stdout, source) => {
      const findings: ParsedFinding[] = [];
      const lines = stdout.split("\n");
      for (const line of lines) {
        const m = line.match(/^(\d+)\/tcp\s+open\s+(\S+)(?:\s+(.+))?$/);
        if (m) {
          const port = parseInt(m[1]);
          const service = m[2];
          const ver = m[3] || "";
          const severity: Severity =
            [22, 80, 443].includes(port) ? "info" :
            [3306, 5432, 6379, 9200, 27017].includes(port) ? "high" :
            "medium";
          findings.push({
            type: "port",
            severity,
            title: `${port}/tcp open — ${service} ${ver}`.trim(),
            target: "",
            source,
            description: `Open port ${port}: ${service} ${ver}`.trim(),
          });
        }
      }
      return findings;
    },
  },
  {
    id: "ffuf",
    name: "ffuf",
    category: "content",
    description: "Fast fuzzing of paths, vhosts, parameters.",
    binary: "ffuf",
    defaultArgs: ["-ac", "-mc", "200,204,301,302,401,403"],
    configurable: [
      { key: "wordlist", label: "Wordlist", type: "string", default: "/usr/share/wordlists/content.txt" },
      { key: "threads", label: "Threads", type: "int", default: 40 },
      { key: "rate", label: "Rate (req/s)", type: "int", default: 0 },
    ],
    intensityLevels: ["stealth", "normal", "aggressive"],
    enabled: true,
  },
  {
    id: "dirsearch",
    name: "Dirsearch",
    category: "content",
    description: "Directory/file bruteforcing with extensions.",
    binary: "dirsearch",
    defaultArgs: ["--format", "json"],
    configurable: [
      { key: "extensions", label: "Extensions", type: "string", default: "php,asp,aspx,jsp,html,js" },
      { key: "threads", label: "Threads", type: "int", default: 30 },
    ],
    enabled: false,
  },
  {
    id: "gowitness",
    name: "Gowitness",
    category: "screenshot",
    description: "Headless screenshot capture of live assets.",
    binary: "gowitness",
    defaultArgs: ["screenshot", "file", "--format", "json"],
    configurable: [
      { key: "viewport_x", label: "Viewport width", type: "int", default: 1440 },
      { key: "viewport_y", label: "Viewport height", type: "int", default: 900 },
      { key: "timeout", label: "Timeout (s)", type: "int", default: 30 },
    ],
    enabled: true,
  },
];

// ----------------------------------------------------------------------------
// PIPELINE STAGES — pre-built sensible-default orchestration plan
// ----------------------------------------------------------------------------
export interface PipelineStageDef {
  id: string;
  name: string;
  description: string;
  toolIds: string[];
  parallelSafe: boolean;
  required: boolean;
  category: ToolConfig["category"];
}

export const PIPELINE_STAGES: PipelineStageDef[] = [
  {
    id: "stage_subdomain",
    name: "Subdomain Discovery",
    description: "Enumerate subdomains from passive sources, active DNS, and bruteforce.",
    toolIds: ["subfinder", "amass", "assetfinder", "shuffledns", "dnsx", "cloudenum"],
    parallelSafe: true,
    required: true,
    category: "subdomain",
  },
  {
    id: "stage_url",
    name: "URL & Endpoint Discovery",
    description: "Pull historical & live URLs from archives and crawlers.",
    toolIds: ["gau", "katana", "gospider", "waybackurls"],
    parallelSafe: true,
    required: true,
    category: "url-discovery",
  },
  {
    id: "stage_probe",
    name: "Live Probing & Fingerprinting",
    description: "Resolve assets, probe HTTP, detect titles & technologies.",
    toolIds: ["httpx"],
    parallelSafe: true,
    required: true,
    category: "probing",
  },
  {
    id: "stage_screenshot",
    name: "Visual Asset Capture",
    description: "Screenshot live web assets for triage and review.",
    toolIds: ["gowitness"],
    parallelSafe: true,
    required: false,
    category: "screenshot",
  },
  {
    id: "stage_intel",
    name: "Intelligence Enrichment",
    description: "Correlate against Shodan / Censys / ZoomEye fingerprints.",
    toolIds: ["shodan", "censys", "zoomeye"],
    parallelSafe: true,
    required: false,
    category: "intelligence",
  },
  {
    id: "stage_content",
    name: "Content Discovery",
    description: "Fuzz for hidden paths, files, and vhosts.",
    toolIds: ["ffuf", "dirsearch"],
    parallelSafe: true,
    required: false,
    category: "content",
  },
  {
    id: "stage_portscan",
    name: "Port & Service Scan",
    description: "Detect open ports and running services with NSE scripts.",
    toolIds: ["nmap"],
    parallelSafe: false,
    required: false,
    category: "portscan",
  },
  {
    id: "stage_vuln",
    name: "Vulnerability Scanning",
    description: "Run nuclei templates across all live assets, classify by severity.",
    toolIds: ["nuclei"],
    parallelSafe: false,
    required: true,
    category: "vulnerability",
  },
  {
    id: "stage_secret",
    name: "Secret Detection",
    description: "Scan repos, buckets, and pages for leaked credentials.",
    toolIds: ["trufflehog", "gitleaks"],
    parallelSafe: true,
    required: false,
    category: "secret",
  },
];
