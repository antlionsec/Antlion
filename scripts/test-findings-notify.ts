// Verify findings.new dispatch: severity threshold filtering + payload rendering.
// Runs the REAL src/lib/notify.ts (bun resolves tsconfig paths + .env).
import { dispatchNotifications } from "@/lib/notify";

// Receiver log is cleared by the caller; two hooks are pre-saved via /api/settings:
//   hook_e2e  → generic,   minSeverity: info
//   hook_high → discord,   minSeverity: high
console.log("dispatching findings.new with 3 info info findings...");
await dispatchNotifications("findings.new", {
  title: "New findings — GitLab — HackerOne · Vulnerability Scanning",
  message: "3 new finding(s) persisted during the \"Vulnerability Scanning\" stage.",
  fields: [
    { name: "Project", value: "GitLab — HackerOne" },
    { name: "Stage", value: "Vulnerability Scanning" },
    { name: "By severity", value: "critical: 1 · info: 2" },
  ],
  severity: "critical",
  findings: [
    { title: "Another subdomain", severity: "info", target: "x.gitlab.com" },
    { title: "Subdomain discovered: customers.gitlab.com", severity: "info", target: "customers.gitlab.com" },
    { title: "Subdomain discovered: advisories.gitlab.com", severity: "info", target: "advisories.gitlab.com" },
  ],
});
console.log("dispatch done — check /tmp/webhook-received.log");
process.exit(0);
