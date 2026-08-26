// Test the disclose.io directory parser against the real live HTML
const rowRe =
  /<td class="org-name"[^>]*>\s*<a href="(\/o\/[^"]+)"[^>]*title="([^"]*)"[^>]*>([\s\S]*?)<\/td>\s*<td class="policy-col"[\s\S]*?<a href="([^"]*)"[^>]*title="([^"]*)"[\s\S]*?<td class="contact-col"[^>]*>\s*<span title="([^"]*)"[\s\S]*?<td class="maturity-col"[^>]*>\s*<span class="m-badge[^"]*"[^>]*title="[^"]*"[^>]*>([^<]*)<\/span>/g;

function domainFromPolicyUrl(policyUrl) {
  try {
    const u = new URL(policyUrl);
    const host = u.hostname.replace(/^www\./i, "");
    if (!host || !host.includes(".")) return null;
    return host;
  } catch {
    return null;
  }
}

async function main() {
  // Fetch live pages
  for (const url of ["https://directory.disclose.io/", "https://directory.disclose.io/?page=2"]) {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) Reconforge/1.0",
        Accept: "text/html",
      },
    });
    const html = await res.text();
    let m;
    const rows = [];
    while ((m = rowRe.exec(html)) !== null) {
      const name = (m[3] || m[2] || "").replace(/<[^>]+>/g, "").trim() || m[2].trim();
      rows.push({
        slug: m[1],
        name,
        policyUrl: m[4],
        contact: m[6],
        maturity: m[7],
        derivedDomain: domainFromPolicyUrl(m[4]),
      });
    }
    console.log(`\n=== ${url} → ${rows.length} rows (HTTP ${res.status}) ===`);
    for (const r of rows.slice(0, 5)) console.log(JSON.stringify(r));
  }
}
main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
