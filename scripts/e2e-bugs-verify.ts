// E2E — 3 real-call receptionist bugs (task 2a2086ff).
// Replays the owner's exact repro on the PUBLISHED server (localhost:3000)
// with a REAL provisioned Twilio number on a THROWAWAY test workspace:
//   "roof inspection" → name → "Saturday at noon" → closed message →
//   "Monday instead" → MUST book MONDAY (never "today"), MUST NOT
//   re-introduce Nova, MUST NOT time out (every webhook < 8s).
//
// Run: bun scripts/e2e-bugs-verify.ts   (from /home/team/shared/site)
import { db } from "../src/db/index";
import { leads, appointments, calls, workspaces, activityLog } from "../src/db/schema";
import { eq, and } from "drizzle-orm";
import { provisionForWorkspace, releaseNumber } from "../src/lib/twilio-provision";
import {
  parseDateTimeHint,
  pickBestSlot,
  parseBusinessHours,
  getDayOfWeek,
  getHour,
  findNextOpenDay,
} from "../src/lib/booking";

const BASE = "http://localhost:3000/api/twilio/webhooks/voice";
const TZ = "America/Phoenix";
const TEST_WS = "ws_bugs_test";
const FROM = "+15550008888";
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
// The live server TTS-es every reply → XML has <Play> URLs, not text. The
// spoken text is in the server log ("Nova says ..." lines).
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

let testNumber = "";
try {
  // ── SETUP: throwaway workspace, Mon-Fri hours (Saturday closed → offer Monday) ──
  console.log("== SETUP ==");
  await deleteWorkspaceRows(TEST_WS);
  await db.insert(workspaces).values({
    id: TEST_WS,
    name: "Bug Test Roofing",
    fromName: "Bug Test Roofing",
    fromEmail: "bugtest@klerkitai.com",
    timezone: TZ,
    receptionistConfig: {
      businessName: "Bug Test Roofing",
      businessType: "roofing",
      businessHours: "Monday through Friday, 9am to 5pm",
      description: "Roofing repair and replacement company",
    },
  });
  const prov = await provisionForWorkspace();
  if (!prov) throw new Error("PROVISION FAILED — Twilio not configured?");
  testNumber = prov.number;
  await db.update(workspaces).set({ twilioPhone: prov.number, twilioPhoneSid: prov.sid, phoneMode: "provisioned" }).where(eq(workspaces.id, TEST_WS));
  console.log("  test workspace:", TEST_WS, "number:", prov.number);

  // Expected Monday: request "saturday at noon" → closed → next open = Monday.
  const now = new Date();
  const hours = parseBusinessHours("Monday through Friday, 9am to 5pm");
  const satHint = parseDateTimeHint("saturday at noon", now, TZ)!;
  const offered = findNextOpenDay(satHint.day, hours, TZ)!;
  const expected = pickBestSlot({ day: offered, preferEarliest: false }, hours, new Set(), now, TZ)!;
  console.log(`  expected booking: ${expected.toISOString()} (${getDayOfWeek(expected, TZ)} @ ${getHour(expected, TZ)}:00 Phoenix — ${expected.toISOString().slice(0,10)})`);

  const SID = "CA-bugs-repro-001";
  // ── GREETING ──
  console.log("== GREETING ==");
  const g = await hit({ CallSid: SID, From: FROM, To: prov.number, CallStatus: "in-progress" });
  ok("greeting routes to test workspace", hasGreeting(g.text, TEST_WS), g.text.slice(0, 160));
  ok("greeting answered fast (<8s)", g.ms < 8000, `${g.ms}ms`);

  // ── TURN 1: "roof inspection" — wants booking, no time yet ──
  console.log("== TURN 1: roof inspection ==");
  const t1 = await hit({ CallSid: SID, From: FROM, To: prov.number, CallStatus: "in-progress", SpeechResult: "I need a roof inspection, can someone come out and take a look", Confidence: "0.95" });
  const s1 = await novaSaid(SID);
  console.log(`  ${t1.ms}ms → "${s1.slice(0, 140)}"`);
  ok("turn 1 answered fast (<8s)", t1.ms < 8000, `${t1.ms}ms`);
  ok("turn 1 does NOT re-introduce Nova", !/this is nova|hello, you've reached/i.test(s1), s1.slice(0, 120));

  // ── TURN 2: caller gives name ──
  console.log("== TURN 2: name ==");
  const t2 = await hit({ CallSid: SID, From: FROM, To: prov.number, CallStatus: "in-progress", SpeechResult: "my name is Jensen Taylor", Confidence: "0.95" });
  const s2 = await novaSaid(SID);
  console.log(`  ${t2.ms}ms → "${s2.slice(0, 140)}"`);
  ok("turn 2 answered fast (<8s)", t2.ms < 8000, `${t2.ms}ms`);
  ok("turn 2 does NOT re-introduce Nova", !/this is nova/i.test(s2), s2.slice(0, 120));

  // ── TURN 3: "Saturday at noon" → closed → offers Monday (deterministic) ──
  console.log("== TURN 3: Saturday at noon ==");
  const t3 = await hit({ CallSid: SID, From: FROM, To: prov.number, CallStatus: "in-progress", SpeechResult: "Saturday at noon", Confidence: "0.95" });
  const s3 = await novaSaid(SID);
  console.log(`  ${t3.ms}ms → "${s3.slice(0, 160)}"`);
  ok("turn 3 answered fast (<8s)", t3.ms < 8000, `${t3.ms}ms`);
  ok("Nova says Saturday is closed", /closed/i.test(s3), s3.slice(0, 160));
  ok("Nova offers the next open day (Monday)", /monday/i.test(s3), s3.slice(0, 160));
  ok("Nova did NOT book yet", !/all set|booked|confirmed for/i.test(s3), s3.slice(0, 160));
  ok("turn 3 does NOT re-introduce Nova", !/this is nova/i.test(s3), s3.slice(0, 120));

  // ── TURN 4: "Monday instead" → MUST book MONDAY (the actual bug) ──
  console.log("== TURN 4: 'Monday instead' ==");
  const t4 = await hit({ CallSid: SID, From: FROM, To: prov.number, CallStatus: "in-progress", SpeechResult: "Monday instead", Confidence: "0.95" });
  const s4 = await novaSaid(SID);
  console.log(`  ${t4.ms}ms → "${s4.slice(0, 160)}"`);
  ok("turn 4 answered fast (<8s)", t4.ms < 8000, `${t4.ms}ms`);
  ok("Nova confirms a booking", /all set|booked|confirmed for/i.test(s4), s4.slice(0, 160));
  ok("confirmation names MONDAY", /monday/i.test(s4), s4.slice(0, 160));
  ok("confirmation does NOT say today", !/today/i.test(s4), s4.slice(0, 160));
  ok("confirmation has the specific time", /9:00 am/i.test(s4), s4.slice(0, 160));
  ok("uses the caller's name", s4.includes("Jensen Taylor"), s4.slice(0, 160));
  ok("turn 4 does NOT re-introduce Nova", !/this is nova/i.test(s4), s4.slice(0, 120));

  // ── VERIFY DB STATE ──
  console.log("== DB VERIFY ==");
  const apps = await db.select().from(appointments).where(eq(appointments.workspaceId, TEST_WS));
  const lds = await db.select().from(leads).where(eq(leads.workspaceId, TEST_WS));
  const cs = await db.select().from(calls).where(eq(calls.workspaceId, TEST_WS));
  const appt = apps[0];
  ok("appointment created", apps.length === 1, JSON.stringify(apps.map((a) => a.scheduledAt)));
  ok("stored instant == expected Monday slot", appt?.scheduledAt.toISOString() === expected.toISOString(), `got ${appt?.scheduledAt.toISOString()} want ${expected.toISOString()}`);
  ok("stored day is Monday in Phoenix", appt ? getDayOfWeek(appt.scheduledAt, TZ) === 1 : false, `dow=${appt ? getDayOfWeek(appt.scheduledAt, TZ) : "?"}`);
  ok("stored time is 9:00 AM Phoenix", appt ? getHour(appt.scheduledAt, TZ) === 9 : false, `hour=${appt ? getHour(appt.scheduledAt, TZ) : "?"}`);
  ok("NOT booked for today", appt ? appt.scheduledAt.toISOString().slice(0, 10) !== now.toISOString().slice(0, 10) : true, appt?.scheduledAt.toISOString());
  ok("lead created (source=phone, Jensen Taylor)", lds.length === 1 && lds[0]?.name === "Jensen Taylor" && lds[0]?.source === "phone", JSON.stringify(lds.map((l) => l.name)));
  const call = cs.find((c) => c.callSid === SID);
  ok("call row outcome=appointment_booked + linked", call?.outcome === "appointment_booked" && !!call?.leadId && !!call?.appointmentId, JSON.stringify(cs.map((c) => ({ sid: c.callSid, outcome: c.outcome }))));

  console.log(`\n${pass} passed, ${fail} failed`);
} catch (err) {
  console.error("E2E error:", err);
  fail++;
} finally {
  // ── CLEANUP: FK-safe, release the number ──
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
