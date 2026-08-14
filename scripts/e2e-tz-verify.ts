// E2E — appointment time fixes (timezone + ASAP short-circuit + business hours).
// Verifies against the PUBLISHED server (localhost:3000) with a REAL provisioned
// Twilio number on a separate test workspace:
//   (1) happy path: "next Saturday at 12pm" lands on Saturday 12:00 in the
//       workspace timezone (America/Phoenix → correct UTC instant 19:00Z),
//       Nova's spoken confirmation matches, call row outcome=appointment_booked.
//   (2) closed-day honesty: same request to the OWNER's number (Mon-Fri hours)
//       → Nova says the day is closed + offers the next open day, NO silent
//       booking, no appointment/lead rows created.
//   (3) cleanup: FK-safe deletion of all test rows; owner workspace back to 0.
//
// Run: bun scripts/e2e-tz-verify.ts   (from /home/team/shared/site; bun auto-loads .env)
import { db } from "../src/db/index";
import { leads, appointments, calls, workspaces, activityLog } from "../src/db/schema";
import { eq, and } from "drizzle-orm";
import { provisionForWorkspace, releaseNumber } from "../src/lib/twilio-provision";
import { parseDateTimeHint, pickBestSlot, parseBusinessHours, zonedTimeToUtc, getDayOfWeek, getHour } from "../src/lib/booking";

const BASE = "http://localhost:3000/api/twilio/webhooks/voice";
const TZ = "America/Phoenix";
const TEST_WS = "ws_tz_test";
const OWNER_WS = "ws_2w3a8uul";
const OWNER_TO = "+14472514467";
const FROM = "+15550007777";

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

// The live server TTS-es every reply, so the XML contains <Play> URLs, not
// spoken text. The actual response text is logged by twilio-handler — read it
// back from the server log (last "Nova says" line for the call).
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

// ── helpers ────────────────────────────────────────────────────────────────
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
  // ── SETUP: fresh test workspace with Saturday hours + Phoenix tz ─────
  console.log("== SETUP ==");
  await deleteWorkspaceRows(TEST_WS);
  await db.insert(workspaces).values({
    id: TEST_WS,
    name: "Test Roofing Co",
    fromName: "Test Roofing Co",
    fromEmail: "test@klerkitai.com",
    timezone: TZ,
    receptionistConfig: {
      businessName: "Test Roofing Co",
      businessType: "roofing",
      businessHours: "Monday through Saturday, 9am to 5pm",
      description: "Roofing repair and replacement company",
    },
  });
  const prov = await provisionForWorkspace();
  if (!prov) throw new Error("PROVISION FAILED — Twilio not configured?");
  testNumber = prov.number;
  await db.update(workspaces).set({ twilioPhone: prov.number, twilioPhoneSid: prov.sid, phoneMode: "provisioned" }).where(eq(workspaces.id, TEST_WS));
  console.log("  test workspace:", TEST_WS, "number:", prov.number);

  // ── (1) HAPPY PATH — "next Saturday at 12pm" in America/Phoenix ─────
  console.log("== (1) HAPPY PATH: next Saturday at 12pm (Phoenix) ==");
  const g = await hit({ CallSid: "CA-tztst1", From: FROM, To: prov.number, CallStatus: "in-progress" });
  ok("greeting routes to test workspace", hasGreeting(g.text, TEST_WS), g.text.slice(0, 160));

  const b = await hit({ CallSid: "CA-tztst1", From: FROM, To: prov.number, CallStatus: "in-progress", SpeechResult: "my roof has a hole, can someone come look next Saturday at 12pm, my name is Jane Cooper", Confidence: "0.95" });
  const spoken = await novaSaid("CA-tztst1");
  console.log(`  booking turn ${b.ms}ms → "${spoken.slice(0, 130)}"`);

  const now = new Date();
  const hours = parseBusinessHours("Monday through Saturday, 9am to 5pm");
  const hint = parseDateTimeHint("next saturday at 12pm", now, TZ)!;
  const expected = pickBestSlot(hint, hours, new Set(), now, TZ)!;
  console.log(`  expected slot: ${expected.toISOString()} (Sat ${getDayOfWeek(expected, TZ)} @ ${getHour(expected, TZ)}:00 Phoenix)`);

  ok("Nova confirms the Saturday time", /saturday at 12:00 pm/i.test(spoken), spoken);
  ok("uses caller name", spoken.includes("Jane Cooper"), spoken);

  await hit({ CallSid: "CA-tztst1", From: FROM, To: prov.number, CallStatus: "completed" });
  await new Promise((r) => setTimeout(r, 2500));

  const apps = await db.select().from(appointments).where(eq(appointments.workspaceId, TEST_WS));
  const lds = await db.select().from(leads).where(eq(leads.workspaceId, TEST_WS));
  const cs = await db.select().from(calls).where(eq(calls.workspaceId, TEST_WS));
  const appt = apps[0];
  ok("appointment created", apps.length === 1, JSON.stringify(apps.map((a) => a.scheduledAt)));
  ok("stored UTC instant == Saturday 12:00 Phoenix", appt?.scheduledAt.toISOString() === expected.toISOString(), `got ${appt?.scheduledAt.toISOString()} want ${expected.toISOString()}`);
  ok("stored instant is a Saturday in Phoenix", appt ? getDayOfWeek(appt.scheduledAt, TZ) === 6 : false);
  ok("stored instant is 12:00 in Phoenix", appt ? getHour(appt.scheduledAt, TZ) === 12 : false);
  ok("lead created (source=phone)", lds.length === 1 && lds[0]?.name === "Jane Cooper" && lds[0]?.source === "phone", JSON.stringify(lds.map((l) => l.name)));
  const bookedCall = cs.find((c) => c.callSid === "CA-tztst1");
  ok("call row outcome=appointment_booked + linked", bookedCall?.outcome === "appointment_booked" && !!bookedCall?.leadId && !!bookedCall?.appointmentId, JSON.stringify(cs.map((c) => ({ sid: c.callSid, outcome: c.outcome }))));

  // ── (2) CLOSED-DAY HONESTY — owner's number, Mon-Fri hours ──────────
  console.log("== (2) CLOSED-DAY HONESTY: owner number, Saturday requested ==");
  const g2 = await hit({ CallSid: "CA-tztst-owner", From: FROM, To: OWNER_TO, CallStatus: "in-progress" });
  ok("owner greeting routes to owner workspace", hasGreeting(g2.text, OWNER_WS), g2.text.slice(0, 160));

  const b2 = await hit({ CallSid: "CA-tztst-owner", From: FROM, To: OWNER_TO, CallStatus: "in-progress", SpeechResult: "my roof has a hole, can someone come look next Saturday at 12pm, my name is Bob Smith", Confidence: "0.95" });
  const spoken2 = await novaSaid("CA-tztst-owner");
  console.log(`  closed-day turn ${b2.ms}ms → "${spoken2.slice(0, 160)}"`);
  ok("Nova says the day is closed", /closed/i.test(spoken2), spoken2);
  ok("Nova offers the next open day (Monday)", /monday/i.test(spoken2), spoken2);
  ok("Nova did NOT confirm a booking", !/all set|booked|confirmed for/i.test(spoken2), spoken2);

  await hit({ CallSid: "CA-tztst-owner", From: FROM, To: OWNER_TO, CallStatus: "completed" });
  await new Promise((r) => setTimeout(r, 2500));

  const ownerApps = await db.select({ id: appointments.id }).from(appointments).where(eq(appointments.workspaceId, OWNER_WS));
  const ownerLds = await db.select({ id: leads.id }).from(leads).where(eq(leads.workspaceId, OWNER_WS));
  ok("NO appointment silently booked in owner workspace", ownerApps.length === 0, `got ${ownerApps.length}`);
  ok("NO lead created in owner workspace", ownerLds.length === 0, `got ${ownerLds.length}`);
  const ownerCall = await db.select().from(calls).where(and(eq(calls.workspaceId, OWNER_WS), eq(calls.callSid, "CA-tztst-owner")));
  ok("owner call row exists (not appointment_booked)", ownerCall.length === 1 && ownerCall[0]?.outcome !== "appointment_booked", JSON.stringify(ownerCall.map((c) => c.outcome)));

  console.log(`\n${pass} passed, ${fail} failed`);
} catch (err) {
  console.error("E2E error:", err);
  fail++;
} finally {
  // ── CLEANUP: FK-safe, release the number, owner back to 0 rows ─────
  console.log("== CLEANUP ==");
  const ws = await db.query.workspaces.findFirst({ where: eq(workspaces.id, TEST_WS), columns: { twilioPhoneSid: true } });
  if (ws?.twilioPhoneSid) {
    const rel = await releaseNumber(ws.twilioPhoneSid);
    console.log("  number released:", rel);
  }
  await deleteWorkspaceRows(TEST_WS);
  await db.delete(calls).where(and(eq(calls.workspaceId, OWNER_WS), eq(calls.callSid, "CA-tztst-owner")));
  const remainA = await db.select({ id: appointments.id }).from(appointments).where(eq(appointments.workspaceId, OWNER_WS));
  const remainL = await db.select({ id: leads.id }).from(leads).where(eq(leads.workspaceId, OWNER_WS));
  const remainC = await db.select({ id: calls.id }).from(calls).where(eq(calls.workspaceId, OWNER_WS));
  const testWsGone = await db.query.workspaces.findFirst({ where: eq(workspaces.id, TEST_WS), columns: { id: true } });
  console.log(`  owner rows after cleanup: appointments=${remainA.length} leads=${remainL.length} calls=${remainC.length} | test ws exists: ${!!testWsGone}`);
}

process.exit(fail > 0 ? 1 : 0);
