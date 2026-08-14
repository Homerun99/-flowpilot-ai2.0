// Unit tests for task afc0e6db — appointmentSpacer (minimum gap between
// consecutive appointments).
// Covers:
//   A. appointmentBusyKeys() pure cases: spacer 0 = legacy behavior (block H,
//      plus H+1 ONLY for mid-hour starts), 15/30/60 block H+1, 90 blocks
//      H+1..H+2, null/undefined/negative fall back to 0, end-of-day bound.
//   B. Booking-engine integration: a 10:00 appointment + 30min spacer leaves
//      12:00 as the next bookable hour (pickBestSlotChecked).
//   C. loadBusyHours(ws, day, tz, 14, spacer) against the REAL DB — the busy
//      set reflects the spacer (10:00 appt + 30 → 10:00 and 11:00 busy,
//      NOT 12:00; spacer 0 keeps 10:00-only for a top-of-hour start).
//
// Run: bun scripts/spacer-unit.ts  (from /home/team/shared/site)
import { db } from "../src/db/index";
import { workspaces, appointments } from "../src/db/schema";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { appointmentBusyKeys, parseBusinessHours, pickBestSlotChecked, parseDateTimeHint, zonedTimeToUtc, getHour } from "../src/lib/booking";
import { loadBusyHours } from "../twilio-handler.ts";

const TZ = "America/Phoenix";
const WS = "ws_spacer_unit";
let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log("  ✅", label); }
  else { fail++; console.log("  ❌", label, detail); }
};
const has = (keys: string[], k: string) => keys.includes(k);

try {
  // ── A. appointmentBusyKeys pure cases ────────────────────────────────
  console.log("== A. appointmentBusyKeys pure ==");
  // spacer 0, top-of-hour: only H (legacy).
  let k = appointmentBusyKeys("2026-08-18", 10, 0, 0);
  check("spacer 0, 10:00 sharp → [10]", k.length === 1 && has(k, "2026-08-18@10"), JSON.stringify(k));
  // spacer 0, mid-hour: H + H+1 (legacy).
  k = appointmentBusyKeys("2026-08-18", 10, 30, 0);
  check("spacer 0, 10:30 → [10, 11]", k.length === 2 && has(k, "2026-08-18@10") && has(k, "2026-08-18@11"), JSON.stringify(k));
  // spacer 15 / 30 / 60: H + H+1 (hourly granularity).
  for (const s of [15, 30, 60]) {
    k = appointmentBusyKeys("2026-08-18", 10, 0, s);
    check(`spacer ${s}, 10:00 → [10, 11]`, k.length === 2 && has(k, "2026-08-18@10") && has(k, "2026-08-18@11"), JSON.stringify(k));
  }
  // spacer 90: H + H+1 + H+2.
  k = appointmentBusyKeys("2026-08-18", 10, 0, 90);
  check("spacer 90, 10:00 → [10, 11, 12]", k.length === 3 && has(k, "2026-08-18@10") && has(k, "2026-08-18@11") && has(k, "2026-08-18@12"), JSON.stringify(k));
  // spacer 61: ceil(61/60)=2 → [10,11,12].
  k = appointmentBusyKeys("2026-08-18", 10, 0, 61);
  check("spacer 61 → [10, 11, 12]", k.length === 3 && has(k, "2026-08-18@12"), JSON.stringify(k));
  // spacer 120: ceil(120/60)=2 → [10,11,12].
  k = appointmentBusyKeys("2026-08-18", 10, 0, 120);
  check("spacer 120 → [10, 11, 12]", k.length === 3 && has(k, "2026-08-18@12"), JSON.stringify(k));
  // null / undefined / negative → 0 (legacy).
  for (const s of [null, undefined, -5]) {
    k = appointmentBusyKeys("2026-08-18", 10, 0, s as number | null | undefined);
    check(`spacer ${String(s)} → legacy [10]`, k.length === 1 && has(k, "2026-08-18@10"), JSON.stringify(k));
  }
  // End-of-day bound: hour 22 + spacer 90 → [22, 23] only (never hour 24+).
  k = appointmentBusyKeys("2026-08-18", 22, 0, 90);
  check("end-of-day bound: 22 + spacer 90 → [22, 23]", k.length === 2 && has(k, "2026-08-18@22") && has(k, "2026-08-18@23") && !has(k, "2026-08-18@24"), JSON.stringify(k));
  k = appointmentBusyKeys("2026-08-18", 23, 0, 120);
  check("hour 23 + spacer 120 → [23]", k.length === 1 && has(k, "2026-08-18@23"), JSON.stringify(k));
  // Mid-hour start with spacer still includes H+1 (superset, no dup issue).
  k = appointmentBusyKeys("2026-08-18", 10, 30, 30);
  check("spacer 30, 10:30 → [10, 11]", k.length === 2 && has(k, "2026-08-18@10") && has(k, "2026-08-18@11"), JSON.stringify(k));

  // ── B. Booking-engine integration (busy set drives slot selection) ──
  console.log("== B. slot selection respects the spacer ==");
  const hours = parseBusinessHours("Monday through Friday, 9am to 5pm");
  const now = new Date("2026-08-11T15:00:00Z"); // Tuesday 08:00 Phoenix
  const day = parseDateTimeHint("next wednesday", now, TZ)!.day; // 2026-08-12

  // "Anytime" request with an existing appointment at 9:00 (the first open
  // hour): the spacer pushes the earliest bookable slot.
  const anytime = (spacer: number | null) => {
    const busy = new Set<string>();
    for (const key of appointmentBusyKeys("2026-08-12", 9, 0, spacer)) busy.add(key);
    return pickBestSlotChecked({ day, preferEarliest: false }, hours, busy, now, TZ);
  };
  const a0 = anytime(0);
  check("anytime + 9:00 appt + spacer 0 → earliest 10:00 (legacy)", a0?.slot ? getHour(a0.slot, TZ) === 10 : false, JSON.stringify(a0));
  const a30 = anytime(30);
  check("anytime + 9:00 appt + spacer 30 → earliest 11:00 (9+10 blocked)", a30?.slot ? getHour(a30.slot, TZ) === 11 : false, JSON.stringify(a30));
  const a90 = anytime(90);
  check("anytime + 9:00 appt + spacer 90 → earliest 12:00 (9+10+11 blocked)", a90?.slot ? getHour(a90.slot, TZ) === 12 : false, JSON.stringify(a90));
  const aN = anytime(null);
  check("anytime + 9:00 appt + spacer null → earliest 10:00 (legacy)", aN?.slot ? getHour(aN.slot, TZ) === 10 : false, JSON.stringify(aN));

  // Exact-hour request for 10:00 with an existing appointment at 10:00 →
  // never matched (the engine offers a nearest free slot instead).
  const exact = (spacer: number | null) => {
    const busy = new Set<string>();
    for (const key of appointmentBusyKeys("2026-08-12", 10, 0, spacer)) busy.add(key);
    return pickBestSlotChecked({ day, preferEarliest: false, exactHour: 10 }, hours, busy, now, TZ);
  };
  check("exact 10:00 + spacer 30 → matched=false (never books a busy hour)", exact(30)?.matched === false, JSON.stringify(exact(30)));

  // ── C. loadBusyHours with the REAL DB reflects the spacer ────────────
  console.log("== C. loadBusyHours(ws, day, tz, 14, spacer) DB-backed ==");
  // Throwaway workspace (FK-safe cleanup order: appointments → workspace).
  await db.delete(appointments).where(eq(appointments.workspaceId, WS));
  await db.delete(workspaces).where(eq(workspaces.id, WS));
  await db.insert(workspaces).values({
    id: WS,
    name: "Spacer Unit",
    timezone: TZ,
    receptionistConfig: { businessName: "Spacer Unit", businessType: "test" },
  });
  // Seed appointments: 10:00 top-of-hour on 2026-08-12, 14:30 mid-hour on same day.
  const at = (h: number, m: number) => zonedTimeToUtc(2026, 8, 12, h, m, TZ);
  await db.insert(appointments).values([
    { id: randomUUID(), workspaceId: WS, leadId: null, title: "Spacer test appt", scheduledAt: at(10, 0), status: "scheduled" },
    { id: randomUUID(), workspaceId: WS, leadId: null, title: "Spacer test appt", scheduledAt: at(14, 30), status: "scheduled" },
  ]);
  const fromDay = zonedTimeToUtc(2026, 8, 12, 0, 0, TZ);

  const busy30 = await loadBusyHours(WS, fromDay, TZ, 14, 30);
  check("spacer 30: 10:00 blocks 10 AND 11", busy30.has("2026-08-12@10") && busy30.has("2026-08-12@11"), JSON.stringify([...busy30]));
  check("spacer 30: 14:30 blocks 14 AND 15", busy30.has("2026-08-12@14") && busy30.has("2026-08-12@15"), JSON.stringify([...busy30]));
  check("spacer 30: 12:00 is NOT busy", !busy30.has("2026-08-12@12"), JSON.stringify([...busy30]));

  const busy0 = await loadBusyHours(WS, fromDay, TZ, 14, 0);
  check("spacer 0: 10:00 sharp blocks ONLY 10", busy0.has("2026-08-12@10") && !busy0.has("2026-08-12@11"), JSON.stringify([...busy0]));
  check("spacer 0: 14:30 mid-hour blocks 14 AND 15 (legacy)", busy0.has("2026-08-12@14") && busy0.has("2026-08-12@15"), JSON.stringify([...busy0]));

  const busyNull = await loadBusyHours(WS, fromDay, TZ, 14, null);
  check("spacer null → legacy (10 only)", busyNull.has("2026-08-12@10") && !busyNull.has("2026-08-12@11"), JSON.stringify([...busyNull]));

  console.log(`\n${pass} passed, ${fail} failed`);
} catch (err) {
  console.error("spacer-unit error:", err);
  fail++;
} finally {
  // Cleanup: FK-safe.
  await db.delete(appointments).where(eq(appointments.workspaceId, WS));
  await db.delete(workspaces).where(eq(workspaces.id, WS));
}
process.exit(fail > 0 ? 1 : 0);
