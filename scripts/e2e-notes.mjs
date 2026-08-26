#!/usr/bin/env node
// E2E test: notes CRUD on a finding + project-level notes + pin ordering
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
  let data = null;
  try { data = await r.json(); } catch {}
  return { status: r.status, data };
}

(async () => {
  // Find a finding to attach notes to
  const f = await j("GET", `/api/findings?projectId=${PROJ}&limit=5`);
  const finding = f.data.findings[0];
  ok("findings available", Boolean(finding), finding?.title);

  console.log("== Notes CRUD ==");
  const c1 = await j("POST", "/api/notes", { projectId: PROJ, findingId: finding.id, content: "First triage note — looks legit" });
  ok("create note", c1.status === 201 && c1.data.note?.content?.includes("triage"), c1.data.note?.id?.slice(0, 8));
  const note1 = c1.data.note;

  const c2 = await j("POST", "/api/notes", { projectId: PROJ, findingId: finding.id, content: "Second note" });
  const note2 = c2.data.note;
  const c3 = await j("POST", "/api/notes", { projectId: PROJ, findingId: finding.id, content: "Pinned important note", pinned: true });
  const note3 = c3.data.note;
  ok("three notes created", c2.status === 201 && c3.status === 201);

  const empty = await j("POST", "/api/notes", { projectId: PROJ, findingId: finding.id, content: "   " });
  ok("empty note rejected", empty.status === 400);

  const g1 = await j("GET", `/api/notes?projectId=${PROJ}&findingId=${finding.id}`);
  ok("list notes for finding", g1.status === 200 && g1.data.notes.length === 3, `${g1.data.notes.length} notes`);
  ok("pinned note sorts first", g1.data.notes[0]?.id === note3.id, g1.data.notes[0]?.content);

  const g2 = await j("GET", `/api/notes?projectId=${PROJ}&findingId=nonexistent-id`);
  ok("notes for unknown finding = empty", g2.status === 200 && g2.data.notes.length === 0);

  const badFinding = await j("POST", "/api/notes", { projectId: PROJ, findingId: "not-a-finding", content: "x" });
  ok("note for foreign finding rejected", badFinding.status === 404);

  console.log("== Pin / edit / delete ==");
  const p1 = await j("PATCH", "/api/notes", { id: note1.id, pinned: true });
  ok("pin note", p1.status === 200 && p1.data.note.pinned === true);
  const p2 = await j("PATCH", "/api/notes", { id: note1.id, content: "Edited triage note" });
  ok("edit note content", p2.status === 200 && p2.data.note.content === "Edited triage note");
  const p3 = await j("PATCH", "/api/notes", { id: note1.id, content: "" });
  ok("empty edit rejected", p3.status === 400);

  const d1 = await j("DELETE", `/api/notes?id=${note2.id}`);
  ok("delete note", d1.status === 200);
  const g3 = await j("GET", `/api/notes?projectId=${PROJ}&findingId=${finding.id}`);
  ok("deleted note gone", g3.data.notes.length === 2);

  console.log("== Project-level notes (no findingId) ==");
  const c4 = await j("POST", "/api/notes", { projectId: PROJ, content: "Project-level journal note" });
  ok("create project note", c4.status === 201);
  const g4 = await j("GET", `/api/notes?projectId=${PROJ}`);
  ok("project notes listed separately", g4.data.notes.some((n) => n.content === "Project-level journal note"));
  const g5 = await j("GET", `/api/notes?projectId=${PROJ}&findingId=${finding.id}`);
  ok("finding notes exclude project note", !g5.data.notes.some((n) => n.content === "Project-level journal note"));

  console.log("== Cleanup ==");
  for (const n of [note1.id, note3.id, c4.data.note.id]) await j("DELETE", `/api/notes?id=${n}`);
  const g6 = await j("GET", `/api/notes?projectId=${PROJ}`);
  ok("all test notes removed", g6.data.notes.length === 0);

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
