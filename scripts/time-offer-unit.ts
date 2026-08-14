// Unit tests — "requested time outside business hours → offer closest slot"
// (task f2352c20). Context: Tue Aug 11 2026, America/Phoenix (UTC-7);
// business hours Tue-Fri 10:00-17:00 (owner's abcplumming setup).
//
// Run: bun scripts/time-offer-unit.ts  (from repo root)
import {
  parseDateTimeHint,
  pickBestSlotChecked,
  pickBestSlot,
  parseBusinessHours,
  timeUnavailableMessage,
  decideOfferedReply,
  formatSlot,
  dateKey,
  getHour,
  getDayOfWeek,
  startOfDay,
} from "../src/lib/booking.ts";

const TZ = "America/Phoenix";
const now = new Date("2026-08-11T15:00:00Z"); // Tue 08:00 Phoenix
let pass = 0, fail = 0;
function check(label: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log("  ✅", label); }
  else { fail++; console.log("  ❌", label, detail); }
}
const hours = parseBusinessHours("Tuesday through Friday, 10am to 5pm");
check("Tue open 10-17", hours[2]?.startHour === 10 && hours[2]?.endHour === 17);
check("Mon closed", hours[1] === null);
check("Sat closed", hours[6] === null);
const key = (day: Date, h: number) => `${dateKey(day, TZ)}@${h}`;

console.log("== (1) before opening: 'Tuesday at 9am' → offer 10:00, NO booking ==");
{
  const hint = parseDateTimeHint("tuesday at 9am", now, TZ)!;
  check("hint exactHour 9", hint.exactHour === 9);
  check("hint day is Tuesday", getDayOfWeek(hint.day, TZ) === 2);
  const pick = pickBestSlotChecked(hint, hours, new Set(), now, TZ)!;
  check("slot found", !!pick);
  check("matched=false (had to snap)", pick.matched === false);
  check("closest slot is Tue 10:00", getDayOfWeek(pick.slot, TZ) === 2 && getHour(pick.slot, TZ) === 10, pick.slot.toISOString());
  const msg = timeUnavailableMessage(hint, pick.slot, hours, now, TZ);
  check("message says NOT open at 9:00 AM", /not open at 9:00 AM/i.test(msg), msg);
  check("message offers the closest slot", msg.includes(formatSlot(pick.slot, now, TZ)), msg);
  // No silent booking: a bare pickBestSlot would have returned the slot, but
  // the offer flow must NOT produce an appointment (handler-level, covered by
  // E2E). Here we assert the offer message + matched flag are what the
  // handler needs to withhold the booking.
  check("pickBestSlot legacy still returns the slot", pickBestSlot(hint, hours, new Set(), now, TZ)?.getTime() === pick.slot.getTime());
}

console.log("== (2) after closing: 'Tuesday at 5pm' → offer closest (4:00 PM) ==");
{
  const hint = parseDateTimeHint("tuesday at 5pm", now, TZ)!;
  check("hint exactHour 17", hint.exactHour === 17);
  const pick = pickBestSlotChecked(hint, hours, new Set(), now, TZ)!;
  check("matched=false", pick.matched === false);
  check("closest slot is Tue 16:00", getHour(pick.slot, TZ) === 16, String(getHour(pick.slot, TZ)));
  const msg = timeUnavailableMessage(hint, pick.slot, hours, now, TZ);
  check("message says not open at 5:00 PM", /not open at 5:00 PM/i.test(msg), msg);
  check("message honest 'closest available time'", /closest available time/i.test(msg), msg);
}

console.log("== (3) fully-booked hour: 'Tuesday at 11am' busy → offer next free ==");
{
  const hint = parseDateTimeHint("tuesday at 11am", now, TZ)!;
  const busy = new Set([key(hint.day, 11)]);
  const pick = pickBestSlotChecked(hint, hours, busy, now, TZ)!;
  check("matched=false (11 busy)", pick.matched === false);
  check("closest free is 10 or 12", getHour(pick.slot, TZ) === 10 || getHour(pick.slot, TZ) === 12, String(getHour(pick.slot, TZ)));
  const msg = timeUnavailableMessage(hint, pick.slot, hours, now, TZ);
  check("message says fully booked", /fully booked/i.test(msg), msg);
  check("message offers closest", /closest available time/i.test(msg), msg);
}

console.log("== (4) agreement next turn books the offered slot ==");
{
  const slot10 = pickBestSlotChecked(parseDateTimeHint("tuesday at 10am", now, TZ)!, hours, new Set(), now, TZ)!.slot;
  check("'yes' accepts offered slot", decideOfferedReply("yes", undefined, slot10, now, TZ).kind === "accept-offered-slot");
  check("'sure' accepts", decideOfferedReply("sure", undefined, slot10, now, TZ).kind === "accept-offered-slot");
  check("'that works' accepts", decideOfferedReply("that works", undefined, slot10, now, TZ).kind === "accept-offered-slot");
  check("'10 am' (same time) accepts", (decideOfferedReply("10 am", undefined, slot10, now, TZ) as any).kind === "accept-offered-slot");
  const accepted = decideOfferedReply("yes", undefined, slot10, now, TZ);
  check("accept carries the exact slot", accepted.kind === "accept-offered-slot" && accepted.slot.getTime() === slot10.getTime());
}

console.log("== (5) naming a different time/day overrides the offer ==");
{
  const slot10 = pickBestSlotChecked(parseDateTimeHint("tuesday at 10am", now, TZ)!, hours, new Set(), now, TZ)!.slot;
  check("'11 am' overrides", decideOfferedReply("11 am", undefined, slot10, now, TZ).kind === "override");
  check("'wednesday' overrides", decideOfferedReply("wednesday", undefined, slot10, now, TZ).kind === "override");
  check("'tomorrow' overrides (different day)", decideOfferedReply("tomorrow", undefined, slot10, now, TZ).kind === "override");
  // same day, no time → accept (still the offered slot)
  check("'tuesday' (same day) accepts", decideOfferedReply("tuesday", undefined, slot10, now, TZ).kind === "accept-offered-slot");
}

console.log("== (6) window 'evening' when closing 5pm → offer instead of silent free[0] ==");
{
  const hint = parseDateTimeHint("tuesday evening", now, TZ)!;
  check("window=evening", hint.window === "evening", String(hint.window));
  check("no exactHour", hint.exactHour === undefined);
  const pick = pickBestSlotChecked(hint, hours, new Set(), now, TZ)!;
  check("matched=false (no evening availability)", pick.matched === false);
  check("slot is first free of day (10:00)", getHour(pick.slot, TZ) === 10, String(getHour(pick.slot, TZ)));
  const msg = timeUnavailableMessage(hint, pick.slot, hours, now, TZ);
  check("message mentions evening", /evening/i.test(msg), msg);
  check("message honest 'closest available time'", /closest available time/i.test(msg), msg);
}

console.log("== control: requested time IS available → matched=true, no offer ==");
{
  const h10 = parseDateTimeHint("tuesday at 10am", now, TZ)!;
  const p10 = pickBestSlotChecked(h10, hours, new Set(), now, TZ)!;
  check("'Tuesday at 10am' matched=true", p10.matched === true && getHour(p10.slot, TZ) === 10);
  const hNoon = parseDateTimeHint("tuesday at noon", now, TZ)!;
  check("'Tuesday at noon' matched=true", pickBestSlotChecked(hNoon, hours, new Set(), now, TZ)!.matched === true);
  // ASAP → matched=true (book earliest directly, no offer)
  const asap = parseDateTimeHint("as soon as possible", now, TZ)!;
  check("ASAP → matched=true", pickBestSlotChecked(asap, hours, new Set(), now, TZ)!.matched === true);
  // no-time preference ('tuesday') → matched=true
  const tue = parseDateTimeHint("tuesday", now, TZ)!;
  check("'tuesday' (no time) → matched=true", pickBestSlotChecked(tue, hours, new Set(), now, TZ)!.matched === true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
