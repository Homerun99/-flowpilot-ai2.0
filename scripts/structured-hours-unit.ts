// Unit tests for task 3acef0fe — structured openDays/openHours:
//   A. structuredToWeeklyHours() pure conversion (valid / invalid / fallback)
//   B. formatStructuredHours() system-prompt label
//   C. Booking engine PREFERS structured days/hours: a conflicting free-text
//      businessHours ("Sat & Sun 8am-6pm") must NOT win — Saturday request →
//      DAY_CLOSED → offer Tuesday (the next STRUCTURED open day)
//   D. Fallback to free-text businessHours when structured fields unset →
//      Saturday request → offer Monday (Mon-Fri 9-5)
//   E. Out-of-hours logic uses structured hours: "Friday at 8am" with
//      structured 10-17 → TIME_UNAVAILABLE offers 10:00 AM (not 9:00 AM)
//   F. Positive booking lands inside the structured window (12:00 PM Wed)
// Run: bun scripts/structured-hours-unit.ts  (from /home/team/shared/site)
import { db } from "../src/db/index";
import { leads, appointments, calls, activityLog, users, workspaces } from "../src/db/schema";
import { eq } from "drizzle-orm";
import { conversations, handleTwilioVoice } from "../twilio-handler.ts";
import {
  structuredToWeeklyHours,
  formatStructuredHours,
  getHour,
  getDayOfWeek,
} from "../src/lib/booking";

const TZ = "America/Phoenix";
const BASE = "https://flowpilotai.ctonew.app";
let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log("  ✅", label); }
  else { fail++; console.log("  ❌", label, detail); }
};

// ── Mock LLM ──
// Intent LLM: names and "<day> at <time>" patterns → booking intent; flakes
// otherwise. Response LLM: follows ASK_* contexts; freewheel stays benign.
// Only OpenAI calls are mocked; Neon DB traffic passes through to the network.
function mockLLM() {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    if (url.includes("/v1/chat/completions")) {
      const body = JSON.parse((init as any)?.body ?? "{}");
      const sys: string = body.messages?.[0]?.content ?? "";
      const last: string = body.messages?.at(-1)?.content ?? "";
      let content: string;
      if (sys.includes("You analyze phone conversations")) {
        const nameM = last.match(/my name is ([a-z ]+)/i);
        if (nameM) {
          const name = nameM[1].trim().replace(/[^a-zA-Z ]/g, "").replace(/\s+/g, " ");
          content = JSON.stringify({ wantsBooking: false, callerName: name, serviceNeed: null, timeHint: null, hasTime: false });
        } else if (
          /(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today)\s+at\s+\d{1,2}(:\d{2})?\s*(am|pm)/i.test(last)
        ) {
          content = JSON.stringify({ wantsBooking: true, callerName: null, serviceNeed: null, timeHint: last.trim(), hasTime: true });
        } else {
          content = JSON.stringify({ wantsBooking: false, callerName: null, serviceNeed: null, timeHint: null, hasTime: false });
        }
      } else if (sys.includes("ASK_WHEN:")) {
        content = "When would you like someone to come out?";
      } else if (sys.includes("ASK_NAME:")) {
        content = "Can I have your name, please?";
      } else {
        content = "I'd be happy to help with that.";
      }
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/v1/audio/speech")) {
      return new Response("mock 404", { status: 404 }); // TTS unavailable → <Say> fallback
    }
    return realFetch(input as any, init as any);
  }) as typeof fetch;
  return () => { globalThis.fetch = realFetch; };
}

async function turn(sid: string, speech: string, ws: string, to: string, cfg: Record<string, unknown>) {
  const body = new URLSearchParams({ CallSid: sid, CallStatus: "in-progress", From: "+15550008888", To: to, SpeechResult: speech, Confidence: "0.95" });
  const resp = await handleTwilioVoice(body, BASE, cfg as any, ws, TZ);
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

const WS_S = "ws_sh_s", WS_F = "ws_sh_f", WS_B = "ws_sh_b";
const TO = "+15552223333";
const STRUCTURED = {
  businessName: "Structured Plumbing",
  businessType: "plumbing",
  // Conflicting free text on purpose: structured must WIN over this.
  businessHours: "Saturday and Sunday, 8am to 6pm",
  openDays: ["Tuesday", "Wednesday", "Thursday", "Friday"],
  openHours: { start: "10:00", end: "17:00" },
};
const FREETEXT = {
  businessName: "FreeText Plumbing",
  businessType: "plumbing",
  businessHours: "Monday through Friday, 9am to 5pm",
};

const restore = mockLLM();
try {
  console.log("== A. structuredToWeeklyHours pure conversion ==");
  const wh = structuredToWeeklyHours(["Tuesday", "Wednesday", "Thursday", "Friday"], { start: "10:00", end: "17:00" });
  check("Tue-Fri 10:00-17:00 → Tue..Fri {10,17}", !!wh && wh[2]?.startHour === 10 && wh[2]?.endHour === 17 && wh[3]?.startHour === 10 && wh[5]?.endHour === 17, JSON.stringify(wh));
  check("Sun/Mon/Sat closed (null)", !!wh && wh[0] === null && wh[1] === null && wh[6] === null, JSON.stringify(wh));
  const wh2 = structuredToWeeklyHours(["tuesday", "WED", "FRI", "thursday"], { start: "10:00", end: "17:00" });
  check("case-insensitive + abbreviations accepted", !!wh2 && !!wh2[2] && !!wh2[3] && !!wh2[4] && !!wh2[5], JSON.stringify(wh2));
  check("empty openDays → null", structuredToWeeklyHours([], { start: "10:00", end: "17:00" }) === null);
  check("undefined openDays → null", structuredToWeeklyHours(undefined, { start: "10:00", end: "17:00" }) === null);
  check("undefined openHours → null", structuredToWeeklyHours(["Tuesday"], undefined) === null);
  check("null openHours → null", structuredToWeeklyHours(["Tuesday"], null) === null);
  check("empty openHours object → null", structuredToWeeklyHours(["Tuesday"], {} as any) === null);
  check("non-HH:MM start ('10') → null", structuredToWeeklyHours(["Tuesday"], { start: "10", end: "17:00" }) === null);
  check("end <= start → null", structuredToWeeklyHours(["Tuesday"], { start: "10:00", end: "09:00" }) === null);
  check("equal start/end → null", structuredToWeeklyHours(["Tuesday"], { start: "10:00", end: "10:00" }) === null);
  check("start 25:00 → null", structuredToWeeklyHours(["Tuesday"], { start: "25:00", end: "17:00" }) === null);
  check("end 24:30 → null", structuredToWeeklyHours(["Tuesday"], { start: "10:00", end: "24:30" }) === null);
  check("open till midnight 10-24 valid", structuredToWeeklyHours(["Tuesday"], { start: "10:00", end: "24:00" })?.[2]?.endHour === 24);
  check("garbage day only → null", structuredToWeeklyHours(["Neverday"], { start: "10:00", end: "17:00" }) === null);
  check("mixed valid+garbage → valid day only", !!structuredToWeeklyHours(["Monday", "bogus"], { start: "10:00", end: "17:00" })?.[1]);

  console.log("\n== B. formatStructuredHours label ==");
  const label = formatStructuredHours(["Tuesday", "Wednesday", "Thursday", "Friday"], { start: "10:00", end: "17:00" });
  check("label lists days + hours", label === "Tuesday, Wednesday, Thursday, Friday, 10:00 AM – 5:00 PM", JSON.stringify(label));
  check("unusable → null", formatStructuredHours([], { start: "10:00", end: "17:00" }) === null);
  check("midnight close label", formatStructuredHours(["Monday"], { start: "10:00", end: "24:00" })?.includes("Midnight"), formatStructuredHours(["Monday"], { start: "10:00", end: "24:00" }) || "");

  for (const ws of [WS_S, WS_F, WS_B]) await deleteWorkspaceRows(ws);
  await db.insert(workspaces).values([
    { id: WS_S, name: "Structured Plumbing", timezone: TZ },
    { id: WS_F, name: "FreeText Plumbing", timezone: TZ },
    { id: WS_B, name: "Structured Booking", timezone: TZ },
  ]);

  console.log("\n== C. structured hours WIN over conflicting free text (closed day) ==");
  const s = "CA-sh-s";
  await turn(s, "", WS_S, TO, STRUCTURED);
  await turn(s, "I need a plumber", WS_S, TO, STRUCTURED);
  const s2 = await turn(s, "my name is Pat Smith", WS_S, TO, STRUCTURED);
  check("C name-only turn stays benign (no phantom booking)", !/all set|booked/i.test(s2), s2.slice(0, 160));
  const s3 = await turn(s, "Saturday at 11am", WS_S, TO, STRUCTURED);
  check("C Saturday is CLOSED (structured Tue-Fri wins over free text)", /closed on .*saturday/i.test(s3), s3.slice(0, 200));
  check("C offers Tuesday (next STRUCTURED open day)", /tuesday/i.test(s3), s3.slice(0, 200));
  check("C does NOT offer Sunday/Monday (free-text days)", !/sunday|monday/i.test(s3), s3.slice(0, 200));
  check("C does NOT book", !/all set/i.test(s3), s3.slice(0, 200));

  console.log("\n== D. fallback to free-text businessHours when structured unset ==");
  const f = "CA-sh-f";
  await turn(f, "", WS_F, TO, FREETEXT);
  await turn(f, "I need a plumber", WS_F, TO, FREETEXT);
  await turn(f, "my name is Dana Reed", WS_F, TO, FREETEXT);
  const f3 = await turn(f, "Saturday at 11am", WS_F, TO, FREETEXT);
  check("D Saturday CLOSED (Mon-Fri free text)", /closed on .*saturday/i.test(f3), f3.slice(0, 200));
  check("D offers Monday (next open per free text)", /monday/i.test(f3), f3.slice(0, 200));
  check("D does NOT book", !/all set/i.test(f3), f3.slice(0, 200));

  console.log("\n== E. out-of-hours offer uses structured hours ==");
  const e = "CA-sh-e";
  await turn(e, "", WS_S, TO, STRUCTURED);
  await turn(e, "I need a plumber", WS_S, TO, STRUCTURED);
  await turn(e, "my name is Alex Cruz", WS_S, TO, STRUCTURED);
  const e3 = await turn(e, "Friday at 8am", WS_S, TO, STRUCTURED);
  check("E 8am is before 10:00 open → TIME_UNAVAILABLE", /not open at 8:00 AM/i.test(e3), e3.slice(0, 200));
  check("E offers 10:00 AM (structured open), not 9:00 AM (default)", /10:00 AM/i.test(e3) && !/9:00 AM/i.test(e3), e3.slice(0, 200));
  check("E does NOT book", !/all set/i.test(e3), e3.slice(0, 200));

  console.log("\n== F. positive booking lands inside the structured window ==");
  const b = "CA-sh-b";
  await turn(b, "", WS_B, TO, STRUCTURED);
  await turn(b, "I need a plumber", WS_B, TO, STRUCTURED);
  await turn(b, "my name is Jordan Lee", WS_B, TO, STRUCTURED);
  const b3 = await turn(b, "Wednesday at 12pm", WS_B, TO, STRUCTURED);
  check("F books Wednesday 12:00 PM", /all set/i.test(b3) && /12:00 PM/i.test(b3), b3.slice(0, 200));
  const leadsB = await db.select().from(leads).where(eq(leads.workspaceId, WS_B));
  const apptsB = await db.select().from(appointments).where(eq(appointments.workspaceId, WS_B));
  check("F lead created", leadsB.length === 1, `got ${leadsB.length}`);
  check("F appointment booked", apptsB.length === 1, `got ${apptsB.length}`);
  const at = apptsB[0]?.scheduledAt;
  check("F slot is 12:00 PM Phoenix", !!at && getHour(at, TZ) === 12, at ? `${at.toISOString()} hour=${at ? getHour(at, TZ) : "?"}` : "no date");
  check("F slot on a Wednesday", !!at && getDayOfWeek(at, TZ) === 3, at ? `dow=${at ? getDayOfWeek(at, TZ) : "?"}` : "no date");
  check("F slot inside 10:00-17:00 window", !!at && getHour(at, TZ) >= 10 && getHour(at, TZ) < 17, "");
} finally {
  for (const ws of [WS_S, WS_F, WS_B]) await deleteWorkspaceRows(ws).catch(() => {});
  for (const sid of ["CA-sh-s", "CA-sh-f", "CA-sh-e", "CA-sh-b"]) conversations.delete(sid);
  restore();
}
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
