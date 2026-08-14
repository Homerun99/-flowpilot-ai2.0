// Call log helper — upserts rows in the `calls` table.
// Used by serve.ts (lifecycle: status/endedAt/duration) and twilio-handler.ts
// (outcome: lead_captured / appointment_booked / transferred / message_taken).
//
// Both functions are idempotent upserts keyed on (workspaceId, callSid), so
// callers can fire them without awaiting (race-safe) — call logging must never
// add latency to the voice path.

import { db } from "../db/index";
import { calls } from "../db/schema";
import { and, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

export type CallOutcome =
  | "incomplete"
  | "lead_captured"
  | "appointment_booked"
  | "transferred"
  | "message_taken"
  | "completed";

export interface UpsertCallInput {
  workspaceId: string;
  callSid: string;
  callerNumber?: string;
  toNumber?: string;
  status?: string;
}

/**
 * INSERT the call row on first sight of a callSid, or UPDATE status/endedAt/
 * durationSec as lifecycle events arrive. Never touches `outcome` — that's
 * owned by updateCallOutcome.
 */
export async function upsertCallRow(input: UpsertCallInput): Promise<void> {
  const { workspaceId, callSid, callerNumber, toNumber, status } = input;
  if (!workspaceId || !callSid) return;

  const now = new Date();
  const completed = status === "completed";

  const setData: Record<string, unknown> = { status: status || "in-progress" };
  if (completed) {
    setData.endedAt = sql`now()`;
    // durationSec from the row's own started_at (epoch seconds, rounded)
    setData.durationSec = sql`round(extract(epoch from (now() - calls.started_at))::numeric)::integer`;
  }

  await db
    .insert(calls)
    .values({
      id: randomUUID(),
      workspaceId,
      callSid,
      callerNumber: callerNumber || null,
      toNumber: toNumber || null,
      status: status || "in-progress",
      startedAt: now,
      ...(completed ? { endedAt: now, durationSec: 0 } : {}),
    })
    .onConflictDoUpdate({
      target: [calls.workspaceId, calls.callSid],
      set: setData as never,
    });
}

export interface UpdateCallOutcomeInput {
  workspaceId: string;
  callSid: string;
  outcome: CallOutcome;
  leadId?: string | null;
  appointmentId?: string | null;
}

/**
 * Record what the call produced. Upserts by (workspaceId, callSid) so it is
 * safe to fire before/without the lifecycle upsert — the row is created with
 * the given outcome if it doesn't exist yet.
 */
export async function updateCallOutcome(input: UpdateCallOutcomeInput): Promise<void> {
  const { workspaceId, callSid, outcome, leadId, appointmentId } = input;
  if (!workspaceId || !callSid) return;

  const now = new Date();
  const setData: Record<string, unknown> = {
    outcome,
    ...(leadId !== undefined ? { leadId } : {}),
    ...(appointmentId !== undefined ? { appointmentId } : {}),
  };

  await db
    .insert(calls)
    .values({
      id: randomUUID(),
      workspaceId,
      callSid,
      status: "in-progress",
      outcome,
      startedAt: now,
      ...(leadId !== undefined ? { leadId } : {}),
      ...(appointmentId !== undefined ? { appointmentId } : {}),
    })
    .onConflictDoUpdate({
      target: [calls.workspaceId, calls.callSid],
      set: setData as never,
    });
}

/**
 * Finalize a call row when the call ends (Twilio statusCallback "completed",
 * or a terminal status like canceled/failed). Upserts by (workspaceId, callSid):
 * - Row missing → create it already marked completed (duration 0).
 * - Row exists → set status=completed, endedAt=now, durationSec from the row's
 *   own started_at, and — crucially — keep any richer outcome already recorded
 *   (appointment_booked / transferred / message_taken / lead_captured). Only a
 *   still-empty/incomplete outcome is promoted to "completed". This makes the
 *   statusCallback event safe to race against the (fire-and-forget) outcome
 *   update from twilio-handler without one clobbering the other.
 */
export async function finalizeCallRow(workspaceId: string, callSid: string): Promise<void> {
  if (!workspaceId || !callSid) return;
  const now = new Date();
  await db
    .insert(calls)
    .values({
      id: randomUUID(),
      workspaceId,
      callSid,
      status: "completed",
      outcome: "completed",
      startedAt: now,
      endedAt: now,
      durationSec: 0,
    })
    .onConflictDoUpdate({
      target: [calls.workspaceId, calls.callSid],
      set: {
        status: "completed",
        endedAt: sql`now()`,
        // durationSec from the row's own started_at (epoch seconds, rounded)
        durationSec: sql`round(extract(epoch from (now() - calls.started_at))::numeric)::integer`,
        outcome: sql`CASE WHEN calls.outcome IS NULL OR calls.outcome = 'incomplete' THEN 'completed' ELSE calls.outcome END`,
      } as never,
    });
}

/** Fire-and-forget wrapper: never throws, never blocks the voice path. */
export function logCall(
  fn: () => Promise<void>,
  label: string,
): void {
  fn().catch((err) => {
    console.warn(`[call-log] ${label} failed (non-fatal):`, err);
  });
}

/** Look up a call row by (workspaceId, callSid) — for verification/tests. */
export async function findCall(
  workspaceId: string,
  callSid: string,
): Promise<typeof calls.$inferSelect | null> {
  const rows = await db
    .select()
    .from(calls)
    .where(and(eq(calls.workspaceId, workspaceId), eq(calls.callSid, callSid)))
    .limit(1);
  return rows[0] || null;
}
