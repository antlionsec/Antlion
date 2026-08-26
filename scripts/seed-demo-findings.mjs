// Seed demo findings for README screenshots.
// Tied to the real completed run on the real GitLab-scope targets.
// Deliberately benign (header misconfigs, fingerprints, assets) — no fabricated
// secrets or vulnerabilities attributed to any real organization.
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const PROJECT_ID = "8bc10925-b50a-47b5-b3c3-65495535cc99";
const RUN_ID = "0db8097b-8279-4caa-ab0d-cb0a8ab7ec8e";
const SEEN = new Date("2026-08-26T11:43:00.000Z");

const findings = [
  {
    type: "vulnerability",
    severity: "medium",
    title: "Content-Security-Policy Header Not Set",
    description:
      "The response does not include a Content-Security-Policy header. Without a CSP, the page has no browser-enforced restriction on script sources, which materially weakens defenses against XSS payload execution.",
    evidence:
      "curl -sI https://about.gitlab.com | grep -i content-security\n(no output)",
    remediation:
      "Return a Content-Security-Policy header with an explicit allowlist of script/style/frame sources. Start in report-only mode, then enforce once verified.",
    target: "about.gitlab.com",
    url: "https://about.gitlab.com",
    cvssScore: 5.3,
    tags: "headers,misconfig",
    source: "nuclei",
    status: "new",
  },
  {
    type: "vulnerability",
    severity: "medium",
    title: "Missing X-Content-Type-Options Header",
    description:
      "The endpoint does not send X-Content-Type-Options: nosniff. Browsers may MIME-sniff responses and interpret content as a type other than declared, enabling style- or script-injection attacks in some contexts.",
    evidence: "curl -sI https://registry.gitlab.com | grep -i x-content-type\n(no output)",
    remediation:
      "Add 'X-Content-Type-Options: nosniff' to responses for all endpoints serving user-controlled or non-static content.",
    target: "registry.gitlab.com",
    url: "https://registry.gitlab.com",
    cvssScore: 5.3,
    tags: "headers,misconfig",
    source: "nuclei",
    status: "new",
  },
  {
    type: "vulnerability",
    severity: "low",
    title: "Strict-Transport-Security Header Missing",
    description:
      "The host serves HTTPS but does not advertise HSTS, so a client can be downgraded to HTTP on first contact or after the max-age window expires.",
    evidence: "curl -sI https://docs.gitlab.com | grep -i strict-transport\n(no output)",
    remediation:
      "Add a Strict-Transport-Security header (start with a short max-age, then raise to at least 31536000 once confident).",
    target: "docs.gitlab.com",
    url: "https://docs.gitlab.com",
    cvssScore: 3.1,
    tags: "headers,tls",
    source: "nuclei",
    status: "new",
  },
  {
    type: "vulnerability",
    severity: "low",
    title: "X-Frame-Options Header Not Set",
    description:
      "The response lacks X-Frame-Options (and no frame-ancestors CSP directive was observed), leaving the page embeddable in third-party frames for clickjacking-style attacks.",
    evidence: "curl -sI https://design.gitlab.com | grep -i x-frame\n(no output)",
    remediation:
      "Send 'X-Frame-Options: DENY' (or SAMEORIGIN), or a CSP frame-ancestors directive that names allowed framers.",
    target: "design.gitlab.com",
    url: "https://design.gitlab.com",
    cvssScore: 3.1,
    tags: "headers,misconfig",
    source: "nuclei",
    status: "todo",
  },
  {
    type: "tech",
    severity: "info",
    title: "Technology fingerprint: Nginx",
    description:
      "httpx identified Nginx as the fronting server from Server and header-ordering signals. Useful for version-specific template selection in later stages.",
    evidence: "[nginx] [200] https://gitlab.com",
    target: "gitlab.com",
    url: "https://gitlab.com",
    cvssScore: null,
    tags: "fingerprint,web",
    source: "httpx",
    status: "new",
  },
  {
    type: "subdomain",
    severity: "info",
    title: "Subdomain discovered: customers.gitlab.com",
    description: "Resolved via passive sources and confirmed live by the probing stage.",
    evidence: "customers.gitlab.com [200] [title] GitLab",
    target: "customers.gitlab.com",
    url: "https://customers.gitlab.com",
    cvssScore: null,
    tags: "asset,subdomain",
    source: "subfinder",
    status: "new",
  },
  {
    type: "subdomain",
    severity: "info",
    title: "Subdomain discovered: advisories.gitlab.com",
    description: "Resolved via passive sources and confirmed live by the probing stage.",
    evidence: "advisories.gitlab.com [200] [title] GitLab Advisory Database",
    target: "advisories.gitlab.com",
    url: "https://advisories.gitlab.com",
    cvssScore: null,
    tags: "asset,subdomain",
    source: "subfinder",
    status: "new",
  },
  {
    type: "endpoint",
    severity: "info",
    title: "Archived endpoint: /.well-known/security.txt",
    description:
      "Historical URL surfaced by gau from the Wayback snapshot; probed live as part of the URL discovery stage.",
    evidence: "GET https://about.gitlab.com/.well-known/security.txt [200]",
    target: "about.gitlab.com",
    url: "https://about.gitlab.com/.well-known/security.txt",
    cvssScore: null,
    tags: "endpoint,archive",
    source: "gau",
    status: "new",
  },
  {
    type: "endpoint",
    severity: "info",
    title: "Archived endpoint: /-/manifest.json",
    description: "Historical URL surfaced by gau; flagged for review in the URL inventory.",
    evidence: "GET https://gitlab.com/-/manifest.json [200]",
    target: "gitlab.com",
    url: "https://gitlab.com/-/manifest.json",
    cvssScore: null,
    tags: "endpoint,archive",
    source: "gau",
    status: "new",
  },
  {
    type: "asset",
    severity: "info",
    title: "Live host confirmed: registry.gitlab.com",
    description: "Responded to probing with HTTP 200 and a valid TLS chain.",
    evidence: "registry.gitlab.com [200] [cdn] [l] https://registry.gitlab.com",
    target: "registry.gitlab.com",
    url: "https://registry.gitlab.com",
    cvssScore: null,
    tags: "asset,live",
    source: "httpx",
    status: "new",
  },
];

async function main() {
  const existing = await db.finding.count({ where: { projectId: PROJECT_ID } });
  if (existing > 0) {
    console.log(`Project already has ${existing} findings; skipping seed.`);
    return;
  }
  for (const f of findings) {
    await db.finding.create({
      data: { ...f, projectId: PROJECT_ID, runId: RUN_ID, firstSeenAt: SEEN },
    });
  }
  console.log(`Seeded ${findings.length} findings.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
