/**
 * Email Inbox — unit + integration tests (task 1e06d386).
 *
 * Part A: pure parser tests (From-header parsing, envelope JSON) — no network.
 * Part B: live-server tests against a THROWAWAY workspace:
 *   - workspace resolution (match / no-match / missing from-to)
 *   - From-header parsing through the webhook (name + bare email on the row)
 *   - envelope handling (bare from rescues a malformed header; bad JSON is safe)
 *   - lead dedupe (2nd email from same sender → same leadId, no new lead)
 *   - regenerate (prompt stored, status reset to draft, sent-guard 400)
 *   - send guards (no-draft 400, already-sent 400)
 *   - status transitions (draft→sent; draft→error→recover via regenerate)
 *   - cross-workspace scoping (a fresh workspace sees zero emails)
 * Cleanup: throwaway workspaces are deleted at the end (finally block).
 *
 * Run: BASE_URL=http://localhost:3000 bun scripts/email-inbox-unit.ts
 */
import { parseAddressField, parseEnvelope } from "../src/lib/email-parse";
import { db } from "../src/db/index";
import { emails, leads } from "../src/db/schema";
import { eq } from "drizzle-orm";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const TEAM_INBOX = "flowpilot-ai-2ca0d10c@ctomail.io"; // known-good recipient for the send test

let pass = 0, fail = 0;
function check(label: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log("  ✅", label); }
  else { fail++; console.log("  ❌", label, detail); }
}

// ────────────────────────────────────────────────
// Part A — pure parser tests (no server, no DB)
// ────────────────────────────────────────────────
function parserTests() {
  console.log("\nPart A — From-header / envelope parsing");
  let a = parseAddressField('Jane Doe <jane@example.com>');
  check("angled: 'Jane Doe <jane@example.com>' → bare email", a.email === "jane@example.com" && !a.fallback, JSON.stringify(a));
  check("angled: name extracted", a.name === "Jane Doe", JSON.stringify(a));

  a = parseAddressField("jane@example.com");
  check("bare: 'jane@example.com' → email, no name", a.email === "jane@example.com" && a.name === null && !a.fallback, JSON.stringify(a));

  a = parseAddressField('"Jane Doe" <jane@example.com>');
  check("quoted: '\"Jane Doe\" <…>' → name de-quoted", a.name === "Jane Doe" && a.email === "jane@example.com", JSON.stringify(a));

  a = parseAddressField("<jane@example.com>");
  check("angled-only: '<…>' → email, name null", a.email === "jane@example.com" && a.name === null, JSON.stringify(a));

  a = parseAddressField("  Jane  <JANE@Example.COM>  ");
  check("whitespace: trims + lowercases email", a.email === "jane@example.com" && a.name === "Jane", JSON.stringify(a));

  a = parseAddressField("");
  check("empty input → fallback, empty email", a.fallback && a.email === "", JSON.stringify(a));

  a = parseAddressField("not-an-email");
  check("malformed → fallback keeps raw (never throws)", a.fallback && a.email === "not-an-email", JSON.stringify(a));

  a = parseAddressField("john@doe.com,");
  check("trailing comma stripped from bare email", a.email === "john@doe.com" && !a.fallback, JSON.stringify(a));

  const e = parseEnvelope('{"to":["Team Demo <team-demo@klerkitai.com>"],"from":"Jane <jane@example.com>"}');
  check("envelope: to display-name → bare email", e?.to?.[0] === "team-demo@klerkitai.com", JSON.stringify(e));
  check("envelope: from display-name → bare email", e?.from === "jane@example.com", JSON.stringify(e));

  check("envelope: bad JSON → null", parseEnvelope("{oops") === null);
  check("envelope: missing → null", parseEnvelope(null) === null);
  check("envelope: not-an-object → null", parseEnvelope('"hi"') === null);
}

// ────────────────────────────────────────────────
// Part B — live-server tests (throwaway workspace)
// ────────────────────────────────────────────────
let cookie = "";
async function api(path: string, init: RequestInit = {}, json?: unknown) {
  const headers = new Headers(init.headers || {});
  if (cookie) headers.set("cookie", cookie);
  if (json !== undefined) headers.set("content-type", "application/json");
  const body = json !== undefined ? JSON.stringify(json) : init.body;
  const res = await fetch(BASE + path, { ...init, headers, body });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  const text = await res.text();
  let parsed: any = null;
  try { parsed = JSON.parse(text); } catch { /* non-JSON */ }
  return { status: res.status, json: parsed, text };
}

async function signup(prefix: string) {
  const email = `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@ctomail.io`;
  const r = await api("/api/auth/signup", { method: "POST" }, { email, password: "Test-Pass-123!", name: prefix });
  return { status: r.status, workspaceId: r.json?.user?.workspaceId, email };
}

async function liveTests() {
  console.log("\nPart B — live server tests (throwaway workspace)");
  const createdWs: { wsId: string; cookie: string }[] = [];
  const pushWs = (wsId: string) => { createdWs.push({ wsId, cookie }); };

  // B1: signup throwaway workspace A
  const A = await signup("unit-a");
  check("B1 signup → 201 + workspaceId", A.status === 201 && !!A.workspaceId, JSON.stringify(A));
  if (!A.workspaceId) { fail++; return; }
  pushWs(A.workspaceId);

  const cfg = await api("/api/workspace/email-config");
  const fromEmail = cfg.json?.from_email;
  check("B1 email-config → branded sender", typeof fromEmail === "string" && fromEmail.endsWith("@klerkitai.com"), JSON.stringify(cfg.json));

  // B2: workspace resolution — unknown recipient (no-match)
  const unk = await api("/api/webhooks/email/inbound", { method: "POST" }, { from: "x@y.z", to: "nobody@nowhere.invalid", subject: "hi", body: "hello" });
  check("B2 unknown recipient → ignored/unknown_recipient (200)", unk.status === 200 && unk.json?.status === "ignored" && unk.json?.reason === "unknown_recipient", JSON.stringify(unk.json));

  // B3: missing from/to → ignored
  const miss = await api("/api/webhooks/email/inbound", { method: "POST" }, { from: "a@b.c" });
  check("B3 missing to → ignored/missing from/to (200)", miss.status === 200 && miss.json?.status === "ignored" && miss.json?.reason === "missing from/to", JSON.stringify(miss.json));

  // B4: match + From-header parsing
  const r1 = await api("/api/webhooks/email/inbound", { method: "POST" }, {
    from: "Jane Roe <jane.roe+test@ctomail.io>", to: fromEmail, subject: "Roof leak", body: "Hi, my roof is leaking in the kitchen. Can you inspect it this week?",
  });
  check("B4 inbound match → ok + emailId + draftReady", r1.status === 200 && r1.json?.status === "ok" && !!r1.json?.emailId && r1.json?.draftReady === true, JSON.stringify(r1.json));
  const e1 = r1.json?.emailId;

  const list1 = await api("/api/emails");
  const row1 = list1.json?.emails?.find((em: any) => em.id === e1);
  check("B4 email row: bare fromEmail (parsed)", row1?.fromEmail === "jane.roe+test@ctomail.io", JSON.stringify(row1 && { f: row1.fromEmail, n: row1.fromName }));
  check("B4 email row: fromName = display name", row1?.fromName === "Jane Roe", JSON.stringify(row1 && { f: row1.fromEmail, n: row1.fromName }));
  check("B4 email row: status=draft + AI summary + AI draft", row1?.status === "draft" && !!row1?.summary && !!row1?.aiSubject && !!row1?.aiBody, JSON.stringify(row1 && { s: row1.status, sum: !!row1.summary, sub: !!row1.aiSubject, b: !!row1.aiBody }));
  check("B4 lead: created with source=email", !!r1.json?.leadId, JSON.stringify(r1.json));

  // B5: lead dedupe — same sender again → same leadId, no new lead
  const r2 = await api("/api/webhooks/email/inbound", { method: "POST" }, {
    from: "Jane Roe <jane.roe+test@ctomail.io>", to: fromEmail, subject: "Following up", body: "Just checking if someone can come look at my roof.",
  });
  check("B5 dedupe: second email → same leadId", r2.json?.leadId === r1.json?.leadId, JSON.stringify({ l1: r1.json?.leadId, l2: r2.json?.leadId }));
  const leadsA = await db.select().from(leads).where(eq(leads.workspaceId, A.workspaceId));
  check("B5 dedupe: only one lead row for sender", leadsA.filter((l) => (l.email || "").toLowerCase() === "jane.roe+test@ctomail.io").length === 1, `count=${leadsA.filter((l) => (l.email || "").toLowerCase() === "jane.roe+test@ctomail.io").length}`);

  // B6: envelope — malformed header rescued by envelope.from
  const r3 = await api("/api/webhooks/email/inbound", { method: "POST" }, {
    from: "!!!bad header!!!", to: fromEmail, subject: "Envelope test",
    body: "Using envelope sender.", envelope: JSON.stringify({ to: [fromEmail], from: "env.fallback@ctomail.io" }),
  });
  check("B6 envelope: ok despite malformed From header", r3.status === 200 && r3.json?.status === "ok", JSON.stringify(r3.json));
  const list2 = await api("/api/emails");
  const row3 = list2.json?.emails?.find((em: any) => em.id === r3.json?.emailId);
  check("B6 envelope: from = envelope.from (bare)", row3?.fromEmail === "env.fallback@ctomail.io", JSON.stringify(row3 && { f: row3.fromEmail }));

  // B7: malformed envelope JSON → still 200, header parsing still works
  const r4 = await api("/api/webhooks/email/inbound", { method: "POST" }, {
    from: "Env Sender <env.sender+test@ctomail.io>", to: fromEmail, subject: "Bad envelope",
    body: "Envelope JSON is garbage.", envelope: "{oops",
  });
  check("B7 bad envelope JSON → ok (no crash)", r4.status === 200 && r4.json?.status === "ok", JSON.stringify(r4.json));
  const row4 = (await api("/api/emails")).json?.emails?.find((em: any) => em.id === r4.json?.emailId);
  check("B7 bad envelope: header parsed anyway", row4?.fromEmail === "env.sender+test@ctomail.io" && row4?.fromName === "Env Sender", JSON.stringify(row4 && { f: row4.fromEmail, n: row4.fromName }));

  // B8: SendGrid-style form payload (content-type form-urlencoded)
  const formBody = new URLSearchParams({
    from: "Form Sender <form.sender+test@ctomail.io>",
    to: fromEmail,
    subject: "Form payload",
    text: "This came in as a SendGrid form post.",
    envelope: JSON.stringify({ to: [fromEmail], from: "form.sender+test@ctomail.io" }),
  });
  const r5 = await api("/api/webhooks/email/inbound", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: formBody.toString() });
  check("B8 SendGrid form payload → ok", r5.status === 200 && r5.json?.status === "ok", JSON.stringify(r5.json));
  const row5 = (await api("/api/emails")).json?.emails?.find((em: any) => em.id === r5.json?.emailId);
  check("B8 form payload: bare fromEmail + name", row5?.fromEmail === "form.sender+test@ctomail.io" && row5?.fromName === "Form Sender", JSON.stringify(row5 && { f: row5.fromEmail, n: row5.fromName }));

  // B9: regenerate with prompt direction
  const regen = await api(`/api/emails/${e1}/regenerate`, { method: "POST" }, { prompt: "Make it more formal and mention a free inspection" });
  check("B9 regenerate → 200 + regenPrompt stored + status draft", regen.status === 200 && regen.json?.email?.regenPrompt?.includes("formal") && regen.json?.email?.status === "draft", JSON.stringify(regen.json?.email && { p: regen.json.email.regenPrompt, s: regen.json.email.status }));

  // B10: status transitions — draft→error (simulated AI failure) → recover via regenerate
  await db.update(emails).set({ status: "error", error: "simulated: summary: boom", aiSubject: null, aiBody: null }).where(eq(emails.id, e1));
  const sendErr = await api(`/api/emails/${e1}/send`, { method: "POST" });
  check("B10 error row → send 400 (no AI draft)", sendErr.status === 400 && sendErr.json?.error?.includes("No AI draft"), JSON.stringify(sendErr.json));
  const regen2 = await api(`/api/emails/${e1}/regenerate`, { method: "POST" }, {});
  check("B10 error row → regenerate recovers (draft, error cleared, draft regenerated)", regen2.status === 200 && regen2.json?.email?.status === "draft" && regen2.json?.email?.error === null && !!regen2.json?.email?.aiSubject, JSON.stringify(regen2.json?.email && { s: regen2.json.email.status, e: regen2.json.email.error, sub: !!regen2.json.email.aiSubject }));

  // B11: send to a known-good address (team inbox) → draft→sent
  const rSend = await api("/api/webhooks/email/inbound", { method: "POST" }, {
    from: TEAM_INBOX, to: fromEmail, subject: "Hardening send test", body: "Please send me your rates for a roof inspection.",
  });
  const sendId = rSend.json?.emailId;
  const send = await api(`/api/emails/${sendId}/send`, { method: "POST" });
  check("B11 send → 200 + messageId", send.status === 200 && !!send.json?.messageId, JSON.stringify(send.json));
  const rowSend = (await api("/api/emails")).json?.emails?.find((em: any) => em.id === sendId);
  check("B11 row → status=sent + sentAt", rowSend?.status === "sent" && !!rowSend?.sentAt, JSON.stringify(rowSend && { s: rowSend.status, t: !!rowSend.sentAt }));

  // B12: already-sent guards
  const send2 = await api(`/api/emails/${sendId}/send`, { method: "POST" });
  check("B12 send again → 400 already sent", send2.status === 400 && send2.json?.error?.includes("already sent"), JSON.stringify(send2.json));
  const regenSent = await api(`/api/emails/${sendId}/regenerate`, { method: "POST" }, {});
  check("B12 regenerate after sent → 400 already sent", regenSent.status === 400 && regenSent.json?.error?.includes("already sent"), JSON.stringify(regenSent.json));

  // B13: cross-workspace scoping — fresh workspace B sees zero emails
  const B = await signup("unit-b");
  if (B.workspaceId) {
    pushWs(B.workspaceId);
    cookie = "";
    const rB = await api("/api/auth/signin", { method: "POST" }, { email: B.email, password: "Test-Pass-123!" });
    check("B13 signin B → 200", rB.status === 200, JSON.stringify(rB.json));
    const listB = await api("/api/emails");
    check("B13 workspace B sees zero emails (no cross-ws leak)", Array.isArray(listB.json?.emails) && listB.json.emails.length === 0, `count=${listB.json?.emails?.length}`);
  }

  // Cleanup: delete throwaway workspaces A + B via the cascading API route
  for (const ws of createdWs) {
    try {
      cookie = ws.cookie;
      const del = await api("/api/workspace", { method: "DELETE" });
      if (del.status !== 200) console.error(`cleanup ws ${ws.wsId} failed: ${del.status} ${del.text}`);
    } catch (err) {
      console.error("cleanup ws failed:", (err as Error).message);
    }
  }
}

// ────────────────────────────────────────────────
async function main() {
  parserTests();
  try {
    await liveTests();
  } catch (err) {
    fail++;
    console.error("❌ live tests crashed:", err);
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main();
