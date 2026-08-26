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
  /** Version flag the tool-scanner should probe (default: --version / version / -V). */
  versionFlag?: string;
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
  // Some tools cannot stream their report to stdout reliably (wpscan reopens
  // its -o path via File.open, which fails on Node's socketpair stdio — the
  // process spins forever). When true, the executor passes a temp file path
  // to buildArgs (ctx.outputFile) and reads it back into stdout after the
  // tool exits.
  usesOutputFile?: boolean;
  enabled: boolean;
  // How to invoke the tool given a list of target values.
  // Returns the argv array (binary + args + target insertion).
  buildArgs?: (
    targets: string[],
    opts?: Record<string, any>,
    ctx?: { outputFile?: string },
  ) => string[];
  // Some tools read their target list from stdin (cariddi, httpx -l -).
  // Returns the exact bytes to pipe into the tool's stdin, or undefined to
  // leave stdin closed (default).
  buildStdin?: (targets: string[], opts?: Record<string, any>) => string;
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
    buildArgs: () => ["-title", "-tech-detect", "-status-code", "-json", "-l", "-"],
    // httpx reads its host list from stdin (-l -) — feed every target in.
    buildStdin: (targets) =>
      targets
        .map((t) => t.replace(/^\*\./, "").replace(/^https?:\/\//, "").split("/")[0])
        .join("\n") + "\n",
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
    id: "nikto",
    name: "Nikto",
    category: "vulnerability",
    description: "Classic web server scanner — outdated software, misconfigs, dangerous files.",
    binary: "nikto",
    versionFlag: "-V",
    defaultArgs: ["-nointeractive", "-ask", "no"],
    configurable: [
      { key: "tuning", label: "Tuning (test types)", type: "string", default: "" },
      { key: "timeout", label: "Request timeout (s)", type: "int", default: 10 },
    ],
    intensityLevels: ["stealth", "normal", "aggressive"],
    enabled: true,
    buildArgs: (targets, opts) => {
      const raw = targets[0].replace(/^\*\./, "");
      const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw.split("/")[0]}`;
      const argv = ["-h", url, "-nointeractive", "-ask", "no", "-timeout", String(opts?.timeout ?? 10)];
      const tuning = String(opts?.tuning ?? "").trim();
      if (tuning) argv.push("-Tuning", tuning);
      return argv;
    },
    parseOutput: (stdout, source) => {
      const findings: ParsedFinding[] = [];
      for (const line of stdout.split("\n")) {
        // Findings look like:
        //   + [600625] PHP/5.3.3 appears to be outdated (current is at least 8.5.8).
        //   + [013587] /: Suggested security header missing: x-content-type-options. See: ...
        //   + OSVDB-3092: /admin: Admin login page found.
        const m = line.match(/^\+\s+(?:\[(\d+)\]|OSVDB-(\d+))\s*(.+)$/);
        if (!m) continue;
        const osvdbId = m[2] ? `OSVDB-${m[2]}` : null;
        let rest = m[3].trim();
        let path = "";
        const pm = rest.match(/^(\/[^\s:]*(?:\/)?):\s*(.+)$/);
        if (pm) {
          path = pm[1];
          rest = pm[2];
        }
        const lower = rest.toLowerCase();
        let severity: Severity = "low";
        if (m[1] && m[1].startsWith("6")) severity = "medium"; // version/outdated software checks
        else if (osvdbId) severity = "medium"; // vulnerability-db entries
        else if (lower.includes("header missing")) severity = "low";
        else if (lower.includes("appears to be outdated")) severity = "medium";
        else if (lower.includes("retrieved") || lower.includes("found") || lower.includes("login page")) severity = "info";
        findings.push({
          type: "vulnerability",
          severity,
          title: `${osvdbId || `Nikto ${m[1]}`}: ${rest.slice(0, 120)}${path ? ` (${path})` : ""}`,
          target: "",
          url: path || undefined,
          cveId: osvdbId || undefined,
          source,
          description: rest,
          evidence: line.trim(),
          remediation:
            lower.includes("header missing")
              ? "Add the recommended security header to the web server / application configuration."
              : lower.includes("appears to be outdated")
                ? "Upgrade the identified software to a currently supported release."
                : undefined,
        });
      }
      return findings;
    },
  },
  {
    id: "dalfox",
    name: "Dalfox",
    category: "vulnerability",
    description: "Parameter-focused XSS scanner with DOM verification and POC payloads.",
    binary: "dalfox",
    defaultArgs: ["-f", "jsonl", "--no-color"],
    configurable: [
      { key: "skip_mining", label: "Skip DOM mining (faster)", type: "bool", default: false },
      { key: "delay", label: "Request delay (ms)", type: "int", default: 0 },
    ],
    intensityLevels: ["stealth", "normal", "aggressive"],
    enabled: true,
    buildArgs: (targets, opts) => {
      const raw = targets[0].replace(/^\*\./, "");
      const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw.split("/")[0]}`;
      const argv = ["scan", url, "-f", "jsonl", "--no-color"];
      if (opts?.skip_mining) argv.push("--skip-mining");
      const delay = Number(opts?.delay ?? 0);
      if (delay > 0) argv.push("--delay", String(delay));
      return argv;
    },
    parseOutput: (stdout, source) => {
      const findings: ParsedFinding[] = [];
      for (const line of stdout.split("\n")) {
        if (!line.trim().startsWith("{")) continue;
        try {
          const obj = JSON.parse(line);
          // First JSONL record is the run summary (has "meta"), not a finding.
          if (obj.meta || !obj.type) continue;
          if (obj.type !== "V") continue; // only confirmed vulnerabilities
          const sev = String(obj.severity || "high").toLowerCase() as Severity;
          const param = obj.param || "?";
          const location = obj.location || "unknown";
          const cwe = obj.cwe ? ` (${obj.cwe})` : "";
          findings.push({
            type: "vulnerability",
            severity: (["critical", "high", "medium", "low", "info"].includes(sev) ? sev : "high") as Severity,
            title: `XSS in ${location.toLowerCase()} parameter '${param}'${cwe}`,
            target: "",
            url: obj.data || undefined,
            source,
            description: obj.message_str || `Reflected XSS via ${obj.detection_method || "reflection"}.`,
            evidence: [obj.message_str, obj.payload ? `Payload: ${obj.payload}` : null, obj.evidence ? `Evidence: ${obj.evidence}` : null]
              .filter(Boolean)
              .join("\n"),
            remediation:
              "Encode user-controlled output per context (HTML entity, attribute, or JS encoding), apply a Content-Security-Policy, and treat parameters as untrusted input.",
          });
        } catch {
          // not JSON — ignore
        }
      }
      return findings;
    },
  },
  {
    id: "tlsx",
    name: "tlsx",
    category: "vulnerability",
    description: "TLS/SSL configuration audit — protocol versions, weak ciphers, certificate issues.",
    binary: "tlsx",
    defaultArgs: ["-json", "-silent", "-tls-version", "-cipher"],
    configurable: [
      { key: "enum_ciphers", label: "Enumerate weak/insecure ciphers (slower)", type: "bool", default: false },
    ],
    intensityLevels: ["stealth", "normal", "aggressive"],
    enabled: true,
    buildArgs: (targets, opts) => {
      const raw = targets[0].replace(/^\*\./, "");
      const host = raw.replace(/^https?:\/\//, "").split("/")[0];
      const argv = ["-u", host, "-json", "-silent", "-tls-version", "-cipher", "-ve"];
      if (opts?.enum_ciphers) argv.push("-ce", "-ct", "weak,insecure");
      return argv;
    },
    parseOutput: (stdout, source) => {
      const findings: ParsedFinding[] = [];
      const weakCipherRe = /(RC4|DES|3DES|NULL|EXPORT|MD5|ANON|aNULL)/i;
      const sha1CbcRe = /CBC.*SHA(?!256|384)|AES\d+-SHA$/;
      const hostLabel = (d: any) => `${d.host || d.ip || "host"}${d.port && d.port !== "443" ? `:${d.port}` : ""}`;

      for (const line of stdout.split("\n")) {
        if (!line.trim().startsWith("{")) continue;
        let obj: any;
        try {
          obj = JSON.parse(line);
        } catch {
          continue;
        }
        if (obj.meta || obj.probe_status === false) continue;
        const host = hostLabel(obj);
        const now = Date.now();

        // --- certificate issues ---
        if (obj.self_signed === true) {
          findings.push({
            type: "vulnerability",
            severity: "medium",
            title: `Self-signed certificate on ${host}`,
            target: obj.host || "",
            source,
            description: `The TLS certificate for ${host} is self-signed (CN=${obj.subject_cn || "unknown"}) — clients cannot establish a trusted chain.`,
            evidence: `Issuer DN: ${obj.issuer_dn || "unknown"}`,
            remediation: "Issue a certificate from a trusted CA (e.g. Let's Encrypt) for public-facing hosts.",
          });
        }
        if (obj.not_after) {
          const expiry = new Date(obj.not_after).getTime();
          if (Number.isFinite(expiry)) {
            if (expiry < now) {
              findings.push({
                type: "vulnerability",
                severity: "high",
                title: `Expired certificate on ${host}`,
                target: obj.host || "",
                source,
                description: `The TLS certificate expired on ${obj.not_after}. Clients see certificate errors.`,
                evidence: `not_after=${obj.not_after}, subject CN=${obj.subject_cn || "unknown"}`,
                remediation: "Renew the certificate immediately and automate renewal (ACME).",
              });
            } else if (expiry - now < 30 * 24 * 3600 * 1000) {
              findings.push({
                type: "vulnerability",
                severity: "low",
                title: `Certificate expiring soon on ${host}`,
                target: obj.host || "",
                source,
                description: `The TLS certificate expires on ${obj.not_after} (< 30 days).`,
                remediation: "Renew the certificate before it expires and set up renewal monitoring.",
              });
            }
          }
        }
        if (obj.subject_cn && obj.host && typeof obj.subject_cn === "string" && !obj.subject_cn.startsWith("*")) {
          const cnDomain = obj.subject_cn.toLowerCase();
          const hostDomain = String(obj.host).toLowerCase();
          if (!hostDomain.endsWith(cnDomain.replace(/^[^.]+\./, ""))) {
            findings.push({
              type: "vulnerability",
              severity: "high",
              title: `Hostname/certificate mismatch on ${host}`,
              target: obj.host,
              source,
              description: `The certificate's CN (${obj.subject_cn}) does not cover ${obj.host}.`,
              remediation: "Issue a certificate with a SAN covering this hostname.",
            });
          }
        }

        // --- protocol versions ---
        const ver = String(obj.tls_version || "").toLowerCase();
        if (["ssl20", "ssl30", "tls10", "tls11"].includes(ver)) {
          findings.push({
            type: "vulnerability",
            severity: ver.startsWith("ssl") ? "high" : "medium",
            title: `Deprecated TLS protocol ${ver.replace("ssl", "SSL ").replace("tls", "TLS ")} on ${host}`,
            target: obj.host || "",
            source,
            description: `${host} negotiates ${ver.toUpperCase()} — deprecated (RFC 8996) and excluded from modern browser trust stores.`,
            evidence: `Negotiated cipher: ${obj.cipher || "unknown"}`,
            remediation: "Disable SSLv3, TLS 1.0 and TLS 1.1; require TLS 1.2+ (ideally TLS 1.3).",
          });
        }
        // --- enumerated supported versions (-ve) ---
        if (Array.isArray(obj.version_enum)) {
          const deprecated = obj.version_enum.map(String).filter((v) =>
            ["ssl20", "ssl30", "tls10", "tls11"].includes(v.toLowerCase()),
          );
          if (deprecated.length) {
            findings.push({
              type: "vulnerability",
              severity: deprecated.some((v) => v.toLowerCase().startsWith("ssl")) ? "high" : "medium",
              title: `Deprecated TLS versions supported on ${host} (${deprecated.map((v) => v.toUpperCase()).join(", ")})`,
              target: obj.host || "",
              source,
              description: `${host} accepts ${deprecated.map((v) => v.toUpperCase()).join(", ")} — deprecated by RFC 8996 and removable from modern TLS configurations.`,
              evidence: `Enumerated supported versions: ${obj.version_enum.join(", ")}`,
              remediation: "Disable SSLv3, TLS 1.0 and TLS 1.1; require TLS 1.2+ (ideally TLS 1.3).",
            });
          }
        }

        // --- negotiated cipher ---
        const cipher = String(obj.cipher || "");
        if (cipher && weakCipherRe.test(cipher)) {
          findings.push({
            type: "vulnerability",
            severity: "high",
            title: `Weak cipher negotiated on ${host}`,
            target: obj.host || "",
            source,
            description: `${host} negotiated ${cipher} — cryptographically weak cipher suite.`,
            evidence: `Negotiated via ${ver.toUpperCase()}`,
            remediation: "Remove weak cipher suites (RC4, 3DES, NULL, EXPORT, anonymous DH) from the TLS configuration.",
          });
        } else if (cipher && sha1CbcRe.test(cipher)) {
          findings.push({
            type: "vulnerability",
            severity: "low",
            title: `Legacy CBC/SHA1 cipher on ${host}`,
            target: obj.host || "",
            source,
            description: `${host} negotiated ${cipher} — legacy CBC mode with SHA-1 MAC.`,
            remediation: "Prefer AEAD suites (GCM, ChaCha20-Poly1305) and remove CBC-SHA1 suites.",
          });
        }

        // --- cipher enumeration (only with enum_ciphers enabled) ---
        if (Array.isArray(obj.cipher_enum)) {
          for (const verBlock of obj.cipher_enum) {
            const groups = verBlock.ciphers || {};
            for (const group of ["insecure", "weak"]) {
              const list: string[] = groups[group] || [];
              if (list.length) {
                findings.push({
                  type: "vulnerability",
                  severity: group === "insecure" ? "high" : "medium",
                  title: `${group === "insecure" ? "Insecure" : "Weak"} ciphers accepted on ${host} (${verBlock.version})`,
                  target: obj.host || "",
                  source,
                  description: `${host} accepts ${list.length} ${group} cipher suite(s) over ${verBlock.version}: ${list.slice(0, 6).join(", ")}${list.length > 6 ? "…" : ""}`,
                  remediation: "Restrict the cipher configuration to modern AEAD suites and re-test.",
                });
              }
            }
          }
        }
      }
      return findings;
    },
  },
  {
    id: "cariddi",
    name: "cariddi",
    category: "vulnerability",
    description: "Crawls a site hunting for secrets, juicy parameters, error leaks and exposed sensitive files.",
    binary: "cariddi",
    versionFlag: "-version",
    defaultArgs: ["-s", "-e", "-err", "-json"],
    configurable: [
      { key: "hunt_secrets", label: "Hunt secrets (API keys, tokens)", type: "bool", default: true },
      { key: "hunt_endpoints", label: "Hunt juicy parameters", type: "bool", default: true },
      { key: "hunt_errors", label: "Hunt error messages", type: "bool", default: true },
      { key: "hunt_infos", label: "Hunt infos (emails, comments, IPs)", type: "bool", default: false },
      { key: "ext_level", label: "Juicy file extensions (0=off, 1=juiciest … 7)", type: "int", default: 1 },
      { key: "max_depth", label: "Max crawl depth", type: "int", default: 3 },
      { key: "timeout", label: "Request timeout (s)", type: "int", default: 10 },
      { key: "concurrency", label: "Concurrency", type: "int", default: 20 },
    ],
    intensityLevels: ["stealth", "normal", "aggressive"],
    enabled: true,
    buildArgs: (targets, opts) => {
      const argv = [
        "-json",
        "-t", String(opts?.timeout ?? 10),
        "-c", String(opts?.concurrency ?? 20),
        "-md", String(opts?.max_depth ?? 3),
      ];
      if (opts?.hunt_secrets !== false) argv.push("-s");
      if (opts?.hunt_endpoints !== false) argv.push("-e");
      if (opts?.hunt_errors !== false) argv.push("-err");
      if (opts?.hunt_infos) argv.push("-info");
      const ext = Number(opts?.ext_level ?? 1);
      if (ext > 0) argv.push("-ext", String(Math.min(7, Math.round(ext))));
      return argv;
    },
    // cariddi reads its target URL list from stdin (one URL per line).
    buildStdin: (targets) =>
      targets
        .map((t) => {
          const raw = t.replace(/^\*\./, "");
          return /^https?:\/\//i.test(raw) ? raw : `https://${raw.split("/")[0]}/`;
        })
        .join("\n") + "\n",
    parseOutput: (stdout, source) => {
      const findings: ParsedFinding[] = [];
      for (const line of stdout.split("\n")) {
        if (!line.trim().startsWith("{")) continue;
        let obj: any;
        try {
          obj = JSON.parse(line);
        } catch {
          continue;
        }
        const m = obj.matches;
        if (!m) continue; // plain crawl line — endpoint discovery is covered by other stages
        const url: string = obj.url || "";
        const host = url.replace(/^https?:\/\//, "").split("/")[0];

        for (const s of m.secrets || []) {
          findings.push({
            type: "secret",
            severity: "high",
            title: `${s.name || "Secret"} exposed on ${host}`,
            target: host,
            url,
            source,
            description: `A ${s.name || "credential pattern"} matched in the page content at ${url}. The matched value must be treated as compromised if it is genuine.`,
            evidence: `Match: ${s.match}`,
            remediation: "Rotate the exposed credential immediately, remove it from the response, and purge it from version control and caches.",
          });
        }
        for (const p of m.parameters || []) {
          findings.push({
            type: "endpoint",
            severity: "low",
            title: `Juicy parameter '${p.name || "?"}' at ${url}`,
            target: host,
            url,
            source,
            description: `The parameter name '${p.name || "?"}' is commonly interesting in attack surface analysis.${p.attacks?.length ? ` Potential attack vectors: ${p.attacks.join(", ")}.` : ""}`,
            evidence: `Parameter: ${p.name}${p.attacks?.length ? ` | Attacks: ${p.attacks.join(", ")}` : ""}`,
            remediation: "Verify the parameter is meant to be public, validate its input server-side, and remove it if unused.",
          });
        }
        for (const e of m.errors || []) {
          findings.push({
            type: "vulnerability",
            severity: "medium",
            title: `${e.name || "Error message"} leaked at ${url}`,
            target: host,
            url,
            source,
            description: `Verbose error output (${e.name || "error"}) is exposed to visitors at ${url}, disclosing internal implementation details.`,
            evidence: `Match: ${e.match}`,
            remediation: "Disable display_errors / verbose stack traces in production and return generic error pages instead.",
          });
        }
        for (const i of m.infos || []) {
          findings.push({
            type: "asset",
            severity: "info",
            title: `${i.name || "Info"} on ${host}: ${String(i.match || "").slice(0, 60)}`,
            target: host,
            url,
            source,
            description: `${i.name || "Useful information"} found at ${url}.`,
            evidence: `Match: ${i.match}`,
          });
        }
        if (m.filetype?.extension) {
          const sev = m.filetype.severity <= 1 ? "high" : m.filetype.severity <= 2 ? "medium" : "low";
          findings.push({
            type: "vulnerability",
            severity: sev,
            title: `Exposed ${String(m.filetype.extension).toUpperCase()} file at ${url}`,
            target: host,
            url,
            source,
            description: `A file with the '${m.filetype.extension}' extension is publicly reachable — files of this type frequently contain credentials, configuration or backup data (juicy level ${m.filetype.severity}/7).`,
            evidence: `Extension: .${m.filetype.extension} (level ${m.filetype.severity})`,
            remediation: "Remove the file from the web root, block direct access to it, and rotate any secrets it contains.",
          });
        }
      }
      return findings;
    },
  },
  {
    id: "whatweb",
    name: "WhatWeb",
    category: "vulnerability",
    description: "CMS & technology fingerprinting — identifies WordPress, Drupal, Joomla, servers, frameworks and versions.",
    binary: "whatweb",
    versionFlag: "--version",
    defaultArgs: ["--quiet", "--no-errors", "--log-json=-"],
    configurable: [
      { key: "aggression", label: "Aggression (1=passive … 4=heavy)", type: "select", default: "1", options: ["1", "2", "3", "4"] },
    ],
    intensityLevels: ["stealth", "normal", "aggressive"],
    enabled: true,
    buildArgs: (targets, opts) => {
      const urls = targets.map((t) => {
        const raw = t.replace(/^\*\./, "");
        return /^https?:\/\//i.test(raw) ? raw : `https://${raw.split("/")[0]}`;
      });
      return ["--quiet", "--no-errors", "--log-json=-", "-a", String(opts?.aggression ?? 1), ...urls];
    },
    parseOutput: (stdout, source) => {
      // whatweb --log-json=- prints a JSON array with one object per line.
      // Parse line-by-line so partially-aborted scans still yield findings.
      const findings: ParsedFinding[] = [];
      for (const line of stdout.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("{")) continue;
        let obj: any;
        try {
          obj = JSON.parse(trimmed.replace(/,$/, ""));
        } catch {
          continue;
        }
        const target = String(obj.target || "");
        const host = target.replace(/^https?:\/\//, "").split("/")[0];
        const plugins = obj.plugins || {};
        for (const [name, detail] of Object.entries(plugins)) {
          const d: any = Array.isArray(detail) ? detail[0] : detail;
          if (!d || typeof d !== "object") continue;
          const version = Array.isArray(d.version) && d.version.length ? d.version.join(", ") : "";
          const str = Array.isArray(d.string) && d.string.length ? d.string.slice(0, 3).join(" | ") : "";
          const os = Array.isArray(d.os) && d.os.length ? d.os.join(", ") : "";
          const isCms = /^(WordPress|Drupal|Joomla|Magento|Shopify|Typo3|Django|Ruby on Rails)$/i.test(name);
          findings.push({
            type: "tech",
            severity: "info",
            title: `${name}${version ? ` ${version}` : ""}${os ? ` (${os})` : ""} detected on ${host}`,
            target: host,
            url: target || undefined,
            source,
            description: isCms
              ? `CMS fingerprint: ${name}${version ? ` version ${version}` : ""}${str ? ` — evidence: ${str}` : ""}. Version-accurate CMS identification drives targeted vulnerability research.`
              : `Technology fingerprint: ${name}${version ? ` version ${version}` : ""}${str ? ` — evidence: ${str}` : ""}.`,
            evidence: [version ? `Version: ${version}` : null, str ? `Strings: ${str}` : null, os ? `OS: ${os}` : null]
              .filter(Boolean)
              .join("\n") || `Matched plugin: ${name}`,
          });
        }
      }
      return findings;
    },
  },
  {
    id: "wpscan",
    name: "WPScan",
    category: "vulnerability",
    description: "WordPress scanner — core version, main theme, plugins, exposed files (debug.log, readme) and config issues.",
    binary: "wpscan",
    versionFlag: "--version",
    defaultArgs: ["-f", "jsonl", "-o", "/proc/self/fd/1"],
    configurable: [
      { key: "enumerate", label: "Enumerate (vp,vt,ap,at,u,dbe… empty=off)", type: "string", default: "" },
      { key: "detection_mode", label: "Detection mode", type: "select", default: "mixed", options: ["mixed", "passive", "aggressive"] },
      { key: "api_token", label: "WPScan API token (vulnerability data)", type: "string", default: "" },
    ],
    intensityLevels: ["stealth", "normal", "aggressive"],
    enabled: true,
    usesOutputFile: true,
    buildArgs: (targets, opts, ctx) => {
      const raw = targets[0].replace(/^\*\./, "");
      const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw.split("/")[0]}`;
      // The report goes to a temp file owned by the executor — /proc/self/fd/1
      // cannot be reopened when stdout is a socketpair (Node spawn), which
      // makes wpscan spin. It stays as a manual-invocation fallback.
      const argv = ["--url", url, "-f", "jsonl", "-o", ctx?.outputFile ?? "/proc/self/fd/1", "--no-update"];
      const mode = String(opts?.detection_mode ?? "mixed");
      if (["mixed", "passive", "aggressive"].includes(mode)) argv.push("--detection-mode", mode);
      const enumList = String(opts?.enumerate ?? "").trim();
      if (enumList) argv.push("-e", enumList);
      const token = String(opts?.api_token ?? "").trim();
      if (token) argv.push("--api-token", token);
      return argv;
    },
    parseOutput: (stdout, source) => {
      const findings: ParsedFinding[] = [];
      // The jsonl stream splits one report across lines; only some carry
      // target_url — remember the last seen one for the rest.
      let currentUrl = "";
      for (const line of stdout.split("\n")) {
        if (!line.trim().startsWith("{")) continue;
        let obj: any;
        try {
          obj = JSON.parse(line);
        } catch {
          continue;
        }
        if (obj.banner || obj.start_time || obj.stop_time || obj.scan_aborted) {
          if (obj.target_url) currentUrl = String(obj.target_url);
          continue;
        }
        if (obj.target_url) currentUrl = String(obj.target_url);

        const host = currentUrl.replace(/^https?:\/\//, "").split("/")[0];
        const vulnToFinding = (v: any, label: string) => ({
          type: "vulnerability" as const,
          severity: (["critical", "high", "medium", "low"].includes(String(v.severity).toLowerCase())
            ? String(v.severity).toLowerCase()
            : "high") as Severity,
          title: `${label}: ${v.title || "vulnerability"}`,
          target: host,
          url: currentUrl || undefined,
          source,
          description: v.description || `${v.title || "Vulnerability"} reported by the WPScan database for ${label}.`,
          evidence: [v.fixed_in ? `Fixed in: ${v.fixed_in}` : null, v.url ? `Reference: ${v.url}` : null].filter(Boolean).join("\n"),
          remediation: v.fixed_in ? `Upgrade to version ${v.fixed_in} or later.` : undefined,
        });

        // --- WordPress core version ---
        if (obj.version?.number) {
          const status = String(obj.version.status || "");
          const outdated = status === "outdated" || status === "insecure";
          findings.push({
            type: "vulnerability",
            severity: outdated ? "high" : "info",
            title: `WordPress ${obj.version.number}${status ? ` (${status})` : ""} on ${host}`,
            target: host,
            url: currentUrl || undefined,
            source,
            description: `WordPress core version ${obj.version.number} detected${obj.version.release_date ? ` (released ${obj.version.release_date})` : ""}${outdated ? " — this version is not the latest and has known security exposure." : "."}`,
            evidence: [
              obj.version.found_by ? `Found by: ${obj.version.found_by}` : null,
              Array.isArray(obj.version.interesting_entries) && obj.version.interesting_entries.length
                ? `Entries: ${obj.version.interesting_entries.slice(0, 3).join(" | ")}`
                : null,
            ].filter(Boolean).join("\n"),
            remediation: outdated
              ? "Update WordPress core to the latest release and keep auto-updates enabled."
              : undefined,
          });
          for (const v of obj.version.vulnerabilities || []) findings.push(vulnToFinding(v, `WordPress ${obj.version.number}`));
        }
        // --- Main theme ---
        if (obj.main_theme?.slug) {
          const t = obj.main_theme;
          const ver = t.version?.number ? ` ${t.version.number}` : "";
          if (t.outdated && t.latest_version) {
            findings.push({
              type: "vulnerability",
              severity: "medium",
              title: `Outdated theme ${t.slug}${ver} on ${host} (latest ${t.latest_version})`,
              target: host,
              url: currentUrl || undefined,
              source,
              description: `The active theme '${t.slug}'${ver} is outdated — version ${t.latest_version} is current. Outdated themes are a common exploitation path.`,
              remediation: `Update the '${t.slug}' theme to ${t.latest_version} or later.`,
            });
          } else {
            findings.push({
              type: "tech",
              severity: "info",
              title: `Active theme ${t.slug}${ver} on ${host}`,
              target: host,
              url: currentUrl || undefined,
              source,
              description: `Main theme '${t.slug}'${ver} detected${t.style_url ? ` (${t.style_url})` : ""}.`,
            });
          }
          for (const v of t.vulnerabilities || []) findings.push(vulnToFinding(v, `Theme ${t.slug}`));
        }
        // --- Plugins & themes (only with --enumerate) ---
        for (const section of ["plugins", "themes"]) {
          for (const [slug, p] of Object.entries(obj[section] || {})) {
            const d: any = p as any;
            const ver = d.version?.number ? ` ${d.version.number}` : "";
            if (d.outdated && d.latest_version) {
              findings.push({
                type: "vulnerability",
                severity: "medium",
                title: `Outdated ${section === "plugins" ? "plugin" : "theme"} ${slug}${ver} on ${host} (latest ${d.latest_version})`,
                target: host,
                url: currentUrl || undefined,
                source,
                description: `The ${section === "plugins" ? "plugin" : "theme"} '${slug}'${ver} is outdated — version ${d.latest_version} is current.`,
                remediation: `Update '${slug}' to ${d.latest_version} or later, or remove it if unused.`,
              });
            } else {
              findings.push({
                type: "tech",
                severity: "info",
                title: `${section === "plugins" ? "Plugin" : "Theme"} ${slug}${ver} on ${host}`,
                target: host,
                url: currentUrl || undefined,
                source,
                description: `${section === "plugins" ? "Plugin" : "Theme"} '${slug}'${ver} detected.`,
              });
            }
            for (const v of d.vulnerabilities || []) findings.push(vulnToFinding(v, `${section === "plugins" ? "Plugin" : "Theme"} ${slug}`));
          }
        }
        // --- Interesting findings (readme, debug.log, listings, headers…) ---
        for (const f of obj.interesting_findings || []) {
          const typeMap: Record<string, { sev: Severity; type: FindingType }> = {
            debug_log: { sev: "high", type: "vulnerability" },
            xmlrpc: { sev: "medium", type: "vulnerability" },
            upload_directory_listing: { sev: "low", type: "vulnerability" },
            readme: { sev: "info", type: "vulnerability" },
            headers: { sev: "info", type: "tech" },
            wordpress_directory_listing: { sev: "low", type: "vulnerability" },
            backup_db: { sev: "critical", type: "vulnerability" },
            wp_config_backup: { sev: "critical", type: "vulnerability" },
          };
          const mapped = typeMap[String(f.type || "")] || { sev: "info", type: "vulnerability" };
          findings.push({
            type: mapped.type,
            severity: mapped.sev,
            title: `${f.to_s || f.type || "Finding"}${host ? ` — ${host}` : ""}`,
            target: host,
            url: f.url || currentUrl || undefined,
            source,
            description: `${f.to_s || "WordPress interesting finding"}${f.found_by ? ` (found by ${f.found_by}, confidence ${f.confainty ?? "?"}%)` : ""}.`,
            evidence: [
              Array.isArray(f.interesting_entries) && f.interesting_entries.length
                ? f.interesting_entries.slice(0, 4).join(" | ")
                : null,
              f.references?.url?.length ? `Reference: ${f.references.url[0]}` : null,
            ].filter(Boolean).join("\n"),
            remediation: f.remediation || (f.type === "debug_log"
              ? "Set WP_DEBUG_LOG to false (or write the log outside the web root) and remove the exposed debug.log."
              : f.type === "upload_directory_listing"
                ? "Disable directory listing (Options -Indexes in Apache, autoindex off in nginx)."
                : f.type === "xmlrpc"
                  ? "Disable XML-RPC if not needed, or restrict it at the WAF level (system_multicall abuse)."
                  : undefined),
          });
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
    description:
      "Template-based scanning (nuclei), web server audit (nikto), XSS detection (dalfox), TLS analysis (tlsx), secret/error/file exposure hunting (cariddi) and CMS fingerprinting (whatweb, wpscan) across live assets.",
    toolIds: ["nuclei", "nikto", "dalfox", "tlsx", "cariddi", "whatweb", "wpscan"],
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
