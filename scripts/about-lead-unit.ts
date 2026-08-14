// Unit tests — "About the Lead": summary + qualifying Q&A extraction
// (task 5ab7c6de). Uses an injectable LLM so no network is needed.
// Run: bun scripts/about-lead-unit.ts  (from repo root)
import { extractLeadAbout, type AboutLlm } from "../src/lib/lead-about";

let pass = 0, fail = 0;
function check(label: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log("  ✅", label); }
  else { fail++; console.log("  ❌", label, detail); }
}

// Fixture: a call with 2 qualifying Q&As and a booking at Tue 10:00 Phoenix.
const HISTORY = [
  "AI: Thanks for calling ABC Plumbing — this is Nova. How can I help you?",
  "Caller: There's water coming in under my kitchen sink.",
  "AI: I'm sorry to hear that — is water actually getting in right now?",
  "Caller: Yes, it's dripping from under the sink.",
  "AI: Thanks. And how long has this been going on?",
  "Caller: About 2 days now.",
  "AI: Got it. We can get someone out to you — when would you like to be seen?",
  "Caller: Tuesday at 10am would work.",
  "AI: Great — you're all set for Tuesday at 10:00 AM.",
];
const SCHEDULED = new Date("2026-08-18T17:00:00.000Z"); // Tue 10:00 America/Phoenix
const TZ = "America/Phoenix";

console.log("== fixture → summary includes the 'when' + qa pairs ==");
{
  let captured: { system: string; user: string } | null = null;
  const fake: AboutLlm = async (system, user) => {
    captured = { system, user };
    return JSON.stringify({
      summary:
        "Caller has a leaking pipe under the kitchen sink, water coming in for about 2 days. Requested a plumber visit Tuesday at 10:00 AM.",
      qa: [
        { question: "Is water actually getting in right now?", answer: "Yes, it's dripping from under the sink" },
        { question: "How long has this been going on?", answer: "About 2 days now" },
      ],
    });
  };
  const res = await extractLeadAbout(HISTORY, {
    callerName: "Jamie Torres",
    serviceNeed: "leaking pipe under kitchen sink",
    scheduledAt: SCHEDULED,
    timezone: TZ,
    llm: fake,
  });
  check("summary non-empty", !!res.summary && res.summary.length > 20, String(res.summary));
  check("summary mentions the problem", /leaking pipe|water/i.test(res.summary || ""), res.summary || "");
  check("summary includes the WHEN (Tuesday 10:00 AM)", /Tuesday at 10:00 AM/i.test(res.summary || ""), res.summary || "");
  check("qa has 2 pairs", res.qa.length === 2, JSON.stringify(res.qa));
  check("qa pair 1 correct", res.qa[0]?.question?.includes("water") && res.qa[0]?.answer?.includes("dripping"), JSON.stringify(res.qa[0]));
  check("qa pair 2 correct", res.qa[1]?.question?.includes("long") && res.qa[1]?.answer?.includes("2 days"), JSON.stringify(res.qa[1]));
  check("prompt includes appointment time", captured?.user.includes("Tuesday at 10:00 AM") === true, captured?.user.slice(0, 300));
  check("prompt includes conversation problem", captured?.user.includes("water coming in under my kitchen sink") === true, "");
  check("prompt includes caller name", captured?.user.includes("Jamie Torres") === true, "");
}

console.log("== empty history → graceful empty, LLM never called ==");
{
  let called = false;
  const res = await extractLeadAbout([], { llm: async () => { called = true; return "{}"; } });
  check("returns {summary:null, qa:[]}", res.summary === null && res.qa.length === 0);
  check("LLM not called", called === false);
}

console.log("== LLM throws → fallback, no throw ==");
{
  const res = await extractLeadAbout(HISTORY, {
    llm: async () => { throw new Error("boom"); },
  });
  check("fallback {summary:null, qa:[]}", res.summary === null && res.qa.length === 0);
}

console.log("== LLM returns invalid JSON → fallback ==");
{
  const res = await extractLeadAbout(HISTORY, {
    llm: async () => "definitely not json",
  });
  check("fallback {summary:null, qa:[]}", res.summary === null && res.qa.length === 0);
}

console.log("== partial / malformed payloads tolerated ==");
{
  const partial = await extractLeadAbout(HISTORY, { llm: async () => JSON.stringify({ summary: "Only a summary" }) });
  check("summary-only → qa []", partial.summary === "Only a summary" && partial.qa.length === 0);
  const qaOnly = await extractLeadAbout(HISTORY, {
    llm: async () => JSON.stringify({ qa: [{ question: "Q1", answer: "A1" }] }),
  });
  check("qa-only → summary null", qaOnly.summary === null && qaOnly.qa.length === 1);
  const badPairs = await extractLeadAbout(HISTORY, {
    llm: async () => JSON.stringify({ qa: [{ question: "", answer: "A" }, { question: "Q", answer: "  " }, { question: "Q2", answer: "A2" }] }),
  });
  check("blank pairs filtered", badPairs.qa.length === 1 && badPairs.qa[0]?.question === "Q2");
}

console.log("== >5 pairs capped at 5 ==");
{
  const many = Array.from({ length: 8 }, (_, i) => ({ question: `Q${i}`, answer: `A${i}` }));
  const res = await extractLeadAbout(HISTORY, { llm: async () => JSON.stringify({ summary: "s", qa: many }) });
  check("qa capped at 5", res.qa.length === 5, String(res.qa.length));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
