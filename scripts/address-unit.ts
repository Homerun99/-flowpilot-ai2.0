// Unit tests for task be8696c6 — service-address capture before booking
// (owner request: "ask for an address if the appointment requires an address").
// Covers:
//   A. requireAddress=true workspace: Nova asks ASK_ADDRESS after time+name are
//      gathered, and does NOT book until the caller gives an address; the
//      address lands VERBATIM on the lead row (leads.address + notes).
//   B. Time-only reply while awaiting the address (caller misunderstood and
//      answered with a time) → Nova re-asks once, then books when the address
//      arrives.
//   C. requireAddress unset (current behavior): no address ask — books exactly
//      as before.
//   D. isTimeOnlyReply() pure-function cases.
// Run: bun scripts/address-unit.ts  (from /home/team/shared/site)
import { db } from "../src/db/index";
import { leads, appointments, calls, activityLog, workspaces, users } from "../src/db/schema";
import { eq } from "drizzle-orm";
import {
  conversations,
  handleTwilioVoice,
  isTimeOnlyReply,
} from "../twilio-handler.ts";

const TZ = "America/Phoenix";
const BASE = "https://flowpilotai.ctonew.app";
let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log("  ✅", label); }
  else { fail++; console.log("  ❌", label, detail); }
};

// ── Mock LLM ──
// Intent LLM: cooperative for name/time turns ("my name is X", "tuesday at
// 11am"), flakes (wantsBooking=false) on everything else — the address turns
// rely on the DETERMINISTIC capture path. Response LLM follows the ASK_* /
// BOOKING STATUS contexts; freewheel replies stay benign (never fabricate a
// booking, so address-turn assertions are unambiguous). Only OpenAI calls are
// mocked; the Neon DB client also uses globalThis.fetch, so everything else
// passes through to the real network.
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
        if (/my name is ([a-z ]+)/i.test(last)) {
          const name = last.match(/my name is ([a-z ]+)/i)![1].trim().replace(/[^a-zA-Z ]/g, "").replace(/\s+/g, " ");
          content = JSON.stringify({ wantsBooking: false, callerName: name, serviceNeed: null, timeHint: null, hasTime: false });
        } else if (/tuesday at 11am/i.test(last)) {
          content = JSON.stringify({ wantsBooking: true, callerName: null, serviceNeed: null, timeHint: "tuesday at 11am", hasTime: true });
        } else {
          // Address turns + everything else: intent LLM flakes.
          content = JSON.stringify({ wantsBooking: false, callerName: null, serviceNeed: null, timeHint: null, hasTime: false });
        }
      } else if (sys.includes("ASK_ADDRESS:")) {
        content = "And what's the address for the service?";
      } else if (sys.includes("ASK_NAME:")) {
        content = "Can I have your name, please?";
      } else if (sys.includes("ASK_WHEN:")) {
        content = "When would you like someone to come out?";
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

async function turn(sid: string, speech: string, ws: string, to: string, requireAddress: boolean) {
  const body = new URLSearchParams({ CallSid: sid, CallStatus: "in-progress", From: "+15550009999", To: to, SpeechResult: speech, Confidence: "0.95" });
  const resp = await handleTwilioVoice(body, BASE, {
    businessName: "Address Plumbing",
    businessType: "plumbing",
    businessHours: "Tuesday through Friday, 10am to 5pm",
    ...(requireAddress ? { requireAddress: true } : {}),
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

const WS_A = "ws_addr_a", WS_B = "ws_addr_b", WS_C = "ws_addr_c";
const TO = "+15551112222";

const restore = mockLLM();
try {
  console.log("== D. isTimeOnlyReply pure cases ==");
  check('"tomorrow at 10am" is time-only', isTimeOnlyReply("tomorrow at 10am"));
  check('"Tuesday at 11am" is time-only', isTimeOnlyReply("Tuesday at 11am"));
  check('"as soon as possible" is time-only', isTimeOnlyReply("as soon as possible"));
  check('"10:30" is time-only', isTimeOnlyReply("10:30"));
  check('"1234 Oak Street, Phoenix AZ" NOT time-only', !isTimeOnlyReply("1234 Oak Street, Phoenix AZ"));
  check('"456 Pine Ave" NOT time-only', !isTimeOnlyReply("456 Pine Ave"));
  check('"the corner of 5th and Main" NOT time-only', !isTimeOnlyReply("the corner of 5th and Main"));

  for (const ws of [WS_A, WS_B, WS_C]) await deleteWorkspaceRows(ws);
  await db.insert(workspaces).values([
    { id: WS_A, name: "Address Plumbing", fromName: "Address Plumbing", fromEmail: "a@klerkitai.com", timezone: TZ },
    { id: WS_B, name: "Address Plumbing", fromName: "Address Plumbing", fromEmail: "b@klerkitai.com", timezone: TZ },
    { id: WS_C, name: "Plain Plumbing", fromName: "Plain Plumbing", fromEmail: "c@klerkitai.com", timezone: TZ },
  ]);

  console.log("== A. requireAddress=true → ask address, then book with address ==");
  const a = "CA-addr-a";
  await turn(a, "", WS_A, TO, true); // greeting
  const a1 = await turn(a, "I need a plumber", WS_A, TO, true);
  check("A1 freewheel benign (no phantom)", !/all set|booked/i.test(a1), a1.slice(0, 120));
  const a2 = await turn(a, "my name is Dana Kim", WS_A, TO, true);
  check("A2 no address ask yet (no time given)", !/address/i.test(a2), a2.slice(0, 120));
  const a3 = await turn(a, "Tuesday at 11am", WS_A, TO, true);
  check("A3 asks for the address before booking", /address/i.test(a3), a3.slice(0, 160));
  check("A3 does NOT book yet", !/all set/i.test(a3), a3.slice(0, 160));
  const a4 = await turn(a, "1234 Oak Street, Phoenix AZ", WS_A, TO, true);
  check("A4 books after the address ('all set')", /all set/i.test(a4), a4.slice(0, 200));
  check("A4 confirms the time", /11:00 AM/i.test(a4), a4.slice(0, 200));
  check("A4 uses Dana's name", /Dana/i.test(a4), a4.slice(0, 200));

  console.log("== B. time-only reply → re-ask once → then book ==");
  const b = "CA-addr-b";
  await turn(b, "", WS_B, TO, true);
  await turn(b, "I need a plumber", WS_B, TO, true);
  await turn(b, "my name is Sam Reed", WS_B, TO, true);
  const b3 = await turn(b, "Tuesday at 11am", WS_B, TO, true);
  check("B3 asks for the address", /address/i.test(b3), b3.slice(0, 160));
  const b4 = await turn(b, "tomorrow at 10am", WS_B, TO, true);
  check("B4 time-only reply → re-asks for address (no booking)", /address/i.test(b4) && !/all set/i.test(b4), b4.slice(0, 160));
  const b5 = await turn(b, "456 Pine Ave", WS_B, TO, true);
  check("B5 books after the real address", /all set/i.test(b5), b5.slice(0, 200));
  check("B5 confirms 11:00 AM (original time kept, not the time-only reply)", /11:00 AM/i.test(b5), b5.slice(0, 200));

  console.log("== C. requireAddress unset → current behavior, no address ask ==");
  const c = "CA-addr-c";
  await turn(c, "", WS_C, TO, false);
  const c1 = await turn(c, "I need a plumber", WS_C, TO, false);
  const c2 = await turn(c, "my name is Chris Lee", WS_C, TO, false);
  const c3 = await turn(c, "Tuesday at 11am", WS_C, TO, false);
  check("C3 books directly (no address ask)", /all set/i.test(c3), c3.slice(0, 200));
  check("C no address question anywhere", !/address/i.test(c1 + c2 + c3));

  console.log("== DB VERIFY ==");
  const leadsA = await db.select().from(leads).where(eq(leads.workspaceId, WS_A));
  check("A: lead created", leadsA.length === 1, `got ${leadsA.length}`);
  check("A: lead address stored VERBATIM", leadsA[0]?.address === "1234 Oak Street, Phoenix AZ", JSON.stringify(leadsA[0]?.address));
  check("A: notes contain Address:", (leadsA[0]?.notes ?? "").includes("Address: 1234 Oak Street, Phoenix AZ"), leadsA[0]?.notes?.slice(0, 160));
  const apptsA = await db.select().from(appointments).where(eq(appointments.workspaceId, WS_A));
  check("A: appointment booked (calendar-visible)", apptsA.length === 1, `got ${apptsA.length}`);
  check("A: appointment linked to lead", apptsA[0]?.leadId === leadsA[0]?.id);

  const leadsB = await db.select().from(leads).where(eq(leads.workspaceId, WS_B));
  check("B: lead created", leadsB.length === 1, `got ${leadsB.length}`);
  check("B: lead address = 456 Pine Ave", leadsB[0]?.address === "456 Pine Ave", JSON.stringify(leadsB[0]?.address));
  const leadsC = await db.select().from(leads).where(eq(leads.workspaceId, WS_C));
  check("C: lead created without address", leadsC.length === 1 && leadsC[0]?.address == null, JSON.stringify(leadsC[0]?.address));
} finally {
  for (const ws of [WS_A, WS_B, WS_C]) {
    await deleteWorkspaceRows(ws).catch(() => {});
  }
  for (const sid of ["CA-addr-a", "CA-addr-b", "CA-addr-c"]) conversations.delete(sid);
  restore();
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
