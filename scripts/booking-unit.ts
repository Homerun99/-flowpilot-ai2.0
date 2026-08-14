import {
  parseDateTimeHint, pickBestSlot, parseBusinessHours, formatSlot,
  zonedTimeToUtc, getDayOfWeek, startOfDay, findNextOpenDay,
} from "/home/team/shared/site/src/lib/booking.ts";

const TZ = "America/Phoenix";
// 2026-08-11 is a Tuesday
const now = new Date("2026-08-11T15:00:00Z");
let pass = 0, fail = 0;
function check(label: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log("  ✅", label); }
  else { fail++; console.log("  ❌", label, detail); }
}

console.log("== tz math ==");
const satNoonPhoenix = zonedTimeToUtc(2026, 8, 15, 12, 0, TZ);
check("Sat 12:00 Phoenix == 19:00Z", satNoonPhoenix.toISOString() === "2026-08-15T19:00:00.000Z", satNoonPhoenix.toISOString());
check("getDayOfWeek(Sat) == 6", getDayOfWeek(satNoonPhoenix, TZ) === 6, String(getDayOfWeek(satNoonPhoenix, TZ)));

console.log("== ASAP short-circuit (bug #2) ==");
let h = parseDateTimeHint("as soon as possible", now, TZ)!;
check("'as soon as possible' → preferEarliest", h.preferEarliest === true);
check("'as soon as possible' → day today", h.day.getTime() === startOfDay(now, TZ).getTime());

h = parseDateTimeHint("next saturday at 12pm", now, TZ)!;
check("'next saturday at 12pm' → exactHour 12", h.exactHour === 12, String(h.exactHour));
check("'next saturday at 12pm' → day is Saturday", getDayOfWeek(h.day, TZ) === 6, String(h.day.toISOString()));
check("'next saturday at 12pm' → NOT preferEarliest", !h.preferEarliest);

h = parseDateTimeHint("as soon as possible next saturday at noon", now, TZ)!;
check("'asap next saturday at noon' → exactHour 12 (noon)", h.exactHour === 12, String(h.exactHour));
check("'asap next saturday at noon' → day is Saturday", getDayOfWeek(h.day, TZ) === 6);
check("'asap next saturday at noon' → NOT preferEarliest (specific wins)", !h.preferEarliest);

h = parseDateTimeHint("friday morning", now, TZ)!;
check("'friday morning' → window morning", h.window === "morning", String(h.window));
check("'friday morning' → day Friday", getDayOfWeek(h.day, TZ) === 5, String(h.day.toISOString()));

h = parseDateTimeHint("tomorrow afternoon", now, TZ)!;
check("'tomorrow afternoon' → window afternoon", h.window === "afternoon");
check("'tomorrow afternoon' → day tomorrow", h.day.getTime() === zonedTimeToUtc(2026, 8, 12, 0, 0, TZ).getTime(), h.day.toISOString());

h = parseDateTimeHint("2pm", now, TZ)!;
check("'2pm' → exactHour 14", h.exactHour === 14, String(h.exactHour));
check("'2pm' → day today", h.day.getTime() === startOfDay(now, TZ).getTime());

console.log("== business hours (bug #3) ==");
const hrs = parseBusinessHours("Monday through Saturday, 9am to 5pm");
check("Mon-Sat parsed: Monday open", hrs[1]?.startHour === 9 && hrs[1]?.endHour === 17);
check("Mon-Sat parsed: Saturday open", hrs[6]?.startHour === 9 && hrs[6]?.endHour === 17);
check("Mon-Sat parsed: Sunday closed", hrs[0] === null);
const mf = parseBusinessHours("Monday through Friday, 9am to 5pm");
check("Mon-Fri default: Saturday closed", mf[6] === null);
check("range+individual union ('Mon-Fri 9-5, Sat 9-12')", parseBusinessHours("Monday through Friday 9am to 5pm, Saturday 9am to 12pm")[6] !== null);

console.log("== pickBestSlot tz correctness ==");
const hint = parseDateTimeHint("next saturday at 12pm", now, TZ)!;
const slot = pickBestSlot(hint, hrs, new Set(), now, TZ);
check("slot found", !!slot);
check("slot == Sat 12:00 Phoenix (19:00Z)", slot?.toISOString() === "2026-08-15T19:00:00.000Z", slot?.toISOString());
check("formatSlot == 'Saturday at 12:00 PM'", formatSlot(slot!, now, TZ) === "Saturday at 12:00 PM", formatSlot(slot!, now, TZ));

console.log("== closed-day honesty ==");
const satHint = parseDateTimeHint("next saturday at 12pm", now, TZ)!;
const satClosed = mf[getDayOfWeek(satHint.day, TZ)] === null;
check("Saturday closed under Mon-Fri", satClosed === true);
const nextOpen = findNextOpenDay(satHint.day, mf, TZ);
check("next open day after Sat == Monday", getDayOfWeek(nextOpen!, TZ) === 1, nextOpen?.toISOString());

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
