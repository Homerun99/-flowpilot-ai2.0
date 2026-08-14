// Live E2E for task 721eee4c — keyQuestions config field + Nova voice
// integration, against the PUBLISHED server on a throwaway workspace.
//
//   A. POST keyQuestions → 200 + response matches
//   B. GET + DB reflect it
//   C. Partial save (omits keyQuestions) → carried over
//   D. VOICE: caller says something matching an IF condition → Nova's reply
//      contains the Then-ask question ("Is the damage extensive?")
//   E. VOICE control: caller with an unrelated need → NO key question asked
//   F. No phantom DB writes (no lead / appointment rows from D/E)
//   G. Cleanup (throwaway workspace deleted)
//
// Uses a FAKE Twilio number on the throwaway workspace (serve.ts routes by
// twilioPhone == To, so a POST with To=+15559990002 resolves to the test
// workspace — no Twilio API calls needed, provisioning is 401-blocked).
//
// Run: bun scripts/key-questions-live.ts   (from /home/team/shared/site)
import { db } from "../src/db/index";
import { leads, appointments, calls, workspaces, activityLog } from "../src/db/schema";
import { eq } from "drizzle-orm";
const API = "http://localhost:3000";
const VOICE = `${API}/api/twilio/webhooks/voice`;
const TZ = "America/Phoenix";
const WS = "ws_keyq_live";
const PHONE = "+15559990002"; // fake; routes webhook POSTs to WS
const FROM = "+15550008888";
const CALLSID_A = `CA-keyq-live-a-${Date.now()}`;
const CALLSID_B = `CA-keyq-live-b-${Date.now()}`;
let pass = 0, fail = 0;
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log("  ✅", label); }
  else { fail++; console.log("  ❌", label, detail); }
};
async function hit(params: Record<string, string>) {
  const body = new URLSearchParams(params);
  const t0 = performance.now();
  const resp = await fetch(VOICE, { method: "POST", body, headers: { "Content-Type": "application/x-www-form-urlencoded" } });
  const ms = Math.round(performance.now() - t0);
  const text = await resp.text();
  return { ms, status: resp.status, text };
}
async function novaSaid(callSid: string): Promise<string> {
  const log = await Bun.file(`${import.meta.dir}/../.run/server.log`).text();
  const re = new RegExp(`\\[twilio-handler\\] ${callSid} Nova says(?:\\\\([^)]*\\\\))?: ([^\\n]+)`, "g");
  let last = "";
  for (const m of log.matchAll(re)) last = m[1];
  return last.trim();
}
async function postConfig(body: Record<string, unknown>) {
  const resp = await fetch(`${API}/api/workspace/receptionist-config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: resp.status, json: await resp.json() as any };
}
async function getConfig() {
  const resp = await fetch(`${API}/api/workspace/receptionist-config?workspace=${WS}`);
  return await resp.json() as any;
}
async function dbConfig(): Promise<Record<string, unknown> | null> {
  const ws = await db.query.workspaces.findFirst({
    where: eq(workspaces.id, WS),
    columns: { receptionistConfig: true },
  });
  return (ws?.receptionistConfig as Record<string, unknown>) ?? null;
}
async function deleteWorkspaceRows(wsId: string) {
  await db.delete(calls).where(eq(calls.workspaceId, wsId));
  const l = await db.select({ id: leads.id }).from(leads).where(eq(leads.workspaceId, wsId));
  for (const r of l) await db.delete(appointments).where(eq(appointments.leadId, r.id));
  await db.delete(leads).where(eq(leads.workspaceId, wsId));
  await db.delete(appointments).where(eq(appointments.workspaceId, wsId));
  await db.delete(activityLog).where(eq(activityLog.workspaceId, wsId));
  await db.delete(workspaces).where(eq(workspaces.id, wsId));
}
async function main() {
  // ── Setup ─────────────────────────────────────────────────────────────
  await deleteWorkspaceRows(WS); // defensive (in case a prior run died)
  await db.insert(workspaces).values({
    id: WS,
    name: "Key Questions Live",
    twilioPhone: PHONE,
    timezone: TZ,
    receptionistConfig: {
      businessName: "Key Q Plumbing",
      businessType: "plumbing",
      businessHours: "Monday-Friday 9am-5pm",
      customInstructions: "Be friendly and professional.",
    },
  });
  console.log("== SETUP ==");
  ok("throwaway workspace created", true);

  // ── A/B/C. POST → GET → DB → carry-over ───────────────────────────────
  console.log("\n== A. POST keyQuestions ==");
  const kq = [
    { if: "The customer needs a repair of any kind", thenAsk: ["Is the damage extensive?", "How long has this been going on?"] },
    { if: "The customer is calling about pricing or a quote", thenAsk: ["What service are you interested in?"] },
  ];
  const p = await postConfig({ workspace_id: WS, keyQuestions: kq });
  ok("POST returns 200", p.status === 200, `status=${p.status}`);
  ok("response config.keyQuestions matches",
    Array.isArray(p.json?.config?.keyQuestions) && p.json?.config?.keyQuestions.length === 2 &&
    p.json?.config?.keyQuestions[0]?.if === "The customer needs a repair of any kind" &&
    p.json?.config?.keyQuestions[0]?.thenAsk?.[1] === "How long has this been going on?",
    JSON.stringify(p.json?.config?.keyQuestions));
  console.log("\n== B. GET + DB reflect it ==");
  const g = await getConfig();
  ok("GET returns keyQuestions (2 blocks)",
    Array.isArray(g?.config?.keyQuestions) && g?.config?.keyQuestions.length === 2, JSON.stringify(g?.config?.keyQuestions));
  const d = await dbConfig();
  ok("DB row keyQuestions (2 blocks)",
    Array.isArray(d?.keyQuestions) && d?.keyQuestions.length === 2 &&
    d?.keyQuestions[1]?.thenAsk?.[0] === "What service are you interested in?",
    JSON.stringify(d?.keyQuestions));
  console.log("\n== C. partial save carries it over ==");
  const p2 = await postConfig({ workspace_id: WS, businessName: "Key Q Plumbing Co" });
  const g2 = await getConfig();
  ok("POST omitting keyQuestions → 200", p2.status === 200, `status=${p2.status}`);
  ok("GET still 2 blocks after partial save",
    Array.isArray(g2?.config?.keyQuestions) && g2?.config?.keyQuestions.length === 2, JSON.stringify(g2?.config?.keyQuestions));
  ok("businessName updated", g2?.config?.businessName === "Key Q Plumbing Co", JSON.stringify(g2?.config?.businessName));

  // ── D. Voice: matching IF → Then-ask question ─────────────────────────
  console.log("\n== D. voice: caller needs a repair → 'Is the damage extensive?' ==");
  const t1 = await hit({ To: PHONE, From: FROM, CallSid: CALLSID_A, CallStatus: "ringing" });
  ok("T1 greeting XML (has Gather, no Hangup)",
    t1.status === 200 && t1.text.includes("<Gather") && !t1.text.includes("<Hangup"), `status=${t1.status}`);
  ok("T1 < 8s", t1.ms < 8000, `${t1.ms}ms`);
  const t2 = await hit({ To: PHONE, From: FROM, CallSid: CALLSID_A, SpeechResult: "my roof is leaking and I need a repair", SpeechConfidence: "0.95" });
  ok("T2 reply webhook 200 + < 8s", t2.status === 200 && t2.ms < 8000, `status=${t2.status} ${t2.ms}ms`);
  const saidA = await novaSaid(CALLSID_A);
  console.log(`    Nova's line: "${saidA}"`);
  ok("T2 reply contains the Then-ask question ('extensive')", /extensive/i.test(saidA), saidA);
  ok("T2 reply does not claim a booking", !/\ball set\b|\bconfirmed\b|\bscheduled for\b|\bsee you\b/i.test(saidA), saidA);

  // ── E. Voice control: unrelated need → no key question ────────────────
  console.log("\n== E. voice control: unrelated need → no key question ==");
  const u1 = await hit({ To: PHONE, From: FROM, CallSid: CALLSID_B, CallStatus: "ringing" });
  ok("U1 greeting XML (has Gather, no Hangup)",
    u1.status === 200 && u1.text.includes("<Gather") && !u1.text.includes("<Hangup"), `status=${u1.status}`);
  ok("U1 < 8s", u1.ms < 8000, `${u1.ms}ms`);
  const u2 = await hit({ To: PHONE, From: FROM, CallSid: CALLSID_B, SpeechResult: "hi, I have a general question about your company", SpeechConfidence: "0.95" });
  ok("U2 reply webhook 200 + < 8s", u2.status === 200 && u2.ms < 8000, `status=${u2.status} ${u2.ms}ms`);
  const saidB = await novaSaid(CALLSID_B);
  console.log(`    Nova's line: "${saidB}"`);
  ok("U2 reply does NOT contain any key question",
    !/extensive|service are you interested|going on/i.test(saidB), saidB);
  ok("U2 reply is a normal helpful reply (not empty)",
    saidB.length > 10 && !/\ball set\b|\bconfirmed\b/i.test(saidB), saidB);

  // ── F. No phantom DB writes ───────────────────────────────────────────
  console.log("\n== F. no phantom DB writes ==");
  const leadsForWs = await db.select({ id: leads.id }).from(leads).where(eq(leads.workspaceId, WS));
  const apptsForWs = await db.select({ id: appointments.id }).from(appointments).where(eq(appointments.workspaceId, WS));
  ok("no lead created (qualifying turns don't write)", leadsForWs.length === 0, `leads=${leadsForWs.length}`);
  ok("no appointment created", apptsForWs.length === 0, `appts=${apptsForWs.length}`);

  // ── Cleanup ───────────────────────────────────────────────────────────
  console.log("\n== CLEANUP ==");
  await deleteWorkspaceRows(WS);
  const gone = await db.query.workspaces.findFirst({ where: eq(workspaces.id, WS) });
  ok("throwaway workspace deleted", !gone);
  console.log(`\n${pass} passed, ${fail} failed`);
}
main().catch(async (err) => {
  console.error("key-questions-live error:", err);
  fail++;
  await deleteWorkspaceRows(WS).catch(() => {});
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}).then(() => { process.exit(fail > 0 ? 1 : 0); });
