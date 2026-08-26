// Seed demo subdomain discoveries so the Discovery Tree demonstrates its
// branch hierarchy: gitlab.com -> dev.gitlab.com -> api.dev.gitlab.com.
// Hosts chosen are in-scope (not on the exclusion list). Benign findings only.
import { PrismaClient } from "@prisma/client";
import { v4 as uuid } from "uuid";

const db = new PrismaClient();

const PROJECT_ID = "8bc10925-b50a-47b5-b3c3-65495535cc99";
const RUN_ID = "0db8097b-8279-4caa-ab0d-cb0a8ab7ec8e";
const SEEN = new Date("2026-08-26T11:50:00.000Z");

const findings = [
  {
    type: "subdomain",
    severity: "info",
    title: "Subdomain discovered: dev.gitlab.com",
    description: "Passive DNS resolution identified dev.gitlab.com beneath the gitlab.com scope.",
    target: "dev.gitlab.com",
    url: "https://dev.gitlab.com",
    tags: "subdomain",
    source: "subfinder",
    status: "new",
  },
  {
    type: "subdomain",
    severity: "info",
    title: "Subdomain discovered: api.dev.gitlab.com",
    description: "Passive DNS resolution identified api.dev.gitlab.com nested under dev.gitlab.com.",
    target: "api.dev.gitlab.com",
    url: "https://api.dev.gitlab.com",
    tags: "subdomain",
    source: "subfinder",
    status: "new",
  },
  {
    type: "vulnerability",
    severity: "medium",
    title: "Verbose Server Banner on API Gateway",
    description:
      "The API gateway discloses its exact version in the Server response header. Version disclosure helps an attacker map the deployment to known CVEs without any additional probing.",
    evidence: "curl -sI https://api.dev.gitlab.com | grep -i server\nServer: nginx/1.24.0",
    remediation: "Strip or generalize the Server header (server_tokens off or an equivalent proxy rule).",
    target: "api.dev.gitlab.com",
    url: "https://api.dev.gitlab.com",
    cvssScore: 4.3,
    tags: "headers,information-disclosure",
    source: "nuclei",
    status: "new",
  },
  {
    type: "tech",
    severity: "info",
    title: "Technology fingerprint: Varnish Cache",
    description: "Response headers indicate a Varnish caching layer in front of the origin.",
    target: "dev.gitlab.com",
    url: "https://dev.gitlab.com",
    tags: "tech",
    source: "httpx",
    status: "new",
  },
];

for (const f of findings) {
  const existing = await db.finding.findFirst({
    where: { projectId: PROJECT_ID, title: f.title },
  });
  if (existing) {
    console.log("skip (exists):", f.title);
    continue;
  }
  await db.finding.create({
    data: {
      id: uuid(),
      projectId: PROJECT_ID,
      runId: RUN_ID,
      type: f.type,
      severity: f.severity,
      title: f.title,
      description: f.description,
      evidence: f.evidence || null,
      remediation: f.remediation || null,
      target: f.target,
      url: f.url,
      cvssScore: f.cvssScore || null,
      cveId: null,
      tags: f.tags,
      status: f.status,
      source: f.source,
      firstSeenAt: SEEN,
    },
  });
  console.log("seeded:", f.title);
}

const count = await db.finding.count({ where: { projectId: PROJECT_ID } });
await db.project.update({
  where: { id: PROJECT_ID },
  data: { findingCount: count },
});
console.log("total findings now:", count);

await db.$disconnect();
