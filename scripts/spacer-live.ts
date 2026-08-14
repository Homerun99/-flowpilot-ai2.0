// Live E2E — appointmentSpacer (task afc0e6db) on the PUBLISHED server
// (localhost:3000 === flowpilotai.ctonew.app).
// Covers:
//   A. POST /api/workspace/receptionist-config {appointmentSpacer: 30} →
//      200 + response.config.appointmentSpacer === 30
//   B. GET returns 30 → DB row has 30
//   C. Old-client partial save (omits appointmentSpacer) → still 30 (carry-over)
//   D. Booking-engine reflection through the FULL voice stack: seed an
//      appointment at 9:00 on the next open day, caller asks for "9 am" →
//      TIME_UNAVAILABLE deterministic offer MUST be 11:00 AM (spacer 30 blocks
//      9:00 AND 10:00; without the spacer it would offer 10:00). No DB write.
//   E. Cleanup (throwaway workspace + seed rows).
//
// Uses a FAKE Twilio number on the throwaway workspace (serve.ts routes by
// twilioPhone == To, so a POST with To=+15559990001 resolves to the test
// workspace — no Twilio API calls needed, provisioning is 401-blocked).
//
// Run: bun scripts/spacer-live.ts   (from /home/team/shared/site)
import { db } from "../src/db/index";
import { leads, appointments, calls, workspaces, activityLog } from "../src/db/schema";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { parseDateTimeHint, zonedTimeToUtc, startOfDay, addDays, getDayOfWeek } from "../src/lib/booking";

const API = "http://localhost:3000";
const VOICE = `${API}/api/twilio/webhooks/voice`;
const TZ = "America/Phoenix";
const WS = "ws_spacer_live";
const PHONE = "+15559990001"; // fake; routes webhook POSTs to WS
const FROM = "+15550007777";
const CALLSID = `CA-spacer-live-${Date.now()}`;
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
  const re = new RegExp(`\\[twilio-handler\\] ${callSid} Nova says(?:\\([^)]*\\))?: ([^\\n]+)`, "g");
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
    name: "Spacer Live",
    twilioPhone: PHONE,
    timezone: TZ,
    receptionistConfig: {
      businessName: "Spacer Live Co",
      businessType: "test",
      businessHours: "Monday-Friday 9am-5pm",
      customInstructions: "Be friendly and professional.",
    },
  });
  console.log("== SETUP ==");
  ok("throwaway workspace created", true);

  // ── A/B/C. POST → GET → DB → carry-over ───────────────────────────────
  console.log("\n== A. POST appointmentSpacer: 30 ==");
  const p = await postConfig({ workspace_id: WS, appointmentSpacer: 30 });
  ok("POST returns 200", p.status === 200, `status=${p.status}`);
  ok("response config.appointmentSpacer === 30", p.json?.config?.appointmentSpacer === 30, JSON.stringify(p.json?.config));

  console.log("\n== B. GET + DB reflect it ==");
  const g = await getConfig();
  ok("GET returns appointmentSpacer === 30", g?.config?.appointmentSpacer === 30, JSON.stringify(g?.config));
  const d = await dbConfig();
  ok("DB row appointmentSpacer === 30", d?.appointmentSpacer === 30, JSON.stringify(d?.appointmentSpacer));

  console.log("\n== C. partial save carries it over ==");
  const p2 = await postConfig({ workspace_id: WS, businessName: "Spacer Live Co 2" });
  const g2 = await getConfig();
  ok("POST omitting appointmentSpacer → 200", p2.status === 200, `status=${p2.status}`);
  ok("GET still 30 after partial save", g2?.config?.appointmentSpacer === 30, JSON.stringify(g2?.config));
  ok("businessName updated", g2?.config?.businessName === "Spacer Live Co 2", JSON.stringify(g2?.config?.businessName));

  // ── D. Voice stack: spacer pushes the TIME_UNAVAILABLE offer ──────────
  console.log("\n== D. voice flow: 9:00 seeded + spacer 30 → offer 11:00 ==");
  // Next open Mon-Fri day strictly after today (Phoenix) — never the same
  // weekday, so a bare weekday phrase resolves to it unambiguously.
  const now = new Date();
  let target: Date | null = null;
  for (let i = 1; i <= 14; i++) {
    const d2 = addDays(startOfDay(now, TZ), i, TZ);
    const dow = getDayOfWeek(d2, TZ);
    if (dow >= 1 && dow <= 5) { target = d2; break; }
  }
  if (!target) throw new Error("no open day found");
  const wp = { y: target.getFullYear(), mo: target.getMonth() + 1, d: target.getDate() };
  const weekdayName = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "long" }).format(target);
  const phrase = `I need an appointment ${weekdayName.toLowerCase()} at 9 am`;
  const seedAt = zonedTimeToUtc(wp.y, wp.mo, wp.d, 9, 0, TZ);
  const seedId = `ap-spacer-live-${Date.now()}`;
  await db.insert(appointments).values({ id: seedId, workspaceId: WS, leadId: null, title: "Spacer live seed", scheduledAt: seedAt, status: "scheduled" });
  ok(`seeded appointment at ${weekdayName} 9:00 (${seedAt.toISOString()})`, true);

  const t1 = await hit({ To: PHONE, From: FROM, CallSid: CALLSID, CallStatus: "ringing" });
  ok("T1 greeting XML (has Gather, no Hangup)", t1.status === 200 && t1.text.includes("<Gather") && !t1.text.includes("<Hangup"), `status=${t1.status}`);
  ok("T1 < 8s", t1.ms < 8000, `${t1.ms}ms`);

  const t2 = await hit({ To: PHONE, From: FROM, CallSid: CALLSID, SpeechResult: phrase, SpeechConfidence: "0.95" });
  ok("T2 booking intent → asks for name (<8s)", t2.status === 200 && t2.ms < 8000 && !t2.text.includes("<Hangup"), `status=${t2.status} ${t2.ms}ms`);

  const t3 = await hit({ To: PHONE, From: FROM, CallSid: CALLSID, SpeechResult: "my name is Jane Doe", SpeechConfidence: "0.95" });
  ok("T3 < 8s", t3.ms < 8000, `${t3.ms}ms`);
  const said = await novaSaid(CALLSID);
  console.log(`    Nova's last line: "${said}"`);
  ok("T3 deterministic time offer mentions 11:00 AM (spacer blocked 9:00+10:00)", /11:00 AM/.test(said), said);
  ok("T3 offer does NOT mention 10:00 AM (spacer 0 would offer 10:00)", !/10:00 AM/.test(said), said);
  ok("T3 never claims a booking (no 'all set'/'confirmed'/'scheduled for')", !/\ball set\b|\bconfirmed\b|\bscheduled for\b|\bsee you\b/i.test(said), said);

  // No new DB rows beyond the seed (TIME_UNAVAILABLE must not write).
  const leadsForWs = await db.select({ id: leads.id }).from(leads).where(eq(leads.workspaceId, WS));
  const apptsForWs = await db.select({ id: appointments.id }).from(appointments).where(eq(appointments.workspaceId, WS));
  ok("no lead created (TIME_UNAVAILABLE doesn't write)", leadsForWs.length === 0, `leads=${leadsForWs.length}`);
  ok("only the seed appointment exists", apptsForWs.length === 1, `appts=${apptsForWs.length}`);

  // ── Cleanup ───────────────────────────────────────────────────────────
  console.log("\n== CLEANUP ==");
  await deleteWorkspaceRows(WS);
  const gone = await db.query.workspaces.findFirst({ where: eq(workspaces.id, WS) });
  ok("throwaway workspace deleted", !gone);

  console.log(`\n${pass} passed, ${fail} failed`);
}

main().catch(async (err) => {
  console.error("spacer-live error:", err);
  fail++;
  await deleteWorkspaceRows(WS).catch(() => {});
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}).then(() => { process.exit(fail > 0 ? 1 : 0); });
