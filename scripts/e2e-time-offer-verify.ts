// E2E — "requested time outside business hours → tell + offer closest slot"
// (task f2352c20). Owner's setup: hours Tue-Fri 10:00-17:00, America/Phoenix.
// Replays the exact repro on the PUBLISHED server with a REAL provisioned
// Twilio number on a THROWAWAY workspace:
//   Call A: "I need a plumber" → name → "Tuesday at 9am" → Nova must say NOT
//           open at 9 and offer 10:00 (NO booking yet); "yes" → books 10:00
//           Tuesday Phoenix. Control Call B: "Tuesday at 11am" books 11:00
//           directly, no offer. No re-intro; every webhook < 8s.
// Run: bun scripts/e2e-time-offer-verify.ts   (from /home/team/shared/site)
import { db } from "../src/db/index";
import { leads, appointments, calls, workspaces, activityLog } from "../src/db/schema";
import { eq } from "drizzle-orm";
import { provisionForWorkspace, releaseNumber } from "../src/lib/twilio-provision";
import { getHour, getDayOfWeek, dateKey, parseDateTimeHint } from "../src/lib/booking";

const BASE = "http://localhost:3000/api/twilio/webhooks/voice";
const TZ = "America/Phoenix";
const TEST_WS = "ws_timeoffer_test";
const FROM = "+15550009999";
let pass = 0, fail = 0;
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log("  ✅", label); }
  else { fail++; console.log("  ❌", label, detail); }
};
async function hit(params: Record<string, string>) {
  const body = new URLSearchParams(params);
  const t0 = performance.now();
  const resp = await fetch(BASE, { method: "POST", body, headers: { "Content-Type": "application/x-www-form-urlencoded" } });
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
const greetingKey = (wsId: string) => `ws:greeting:${wsId}:`;
const hasGreeting = (xml: string, wsId: string) =>
  xml.includes(encodeURIComponent(greetingKey(wsId))) || xml.includes(greetingKey(wsId));

async function deleteWorkspaceRows(wsId: string) {
  await db.delete(calls).where(eq(calls.workspaceId, wsId));
  const l = await db.select({ id: leads.id }).from(leads).where(eq(leads.workspaceId, wsId));
  for (const r of l) await db.delete(appointments).where(eq(appointments.leadId, r.id));
  await db.delete(leads).where(eq(leads.workspaceId, wsId));
  await db.delete(activityLog).where(eq(activityLog.workspaceId, wsId));
  await db.delete(workspaces).where(eq(workspaces.id, wsId));
}

try {
  console.log("== SETUP ==");
  await deleteWorkspaceRows(TEST_WS);
  await db.insert(workspaces).values({
    id: TEST_WS,
    name: "Time Offer Plumbing",
    fromName: "Time Offer Plumbing",
    fromEmail: "timeoffer@klerkitai.com",
    timezone: TZ,
    receptionistConfig: {
      businessName: "Time Offer Plumbing",
      businessType: "plumbing",
      businessHours: "Tuesday through Friday, 10am to 5pm",
      description: "Plumbing repair and service company",
    },
  });
  const prov = await provisionForWorkspace();
  if (!prov) throw new Error("PROVISION FAILED — Twilio not configured?");
  await db.update(workspaces).set({ twilioPhone: prov.number, twilioPhoneSid: prov.sid, phoneMode: "provisioned" }).where(eq(workspaces.id, TEST_WS));
  console.log("  test workspace:", TEST_WS, "number:", prov.number);

  // ── CALL A: "Tuesday at 9am" → not open + offer 10:00 → "yes" → books ──
  const A = "CA-timeoffer-a";
  console.log("== CALL A: Tuesday at 9am (before opening) ==");
  const g = await hit({ CallSid: A, From: FROM, To: prov.number, CallStatus: "in-progress" });
  ok("greeting routes to test workspace", hasGreeting(g.text, TEST_WS), g.text.slice(0, 140));
  const t1 = await hit({ CallSid: A, From: FROM, To: prov.number, CallStatus: "in-progress", SpeechResult: "I need a plumber", Confidence: "0.95" });
  ok(`A1 ${t1.ms}ms`, t1.ms < 8000, `${t1.ms}ms`);
  const t2 = await hit({ CallSid: A, From: FROM, To: prov.number, CallStatus: "in-progress", SpeechResult: "my name is Sam Rivera", Confidence: "0.95" });
  ok(`A2 ${t2.ms}ms`, t2.ms < 8000, `${t2.ms}ms`);
  const t3 = await hit({ CallSid: A, From: FROM, To: prov.number, CallStatus: "in-progress", SpeechResult: "Tuesday at 9am", Confidence: "0.95" });
  const s3 = await novaSaid(A);
  console.log(`  A3 ${t3.ms}ms → "${s3.slice(0, 170)}"`);
  ok("A3 fast (<8s)", t3.ms < 8000, `${t3.ms}ms`);
  ok("A3 says NOT open at 9:00 AM", /not open at 9:00 AM/i.test(s3), s3.slice(0, 170));
  ok("A3 offers 10:00", /10:00 AM/i.test(s3), s3.slice(0, 170));
  ok("A3 does NOT confirm a booking", !/all set|booked|confirmed for/i.test(s3), s3.slice(0, 170));
  ok("A3 no re-intro", !/this is nova/i.test(s3), s3.slice(0, 120));
  await new Promise((r) => setTimeout(r, 2000));
  const appsAfterOffer = await db.select().from(appointments).where(eq(appointments.workspaceId, TEST_WS));
  ok("NO appointment created on the offer turn", appsAfterOffer.length === 0, `got ${appsAfterOffer.length}`);

  const t4 = await hit({ CallSid: A, From: FROM, To: prov.number, CallStatus: "in-progress", SpeechResult: "yes", Confidence: "0.95" });
  const s4 = await novaSaid(A);
  console.log(`  A4 ${t4.ms}ms → "${s4.slice(0, 170)}"`);
  ok("A4 fast (<8s)", t4.ms < 8000, `${t4.ms}ms`);
  ok("A4 confirms booking", /all set|booked|confirmed for/i.test(s4), s4.slice(0, 170));
  ok("A4 confirms 10:00 AM", /10:00 AM/i.test(s4), s4.slice(0, 170));
  ok("A4 no re-intro", !/this is nova/i.test(s4), s4.slice(0, 120));
  await hit({ CallSid: A, From: FROM, To: prov.number, CallStatus: "completed" });
  await new Promise((r) => setTimeout(r, 2500));

  // ── CALL B (control): "Tuesday at 11am" → books directly, no offer ──
  const B = "CA-timeoffer-b";
  console.log("== CALL B (control): Tuesday at 11am ==");
  const gb = await hit({ CallSid: B, From: FROM, To: prov.number, CallStatus: "in-progress" });
  ok("greeting routes to test workspace", hasGreeting(gb.text, TEST_WS), gb.text.slice(0, 140));
  await hit({ CallSid: B, From: FROM, To: prov.number, CallStatus: "in-progress", SpeechResult: "I need a plumber", Confidence: "0.95" });
  await hit({ CallSid: B, From: FROM, To: prov.number, CallStatus: "in-progress", SpeechResult: "my name is Dana Kim", Confidence: "0.95" });
  const b3 = await hit({ CallSid: B, From: FROM, To: prov.number, CallStatus: "in-progress", SpeechResult: "Tuesday at 11am", Confidence: "0.95" });
  const sb3 = await novaSaid(B);
  console.log(`  B3 ${b3.ms}ms → "${sb3.slice(0, 170)}"`);
  ok("B3 fast (<8s)", b3.ms < 8000, `${b3.ms}ms`);
  ok("B3 confirms booking", /all set|booked|confirmed for/i.test(sb3), sb3.slice(0, 170));
  ok("B3 confirms 11:00 AM", /11:00 AM/i.test(sb3), sb3.slice(0, 170));
  ok("B3 has NO offer language", !/not open|closest available|work for you instead/i.test(sb3), sb3.slice(0, 170));
  ok("B3 no re-intro", !/this is nova/i.test(sb3), sb3.slice(0, 120));
  await hit({ CallSid: B, From: FROM, To: prov.number, CallStatus: "completed" });
  await new Promise((r) => setTimeout(r, 2500));

  // ── DB VERIFY ──
  console.log("== DB VERIFY ==");
  const apps = await db.select().from(appointments).where(eq(appointments.workspaceId, TEST_WS));
  const lds = await db.select().from(leads).where(eq(leads.workspaceId, TEST_WS));
  // "Tuesday" on a Tuesday resolves to next week's Tuesday (parser convention
  // `diff === 0 ? 7 : diff`), so assert against the resolved day dynamically.
  const resolvedTue = parseDateTimeHint("tuesday", new Date(), TZ)!.day;
  const expDayKey = dateKey(resolvedTue, TZ);
  ok("two appointments created", apps.length === 2, JSON.stringify(apps.map((a) => a.scheduledAt.toISOString())));
  const a10 = apps.find((a) => getHour(a.scheduledAt, TZ) === 10);
  const a11 = apps.find((a) => getHour(a.scheduledAt, TZ) === 11);
  ok("call A appointment = resolved Tuesday 10:00 Phoenix",
    !!a10 && getDayOfWeek(a10.scheduledAt, TZ) === 2 && dateKey(a10.scheduledAt, TZ) === expDayKey && a10.scheduledAt.getUTCHours() === 17,
    a10?.scheduledAt.toISOString());
  ok("call B appointment = resolved Tuesday 11:00 Phoenix",
    !!a11 && getDayOfWeek(a11.scheduledAt, TZ) === 2 && dateKey(a11.scheduledAt, TZ) === expDayKey && a11.scheduledAt.getUTCHours() === 18,
    a11?.scheduledAt.toISOString());
  const leadA = lds.find((l) => l.name === "Sam Rivera");
  const leadB = lds.find((l) => l.name === "Dana Kim");
  ok("lead A (Sam Rivera, phone)", !!leadA && leadA.source === "phone");
  ok("lead B (Dana Kim, phone)", !!leadB && leadB.source === "phone");

  console.log(`\n${pass} passed, ${fail} failed`);
} catch (err) {
  console.error("E2E error:", err);
  fail++;
} finally {
  console.log("== CLEANUP ==");
  const ws = await db.query.workspaces.findFirst({ where: eq(workspaces.id, TEST_WS), columns: { twilioPhoneSid: true } });
  if (ws?.twilioPhoneSid) {
    const rel = await releaseNumber(ws.twilioPhoneSid);
    console.log("  number released:", rel);
  }
  await deleteWorkspaceRows(TEST_WS);
  const wsGone = await db.query.workspaces.findFirst({ where: eq(workspaces.id, TEST_WS), columns: { id: true } });
  console.log("  test ws exists:", !!wsGone);
}
process.exit(fail > 0 ? 1 : 0);
