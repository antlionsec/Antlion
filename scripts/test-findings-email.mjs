// Verify findings.new dispatch → email formatting (severity list, targets).
// Run: bun /home/z/my-project/scripts/test-findings-email.mjs
import { dispatchNotifications } from "../src/lib/notify";

await dispatchNotifications("findings.new", {
  title: "New findings — GitLab — HackerOne",
  message: "3 new findings were persisted during the run.",
  severity: "critical",
  fields: [
    { name: "New findings", value: "3" },
    { name: "critical", value: "1" },
    { name: "high", value: "2" },
  ],
  findings: [
    { title: "Strict-Transport-Security header missing", severity: "critical", target: "https://gitlab.com" },
    { title: "Server header reveals version", severity: "high", target: "https://about.gitlab.com" },
    { title: "X-Powered-By exposes framework", severity: "high", target: "https://docs.gitlab.com" },
  ],
});
console.log("dispatch done");
