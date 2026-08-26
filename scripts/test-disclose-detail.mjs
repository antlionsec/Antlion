// Verify disclose.io detail-page attribute parsing + org-domain derivation
import { readFileSync } from "node:fs";

const html = readFileSync("/tmp/dpp.html", "utf8");

// --- replicate fetchDiscloseScope parsing ---
const attrs = new Map();
const itemRe = /<div class="mat-item"[^>]*data-maturity-attr="([a-z_]+)"[^>]*>([\s\S]*?)<\/div>/g;
let im;
while ((im = itemRe.exec(html)) !== null) {
  const attr = im[1];
  const body = im[2];
  if (/icon-check/.test(body)) attrs.set(attr, true);
  else if (/icon-x\b/.test(body)) attrs.set(attr, false);
  else attrs.set(attr, null);
}
console.log("attributes:", Object.fromEntries(attrs));

const titleM = /<title>([^<]*)<\/title>/.exec(html);
const orgName = titleM ? titleM[1].split("-")[0].trim() : "";
console.log("orgName:", orgName);

const links = [];
const linkRe = /<a href="(https?:\/\/[^"]+)"[^>]*target="_blank"/g;
let lm;
while ((lm = linkRe.exec(html)) !== null) {
  const u = lm[1];
  if (/disclose\.io|disclosebot\.io|users\/sign_in/i.test(u)) continue;
  if (!links.includes(u)) links.push(u);
}
console.log("links:", links);

const secTxt = links.find((u) => /security\.txt/i.test(u));
const policyUrl = secTxt || links[0];
console.log("policyUrl:", policyUrl);

// --- replicate discloseOrgDomain ---
function domainFromPolicyUrl(policyUrl) {
  try {
    const u = new URL(policyUrl);
    const host = u.hostname.replace(/^www\./i, "");
    if (!host || !host.includes(".")) return null;
    return host;
  } catch { return null; }
}
function discloseOrgDomain(orgName, policyUrl, contact) {
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const org = norm(orgName);
  if (!org) return null;
  const emailDomain = contact.includes("@") ? contact.split("@").pop().trim().toLowerCase() : null;
  if (emailDomain && emailDomain.includes(".") && norm(emailDomain).includes(org.slice(0, Math.max(4, org.length - 2)))) {
    return { domain: emailDomain, source: `contact ${contact}` };
  }
  const policyDomain = domainFromPolicyUrl(policyUrl);
  if (policyDomain && norm(policyDomain).includes(org.slice(0, Math.max(4, org.length - 2)))) {
    return { domain: policyDomain, source: `policy ${policyUrl}` };
  }
  if (emailDomain && !policyDomain) return { domain: emailDomain, source: `contact ${contact}` };
  return null;
}

const org = orgName && policyUrl ? discloseOrgDomain(orgName, policyUrl, "") : null;
console.log("derived org domain:", org);

// Build the facts
const facts = [];
if (policyUrl) facts.push(`Published policy: ${policyUrl}`);
if (attrs.get("offers_bounty") === true) facts.push("Registry attests: offers bounties.");
if (attrs.get("offers_swag") === true) facts.push("Registry attests: offers swag.");
if (attrs.get("has_full_safe_harbor") === true) facts.push("Registry attests: full safe harbor.");
else if (attrs.get("has_safe_harbor") === true) facts.push("Registry attests: partial safe harbor.");
if (attrs.get("has_public_disclosure") === true) facts.push("Registry attests: public disclosure permitted.");
if (attrs.get("has_cvd_timeline") === true) facts.push("Registry attests: coordinated vulnerability disclosure timeline.");
if (attrs.get("has_security_txt") === true) facts.push("Registry attests: security.txt published.");
if (!org && policyUrl) facts.push("Scope targets are not machine-readable in this registry entry — read the linked policy for the authoritative scope.");
console.log("\npolicy text:\n- " + facts.join("\n- "));
