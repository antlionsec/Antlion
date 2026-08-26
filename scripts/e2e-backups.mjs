#!/usr/bin/env node
// E2E test: backup create → list → export plain → export encrypted →
// import (new project) → restore (replace) → delete record → encryption lifecycle
const BASE = "http://localhost:3000";
const PROJ = "8bc10925-b50a-47b5-b3c3-65495535cc99";
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ✓ ${name}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${name}${extra ? " — " + extra : ""}`); }
};

async function j(method, path, body) {
  const r = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const ct = r.headers.get("content-type") || "";
  if (ct.includes("application/json")) return { status: r.status, data: await r.json() };
  return { status: r.status, buf: Buffer.from(await r.arrayBuffer()), headers: r.headers };
}

(async () => {
  console.log("== 1. Plain backup now ==");
  const b1 = await j("POST", "/api/backups", { projectId: PROJ });
  ok("create plain backup", b1.status === 200 && b1.data.record?.size > 0, `${b1.data?.record?.size} bytes, file ${b1.data?.file}`);
  const recId = b1.data.record?.id;

  console.log("== 2. List backups ==");
  const l1 = await j("GET", `/api/backups?projectId=${PROJ}`);
  ok("list contains new record", l1.status === 200 && l1.data.backups.some((b) => b.id === recId), `${l1.data.backups.length} records`);
  ok("autoBackup flag present", typeof l1.data.autoBackup === "boolean");
  ok("retention present", [7, 14].includes(l1.data.retentionDays), String(l1.data.retentionDays));

  console.log("== 3. Plain export ==");
  const e1 = await j("POST", "/api/backups/export", { projectId: PROJ });
  ok("export returns zip", e1.status === 200 && e1.buf?.length > 500, `${e1.buf?.length} bytes`);
  ok("zip magic PK", e1.buf?.subarray(0, 2)?.toString() === "PK");
  const plainExportB64 = e1.buf.toString("base64");

  console.log("== 4. Enable encryption ==");
  const enc1 = await j("POST", `/api/projects/${PROJ}/encryption`, { passphrase: "test-pass-123" });
  ok("enable encryption", enc1.status === 200, JSON.stringify(enc1.data));
  const encDup = await j("POST", `/api/projects/${PROJ}/encryption`, { passphrase: "another-one" });
  ok("double-enable rejected", encDup.status === 409);
  const encShort = await j("POST", `/api/projects/${PROJ}/encryption`, { passphrase: "short" });
  ok("short passphrase rejected", encShort.status === 400);

  console.log("== 5. Verify passphrase ==");
  const v1 = await j("PUT", `/api/projects/${PROJ}/encryption`, { passphrase: "test-pass-123" });
  ok("correct passphrase verifies", v1.status === 200);
  const v2 = await j("PUT", `/api/projects/${PROJ}/encryption`, { passphrase: "wrong-pass" });
  ok("wrong passphrase rejected", v2.status === 400);

  console.log("== 6. Encrypted export (no passphrase → refuse) ==");
  const e2 = await j("POST", "/api/backups/export", { projectId: PROJ });
  ok("export without passphrase refused", e2.status === 400, e2.data?.error);
  const e3 = await j("POST", "/api/backups/export", { projectId: PROJ, passphrase: "wrong" });
  ok("wrong passphrase refused", e3.status === 400);
  const e4 = await j("POST", "/api/backups/export", { projectId: PROJ, passphrase: "test-pass-123" });
  ok("encrypted export ok", e4.status === 200 && e4.buf.length > 500, `${e4.buf?.length} bytes`);
  ok("ANTLIONENC1 magic", e4.buf.subarray(0, 11).toString() === "ANTLIONENC1");
  const encExportB64 = e4.buf.toString("base64");

  console.log("== 7. Encrypted backup now ==");
  const b2 = await j("POST", "/api/backups", { projectId: PROJ });
  ok("backup without passphrase refused", b2.status === 400, b2.data?.error);
  const b3 = await j("POST", "/api/backups", { projectId: PROJ, passphrase: "test-pass-123" });
  ok("encrypted backup created", b3.status === 200 && b3.data.encrypted === true);
  const encRecId = b3.data.record?.id;

  console.log("== 8. Import plain export as NEW project ==");
  const i1 = await j("POST", "/api/backups/import", { dataBase64: plainExportB64, asNew: true });
  ok("import as new", i1.status === 200 && i1.data.created === true, JSON.stringify(i1.data.counts));
  const newProjId = i1.data.projectId;
  const np = await j("GET", `/api/projects/${newProjId}`);
  ok("new project has targets+findings", np.data.stats.targetCount === 26 && np.data.stats.findingCount === 14, `t=${np.data.stats.targetCount} f=${np.data.stats.findingCount} r=${np.data.stats.runCount}`);

  console.log("== 9. Import encrypted export without passphrase → refuse ==");
  const i2 = await j("POST", "/api/backups/import", { dataBase64: encExportB64, asNew: true });
  ok("refused without passphrase", i2.status === 400, i2.data?.error);
  const i3 = await j("POST", "/api/backups/import", { dataBase64: encExportB64, passphrase: "WRONG", asNew: true });
  ok("refused with wrong passphrase", i3.status === 400 && /passphrase/i.test(i3.data?.error || ""), i3.data?.error);
  const i4 = await j("POST", "/api/backups/import", { dataBase64: encExportB64, passphrase: "test-pass-123", asNew: true });
  ok("import encrypted as new", i4.status === 200 && i4.data.counts?.targets === 26, JSON.stringify(i4.data.counts));
  const newProj2 = i4.data.projectId;

  console.log("== 10. Restore encrypted record (own project only) ==");
  const r1 = await j("POST", "/api/backups/restore", { projectId: PROJ, recordId: encRecId });
  ok("restore without passphrase refused", r1.status === 400, r1.data?.error);
  const rCross = await j("POST", "/api/backups/restore", { projectId: newProjId, recordId: encRecId });
  ok("cross-project restore blocked", rCross.status === 404, rCross.data?.error);
  const r2 = await j("POST", "/api/backups/restore", { projectId: PROJ, recordId: encRecId, passphrase: "test-pass-123" });
  ok("restore with passphrase", r2.status === 200 && r2.data.counts?.findings === 14, JSON.stringify(r2.data.counts));

  console.log("== 11. Replace-mode import ==");
  const i5 = await j("POST", "/api/backups/import", { dataBase64: plainExportB64, asNew: false, projectId: newProj2 });
  ok("replace-mode import", i5.status === 200 && i5.data.counts?.targets === 26);

  console.log("== 12. Auto-backup toggle + retention ==");
  const a1 = await j("PUT", "/api/backups", { projectId: PROJ, autoBackup: true });
  ok("auto-backup enabled", a1.status === 200 && a1.data.autoBackup === true);
  const a2 = await j("PUT", "/api/backups", { retentionDays: 14 });
  ok("retention updated", a2.status === 200 && a2.data.retentionDays === 14);
  const a3 = await j("PUT", "/api/backups", { retentionDays: 9000 });
  ok("retention out-of-range rejected", a3.status === 400);

  console.log("== 13. Delete backup record ==");
  const d1 = await j("DELETE", `/api/backups?id=${recId}`);
  ok("record deleted", d1.status === 200);
  const l2 = await j("GET", `/api/backups?projectId=${PROJ}`);
  ok("record gone from list", !l2.data.backups.some((b) => b.id === recId));

  console.log("== 14. Disable encryption (wrong passphrase → refuse) ==");
  const x1 = await j("DELETE", `/api/projects/${PROJ}/encryption`, { passphrase: "nope" });
  ok("wrong passphrase refused", x1.status === 400);
  const x2 = await j("DELETE", `/api/projects/${PROJ}/encryption`, { passphrase: "test-pass-123" });
  ok("encryption disabled", x2.status === 200);
  const pAfter = await j("GET", `/api/projects/${PROJ}`);
  ok("project flag cleared", pAfter.data.project.encryptionEnabled === false);

  console.log("== 15. Cleanup test projects ==");
  await j("DELETE", `/api/projects/${newProjId}?hard=1`);
  await j("DELETE", `/api/projects/${newProj2}?hard=1`);
  const plist = await j("GET", "/api/projects?status=active");
  ok("test projects removed", !plist.data.projects.some((p) => p.id === newProjId || p.id === newProj2));

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
