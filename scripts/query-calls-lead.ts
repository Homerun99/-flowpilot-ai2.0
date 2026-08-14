import { db } from "../src/db/index";
import { calls } from "../src/db/schema";
import { desc } from "drizzle-orm";
const rows = await db.select().from(calls).orderBy(desc(calls.startedAt)).limit(10);
for (const r of rows) {
  console.log(JSON.stringify({ id: r.id, ws: r.workspaceId, callSid: r.callSid, from: r.callerNumber, status: r.status, outcome: r.outcome, durationSec: r.durationSec, startedAt: r.startedAt, leadId: r.leadId, apptId: r.appointmentId, notes: (r.notes || "").slice(0, 300) }));
}
process.exit(0);
