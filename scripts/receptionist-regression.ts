// Regression tests for the 3 real-call receptionist bugs (task 2a2086ff):
//  BUG 1 — Nova re-introduces herself after the greeting
//  BUG 2 — closed-day offer + "Monday instead" booked the wrong day
//  BUG 3 — slow TTS stalled the webhook → Twilio error + hangup
//
// Run: bun scripts/receptionist-regression.ts  (from repo root)
import {
  decideOfferReply,
  findNextOpenDay,
  formatSlot,
  getDayOfWeek,
  parseBusinessHours,
  parseDateTimeHint,
  pickBestSlot,
  startOfDay,
  zonedTimeToUtc,
} from "../src/lib/booking.ts";
import { conversations, handleTwilioVoice, raceTts } from "../twilio-handler.ts";

const TZ = "America/Phoenix";
// 2026-08-11 is a Tuesday
const now = new Date("2026-08-11T15:00:00Z");
let pass = 0, fail = 0;
function check(label: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log("  ✅", label); }
  else { fail++; console.log("  ❌", label, detail); }
}

// ── BUG 1: greeting is recorded as an AI turn in conversation history ──────
console.log("== BUG 1: greeting never re-introduced ==");
{
  // Mock the network so the greeting TTS call cannot reach OpenAI in tests.
  const realFetch = globalThis.fetch;
  globalThis.fetch = (() => Promise.resolve(new Response("mock 404", { status: 404 }))) as typeof fetch;
  try {
    const sid = "CA-regression-greeting-0001";
    const body = new URLSearchParams({
      CallSid: sid,
      CallStatus: "in-progress",
      From: "+15005550001",
    });
    const resp = await handleTwilioVoice(
      body,
      "https://flowpilotai.ctonew.app",
      { businessName: "Acme Roofing" },
      "ws_regression_test",
      TZ,
    );
    const xml = await resp.text();
    check("greeting response returned", resp.status === 200, String(resp.status));
    check("greeting response mentions greeting", xml.includes("How can I help you today"));
    const convo = conversations.get(sid);
    check("conversation state created on greeting", !!convo);
    check(
      "greeting pushed into history as AI turn (model sees it on turn 1)",
      convo?.history?.[0] === "AI: Hello, you've reached Acme Roofing. This is Nova. How can I help you today?",
      convo?.history?.[0],
    );
    conversations.delete(sid);
  } finally {
    globalThis.fetch = realFetch;
  }
}

// ── BUG 2: closed-day offer + "Monday instead" books MONDAY, not today ─────
console.log("== BUG 2: offered-day agreement books the OFFERED day ==");
{
  const mf = parseBusinessHours("Monday through Friday, 9am to 5pm");
  // Repro: caller asks Saturday (closed) → Nova offers Monday 2026-08-17.
  const satHint = parseDateTimeHint("next saturday at noon", now, TZ)!;
  check("Saturday hint resolves to Saturday", getDayOfWeek(satHint.day, TZ) === 6);
  const satClosed = mf[getDayOfWeek(satHint.day, TZ)] === null;
  check("Saturday is closed under Mon-Fri hours", satClosed === true);
  const offered = findNextOpenDay(satHint.day, mf, TZ)!;
  check("offer is the next open day (Monday)", getDayOfWeek(offered, TZ) === 1, offered.toISOString());

  // Caller replies "Monday instead" — must ACCEPT the offered Monday.
  check(
    "'Monday instead' accepts the offered Monday",
    decideOfferReply("Monday instead", offered, now, TZ) === "accept",
  );
  // Pure-agreement replies also accept.
  check("'yes that works' accepts", decideOfferReply("yes that works", offered, now, TZ) === "accept");
  check("'sure' accepts", decideOfferReply("sure", offered, now, TZ) === "accept");
  check("'okay' accepts", decideOfferReply("okay", offered, now, TZ) === "accept");
  // A genuinely different named day overrides the offer (this was the bug:
  // "today at 3 PM" — Tuesday — must NOT be booked after the Monday offer).
  check(
    "'today' is a different-day reply (reject silently booking today)",
    decideOfferReply("today", offered, now, TZ) === "different-day",
  );
  check(
    "'tuesday' is a different-day reply",
    decideOfferReply("tuesday", offered, now, TZ) === "different-day",
  );
  check("no pending offer → no-offer", decideOfferReply("monday", undefined, now, TZ) === "no-offer");

  // Booking the accepted offer: first free slot of Monday = 9:00 AM Phoenix.
  const slot = pickBestSlot(
    { day: offered, preferEarliest: false },
    mf,
    new Set(),
    now,
    TZ,
  );
  check("offered-day slot found", !!slot);
  check(
    "slot is Monday 09:00 Phoenix (NOT today 15:00)",
    slot?.toISOString() === "2026-08-17T16:00:00.000Z",
    slot?.toISOString(),
  );
  check(
    "confirmation text says 'Monday at 9:00 AM'",
    formatSlot(slot!, now, TZ) === "Monday at 9:00 AM",
    formatSlot(slot!, now, TZ),
  );
  // And the explicit-day path still works: caller names Monday directly.
  const monHint = parseDateTimeHint("monday", now, TZ)!;
  check("'monday' parses to next Monday", getDayOfWeek(monHint.day, TZ) === 1);
}

// ── BUG 3: TTS timeout falls back to <Say>; webhook never waits on TTS ─────
console.log("== BUG 3: TTS race fallback ==");
{
  // A TTS call that never resolves must yield "say" after the timer.
  const never = new Promise<Buffer | null>(() => {});
  const r1 = await raceTts(never, 60);
  check("stalled TTS → 'say' fallback", r1.kind === "say");
  // A fast TTS still wins.
  const r2 = await raceTts(Promise.resolve(Buffer.from("mp3")), 500);
  check("fast TTS → 'audio'", r2.kind === "audio");
  // A TTS that resolves to null (API error) also yields 'say'.
  const r3 = await raceTts(Promise.resolve(null), 500);
  check("null TTS → 'say'", r3.kind === "say");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
