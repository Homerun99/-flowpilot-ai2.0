// E2E — phantom-booking guard + ASAP capture + name capture (task c4e8b071).
// Replays the EXACT failing transcript from the owner's real call
// CAc25e82bfdfc4389e54f4f12265f7cf7a (ws_2w3a8uul) against a throwaway
// Twilio number/workspace. The bug: Nova said "you're all set for tomorrow at
// 10:00 AM" but NO lead and NO appointment were written. After the fix:
//   • "…just as soon as possible" must be captured as an ASAP hint (booking
//     flow starts, ASK_NAME).
//   • "yeah, Jackie" must capture the name deterministically and BOOK the
//     earliest slot — with the DB write completing BEFORE the confirmation is
//     spoken (verified by log ordering + a lead/appointment row in the DB).
//   • The post-booking "As soon as possible. Yeah." turn must not create a
//     second phantom booking and must not be mangled by the guard.
//   • The call row must finalize to status=completed via the statusCallback
//     endpoint (fix E), preserving outcome=appointment_booked.
//   • A control call (normal booking) and a freewheel call ("Sounds good to
//     me." with no booking) must not produce phantom confirmations/rows.
//   • Owner workspace ws_2w3a8uul must remain untouched.
// Run: bun scripts/e2e-phantom-verify.ts  (from /home/team/shared/site)
import { db } from "../src/db/index";
import { leads, appointments, calls, workspaces, activityLog, users } from "../src/db/schema";
import { eq } from "drizzle-orm";
import { provisionForWorkspace, releaseNumber } from "../src/lib/twilio-provision";

const VOICE = "http://localhost:3000/api/twilio/webhooks/voice";
const STATUS = "http://localhost:3000/api/twilio/webhooks/status";
const TZ = "America/Phoenix";
const TEST_WS = "ws_phantom_test";
const FROM = "+15550009999";
const OWNER_WS = "ws_2w3a8uul";
let pass = 0, fail = 0;
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log("  ✅", label); }
  else { fail++; console.log("  ❌", label, detail); }
};
async function hit(base: string, params: Record<string, string>) {
  const body = new URLSearchParams(params);
  const t0 = performance.now();
  const resp = await fetch(base, { method: "POST", body, headers: { "Content-Type": "application/x-www-form-urlencoded" } });
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
  await db.delete(users).where(eq(users.workspaceId, wsId));
  await db.delete(calls).where(eq(calls.workspaceId, wsId));
  const l = await db.select({ id: leads.id }).from(leads).where(eq(leads.workspaceId, wsId));
  for (const r of l) await db.delete(appointments).where(eq(appointments.leadId, r.id));
  await db.delete(leads).where(eq(leads.workspaceId, wsId));
  await db.delete(activityLog).where(eq(activityLog.workspaceId, wsId));
  await db.delete(workspaces).where(eq(workspaces.id, wsId));
}
async function countWs(wsId: string) {
  const l = (await db.select().from(leads).where(eq(leads.workspaceId, wsId))).length;
  const a = (await db.select().from(appointments).where(eq(appointments.workspaceId, wsId))).length;
  const c = (await db.select().from(calls).where(eq(calls.workspaceId, wsId))).length;
  return { l, a, c };
}

// Snapshot owner workspace BEFORE anything touches the DB.
const ownerBefore = await countWs(OWNER_WS);

try {
  console.log("== SETUP ==");
  await deleteWorkspaceRows(TEST_WS);
  await db.insert(workspaces).values({
    id: TEST_WS,
    name: "Phantom Plumbing",
    fromName: "Phantom Plumbing",
    fromEmail: "phantom@klerkitai.com",
    timezone: TZ,
    receptionistConfig: {
      businessName: "Phantom Plumbing",
      businessType: "plumbing",
      businessHours: "Tuesday through Friday, 10am to 5pm",
      description: "Plumbing repair and service company",
    },
  });
  const prov = await provisionForWorkspace();
  if (!prov) throw new Error("PROVISION FAILED — Twilio not configured?");
  await db.update(workspaces).set({ twilioPhone: prov.number, twilioPhoneSid: prov.sid, phoneMode: "provisioned" }).where(eq(workspaces.id, TEST_WS));
  console.log("  test workspace:", TEST_WS, "number:", prov.number);

  // ── CALL A (primary): the EXACT Jackie transcript ──
  // Unique per-run callSids: the server keeps in-memory ConversationState per
  // callSid, so reusing SIDs across runs pollutes the booking flow.
  const RUN = Date.now().toString(36);
  const A = `CA-phantom-jackie-${RUN}`;
  console.log("== CALL A: exact Jackie transcript ==");
  const g = await hit(VOICE, { CallSid: A, From: FROM, To: prov.number, CallStatus: "in-progress" });
  ok("greeting routes to test workspace", hasGreeting(g.text, TEST_WS) || /Hello, you've reached/i.test(g.text), g.text.slice(0, 160));
  ok("greeting <Response> carries statusCallback (fix E)", g.text.includes("/api/twilio/webhooks/status"), g.text.slice(0, 200));

  const a1 = await hit(VOICE, { CallSid: A, From: FROM, To: prov.number, CallStatus: "in-progress", SpeechResult: "Hi, I just had a leaky pipe and I was wondering if I can get that fixed.", Confidence: "0.95" });
  const s1 = await novaSaid(A);
  console.log(`  A1 ${a1.ms}ms → "${s1.slice(0, 160)}"`);
  ok("A1 fast (<8s)", a1.ms < 8000, `${a1.ms}ms`);

  const a2 = await hit(VOICE, { CallSid: A, From: FROM, To: prov.number, CallStatus: "in-progress", SpeechResult: "Water is actually coming out pretty quickly and just as soon as possible.", Confidence: "0.95" });
  const s2 = await novaSaid(A);
  console.log(`  A2 ${a2.ms}ms → "${s2.slice(0, 160)}"`);
  ok("A2 fast (<8s)", a2.ms < 8000, `${a2.ms}ms`);
  ok("A2 ASAP captured → booking flow asks for name", /name/i.test(s2), s2.slice(0, 200));

  const a3 = await hit(VOICE, { CallSid: A, From: FROM, To: prov.number, CallStatus: "in-progress", SpeechResult: "It's in my home.", Confidence: "0.95" });
  ok("A3 fast (<8s)", a3.ms < 8000, `${a3.ms}ms`);

  // THIS was the fatal turn: "yeah, Jackie" must capture the name and BOOK.
  const a4 = await hit(VOICE, { CallSid: A, From: FROM, To: prov.number, CallStatus: "in-progress", SpeechResult: "yeah, Jackie", Confidence: "0.95" });
  const s4 = await novaSaid(A);
  console.log(`  A4 ${a4.ms}ms → "${s4.slice(0, 160)}"`);
  ok("A4 fast (<8s)", a4.ms < 8000, `${a4.ms}ms`);
  ok("A4 confirms a REAL booking ('all set')", /all set/i.test(s4), s4.slice(0, 200));
  ok("A4 uses Jackie's name", /Jackie/i.test(s4), s4.slice(0, 200));
  ok("A4 no re-intro", !/this is nova/i.test(s4), s4.slice(0, 100));
  await new Promise((r) => setTimeout(r, 2500)); // let the write + backfill land

  // Log ordering proof: the DB write ("Created lead" — logged with the
  // WORKSPACE id, not the callSid) must appear BEFORE the spoken confirmation
  // — the confirmation only exists after the write lands.
  const log = await Bun.file(`${import.meta.dir}/../.run/server.log`).text();
  const lines = log.split("\n");
  const writeIdx = lines.findIndex((l) => l.includes(TEST_WS) && l.includes("Created lead"));
  const confirmIdx = lines.findIndex((l) => l.includes(A) && l.includes("deterministic booking confirm"));
  ok("booking write logged", writeIdx !== -1, `writeIdx=${writeIdx}`);
  ok("confirmation logged", confirmIdx !== -1, `confirmIdx=${confirmIdx}`);
  ok("write happens BEFORE confirmation is spoken", writeIdx !== -1 && confirmIdx !== -1 && writeIdx < confirmIdx, `write=${writeIdx} confirm=${confirmIdx}`);

  // Post-booking "As soon as possible. Yeah." — no second booking, no mangling.
  const a5 = await hit(VOICE, { CallSid: A, From: FROM, To: prov.number, CallStatus: "in-progress", SpeechResult: "As soon as possible. Yeah.", Confidence: "0.95" });
  const s5 = await novaSaid(A);
  console.log(`  A5 → "${s5.slice(0, 160)}"`);
  ok("A5 fast (<8s)", a5.ms < 8000, `${a5.ms}ms`);

  // End the call + finalize via the statusCallback endpoint (fix E).
  await hit(STATUS, { CallSid: A, From: FROM, To: prov.number, CallStatus: "completed", CallDuration: "45" });
  await new Promise((r) => setTimeout(r, 1500));

  // ── CALL B (control): normal booking flow (name + specific time) ──
  const B = `CA-phantom-control-${RUN}`;
  console.log("== CALL B (control): 'I need a plumber', Tue 11am ==");
  const gb = await hit(VOICE, { CallSid: B, From: FROM, To: prov.number, CallStatus: "in-progress" });
  ok("greeting routes to test workspace", hasGreeting(gb.text, TEST_WS), gb.text.slice(0, 140));
  await hit(VOICE, { CallSid: B, From: FROM, To: prov.number, CallStatus: "in-progress", SpeechResult: "I need a plumber", Confidence: "0.95" });
  await hit(VOICE, { CallSid: B, From: FROM, To: prov.number, CallStatus: "in-progress", SpeechResult: "my name is Dana Kim", Confidence: "0.95" });
  const b3 = await hit(VOICE, { CallSid: B, From: FROM, To: prov.number, CallStatus: "in-progress", SpeechResult: "Tuesday at 11am", Confidence: "0.95" });
  const sb3 = await novaSaid(B);
  console.log(`  B3 ${b3.ms}ms → "${sb3.slice(0, 160)}"`);
  ok("B3 fast (<8s)", b3.ms < 8000, `${b3.ms}ms`);
  ok("B3 books 11:00 AM", /11:00 AM/i.test(sb3), sb3.slice(0, 200));
  await hit(STATUS, { CallSid: B, From: FROM, To: prov.number, CallStatus: "completed", CallDuration: "30" });
  await new Promise((r) => setTimeout(r, 1500));

  // ── CALL C (freewheel): no booking ever — guard must block phantom text ──
  const C = `CA-phantom-freewheel-${RUN}`;
  console.log("== CALL C (freewheel): 'Sounds good to me.' with no booking ==");
  const gc = await hit(VOICE, { CallSid: C, From: FROM, To: prov.number, CallStatus: "in-progress" });
  ok("greeting routes to test workspace", hasGreeting(gc.text, TEST_WS), gc.text.slice(0, 140));
  await hit(VOICE, { CallSid: C, From: FROM, To: prov.number, CallStatus: "in-progress", SpeechResult: "I need a plumber", Confidence: "0.95" });
  const c2 = await hit(VOICE, { CallSid: C, From: FROM, To: prov.number, CallStatus: "in-progress", SpeechResult: "Sounds good to me.", Confidence: "0.95" });
  const sC2 = await novaSaid(C);
  console.log(`  C2 → "${sC2.slice(0, 160)}"`);
  ok("C2 fast (<8s)", c2.ms < 8000, `${c2.ms}ms`);
  ok("C2 no phantom confirmation (guard active)", !/all set|you'?re booked|confirmed (for|at)|scheduled for/i.test(sC2), sC2.slice(0, 200));

  // ── DB VERIFY ──
  console.log("== DB VERIFY ==");
  const leadsA = await db.select().from(leads).where(eq(leads.workspaceId, TEST_WS));
  ok("exactly 2 leads (Jackie + Dana)", leadsA.length === 2, `got ${leadsA.length}`);
  const jackie = leadsA.find((l) => /jackie/i.test(l.name));
  ok("lead A = Jackie", !!jackie, JSON.stringify(leadsA.map((l) => l.name)));
  ok("lead A has About-the-Lead summary (backfill ran)", !!jackie?.summary && jackie.summary.length > 10, jackie?.summary?.slice(0, 160));
  const appts = await db.select().from(appointments).where(eq(appointments.workspaceId, TEST_WS));
  ok("exactly 2 appointments (calendar-visible)", appts.length === 2, `got ${appts.length}`);
  const apptA = appts.find((a) => a.leadId === jackie?.id);
  ok("appointment A linked to Jackie's lead", !!apptA);
  ok("appointment A status=scheduled", apptA?.status === "scheduled", String(apptA?.status));
  ok("appointment A is in the future", !!apptA?.scheduledAt && apptA.scheduledAt.getTime() > Date.now(), apptA?.scheduledAt?.toISOString());

  const callA = await db.select().from(calls).where(eq(calls.callSid, A)).limit(1);
  ok("call A row exists", callA.length === 1);
  ok("call A finalized: status=completed (fix E)", callA[0]?.status === "completed", String(callA[0]?.status));
  ok("call A duration recorded", typeof callA[0]?.durationSec === "number" && callA[0]!.durationSec! > 0, String(callA[0]?.durationSec));
  ok("call A outcome=appointment_booked preserved", callA[0]?.outcome === "appointment_booked", String(callA[0]?.outcome));
  ok("call A linked to lead+appointment", !!callA[0]?.leadId && !!callA[0]?.appointmentId);
  const callB = await db.select().from(calls).where(eq(calls.callSid, B)).limit(1);
  ok("call B finalized: status=completed", callB[0]?.status === "completed", String(callB[0]?.status));
  ok("call B outcome=appointment_booked preserved", callB[0]?.outcome === "appointment_booked", String(callB[0]?.outcome));
  const callC = await db.select().from(calls).where(eq(calls.callSid, C)).limit(1);
  ok("call C has NO lead/appointment", !callC[0]?.leadId && !callC[0]?.appointmentId);

  // ── OWNER WORKSPACE UNTOUCHED ──
  console.log("== OWNER WS ==");
  const ownerAfter = await countWs(OWNER_WS);
  ok("owner workspace untouched (leads/appointments/calls)", JSON.stringify(ownerBefore) === JSON.stringify(ownerAfter), `${JSON.stringify(ownerBefore)} → ${JSON.stringify(ownerAfter)}`);
} finally {
  console.log("== CLEANUP ==");
  // Release the provisioned number FIRST (the sid lives on the workspace row,
  // which deleteWorkspaceRows removes).
  try {
    const ws = await db.query.workspaces.findFirst({ where: eq(workspaces.id, TEST_WS), columns: { twilioPhoneSid: true } });
    if (ws?.twilioPhoneSid) {
      const rel = await releaseNumber(ws.twilioPhoneSid);
      console.log("  number released:", rel);
    }
  } catch (err) {
    console.warn("  number release skipped:", err);
  }
  await deleteWorkspaceRows(TEST_WS);
  const wsGone = await db.query.workspaces.findFirst({ where: eq(workspaces.id, TEST_WS), columns: { id: true } });
  console.log("  test ws exists:", !!wsGone);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
