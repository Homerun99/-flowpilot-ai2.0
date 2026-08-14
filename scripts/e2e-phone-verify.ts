// E2E verify — live webhook against the published server.
// (b) routing by number  (c) booking lands in ws_phone_test  (d) ring+complete call row
// (e) booking call row outcome  + speech-turn latency.
import { db } from "../src/db/index";
import { leads, appointments, calls, workspaces } from "../src/db/schema";
import { eq, and } from "drizzle-orm";

const BASE = "http://localhost:3000/api/twilio/webhooks/voice";
const WS = "ws_phone_test";
const TO = "+14059310473";

async function hit(params: Record<string, string>) {
  const body = new URLSearchParams(params);
  const t0 = performance.now();
  const resp = await fetch(BASE, { method: "POST", body, headers: { "Content-Type": "application/x-www-form-urlencoded" } });
  const ms = Math.round(performance.now() - t0);
  const text = await resp.text();
  return { ms, status: resp.status, text };
}

console.log("=== (b) ROUTING: greeting for To=+14059310473 ===");
const g = await hit({ CallSid: "CA-booktest1", From: "+15550001111", To: TO, CallStatus: "in-progress" });
console.log(`greeting ${g.status} in ${g.ms}ms`);
console.log("Play URL contains ws_phone_test:", g.text.includes("ws:greeting:ws_phone_test:"));
console.log("Play URL contains owner ws_2w3a8uul:", g.text.includes("ws:greeting:ws_2w3a8uul:"));

console.log("\n=== (c) BOOKING FLOW (same call) ===");
const t1 = await hit({ CallSid: "CA-booktest1", From: "+15550001111", To: TO, CallStatus: "in-progress", SpeechResult: "I have a hole in my roof", Confidence: "0.9" });
console.log(`turn1 ${t1.ms}ms  reply:`, t1.text.slice(0, 120).replace(/\s+/g, " "));
const t2 = await hit({ CallSid: "CA-booktest1", From: "+15550001111", To: TO, CallStatus: "in-progress", SpeechResult: "tomorrow morning", Confidence: "0.9" });
console.log(`turn2 ${t2.ms}ms  reply:`, t2.text.slice(0, 120).replace(/\s+/g, " "));
const t3 = await hit({ CallSid: "CA-booktest1", From: "+15550001111", To: TO, CallStatus: "in-progress", SpeechResult: "my name is Jane Cooper", Confidence: "0.9" });
console.log(`turn3 ${t3.ms}ms  reply:`, t3.text.slice(0, 140).replace(/\s+/g, " "));
const t4 = await hit({ CallSid: "CA-booktest1", From: "+15550001111", To: TO, CallStatus: "completed" });
console.log(`completed ${t4.ms}ms  reply:`, t4.text.slice(0, 80).replace(/\s+/g, " "));

console.log("\n=== (d) RING + HANGUP (no speech) ===");
const r1 = await hit({ CallSid: "CA-ringtest1", From: "+15550002222", To: TO, CallStatus: "ringing" });
console.log(`ringing ${r1.ms}ms`);
const r2 = await hit({ CallSid: "CA-ringtest1", From: "+15550002222", To: TO, CallStatus: "completed" });
console.log(`completed ${r2.ms}ms`);

// Give fire-and-forget call-log writes a moment, then inspect the DB.
await new Promise((r) => setTimeout(r, 2500));

console.log("\n=== DB CHECKS ===");
const lds = await db.select().from(leads).where(eq(leads.workspaceId, WS));
const apps = await db.select().from(appointments).where(eq(appointments.workspaceId, WS));
const cs = await db.select().from(calls).where(eq(calls.workspaceId, WS)).orderBy(calls.startedAt);
console.log("leads in ws_phone_test:", JSON.stringify(lds.map((l) => ({ name: l.name, source: l.source, score: l.score }))));
console.log("appointments in ws_phone_test:", JSON.stringify(apps.map((a) => ({ title: a.title, status: a.status, leadId: a.leadId }))));
console.log("calls in ws_phone_test:", JSON.stringify(cs.map((c) => ({ callSid: c.callSid, status: c.status, outcome: c.outcome, durationSec: c.durationSec, leadId: c.leadId?.slice(0,8), appointmentId: c.appointmentId?.slice(0,8) }))));
// Confirm NOTHING leaked into owner's workspace
const ownerLeads = await db.select({ id: leads.id }).from(leads).where(and(eq(leads.workspaceId, "ws_2w3a8uul"), eq(leads.source, "phone")));
console.log("owner phone-source leads (should be 0):", ownerLeads.length);
