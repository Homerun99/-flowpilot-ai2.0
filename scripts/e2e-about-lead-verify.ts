// E2E — "About the Lead": summary + qualifying Q&A captured on phone-created
// leads (task 5ab7c6de). Real provisioned Twilio number on a THROWAWAY
// workspace (hours Tue-Fri 10-17, America/Phoenix).
//   Call A (primary): caller states a problem → Nova asks qualifying questions
//   → caller answers → books "Tuesday at 10am". Verify the created lead has a
//   non-empty summary mentioning the problem + Tuesday 10:00 AM, and a qa
//   array with Q&A pairs. Call B (control): simple "I need a plumber" + name +
//   "Tuesday at 11am" → lead still created without error (summary may be null).
// Run: bun scripts/e2e-about-lead-verify.ts  (from /home/team/shared/site)
import { db } from "../src/db/index";
import { leads, appointments, calls, workspaces, activityLog, users } from "../src/db/schema";
import { eq } from "drizzle-orm";
import { provisionForWorkspace, releaseNumber } from "../src/lib/twilio-provision";
import { getHour, getDayOfWeek } from "../src/lib/booking";

const BASE = "http://localhost:3000/api/twilio/webhooks/voice";
const TZ = "America/Phoenix";
const TEST_WS = "ws_aboutlead_test";
const FROM = "+15550009999";
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
async function novaSaid(callSid: string): Promise<string> {
  const log = await Bun.file(`${import.meta.dir}/../.run/server.log`).text();
  const re = new RegExp(`\\[twilio-handler\\] ${callSid} Nova says(?:\\([^)]*\\))?: ([^\\n]+)`, "g");
  let last = "";
  for (const m of log.matchAll(re)) last = m[1];
  return last.trim();
}
const greetingKey = (wsId: string) => `ws:greeting:${wsId}:`;
const hasGreeting = (xml: string, wsId: string) =>
  xml.includes(encodeURIComponent(greetingKey(wsId))) || xml.includes(greetingKey(wsId));

async function deleteWorkspaceRows(wsId: string) {
  await db.delete(users).where(eq(users.workspaceId, wsId));
  await db.delete(calls).where(eq(calls.workspaceId, wsId));
  const l = await db.select({ id: leads.id }).from(leads).where(eq(leads.workspaceId, wsId));
  for (const r of l) await db.delete(appointments).where(eq(appointments.leadId, r.id));
  await db.delete(leads).where(eq(leads.workspaceId, wsId));
  await db.delete(activityLog).where(eq(activityLog.workspaceId, wsId));
  await db.delete(workspaces).where(eq(workspaces.id, wsId));
}

try {
  console.log("== SETUP ==");
  await deleteWorkspaceRows(TEST_WS);
  await db.insert(workspaces).values({
    id: TEST_WS,
    name: "About Lead Plumbing",
    fromName: "About Lead Plumbing",
    fromEmail: "aboutlead@klerkitai.com",
    timezone: TZ,
    receptionistConfig: {
      businessName: "About Lead Plumbing",
      businessType: "plumbing",
      businessHours: "Tuesday through Friday, 10am to 5pm",
      description: "Plumbing repair and service company",
    },
  });
  const prov = await provisionForWorkspace();
  if (!prov) throw new Error("PROVISION FAILED — Twilio not configured?");
  await db.update(workspaces).set({ twilioPhone: prov.number, twilioPhoneSid: prov.sid, phoneMode: "provisioned" }).where(eq(workspaces.id, TEST_WS));
  console.log("  test workspace:", TEST_WS, "number:", prov.number);

  // ── CALL A (primary): problem → qualifying Q&A → books Tuesday 10am ──
  const A = "CA-aboutlead-a";
  console.log("== CALL A: water under the sink, answers questions, Tue 10am ==");
  const g = await hit({ CallSid: A, From: FROM, To: prov.number, CallStatus: "in-progress" });
  ok("greeting routes to test workspace", hasGreeting(g.text, TEST_WS), g.text.slice(0, 140));
  const a1 = await hit({ CallSid: A, From: FROM, To: prov.number, CallStatus: "in-progress", SpeechResult: "there's water coming in under my kitchen sink", Confidence: "0.95" });
  const s1 = await novaSaid(A);
  console.log(`  A1 ${a1.ms}ms → "${s1.slice(0, 150)}"`);
  ok("A1 fast (<8s)", a1.ms < 8000, `${a1.ms}ms`);
  const a2 = await hit({ CallSid: A, From: FROM, To: prov.number, CallStatus: "in-progress", SpeechResult: "yes, it's dripping from under the sink", Confidence: "0.95" });
  const s2 = await novaSaid(A);
  console.log(`  A2 ${a2.ms}ms → "${s2.slice(0, 150)}"`);
  ok("A2 fast (<8s)", a2.ms < 8000, `${a2.ms}ms`);
  const a3 = await hit({ CallSid: A, From: FROM, To: prov.number, CallStatus: "in-progress", SpeechResult: "about 2 days now", Confidence: "0.95" });
  const s3 = await novaSaid(A);
  console.log(`  A3 ${a3.ms}ms → "${s3.slice(0, 150)}"`);
  ok("A3 fast (<8s)", a3.ms < 8000, `${a3.ms}ms`);
  const a4 = await hit({ CallSid: A, From: FROM, To: prov.number, CallStatus: "in-progress", SpeechResult: "my name is Jamie Torres", Confidence: "0.95" });
  const s4 = await novaSaid(A);
  console.log(`  A4 ${a4.ms}ms → "${s4.slice(0, 150)}"`);
  ok("A4 fast (<8s)", a4.ms < 8000, `${a4.ms}ms`);
  const a5 = await hit({ CallSid: A, From: FROM, To: prov.number, CallStatus: "in-progress", SpeechResult: "Tuesday at 10am", Confidence: "0.95" });
  const s5 = await novaSaid(A);
  console.log(`  A5 ${a5.ms}ms → "${s5.slice(0, 150)}"`);
  ok("A5 fast (<8s)", a5.ms < 8000, `${a5.ms}ms`);
  ok("A5 books 10:00 AM", /10:00 AM/i.test(s5), s5.slice(0, 150));
  ok("A5 no re-intro", !/this is nova/i.test(s5), s5.slice(0, 100));
  await hit({ CallSid: A, From: FROM, To: prov.number, CallStatus: "completed" });
  await new Promise((r) => setTimeout(r, 3000)); // let the booking write finish

  // ── CALL B (control): no qualifying Q&A → lead still created ──
  const B = "CA-aboutlead-b";
  console.log("== CALL B (control): 'I need a plumber', Tue 11am ==");
  const gb = await hit({ CallSid: B, From: FROM, To: prov.number, CallStatus: "in-progress" });
  ok("greeting routes to test workspace", hasGreeting(gb.text, TEST_WS), gb.text.slice(0, 140));
  await hit({ CallSid: B, From: FROM, To: prov.number, CallStatus: "in-progress", SpeechResult: "I need a plumber", Confidence: "0.95" });
  await hit({ CallSid: B, From: FROM, To: prov.number, CallStatus: "in-progress", SpeechResult: "my name is Dana Kim", Confidence: "0.95" });
  const b3 = await hit({ CallSid: B, From: FROM, To: prov.number, CallStatus: "in-progress", SpeechResult: "Tuesday at 11am", Confidence: "0.95" });
  const sb3 = await novaSaid(B);
  ok("B3 fast (<8s)", b3.ms < 8000, `${b3.ms}ms`);
  ok("B3 books 11:00 AM", /11:00 AM/i.test(sb3), sb3.slice(0, 150));
  await hit({ CallSid: B, From: FROM, To: prov.number, CallStatus: "completed" });
  await new Promise((r) => setTimeout(r, 3000));

  // ── DB VERIFY ──
  console.log("== DB VERIFY ==");
  const lds = await db.select().from(leads).where(eq(leads.workspaceId, TEST_WS));
  const apps = await db.select().from(appointments).where(eq(appointments.workspaceId, TEST_WS));
  ok("two leads created", lds.length === 2, `got ${lds.length}`);
  ok("two appointments created", apps.length === 2, `got ${apps.length}`);
  const leadA = lds.find((l) => l.name === "Jamie Torres");
  const leadB = lds.find((l) => l.name === "Dana Kim");
  ok("lead A found (Jamie Torres)", !!leadA);
  ok("lead B found (Dana Kim)", !!leadB);
  if (leadA) {
    console.log(`  lead A summary: ${(leadA.summary || "").slice(0, 200)}`);
    console.log(`  lead A qa: ${JSON.stringify(leadA.qa).slice(0, 240)}`);
    ok("A summary non-empty", !!leadA.summary && leadA.summary.length > 30, String(leadA.summary));
    ok("A summary mentions the problem (water/sink)", /water|sink|leak/i.test(leadA.summary || ""), leadA.summary || "");
    ok("A summary includes the WHEN (Tuesday / 10:00)", /tuesday|10:00 am/i.test(leadA.summary || ""), leadA.summary || "");
    ok("A qa is an array", Array.isArray(leadA.qa), String(leadA.qa));
    ok("A qa has >= 1 pair", Array.isArray(leadA.qa) && leadA.qa.length >= 1, JSON.stringify(leadA.qa));
    ok("A qa pairs have question+answer", Array.isArray(leadA.qa) && leadA.qa.every((p: any) => typeof p?.question === "string" && p.question.length > 0 && typeof p?.answer === "string" && p.answer.length > 0));
  }
  if (leadB) {
    console.log(`  B summary: ${(leadB.summary || "(null)").slice(0, 160)}`);
    ok("B lead created without error", true);
    ok("B summary null-or-string", leadB.summary === null || typeof leadB.summary === "string");
    ok("B qa is an array", Array.isArray(leadB.qa), String(leadB.qa));
  }
  const apptA = apps.find((a) => a.leadId === leadA?.id);
  const apptB = apps.find((a) => a.leadId === leadB?.id);
  ok("A appointment Tue 10:00 Phoenix", !!apptA && getDayOfWeek(apptA.scheduledAt, TZ) === 2 && getHour(apptA.scheduledAt, TZ) === 10, apptA?.scheduledAt.toISOString());
  ok("B appointment Tue 11:00 Phoenix", !!apptB && getDayOfWeek(apptB.scheduledAt, TZ) === 2 && getHour(apptB.scheduledAt, TZ) === 11, apptB?.scheduledAt.toISOString());

  // ── API contract: GET /api/leads returns summary + qa ──
  console.log("== API CONTRACT ==");
  // GET /api/leads is session-authenticated; signup accepts workspaceId, so
  // create a throwaway user bound to the test workspace and use its cookie.
  const email = `e2e-aboutlead-${Date.now()}@test.local`;
  const signup = await fetch(`http://localhost:3000/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "TestPass123!", name: "E2E AboutLead", workspaceId: TEST_WS }),
  });
  const setCookie = signup.headers.get("set-cookie") || "";
  ok("signup ok (session created)", signup.status >= 200 && signup.status < 300 && setCookie.includes("fp_session"), `${signup.status} ${setCookie.slice(0, 40)}`);
  const apiResp = await fetch(`http://localhost:3000/api/leads?limit=20`, {
    headers: { Cookie: setCookie.split(";")[0] },
  });
  const apiJson = await apiResp.json().catch(() => null);
  const leadsFromApi: any[] = Array.isArray(apiJson?.leads) ? apiJson.leads : [];
  const leadInApi = leadsFromApi.find((l: any) => l.id === leadA?.id);
  ok("GET /api/leads reachable (auth ok)", apiResp.status === 200, String(apiResp.status));
  ok("test lead returned via API", !!leadInApi, `got ${leadsFromApi.length} leads`);
  if (leadInApi) {
    ok("API lead has summary field", "summary" in leadInApi && typeof leadInApi.summary === "string", JSON.stringify(Object.keys(leadInApi)));
    ok("API lead has qa field (array)", Array.isArray(leadInApi.qa) && leadInApi.qa.length >= 1, JSON.stringify(leadInApi.qa));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
} catch (err) {
  console.error("E2E error:", err);
  fail++;
} finally {
  console.log("== CLEANUP ==");
  const ws = await db.query.workspaces.findFirst({ where: eq(workspaces.id, TEST_WS), columns: { twilioPhoneSid: true } });
  if (ws?.twilioPhoneSid) {
    const rel = await releaseNumber(ws.twilioPhoneSid);
    console.log("  number released:", rel);
  }
  await deleteWorkspaceRows(TEST_WS);
  const wsGone = await db.query.workspaces.findFirst({ where: eq(workspaces.id, TEST_WS), columns: { id: true } });
  console.log("  test ws exists:", !!wsGone);
}
process.exit(fail > 0 ? 1 : 0);
