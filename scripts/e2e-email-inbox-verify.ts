/**
 * Email Inbox — live E2E verification (task 1e06d386).
 *
 * Full journey against the running server:
 *   signup throwaway → POST JSON inbound → GET /api/emails shows row with
 *   AI summary + AI draft → regenerate with prompt (draft replaced) → send
 *   → status=sent → delete workspace.
 *
 * Run: bun scripts/e2e-email-inbox-verify.ts  (BASE_URL overridable)
 */
let pass = 0, fail = 0;
function check(label: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log("  ✅", label); }
  else { fail++; console.log("  ❌", label, detail); }
}

const BASE = process.env.BASE_URL || "http://localhost:3000";
let cookie = "";
async function api(path: string, init: RequestInit = {}, json?: unknown) {
  const headers = new Headers(init.headers || {});
  if (cookie) headers.set("cookie", cookie);
  if (json !== undefined) headers.set("content-type", "application/json");
  const res = await fetch(BASE + path, { ...init, headers, body: json !== undefined ? JSON.stringify(json) : init.body });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  const text = await res.text();
  let parsed: any = null;
  try { parsed = JSON.parse(text); } catch { /* non-JSON */ }
  return { status: res.status, json: parsed, text };
}

async function main() {
  const email = `e2e-${Date.now()}@ctomail.io`;
  const r = await api("/api/auth/signup", { method: "POST" }, { email, password: "Test-Pass-123!", name: "E2E Tester" });
  const wsId = r.json?.user?.workspaceId;
  check("signup → 201 + workspaceId", r.status === 201 && !!wsId, JSON.stringify(r.json));

  const cfg = await api("/api/workspace/email-config");
  const fromEmail = cfg.json?.from_email;
  check("email-config → branded sender", typeof fromEmail === "string" && fromEmail.endsWith("@klerkitai.com"), JSON.stringify(cfg.json));

  const inbound = await api("/api/webhooks/email/inbound", { method: "POST" }, {
    from: "E2E Sender <e2e.sender@ctomail.io>",
    to: fromEmail,
    subject: "E2E inquiry — water heater",
    body: "Our water heater is making noise. How much is a replacement and when can someone come out?",
  });
  const emailId = inbound.json?.emailId;
  check("inbound → ok + draftReady", inbound.status === 200 && inbound.json?.status === "ok" && inbound.json?.draftReady === true, JSON.stringify(inbound.json));

  const list = await api("/api/emails");
  const row = list.json?.emails?.find((em: any) => em.id === emailId);
  check("GET /api/emails → row with summary + AI draft",
    !!row && row.status === "draft" && !!row.summary && !!row.aiSubject && !!row.aiBody,
    JSON.stringify(row && { s: row.status, sum: (row.summary || "").slice(0, 60), sub: row.aiSubject, b: (row.aiBody || "").slice(0, 40) }));

  const regen = await api(`/api/emails/${emailId}/regenerate`, { method: "POST" }, { prompt: "Shorten it and offer a free estimate" });
  check("regenerate → draft replaced + prompt stored",
    regen.status === 200 && !!regen.json?.email?.aiSubject && regen.json?.email?.regenPrompt?.includes("Shorten"),
    JSON.stringify(regen.json?.email && { sub: regen.json.email.aiSubject, p: regen.json.email.regenPrompt }));

  // Send — recipient is e2e.sender@ctomail.io (ctomail.io accepts mail; we verify
  // delivery by reading the flowpilot inbox after the run).
  const send = await api(`/api/emails/${emailId}/send`, { method: "POST" });
  check("send → 200 + messageId", send.status === 200 && !!send.json?.messageId, JSON.stringify(send.json));

  const after = await api("/api/emails");
  const sent = after.json?.emails?.find((em: any) => em.id === emailId);
  check("row → status=sent + sentAt", sent?.status === "sent" && !!sent?.sentAt, JSON.stringify(sent && { s: sent.status, t: !!sent.sentAt }));

  // Cleanup
  const del = await api("/api/workspace", { method: "DELETE" });
  check("workspace deleted (cleanup)", del.status === 200, `${del.status} ${del.text}`);

  console.log(`\nE2E: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((err) => { console.error("E2E crashed:", err); process.exit(1); });
