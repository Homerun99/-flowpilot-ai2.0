// Unit tests for the silent-caller UX fix (task 16200dfa):
//  - the full greeting plays EXACTLY ONCE (first webhook with no speech)
//  - a no-speech <Gather> timeout re-post never replays the intro — it nudges
//    ("I didn't quite catch that…"), and repeated silent timeouts keep the
//    call alive with a varied nudge ("I'm still here whenever you're ready…")
//  - silent callers are NEVER hung up on (every response keeps a <Gather>)
//  - a real speech turn resets the silent streak
//  - state is per-call (a fresh callSid gets a fresh greeting)
//
// Run: bun scripts/silent-nudge-unit.ts   (from /home/team/shared/site)
import { conversations, handleTwilioVoice } from "../twilio-handler.ts";

const TZ = "America/Phoenix";
const BASE = "https://flowpilotai.ctonew.app";
const CONFIG = { businessName: "Acme Roofing" };
let pass = 0, fail = 0;
function check(label: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log("  ✅", label); }
  else { fail++; console.log("  ❌", label, detail); }
}

// Mock the network so TTS + response LLM can never reach OpenAI in tests
// (404 → TTS falls back to <Say>, so the spoken text is visible in the XML).
const realFetch = globalThis.fetch;
globalThis.fetch = (() => Promise.resolve(new Response("mock 404", { status: 404 }))) as typeof fetch;

const noSpeech = (sid: string) =>
  new URLSearchParams({ CallSid: sid, CallStatus: "in-progress", From: "+15005550001" });
const withSpeech = (sid: string, speech: string) => {
  const p = noSpeech(sid);
  p.set("SpeechResult", speech);
  p.set("Confidence", "0.95");
  return p;
};
async function hit(body: URLSearchParams) {
  const resp = await handleTwilioVoice(body, BASE, CONFIG, undefined, TZ);
  return { status: resp.status, xml: await resp.text() };
}
const hasGather = (xml: string) => xml.includes("<Gather");
const hasHangup = (xml: string) => xml.includes("<Hangup");
const isNudge = (xml: string) =>
  !/you've reached|This is Nova/i.test(xml) && !xml.includes(CONFIG.businessName);

try {
  const SID = "CA-silent-nudge-unit-0001";
  conversations.delete(SID);

  // ── 1. First webhook → full greeting, exactly once ─────────────────────
  console.log("== 1. first webhook: greeting ==");
  const g = await hit(noSpeech(SID));
  check("greeting returns 200", g.status === 200, String(g.status));
  check("greeting text spoken", g.xml.includes("How can I help you today"), g.xml.slice(0, 200));
  check("greeting keeps a <Gather>", hasGather(g.xml), g.xml.slice(0, 200));
  check("greeting does NOT hang up", !hasHangup(g.xml), g.xml.slice(0, 200));
  const convo = conversations.get(SID);
  check("conversation created", !!convo);
  check("hasGreeted set", convo?.hasGreeted === true, JSON.stringify(convo?.hasGreeted));
  check("silentStreak starts at 0", convo?.silentStreak === 0, JSON.stringify(convo?.silentStreak));
  check(
    "greeting pushed into history as AI turn",
    convo?.history?.[0] === "AI: Hello, you've reached Acme Roofing. This is Nova. How can I help you today?",
    convo?.history?.[0],
  );

  // ── 2. No-speech re-post #1 → nudge (NO intro, still a Gather) ─────────
  console.log("== 2. no-speech re-post #1: nudge ==");
  const n1 = await hit(noSpeech(SID));
  check("nudge returns 200", n1.status === 200, String(n1.status));
  check("nudge #1 spoken", n1.xml.includes("I didn't quite catch that"), n1.xml.slice(0, 200));
  check("nudge does NOT replay the intro", isNudge(n1.xml), n1.xml.slice(0, 200));
  check("nudge keeps a <Gather>", hasGather(n1.xml), n1.xml.slice(0, 200));
  check("nudge does NOT hang up", !hasHangup(n1.xml), n1.xml.slice(0, 200));
  check("silentStreak = 1", conversations.get(SID)?.silentStreak === 1, JSON.stringify(conversations.get(SID)?.silentStreak));
  check(
    "nudge pushed into history as AI turn",
    conversations.get(SID)?.history?.[1] === "AI: I didn't quite catch that — how can I help you today?",
    conversations.get(SID)?.history?.[1],
  );

  // ── 3. No-speech re-post #2 → varied nudge, still no intro, no hangup ──
  console.log("== 3. no-speech re-post #2: varied nudge ==");
  const n2 = await hit(noSpeech(SID));
  check("nudge #2 returns 200", n2.status === 200, String(n2.status));
  check("nudge #2 spoken (different wording)", n2.xml.includes("I'm still here whenever you're ready"), n2.xml.slice(0, 200));
  check("nudge #2 does NOT replay the intro", isNudge(n2.xml), n2.xml.slice(0, 200));
  check("nudge #2 keeps a <Gather>", hasGather(n2.xml), n2.xml.slice(0, 200));
  check("nudge #2 does NOT hang up", !hasHangup(n2.xml), n2.xml.slice(0, 200));
  check("silentStreak = 2", conversations.get(SID)?.silentStreak === 2, JSON.stringify(conversations.get(SID)?.silentStreak));
  check(
    "nudge #2 pushed into history as AI turn",
    conversations.get(SID)?.history?.[2] === "AI: I'm still here whenever you're ready. How can I help you today?",
    conversations.get(SID)?.history?.[2],
  );

  // ── 4. Real speech resets the silent streak ────────────────────────────
  console.log("== 4. speech resets the streak ==");
  const s = await hit(withSpeech(SID, "I need a roof inspection"));
  check("speech turn returns 200", s.status === 200, String(s.status));
  check("speech turn keeps a <Gather>", hasGather(s.xml), s.xml.slice(0, 200));
  check("speech turn does NOT hang up", !hasHangup(s.xml), s.xml.slice(0, 200));
  check("silentStreak reset to 0 on speech", conversations.get(SID)?.silentStreak === 0, JSON.stringify(conversations.get(SID)?.silentStreak));

  // ── 5. Next silence after speech starts the nudge sequence over ────────
  console.log("== 5. silence after speech ==");
  const n3 = await hit(noSpeech(SID));
  check("nudge restarts at #1 wording", n3.xml.includes("I didn't quite catch that"), n3.xml.slice(0, 200));
  check("silentStreak back to 1", conversations.get(SID)?.silentStreak === 1, JSON.stringify(conversations.get(SID)?.silentStreak));
  check("still no hangup", !hasHangup(n3.xml), n3.xml.slice(0, 200));

  // ── 6. Per-call isolation: a NEW callSid greets fresh ──────────────────
  console.log("== 6. new call gets a fresh greeting ==");
  const SID2 = "CA-silent-nudge-unit-0002";
  conversations.delete(SID2);
  const g2 = await hit(noSpeech(SID2));
  check("new call greets (intro plays)", g2.xml.includes("How can I help you today"), g2.xml.slice(0, 200));
  const convo2 = conversations.get(SID2);
  check("new call hasGreeted = true", convo2?.hasGreeted === true);
  check("new call silentStreak = 0", convo2?.silentStreak === 0, JSON.stringify(convo2?.silentStreak));
  check("new call history has ONLY the greeting", convo2?.history?.length === 1, JSON.stringify(convo2?.history));

  // ── 7. Workspace-scoped greeting key still used when workspaceId set ───
  console.log("== 7. workspace greeting key preserved ==");
  const SID3 = "CA-silent-nudge-unit-0003";
  conversations.delete(SID3);
  const g3 = await hit(new URLSearchParams({
    CallSid: SID3,
    CallStatus: "in-progress",
    From: "+15005550001",
    To: "+14470001111",
  }));
  // workspaceId undefined here → callSid-scoped key (as before); the greeting
  // key format itself is exercised live by e2e-silent-verify.ts. Just assert
  // the branch still returns the greeting with a Play URL.
  check("greeting still 200", g3.status === 200, String(g3.status));
  check("greeting text spoken", g3.xml.includes("How can I help you today"), g3.xml.slice(0, 200));

  conversations.delete(SID);
  conversations.delete(SID2);
  conversations.delete(SID3);
} finally {
  globalThis.fetch = realFetch;
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
