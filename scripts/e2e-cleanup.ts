import { db } from "../src/db/index";
import { calls, leads, appointments, workspaces } from "../src/db/schema";
import { eq } from "drizzle-orm";
import { releaseNumber } from "../src/lib/twilio-provision";
const WS = "ws_phone_test";
try { await releaseNumber("PN57981e6c9a2ec1c9c02c8b23c5ad2941"); console.log("number released"); } catch (e) { console.log("release err:", (e as Error).message?.slice(0,120)); }
await db.delete(calls).where(eq(calls.workspaceId, WS));
const l = await db.select({id: leads.id}).from(leads).where(eq(leads.workspaceId, WS));
for (const r of l) await db.delete(appointments).where(eq(appointments.leadId, r.id));
await db.delete(leads).where(eq(leads.workspaceId, WS));
await db.delete(workspaces).where(eq(workspaces.id, WS));
console.log("test workspace + rows deleted");
