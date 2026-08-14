// Unit tests for task 721eee4c — keyQuestions config field.
//
// Covers the NOVA SYSTEM-PROMPT side:
//   A. buildKeyQuestionsPrompt: absent/null/empty → ""
//   B. buildKeyQuestionsPrompt: present → exact IF/THEN ASK phrasing,
//      one-question-at-a-time framing, multi-block, multi-question
//   C. buildKeyQuestionsPrompt: shape safety (invalid entries dropped,
//      whitespace trimmed, empty if/thenAsk skipped)
//   D. buildKeyQuestionsPrompt: caps (20 IF blocks, 20 questions per block,
//      1500-char truncation)
//   E. buildSystemPrompt integration: no key-questions block when absent;
//      block present when configured; existing one-question-at-a-time +
//      persona rules still intact
//
// Run: bun scripts/key-questions-unit.ts  (from /home/team/shared/site)
import { buildKeyQuestionsPrompt, buildSystemPrompt } from "../twilio-handler.ts";
let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log("  ✅", label); }
  else { fail++; console.log("  ❌", label, detail); }
};

async function main() {
  // ── A. Absent / null / empty → no block ───────────────────────────────
  console.log("== A. absent/null/empty → '' ==");
  check("A1 undefined → ''", buildKeyQuestionsPrompt(undefined) === "");
  check("A2 null → ''", buildKeyQuestionsPrompt(null) === "");
  check("A3 [] → ''", buildKeyQuestionsPrompt([]) === "");
  check("A4 missing arg → ''", buildKeyQuestionsPrompt() === "");

  // ── B. Present → exact phrasing ───────────────────────────────────────
  console.log("\n== B. present → IF/THEN ASK phrasing ==");
  const b1 = buildKeyQuestionsPrompt([
    { if: "The customer needs a repair of any kind", thenAsk: ["Is the damage extensive?", "How urgent is it?"] },
  ]);
  check("B1 header present", b1.includes("KEY QUALIFYING QUESTIONS"));
  check("B1 framing sentence present",
    b1.includes("When the customer's situation matches one of these conditions, ask the matching questions one at a time"),
    b1);
  check("B1 exact IF/THEN ASK line",
    b1.includes("IF 'The customer needs a repair of any kind' THEN ASK 'Is the damage extensive?', 'How urgent is it?'"),
    b1);
  check("B1 one-at-a-time never-a-list warning present", b1.includes("never rattle off the whole list"), b1);
  const b2 = buildKeyQuestionsPrompt([
    { if: "cond one", thenAsk: ["q1"] },
    { if: "cond two", thenAsk: ["q2", "q3"] },
  ]);
  check("B2 two IF blocks both present",
    b2.includes("IF 'cond one' THEN ASK 'q1'") && b2.includes("IF 'cond two' THEN ASK 'q2', 'q3'"), b2);
  check("B2 blocks are line-separated (one per line)", (b2.match(/THEN ASK/g) ?? []).length === 2, b2);

  // ── C. Shape safety ───────────────────────────────────────────────────
  console.log("\n== C. shape safety ==");
  const c1 = buildKeyQuestionsPrompt([
    { if: "   padded cond   ", thenAsk: ["   q1   ", "q2"] },
  ]);
  check("C1 whitespace trimmed in if + questions",
    c1.includes("IF 'padded cond' THEN ASK 'q1', 'q2'") && !c1.includes("padded cond   "), c1);
  const c2 = buildKeyQuestionsPrompt([
    { if: "", thenAsk: ["q1"] },            // empty if → dropped
    { if: "   ", thenAsk: ["q1"] },         // whitespace-only if → dropped
    { if: "good cond", thenAsk: [] },       // empty thenAsk → dropped
    { if: "good cond2", thenAsk: ["  ", ""] }, // all-blank questions → dropped
    { if: "real cond", thenAsk: ["real q"] }, // kept
  ] as any);
  check("C2 invalid entries dropped, valid kept",
    c2.includes("IF 'real cond' THEN ASK 'real q'") &&
    !c2.includes("good cond") && !c2.includes("good cond2"), c2);
  const c3 = buildKeyQuestionsPrompt([
    null,
    "string entry",
    42,
    { if: 123, thenAsk: ["q"] },
    { if: "c", thenAsk: "not an array" },
    { if: "c2", thenAsk: [7, null, "ok q"] },
  ] as any);
  check("C3 non-object / non-string / non-array entries dropped, valid kept",
    c3.includes("IF 'c2' THEN ASK 'ok q'") && !c3.includes("'123'") && !c3.includes("not an array"), c3);

  // ── D. Caps ───────────────────────────────────────────────────────────
  console.log("\n== D. caps ==");
  const d1 = buildKeyQuestionsPrompt(
    Array.from({ length: 25 }, (_, i) => ({ if: `cond ${i}`, thenAsk: ["q"] })),
  );
  check("D1 25 blocks → capped at 20", (d1.match(/THEN ASK/g) ?? []).length === 20,
    `count=${(d1.match(/THEN ASK/g) ?? []).length}`);
  const d2 = buildKeyQuestionsPrompt([
    { if: "cond", thenAsk: Array.from({ length: 25 }, (_, i) => `question ${i}`) },
  ]);
  check("D2 25 questions → capped at 20",
    (d2.match(/'question \d+'/g) ?? []).length === 20 &&
    !d2.includes("question 20") && d2.includes("question 19"),
    d2);
  const d3 = buildKeyQuestionsPrompt([
    { if: "cond ".repeat(200).trim(), thenAsk: ["q ".repeat(300).trim()] },
    { if: "cond2 ".repeat(200).trim(), thenAsk: ["q2 ".repeat(300).trim()] },
  ]);
  check("D3 injected block truncated to ≤1500 chars", d3.length <= 1500, `len=${d3.length}`);

  // ── E. buildSystemPrompt integration ──────────────────────────────────
  console.log("\n== E. buildSystemPrompt integration ==");
  const baseCfg = {
    businessName: "ABC Plumbing",
    businessType: "plumbing",
    businessHours: "Tue-Fri 10am-5pm",
  };
  const e1 = await buildSystemPrompt(baseCfg);
  check("E1 no keyQuestions → no key-questions block", !e1.includes("KEY QUALIFYING QUESTIONS"), "");
  check("E1 one-question-at-a-time rule intact", e1.includes("Ask ONE question at a time"), "");
  check("E1 persona rules intact", e1.includes("You are Nova, the receptionist for ABC Plumbing."), "");
  const e2 = await buildSystemPrompt({
    ...baseCfg,
    keyQuestions: [{ if: "The customer needs a repair of any kind", thenAsk: ["Is the damage extensive?"] }],
  });
  check("E2 keyQuestions present → block injected",
    e2.includes("KEY QUALIFYING QUESTIONS") &&
    e2.includes("IF 'The customer needs a repair of any kind' THEN ASK 'Is the damage extensive?'"),
    "");
  check("E2 one-question-at-a-time rule still intact alongside block",
    e2.includes("Ask ONE question at a time"), "");
  check("E2 requireAddress absent → no address instruction", !e2.includes("SERVICE ADDRESS"), "");
  const e3 = await buildSystemPrompt({
    ...baseCfg,
    requireAddress: true,
    keyQuestions: [{ if: "c", thenAsk: ["q"] }],
  });
  check("E3 keyQuestions + requireAddress coexist",
    e3.includes("KEY QUALIFYING QUESTIONS") && e3.includes("SERVICE ADDRESS"), "");
  const e4 = await buildSystemPrompt({ ...baseCfg, keyQuestions: [] });
  check("E4 empty array → no block in full prompt", !e4.includes("KEY QUALIFYING QUESTIONS"), "");
  const e5 = await buildSystemPrompt(
    { ...baseCfg, keyQuestions: [{ if: "c", thenAsk: ["q"] }] },
    "We offer 24/7 emergency service.",
    "BOOKED: tomorrow at 1:00 PM",
  );
  check("E5 keyQuestions + KB + booking context all coexist",
    e5.includes("KEY QUALIFYING QUESTIONS") &&
    e5.includes("RELEVANT BUSINESS INFORMATION") &&
    e5.includes("BOOKING STATUS — THIS TURN"), "");

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
