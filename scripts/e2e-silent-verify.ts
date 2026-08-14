// Live E2E — silent-caller no-speech UX (task 16200dfa), verified against the
// PUBLISHED server (localhost:3000 === flowpilotai.ctonew.app).
//
// Sequence: greeting webhook (no speech) → no-speech <Gather> re-post ×2.
// Asserts:
//   1st response = full greeting for the owner workspace (Play URL key
//                  ws:greeting:<wsId>:)
//   2nd & 3rd = NUDGES — no greeting key, no "you've reached"/business-name
//               intro, each keeps a <Gather>, NEVER a <Hangup/>
//   all webhooks answer fast (<8s)
//   server log shows branch=greeting then branch=nudge silentStreak=1/2
//
// Uses a THROWAWAY CallSid routed to the owner workspace's real Twilio number
// (provisioning is blocked by the Twilio 401, and the voice path is fine).
// Cleanup: deletes the fake call row; asserts zero new leads/appointments.
//
// Run: bun scripts/e2e-silent-verify.ts   (from /home/team/shared/site)
import { db } from "../src/db/index";
import { workspaces, calls, leads, appointments } from "../src/db/schema";
import { eq, and } from "drizzle-orm";

const BASE = "http://localhost:3000/api/twilio/webhooks/voice";
const OWNER_WS = "ws_2w3a8uul";
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

const SID = `CA-silent-verify-${Date.now()}`;
console.log("== SETUP ==");
const owner = await db.query.workspaces.findFirst({
  where: eq(workspaces.id, OWNER_WS),
  columns: { id: true, twilioPhone: true, businessName: true, name: true },
});
if (!owner?.twilioPhone) {
  console.error("❌ owner workspace has no twilioPhone — cannot route silently");
  process.exit(1);
}
console.log(`  owner ws: ${owner.id} number: ${owner.twilioPhone}`);
const businessName = owner.businessName || owner.name || "plumingcentral";

const leadsBefore = (await db.select().from(leads).where(eq(leads.workspaceId, OWNER_WS))).length;
const apptsBefore = (await db.select().from(appointments).where(eq(appointments.workspaceId, OWNER_WS))).length;

const params = (extra: Record<string, string> = {}) => ({
  CallSid: SID,
  From: FROM,
  To: owner.twilioPhone!,
  CallStatus: "in-progress",
  ...extra,
});
// Key markers (Play URLs are percent-encoded by the server).
const greetingKey = `ws:greeting:${OWNER_WS}:`;
const nudgeKey = `ws:nudge:${OWNER_WS}:`;
const has = (xml: string, s: string) =>
  xml.includes(encodeURIComponent(s)) || xml.includes(s);
const isGreeting = (xml: string) => has(xml, greetingKey);
const isNudgeXml = (xml: string) =>
  !has(xml, greetingKey) &&
  !/you've reached|This is Nova/i.test(xml) &&
  !xml.includes(encodeURIComponent(businessName)) &&
  !xml.includes(businessName);

try {
  // ── 1. Greeting webhook (no speech) ────────────────────────────────────
  console.log("== 1. greeting webhook ==");
  const g = await hit(params());
  ok("greeting returns 200", g.status === 200, String(g.status));
  ok("greeting routes to owner workspace (Play key present)", isGreeting(g.text), g.text.slice(0, 220));
  ok("greeting answered fast (<8s)", g.ms < 8000, `${g.ms}ms`);
  ok("greeting keeps a <Gather>", g.text.includes("<Gather"), g.text.slice(0, 220));
  ok("greeting does NOT hang up", !g.text.includes("<Hangup"), g.text.slice(0, 220));

  // ── 2. No-speech re-post #1 → nudge, no intro, no hangup ───────────────
  console.log("== 2. no-speech re-post #1 ==");
  const n1 = await hit(params());
  ok("nudge #1 returns 200", n1.status === 200, String(n1.status));
  ok("nudge #1 is NOT a greeting (no greeting Play key)", isNudgeXml(n1.text), n1.text.slice(0, 220));
  ok("nudge #1 uses the nudge TTS key", has(n1.text, nudgeKey), n1.text.slice(0, 220));
  ok("nudge #1 answered fast (<8s)", n1.ms < 8000, `${n1.ms}ms`);
  ok("nudge #1 keeps a <Gather>", n1.text.includes("<Gather"), n1.text.slice(0, 220));
  ok("nudge #1 does NOT hang up", !n1.text.includes("<Hangup"), n1.text.slice(0, 220));

  // ── 3. No-speech re-post #2 → nudge again, still alive ─────────────────
  console.log("== 3. no-speech re-post #2 ==");
  const n2 = await hit(params());
  ok("nudge #2 returns 200", n2.status === 200, String(n2.status));
  ok("nudge #2 is NOT a greeting", isNudgeXml(n2.text), n2.text.slice(0, 220));
  ok("nudge #2 uses the nudge TTS key", has(n2.text, nudgeKey), n2.text.slice(0, 220));
  ok("nudge #2 answered fast (<8s)", n2.ms < 8000, `${n2.ms}ms`);
  ok("nudge #2 keeps a <Gather>", n2.text.includes("<Gather"), n2.text.slice(0, 220));
  ok("nudge #2 does NOT hang up", !n2.text.includes("<Hangup"), n2.text.slice(0, 220));

  // ── 4. Server log shows branch=greeting then branch=nudge 1 & 2 ────────
  console.log("== 4. server log branches ==");
  const log = await Bun.file(`${import.meta.dir}/../.run/server.log`).text();
  const branch = (pattern: string) => {
    let last = "";
    for (const m of log.matchAll(new RegExp(pattern, "g"))) last = m[0];
    return last;
  };
  ok("branch=greeting logged for this call",
    branch(`\\[twilio-handler\\] ${SID} branch=greeting \\(first webhook, no speech yet\\)`).length > 0);
  ok("branch=nudge silentStreak=1 logged",
    branch(`\\[twilio-handler\\] ${SID} branch=nudge silentStreak=1`).length > 0);
  ok("branch=nudge silentStreak=2 logged",
    branch(`\\[twilio-handler\\] ${SID} branch=nudge silentStreak=2`).length > 0);
  ok("no 'Nova says' (silent path speaks only via deterministic TTS key)",
    !new RegExp(`\\[twilio-handler\\] ${SID} Nova says`).test(log));

  // ── 5. DB: no phantom leads/appointments; only the call row ────────────
  console.log("== 5. DB cleanliness ==");
  const leadsAfter = (await db.select().from(leads).where(eq(leads.workspaceId, OWNER_WS))).length;
  const apptsAfter = (await db.select().from(appointments).where(eq(appointments.workspaceId, OWNER_WS))).length;
  ok("no new leads", leadsAfter === leadsBefore, `${leadsBefore} → ${leadsAfter}`);
  ok("no new appointments", apptsAfter === apptsBefore, `${apptsBefore} → ${apptsAfter}`);
  const callRows = await db.select().from(calls).where(eq(calls.workspaceId, OWNER_WS));
  const fakeRow = callRows.find((c) => c.callSid === SID);
  ok("fake call row logged (ring → in-progress)", !!fakeRow, JSON.stringify(callRows.map((c) => c.callSid)));

  console.log(`\n${pass} passed, ${fail} failed`);
} catch (err) {
  console.error("E2E error:", err);
  fail++;
} finally {
  // ── CLEANUP: remove the throwaway call row; leave the owner workspace clean ──
  console.log("== CLEANUP ==");
  const gone = await db.delete(calls).where(and(eq(calls.workspaceId, OWNER_WS), eq(calls.callSid, SID)));
  const remaining = await db.select({ id: calls.id }).from(calls)
    .where(eq(calls.workspaceId, OWNER_WS));
  console.log(`  fake call row deleted (${remaining.length} call rows remain for owner ws)`);
  const leadsFinal = (await db.select().from(leads).where(eq(leads.workspaceId, OWNER_WS))).length;
  const apptsFinal = (await db.select().from(appointments).where(eq(appointments.workspaceId, OWNER_WS))).length;
  console.log(`  owner ws leads=${leadsFinal} (was ${leadsBefore}), appointments=${apptsFinal} (was ${apptsBefore})`);
}
process.exit(fail > 0 ? 1 : 0);
