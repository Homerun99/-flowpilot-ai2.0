// Unit tests for task c4e8b071 — phantom-booking guard + ASAP capture + name
// capture (real-call bug CAc25e82b). Covers:
//   A. PHANTOM_BOOKING_RE: matches fabricated confirmations/offers, never
//      touches benign receptionist replies; the guard is skipped for real
//      BOOKED turns (bookingDone) so truthful confirmations survive.
//   B. ASAP literal-fallback: parseDateTimeHint("as soon as possible…") →
//      preferEarliest; pickBestSlotChecked(preferEarliest) → matched=true.
//   C. "yeah, Jackie" / "sure, it's Jackie" / bare "Jackie" name capture.
//   D. Full Jackie replay through handleTwilioVoice (mocked LLM that flakes on
//      booking intent and fabricates confirmations when it freewheels) — the
//      booking must land in the DB and the confirmation must be spoken.
//   E. Write-failure honesty: when the DB write fails, Nova apologizes instead
//      of confirming.
//   F. Guard rewrite: an LLM-fabricated "you're all set" on a freewheel turn
//      gets rewritten to an honest scheduling question.
// Run: bun scripts/phantom-guard-unit.ts  (from /home/team/shared/site)
import { db } from "../src/db/index";
import { leads, appointments, calls, activityLog, workspaces, users } from "../src/db/schema";
import { eq } from "drizzle-orm";
import {
  conversations,
  handleTwilioVoice,
  PHANTOM_BOOKING_RE,
  extractNameFromReply,
  isBareAsapReply,
  novaAskedForWhen,
} from "../twilio-handler.ts";
import {
  parseDateTimeHint,
  pickBestSlotChecked,
  parseBusinessHours,
  startOfDay,
} from "../src/lib/booking.ts";

const TZ = "America/Phoenix";
const now = new Date("2026-08-11T15:00:00Z"); // Tuesday 2026-08-11, 08:00 Phoenix
const TEST_WS = "ws_guard_unit";
const BASE = "https://flowpilotai.ctonew.app";
let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log("  ✅", label); }
  else { fail++; console.log("  ❌", label, detail); }
};

// ── Mock LLM: booking-intent ALWAYS flakes (wantsBooking=false, no time); the
// response LLM follows ASK_WHEN/ASK_NAME context, but FABRICATES a booking
// confirmation whenever it freewheels (no BOOKING STATUS in the prompt) — the
// exact failure mode of the real call. Only OpenAI calls are mocked; the Neon
// DB client also uses globalThis.fetch, so everything else passes through to
// the real network (the unit test writes real leads/appointments).
function mockFlakyLLM() {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    if (url.includes("/v1/chat/completions")) {
      const body = JSON.parse((init as any)?.body ?? "{}");
      const sys: string = body.messages?.[0]?.content ?? "";
      let content: string;
      if (sys.includes("You analyze phone conversations")) {
        // Intent LLM flake: never wants a booking, never captures anything.
        content = JSON.stringify({ wantsBooking: false, callerName: null, serviceNeed: null, timeHint: null, hasTime: false });
      } else if (sys.includes("ASK_NAME:")) {
        content = "Can I have your name, please?";
      } else if (sys.includes("ASK_WHEN:")) {
        content = "When would you like someone to come out?";
      } else {
        // Freewheel — fabricate a booking/offer the engine never made.
        content = "I'll check availability for you right now. How does tomorrow at 10:00 AM sound?";
      }
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/v1/audio/speech")) {
      return new Response("mock 404", { status: 404 }); // TTS unavailable → <Say> fallback
    }
    // Everything else (Neon DB, etc.) passes through untouched.
    return realFetch(input as any, init as any);
  }) as typeof fetch;
  return () => { globalThis.fetch = realFetch; };
}

async function turn(sid: string, speech: string, ws: string, to: string) {
  const body = new URLSearchParams({ CallSid: sid, CallStatus: "in-progress", From: "+15550009999", To: to, SpeechResult: speech, Confidence: "0.95" });
  const resp = await handleTwilioVoice(body, BASE, {
    businessName: "Guard Plumbing",
    businessType: "plumbing",
    businessHours: "Tuesday through Friday, 10am to 5pm",
  }, ws, TZ);
  return resp.text();
}

async function deleteWorkspaceRows(wsId: string) {
  await db.delete(users).where(eq(users.workspaceId, wsId));
  await db.delete(calls).where(eq(calls.workspaceId, wsId));
  const l = await db.select({ id: leads.id }).from(leads).where(eq(leads.workspaceId, wsId));
  for (const r of l) await db.delete(appointments).where(eq(appointments.leadId, r.id));
  await db.delete(leads).where(eq(leads.workspaceId, wsId));
  await db.delete(activityLog).where(eq(activityLog.workspaceId, wsId));
  await db.delete(workspaces).where(eq(workspaces.id, wsId));
}

// ── A. Guard regex ─────────────────────────────────────────────────────────
console.log("== A. PHANTOM_BOOKING_RE ==");
const fabrications = [
  "Great — you're all set for tomorrow at 10:00 AM, Jackie. Anything else I can help with?",
  "I'll check availability for you right now. How does tomorrow at 10:00 AM sound?",
  "You're booked for Tuesday at 2pm.",
  "Your appointment is confirmed for Wednesday at 9:00 AM.",
  "I've scheduled you for Friday. See you then!",
  "I can fit you in at 3pm tomorrow.",
  "Let me look at our calendar and get you in.",
  "We have availability at 10:00 AM tomorrow.",
  "I'll see you at 2pm on Tuesday.",
  "Let me check the schedule for you.",
  "I can get you in on Thursday morning.",
];
for (const f of fabrications) check(`guard matches fabricated: "${f.slice(0, 55)}…"`, PHANTOM_BOOKING_RE.test(f));

const benign = [
  "I'm sorry to hear about the leaky pipe. Is water coming in from it?",
  "Can I have your name, please?",
  "When would you like someone to come out to take a look?",
  "We can get someone out to you — when would you like to be seen?",
  "Thanks for calling Guard Plumbing. Have a great day!",
  "I'd want to make sure I get that right — let me have someone follow up with you about that.",
  "Do you have a day or time in mind?",
  "Is water actively leaking, or is it more of a steady drip?",
];
for (const b of benign) check(`guard does NOT match benign: "${b.slice(0, 55)}…"`, !PHANTOM_BOOKING_RE.test(b));

// ── B. ASAP capture ────────────────────────────────────────────────────────
console.log("== B. ASAP literal fallback ==");
const asapHint = parseDateTimeHint("Water is actually coming out pretty quickly and just as soon as possible", now, TZ);
check("ASAP hint parses", asapHint !== null);
check("ASAP hint preferEarliest=true", asapHint?.preferEarliest === true, String(asapHint?.preferEarliest));
const hours = parseBusinessHours("Tuesday through Friday, 10am to 5pm");
const pick = pickBestSlotChecked({ day: startOfDay(now, TZ), preferEarliest: true }, hours, new Set(), now, TZ);
check("preferEarliest pick exists", !!pick, String(pick?.slot));
check("preferEarliest matched=true (BOOKED path, no offer)", pick?.matched === true, String(pick?.matched));
const vague = parseDateTimeHint("some time next week", now, TZ);
check("specific hint unaffected by ASAP rules", vague !== null);

// ── C. Name capture ────────────────────────────────────────────────────────
console.log("== C. extractNameFromReply ==");
check('"yeah, Jackie" → Jackie', extractNameFromReply("yeah, Jackie") === "Jackie");
check('"sure, it\'s Jackie" → Jackie', extractNameFromReply("sure, it's Jackie") === "Jackie");
check('"Jackie" → Jackie', extractNameFromReply("Jackie") === "Jackie");
check('"my name is Jackie Smith" → Jackie Smith', extractNameFromReply("my name is Jackie Smith") === "Jackie Smith");
check('"It\'s in my home" → null (not a name)', extractNameFromReply("It's in my home") === null);
check('"it\'s dripping from under the sink" → null', extractNameFromReply("it's dripping from under the sink") === null);
check('"" → null', extractNameFromReply("") === null);
check('"yes" → null (no name after filler)', extractNameFromReply("yes") === null);
console.log("== C. novaAskedForWhen / isBareAsapReply ==");
check("when-question detected", novaAskedForWhen(["AI: I'm sorry to hear that. When would you like someone to come out to take a look?"]) === true);
check("name-ask not a when-question", novaAskedForWhen(["AI: Can I have your name, please?"]) === false);
check("greeting not a when-question", novaAskedForWhen(["AI: Hello, you've reached X. This is Nova. How can I help you today?"]) === false);
check("'As soon as possible. Yeah.' is bare", isBareAsapReply("As soon as possible. Yeah.") === true);
check("long problem+ASAP is not bare", isBareAsapReply("Water is actually coming out pretty quickly and just as soon as possible.") === false);

// ── D/E/F. Full flow through handleTwilioVoice (mocked flaky LLM) ─────────
console.log("== D. Jackie replay — booking lands, confirmation spoken ==");
const restore = mockFlakyLLM();
const toNumber = "+13395550001";
try {
  // D: full Jackie transcript on a REAL throwaway workspace (DB write succeeds)
  await deleteWorkspaceRows(TEST_WS);
  await db.insert(workspaces).values({
    id: TEST_WS,
    name: "Guard Plumbing",
    fromName: "Guard Plumbing",
    fromEmail: "guard@klerkitai.com",
    timezone: TZ,
    receptionistConfig: {
      businessName: "Guard Plumbing",
      businessType: "plumbing",
      businessHours: "Tuesday through Friday, 10am to 5pm",
    },
  });

  const j = "CA-guard-jackie";
  // greeting
  await handleTwilioVoice(new URLSearchParams({ CallSid: j, CallStatus: "in-progress", From: "+15550009999", To: toNumber }), BASE, undefined, TEST_WS, TZ);
  const j1 = await turn(j, "Hi, I just had a leaky pipe and I was wondering if I can get that fixed.", TEST_WS, toNumber);
  // Intent flaked → no booking context → LLM freewheel fabricated an offer →
  // guard must rewrite it to an honest scheduling question.
  check("turn1 guard rewrites fabricated offer", j1.includes("I'd like to get you scheduled"), j1.slice(0, 200));
  const j2 = await turn(j, "Water is actually coming out pretty quickly and just as soon as possible.", TEST_WS, toNumber);
  // ASAP captured → ASK_NAME flow → asks for the name
  check("turn2 asks for name (ASAP captured)", /name/i.test(j2), j2.slice(0, 200));
  const j3 = await turn(j, "It's in my home.", TEST_WS, toNumber);
  const j4 = await turn(j, "yeah, Jackie", TEST_WS, toNumber);
  // Deterministic BOOKED confirm — name captured + earliest slot booked
  check("turn4 confirms with 'all set' (REAL booking)", /all set/i.test(j4), j4.slice(0, 200));
  check("turn4 confirms with Jackie's name", /Jackie/i.test(j4), j4.slice(0, 200));
  check("turn4 confirms with 10:00 AM (earliest open)", /10:00 AM/i.test(j4), j4.slice(0, 200));
  check("turn4 contains NO re-intro", !/this is nova/i.test(j4), j4.slice(0, 120));
  // bookingDone → subsequent freewheel turns may re-confirm truthfully; the
  // guard must NOT rewrite a real confirmation.
  const j5 = await turn(j, "As soon as possible. Yeah.", TEST_WS, toNumber);
  check("turn5 (post-booking) NOT mangled by guard", !j5.includes("When would you like someone to come out?"), j5.slice(0, 200));

  // DB verify: lead + appointment exist (calendar-visible)
  const leadsJ = await db.select().from(leads).where(eq(leads.workspaceId, TEST_WS));
  check("lead created (Jackie)", leadsJ.length === 1 && /jackie/i.test(leadsJ[0].name), JSON.stringify(leadsJ.map((l) => l.name)));
  const apptsJ = await db.select().from(appointments).where(eq(appointments.workspaceId, TEST_WS));
  check("appointment created (calendar-visible)", apptsJ.length === 1 && apptsJ[0].leadId === leadsJ[0].id, JSON.stringify(apptsJ.map((a) => ({ t: a.scheduledAt?.toISOString(), s: a.status }))));
  check("appointment status scheduled", apptsJ[0]?.status === "scheduled");

  // ── E. Write-failure honesty ─────────────────────────────────────────────
  console.log("== E. write failure → honest apology, never phantom confirm ==");
  const f = "CA-guard-fail";
  await handleTwilioVoice(new URLSearchParams({ CallSid: f, CallStatus: "in-progress", From: "+15550009999", To: toNumber }), BASE, undefined, "ws_no_such_workspace", TZ);
  const f1 = await turn(f, "I need a plumber as soon as possible", "ws_no_such_workspace", toNumber);
  check("fail: ASAP captured → asks name", /name/i.test(f1), f1.slice(0, 200));
  const f2 = await turn(f, "yeah, Dana", "ws_no_such_workspace", toNumber);
  check("fail: write failed → honest apology (no 'all set')", !/all set|booked for|you'?re booked/i.test(f2), f2.slice(0, 200));
  check("fail: apology mentions trouble", /having trouble|call you right back|someone call/i.test(f2), f2.slice(0, 200));
  const convoF = conversations.get(f);
  check("fail: bookingDone stays false", convoF?.bookingDone !== true);

  // ── F. Guard rewrite on pure freewheel (the exact 'Sounds good to me') ───
  console.log("== F. guard rewrites freewheeled confirmation ==");
  const g = "CA-guard-freewheel";
  await handleTwilioVoice(new URLSearchParams({ CallSid: g, CallStatus: "in-progress", From: "+15550009999", To: toNumber }), BASE, undefined, "ws_no_such_workspace", TZ);
  const g1 = await turn(g, "I need a plumber", "ws_no_such_workspace", toNumber);
  check("freewheel: fabricated offer rewritten to honest when-question", g1.includes("I'd like to get you scheduled"), g1.slice(0, 200));
  const g2 = await turn(g, "Sounds good to me.", "ws_no_such_workspace", toNumber);
  check("freewheel: 'sounds good' gets NO phantom confirmation", !/all set|you'?re booked/i.test(g2), g2.slice(0, 200));

  for (const sid of ["CA-guard-jackie", "CA-guard-fail", "CA-guard-freewheel"]) conversations.delete(sid);
} finally {
  restore();
  await deleteWorkspaceRows(TEST_WS);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
