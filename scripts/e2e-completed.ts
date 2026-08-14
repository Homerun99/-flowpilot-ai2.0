import { db } from "../src/db/index";
import { calls } from "../src/db/schema";
import { eq } from "drizzle-orm";
const BASE = "http://localhost:3000/api/twilio/webhooks/voice";
const TO = "+14059310473";
const hit = async (p: Record<string, string>) => {
  const r = await fetch(BASE, { method: "POST", body: new URLSearchParams(p), headers: { "Content-Type": "application/x-www-form-urlencoded" } });
  return { s: r.status, t: (await r.text()) };
};
const g = await hit({ CallSid: "CA-verify1", From: "+15550003333", To: TO, CallStatus: "in-progress" });
console.log("greeting status:", g.s);
console.log("greeting contains ws_phone_test (decoded):", decodeURIComponent(g.t).includes("ws:greeting:ws_phone_test:"));
console.log("greeting contains owner (decoded):", decodeURIComponent(g.t).includes("ws:greeting:ws_2w3a8uul:"));
await hit({ CallSid: "CA-ringtest1", From: "+15550002222", To: TO, CallStatus: "completed" });
await hit({ CallSid: "CA-verify1", From: "+15550003333", To: TO, CallStatus: "completed" });
await new Promise((r) => setTimeout(r, 2000));
const rows = await db.select().from(calls).where(eq(calls.workspaceId, "ws_phone_test"));
console.log("calls:", JSON.stringify(rows.map((c) => ({ callSid: c.callSid, status: c.status, outcome: c.outcome, durationSec: c.durationSec, leadId: c.leadId ? "yes" : null, apptId: c.appointmentId ? "yes" : null }))));
