/**
 * Pure calendar-availability helpers for the AI phone receptionist.
 *
 * No DB access here — the caller (twilio-handler.ts) loads the busy set
 * and passes it in. Everything is best-effort parsing of natural language.
 *
 * TIMEZONE MODEL: all wall-clock math (day boundaries, day-of-week, hour of
 * day, date keys, slot generation, formatting) is timezone-aware. Helpers take
 * an optional IANA `timezone` (default "UTC") and compute wall-clock values in
 * that zone via Intl.DateTimeFormat. Date objects are ALWAYS absolute UTC
 * instants — a slot "12:00 PM in Phoenix" is stored as the correct UTC instant
 * (19:00Z), never as server-local time. This is what fixes bookings landing at
 * the wrong hour/day when the server runs in UTC but the business is in UTC−7.
 */

export interface DayHours {
  startHour: number; // inclusive, e.g. 9  (slot starts at 9:00)
  endHour: number;   // exclusive, e.g. 17 (last slot starts at 16:00)
}

// index 0 = Sunday ... 6 = Saturday; null = closed that day
export type WeeklyHours = (DayHours | null)[];

export const SLOT_MINUTES = 60;

export interface DateTimeHint {
  day: Date; // the preferred day (start of day, in workspace tz)
  window?: "morning" | "afternoon" | "evening" | "anytime";
  exactHour?: number; // 0-23 when an explicit clock time was given
  preferEarliest?: boolean; // ASAP → earliest possible slot
}

const WEEKDAY_FULL = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const WEEKDAY_ABBR = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

// ── Timezone helpers (Intl-based, no external deps) ─────────────────────────

interface WallClock {
  y: number; mo: number; d: number; h: number; mi: number; s: number;
}

/** Wall-clock parts of a UTC instant `d` as seen in `tz`. */
function wallClockParts(d: Date, tz: string): WallClock {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = dtf.formatToParts(d);
  const m: Record<string, number> = {};
  for (const p of parts) {
    if (p.type !== "literal") m[p.type] = parseInt(p.value, 10);
  }
  // Some engines render midnight as hour 24 with hour12:false — normalize.
  if (m.hour === 24) m.hour = 0;
  return { y: m.year, mo: m.month, d: m.day, h: m.hour, mi: m.minute, s: m.second };
}

/**
 * Build a UTC Date from wall-clock parts interpreted in `tz`. DST-safe: starts
 * from the wall-clock-as-UTC guess, then corrects by the tz's real UTC offset
 * at that instant (≤3 passes — offsets only shift by an hour at DST
 * boundaries, so the second pass is already exact).
 */
export function zonedTimeToUtc(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  tz: string,
): Date {
  const targetAsUtc = Date.UTC(y, mo - 1, d, h, mi);
  let guess = targetAsUtc;
  for (let i = 0; i < 3; i++) {
    const wp = wallClockParts(new Date(guess), tz);
    const asUtc = Date.UTC(wp.y, wp.mo - 1, wp.d, wp.h, wp.mi, wp.s);
    const offset = asUtc - guess; // tz's UTC offset at `guess` (negative west of UTC)
    const next = targetAsUtc - offset;
    if (next === guess) break;
    guess = next;
  }
  return new Date(guess);
}

/** True when `tz` is a valid IANA timezone identifier. */
export function isValidTimezone(tz: string): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Start of `d`'s day in `tz` (as a UTC instant). */
export function startOfDay(d: Date, tz = "UTC"): Date {
  const wp = wallClockParts(d, tz);
  return zonedTimeToUtc(wp.y, wp.mo, wp.d, 0, 0, tz);
}

/** Add `n` whole wall-clock days to `d` in `tz` (DST-safe). */
export function addDays(d: Date, n: number, tz = "UTC"): Date {
  const wp = wallClockParts(d, tz);
  return zonedTimeToUtc(wp.y, wp.mo, wp.d + n, 0, 0, tz);
}

/** `YYYY-MM-DD` key of `d` in `tz`. */
export function dateKey(d: Date, tz = "UTC"): string {
  const wp = wallClockParts(d, tz);
  return `${wp.y}-${String(wp.mo).padStart(2, "0")}-${String(wp.d).padStart(2, "0")}`;
}

/** Day-of-week of `d` in `tz` (0 = Sunday). Wall-clock based, DST-safe. */
export function getDayOfWeek(d: Date, tz = "UTC"): number {
  const wp = wallClockParts(d, tz);
  return new Date(Date.UTC(wp.y, wp.mo - 1, wp.d)).getUTCDay();
}

/** Hour (0-23) of `d` in `tz`. */
export function getHour(d: Date, tz = "UTC"): number {
  return wallClockParts(d, tz).h;
}

/** Minute (0-59) of `d` in `tz`. */
export function getMinute(d: Date, tz = "UTC"): number {
  return wallClockParts(d, tz).mi;
}

/** Localized day label in `tz`, e.g. "Saturday, August 15". */
export function formatDay(d: Date, tz = "UTC"): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(d);
}

/** "12:00 PM" style wall-clock time of `d` in `tz`. */
export function formatClockTime(d: Date, tz = "UTC"): string {
  const wp = wallClockParts(d, tz);
  const h12 = wp.h % 12 === 0 ? 12 : wp.h % 12;
  const mer = wp.h < 12 ? "AM" : "PM";
  return `${h12}:${String(wp.mi).padStart(2, "0")} ${mer}`;
}

// ── Date helpers (tz-aware) ─────────────────────────────────────────────────

function toHour24(h: number, m: number, meridian?: string): number {
  let hour = h;
  const merid = (meridian || "").toLowerCase();
  if (merid.includes("pm") && hour < 12) hour += 12;
  if (merid.includes("am") && hour === 12) hour = 0;
  return m > 0 ? hour : hour; // slot resolution is hourly; minutes ignored for matching
}

function normalizeDay(word: string): number {
  const w = word.toLowerCase();
  const full = WEEKDAY_FULL.indexOf(w);
  if (full !== -1) return full;
  const abbr = WEEKDAY_ABBR.indexOf(w);
  if (abbr !== -1) return abbr;
  return -1;
}

// ── Business hours parsing ─────────────────────────────────────────────────

export function defaultWeeklyHours(): WeeklyHours {
  const hours: WeeklyHours = Array(7).fill(null);
  for (let d = 1; d <= 5; d++) hours[d] = { startHour: 9, endHour: 17 };
  return hours;
}

/** Structured open-hours shape — 24h "HH:MM", e.g. { start: "10:00", end: "17:00" }. */
export interface StructuredOpenHours {
  start: string;
  end: string;
}

/**
 * "10:00" / "17:30" (24h "HH:MM") → hour number. Minutes are floored to the
 * hour (slot generation is hourly for v1). Null when malformed.
 */
function parseHHMM(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const mi = parseInt(m[2], 10);
  if (h < 0 || h > 24 || mi < 0 || mi > 59) return null;
  if (h === 24 && mi !== 0) return null; // 24:00 is allowed (close at midnight), 24:30 is not
  return h;
}

/**
 * Convert structured open days + hours into WeeklyHours. Returns null when the
 * structured fields are unusable (missing, empty, malformed day names, bad
 * "HH:MM", end <= start, or no valid days) — the caller then falls back to
 * free-text businessHours parsing. One time window applies to every open day
 * (v1). Day names are case-insensitive; full names and 3-letter abbreviations
 * both work, e.g. ["Tuesday","Wed","FRI"].
 */
export function structuredToWeeklyHours(
  openDays?: string[],
  openHours?: StructuredOpenHours | null,
): WeeklyHours | null {
  if (!Array.isArray(openDays) || openDays.length === 0) return null;
  if (!openHours || typeof openHours !== "object") return null;
  const startHour = parseHHMM(openHours.start);
  const endHour = parseHHMM(openHours.end);
  if (startHour === null || endHour === null) return null;
  if (endHour <= startHour || endHour > 24) return null;
  const hours: WeeklyHours = Array(7).fill(null);
  let any = false;
  for (const raw of openDays) {
    const idx = normalizeDay(String(raw ?? ""));
    if (idx !== -1) {
      hours[idx] = { startHour, endHour };
      any = true;
    }
  }
  return any ? hours : null;
}

/**
 * Human label for structured hours for the Nova system prompt, e.g.
 * "Tuesday, Wednesday, Thursday, Friday, 10:00 AM – 5:00 PM". Null when the
 * structured fields are unusable (caller falls back to the free-text string).
 */
export function formatStructuredHours(
  openDays?: string[],
  openHours?: StructuredOpenHours | null,
): string | null {
  const wh = structuredToWeeklyHours(openDays, openHours);
  if (!wh) return null;
  const open: number[] = [];
  for (let i = 0; i < 7; i++) if (wh[i]) open.push(i);
  if (open.length === 0) return null;
  const days = open
    .map((i) => WEEKDAY_FULL[i])
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(", ");
  const dh = wh[open[0]]!;
  const endLabel = dh.endHour === 24 ? "Midnight" : formatHour12(dh.endHour);
  return `${days}, ${formatHour12(dh.startHour)} – ${endLabel}`;
}

/**
 * Best-effort parse of free-text business hours, e.g.
 *   "Monday through Friday, 9am to 5pm"
 *   "Mon-Fri 8:30am-4pm"
 *   "24/7"
 *   "Saturday and Sunday 10am-2pm"
 * Falls back to Mon-Fri 9am-5pm.
 */
export function parseBusinessHours(text?: string): WeeklyHours {
  if (!text || !text.trim()) return defaultWeeklyHours();
  const lower = text.toLowerCase();

  if (/\b24\/7\b|24 hours|always open|open all day|every day/i.test(lower)) {
    return Array(7)
      .fill(null)
      .map(() => ({ startHour: 0, endHour: 24 }));
  }

  // Collect days from ranges AND individual mentions (union — a range like
  // "Monday through Friday" plus a trailing "Saturday" must not lose Saturday).
  const daySet = new Set<number>();

  // 1) explicit day ranges: "monday through friday", "mon-fri", "saturday and sunday"
  const dayRangeRe =
    /(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|wed|thu|fri|sat)\s*(?:through|thru|to|until|-|–|,|&|and)\s*(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|wed|thu|fri|sat)/i;
  const range = lower.match(dayRangeRe);
  if (range) {
    const start = normalizeDay(range[1]);
    const end = normalizeDay(range[2]);
    if (start !== -1 && end !== -1) {
      for (let d = start; ; d = (d + 1) % 7) {
        daySet.add(d);
        if (d === end) break;
      }
    }
  }

  // 2) individual days mentioned (always scanned, in case a standalone day
  //    appears alongside a range)
  WEEKDAY_FULL.forEach((name, idx) => {
    if (new RegExp(`\\b${name}\\b`).test(lower)) daySet.add(idx);
  });
  WEEKDAY_ABBR.forEach((abbr, idx) => {
    if (new RegExp(`\\b${abbr}\\b`).test(lower)) daySet.add(idx);
  });

  const days = [...daySet];

  // 3) time range: "9am to 5pm", "8:30am-4pm", "9-5"
  let startHour = 9;
  let endHour = 17;
  const timeRe =
    /(\d{1,2})(?::(\d{2}))?\s*(am|a\.m\.|pm|p\.m\.)?\s*(?:-|to|until|–)\s*(\d{1,2})(?::(\d{2}))?\s*(am|a\.m\.|pm|p\.m\.)?/i;
  const tm = lower.match(timeRe);
  if (tm) {
    startHour = toHour24(parseInt(tm[1], 10), parseInt(tm[2] || "0", 10), tm[3]);
    endHour = toHour24(parseInt(tm[4], 10), parseInt(tm[5] || "0", 10), tm[6]);
  } else {
    const simpleRe = /\b(\d{1,2})\s*(?:-|to)\s*(\d{1,2})\b/;
    const sm = lower.match(simpleRe);
    if (sm) {
      startHour = parseInt(sm[1], 10);
      endHour = parseInt(sm[2], 10);
    }
  }

  if (isNaN(startHour) || startHour < 0 || startHour > 23) startHour = 9;
  if (isNaN(endHour) || endHour <= startHour || endHour > 24) {
    endHour = Math.min(24, startHour + 8);
  }

  if (days.length === 0) days.push(1, 2, 3, 4, 5); // default weekdays
  const hours: WeeklyHours = Array(7).fill(null);
  for (const d of days) {
    if (d >= 0 && d <= 6) hours[d] = { startHour, endHour };
  }
  return hours;
}

// ── Date/time hint parsing ─────────────────────────────────────────────────

/**
 * Parse a caller's day/time preference into a DateTimeHint.
 * Returns null when nothing usable is found.
 *
 * Explicit preferences always beat "as soon as possible": an ASAP phrase only
 * sets preferEarliest when the utterance contains NO explicit day/time (clock
 * time, named day, tomorrow/today, or a morning/afternoon/evening window).
 */
export function parseDateTimeHint(raw: string, now: Date, tz = "UTC"): DateTimeHint | null {
  if (!raw || !raw.trim()) return null;
  const lower = raw
    .toLowerCase()
    .replace(/[.,!?;]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!lower) return null;

  const hint: DateTimeHint = { day: startOfDay(now, tz) };

  const hasAsap = /\basap\b|as soon as possible|soonest|earliest|right away|right now|immediately/.test(
    lower,
  );

  // explicit clock time, e.g. "2pm", "3:30pm", "2:00 PM", "noon", "midnight"
  if (/\bnoon\b/.test(lower)) {
    hint.exactHour = 12;
  } else if (/\bmidnight\b/.test(lower)) {
    hint.exactHour = 0;
  } else {
    const clockRe = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)\b/;
    const cm = lower.match(clockRe);
    if (cm) {
      hint.exactHour = toHour24(parseInt(cm[1], 10), parseInt(cm[2] || "0", 10), cm[3]);
    } else {
      // bare clock time without meridiem, e.g. "3:30" — assume PM for business hours
      const bareRe = /\b(\d{1,2}):(\d{2})\b/;
      const bm = lower.match(bareRe);
      if (bm) {
        let h = parseInt(bm[1], 10);
        if (h < 8) h += 12; // "3:30" → 3:30 PM
        hint.exactHour = h;
      }
    }
  }

  // day words — full names first, then abbreviations
  let namedDay: number | null = null;
  for (const w of WEEKDAY_FULL) {
    if (new RegExp(`\\b${w}\\b`).test(lower)) {
      namedDay = normalizeDay(w);
      break;
    }
  }
  if (namedDay === null) {
    for (const w of WEEKDAY_ABBR) {
      if (new RegExp(`\\b${w}\\b`).test(lower)) {
        namedDay = normalizeDay(w);
        break;
      }
    }
  }

  if (/\btomorrow\b/.test(lower)) {
    hint.day = addDays(startOfDay(now, tz), 1, tz);
  } else if (/\bnext week\b/.test(lower)) {
    hint.day = addDays(startOfDay(now, tz), 7, tz);
  } else if (/\btoday\b|this afternoon|this evening|tonight/.test(lower)) {
    hint.day = startOfDay(now, tz);
  } else if (/\bthis week\b/.test(lower)) {
    hint.day = startOfDay(now, tz);
  } else if (namedDay !== null) {
    let day = startOfDay(now, tz);
    const diff = (namedDay - getDayOfWeek(now, tz) + 7) % 7;
    day = addDays(day, diff === 0 ? 7 : diff, tz); // next occurrence; if today, next week
    hint.day = day;
  }

  // window words
  if (/\bmorning\b/.test(lower)) {
    hint.window = "morning";
  } else if (/\bafternoon\b/.test(lower)) {
    hint.window = "afternoon";
  } else if (/\bevening\b/.test(lower)) {
    hint.window = "evening";
  } else if (/\banytime\b|any time|whenever/.test(lower)) {
    hint.window = "anytime";
  }

  // ASAP only wins when there is NO explicit day/time preference anywhere.
  const hasExplicitTime =
    hint.exactHour !== undefined ||
    namedDay !== null ||
    (hint.window !== undefined && hint.window !== "anytime") ||
    /\btomorrow\b|\btoday\b|this afternoon|this evening|tonight|this week|next week/.test(lower);
  if (hasAsap && !hasExplicitTime) hint.preferEarliest = true;

  return hint;
}

// ── Slot generation & selection ────────────────────────────────────────────

/** All 60-minute slots for a given day within business hours (future-only). */
export function generateSlotsForDay(day: Date, dh: DayHours, now: Date, tz = "UTC"): Date[] {
  const wp = wallClockParts(day, tz);
  const slots: Date[] = [];
  for (let h = dh.startHour; h < dh.endHour; h++) {
    const s = zonedTimeToUtc(wp.y, wp.mo, wp.d, h, 0, tz);
    if (s.getTime() > now.getTime()) slots.push(s);
  }
  return slots;
}

/** First open day strictly after `day` in `tz` (within maxLookaheadDays). */
export function findNextOpenDay(
  day: Date,
  hours: WeeklyHours,
  tz = "UTC",
  maxLookaheadDays = 14,
): Date | null {
  for (let i = 1; i <= maxLookaheadDays; i++) {
    const d = addDays(day, i, tz);
    if (hours[getDayOfWeek(d, tz)]) return d;
  }
  return null;
}
// ── Appointment spacer ─────────────────────────────────────────────────────
/**
 * Busy-slot keys an appointment occupies, including the appointment spacer
 * (minimum gap Nova must leave between consecutive appointments). An
 * appointment at hour H blocks H..H+ceil(spacer/60) (bounded by end of day,
 * hour 23):
 *   spacer 0     → legacy behavior: block H, plus H+1 ONLY when the
 *                  appointment starts mid-hour (minute > 0)
 *   spacer 1..60 → block H and H+1 (hourly-slot granularity — a 10:00
 *                  appointment + 30min spacer means the next bookable hour
 *                  is 12:00)
 *   spacer 61+   → block H..H+ceil(spacer/60)
 * Returns `${day}@${hour}` keys matching the keys pickBestSlot generates.
 */
export function appointmentBusyKeys(
  day: string,
  hour: number,
  minute: number,
  spacerMinutes: number | null | undefined = 0,
): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  const push = (h: number) => {
    const k = `${day}@${h}`;
    if (!seen.has(k)) {
      seen.add(k);
      keys.push(k);
    }
  };
  const spacer = Number.isFinite(spacerMinutes ?? 0)
    ? Math.max(0, Math.floor(spacerMinutes ?? 0))
    : 0;
  const trailing = Math.ceil(spacer / 60);
  const maxH = Math.min(hour + trailing, 23);
  for (let h = hour; h <= maxH; h++) push(h);
  // Legacy: an appointment starting mid-hour also blocks the following slot
  // (kept for spacer 0; a superset for spacer > 0).
  if (minute > 0 && hour + 1 < 24) push(hour + 1);
  return keys;
}

// ── Closed-day offer follow-up ─────────────────────────────────────────────

const DAY_MENTION_RE = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today)\b/i;
const OFFER_AGREEMENT_RE = /\b(yes|yep|yeah|yup|that works|works|fine|okay|ok|sure|good|perfect|instead|sounds good|please)\b/i;

/** First named day in free text ("monday", "tomorrow", …) or null. */
export function extractDayMention(text: string): string | null {
  const m = DAY_MENTION_RE.exec(text);
  return m ? m[1].toLowerCase() : null;
}

/** Resolve a day mention to its next-occurrence start-of-day in `tz`. */
export function dayMentionToDate(mention: string, now: Date, tz = "UTC"): Date {
  const lower = mention.toLowerCase();
  const today = startOfDay(now, tz);
  if (lower === "tomorrow") return addDays(today, 1, tz);
  if (lower === "today") return today;
  const idx = WEEKDAY_FULL.indexOf(lower);
  if (idx !== -1) {
    const diff = (idx - getDayOfWeek(now, tz) + 7) % 7;
    return addDays(today, diff === 0 ? 7 : diff, tz);
  }
  return today;
}

export type OfferReplyDecision = "accept" | "different-day" | "no-offer";

/**
 * Decide how to interpret a caller's reply after Nova offered the next open
 * day (convo.offeredDay). A reply naming the SAME day as the offer, or pure
 * agreement ("yes", "that works", "Monday instead") accepts the offer. A reply
 * naming a DIFFERENT day overrides it. Returns "no-offer" when there is no
 * pending offer or the reply is ambiguous.
 */
export function decideOfferReply(
  speech: string,
  offeredDay: Date | undefined,
  now: Date,
  tz = "UTC",
): OfferReplyDecision {
  if (!offeredDay) return "no-offer";
  const mention = extractDayMention(speech);
  if (mention !== null) {
    const mentionedDow = getDayOfWeek(dayMentionToDate(mention, now, tz), tz);
    if (mentionedDow === getDayOfWeek(offeredDay, tz)) return "accept";
    return "different-day";
  }
  return OFFER_AGREEMENT_RE.test(speech) ? "accept" : "no-offer";
}

// ── Time-unavailable offer (requested time outside business hours / busy) ──

/** "9" → "9:00 AM", "14" → "2:00 PM" (slot granularity is hourly). */
export function formatHour12(hour: number): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const mer = hour < 12 ? "AM" : "PM";
  return `${h12}:00 ${mer}`;
}

/**
 * Deterministic "we can't do that exact time" message for the case where the
 * caller explicitly named a time/window that isn't available (before opening,
 * after close, fully booked, or no window availability). The slot is the
 * closest free slot Nova wants to offer instead.
 */
export function timeUnavailableMessage(
  hint: DateTimeHint,
  slot: Date,
  hours: WeeklyHours,
  now: Date,
  tz = "UTC",
): string {
  const slotLabel = formatSlot(slot, now, tz);
  const dayHours = hours[getDayOfWeek(slot, tz)];
  if (hint.exactHour !== undefined) {
    const req = formatHour12(hint.exactHour);
    if (dayHours && hint.exactHour < dayHours.startHour) {
      return `I'm sorry, we're not open at ${req}. Would ${slotLabel} work for you instead?`;
    }
    if (dayHours && hint.exactHour >= dayHours.endHour) {
      return `I'm sorry, we're not open at ${req} — the business closes before then. The closest available time is ${slotLabel}. Would that work for you?`;
    }
    return `I'm sorry, ${req} on that day is already fully booked. The closest available time is ${slotLabel}. Would that work for you?`;
  }
  if (hint.window && hint.window !== "anytime") {
    return `I'm sorry, we don't have availability in the ${hint.window} on that day. The closest available time is ${slotLabel}. Would that work for you?`;
  }
  return `The closest available time is ${slotLabel}. Would that work for you?`;
}

/** First explicit clock time in free text ("9am", "noon", "3:30pm") → 24h hour, or null. */
export function extractClockHour(text: string): number | null {
  const lower = text.toLowerCase();
  if (/\bnoon\b/.test(lower)) return 12;
  if (/\bmidnight\b/.test(lower)) return 0;
  const m = lower.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  if (m) {
    let h = parseInt(m[1], 10) % 12;
    if (m[3][0] === "p") h += 12;
    return h;
  }
  return null;
}

export type OfferedReply =
  | { kind: "accept-offered-slot"; slot: Date }
  | { kind: "accept-offered-day"; day: Date }
  | { kind: "override" } // caller named a different day/time → re-run the normal flow
  | { kind: "no-offer" }; // nothing pending or ambiguous → re-run the normal flow

/**
 * Decide how to interpret a reply while either a closed-DAY offer
 * (convo.offeredDay) or a time-unavailable SLOT offer (convo.offeredSlot) is
 * pending. Naming the SAME day/time or agreeing accepts the offer; naming a
 * genuinely different day/time overrides it (the normal flow re-runs).
 */
export function decideOfferedReply(
  speech: string,
  offeredDay: Date | undefined,
  offeredSlot: Date | undefined,
  now: Date,
  tz = "UTC",
): OfferedReply {
  if (offeredSlot) {
    const slotDow = getDayOfWeek(offeredSlot, tz);
    const mention = extractDayMention(speech);
    const clock = extractClockHour(speech);
    if (mention !== null && getDayOfWeek(dayMentionToDate(mention, now, tz), tz) !== slotDow) {
      return { kind: "override" }; // different named day
    }
    if (clock !== null && clock !== getHour(offeredSlot, tz)) {
      return { kind: "override" }; // different named time
    }
    if (mention !== null || clock !== null || OFFER_AGREEMENT_RE.test(speech)) {
      return { kind: "accept-offered-slot", slot: offeredSlot };
    }
    return { kind: "no-offer" };
  }
  if (offeredDay) {
    const d = decideOfferReply(speech, offeredDay, now, tz);
    if (d === "accept") return { kind: "accept-offered-day", day: offeredDay };
    if (d === "different-day") return { kind: "override" };
    return { kind: "no-offer" };
  }
  return { kind: "no-offer" };
}

/**
 * Pick the most convenient free slot for the hint.
 *
 * @param busy Set of `${dateKey}@${hour}` keys (in workspace tz) already taken.
 */
export interface SlotPick {
  slot: Date;
  /**
   * True when the chosen slot satisfies the caller's EXPLICIT request (exact
   * hour or window on the requested day). False when pickBestSlot had to SNAP
   * to a different time — requested hour/window outside business hours, fully
   * booked, or the day itself rolled forward. ASAP/anytime/no-preference
   * requests always return matched=true (nothing to honor).
   */
  matched: boolean;
}

export function pickBestSlotChecked(
  hint: DateTimeHint,
  hours: WeeklyHours,
  busy: Set<string>,
  now: Date,
  tz = "UTC",
  maxLookaheadDays = 14,
): SlotPick | null {
  const start = hint.preferEarliest ? startOfDay(now, tz) : startOfDay(hint.day, tz);
  const seen = new Set<string>();
  const days: Date[] = [];
  for (let i = 0; i < maxLookaheadDays && days.length < 7; i++) {
    const day = addDays(start, i, tz);
    const key = dateKey(day, tz);
    if (!seen.has(key)) {
      seen.add(key);
      days.push(day);
    }
  }
  for (const day of days) {
    const dh = hours[getDayOfWeek(day, tz)];
    if (!dh) continue; // closed
    const free = generateSlotsForDay(day, dh, now, tz).filter(
      (s) => !busy.has(`${dateKey(day, tz)}@${getHour(s, tz)}`),
    );
    if (free.length === 0) continue;
    const sameDay = hint.preferEarliest || startOfDay(day, tz).getTime() === startOfDay(hint.day, tz).getTime();
    // exact requested time → prefer it, else closest free slot that day
    if (hint.exactHour !== undefined) {
      const exact = free.find((s) => getHour(s, tz) === hint.exactHour);
      if (exact) return { slot: exact, matched: sameDay };
      let best: Date | null = null;
      let bestDist = Infinity;
      for (const s of free) {
        const dist = Math.abs(getHour(s, tz) - hint.exactHour);
        if (dist < bestDist) {
          bestDist = dist;
          best = s;
        }
      }
      if (best) return { slot: best, matched: false };
      continue; // day fully booked → next day
    }
    // window → first slot within the window; fall back to first slot of day
    if (hint.window && hint.window !== "anytime") {
      const [winStart, winEnd] = windowHours(hint.window, dh);
      const inWindow = free.filter((s) => getHour(s, tz) >= winStart && getHour(s, tz) < winEnd);
      if (inWindow.length > 0) return { slot: inWindow[0], matched: sameDay };
      return { slot: free[0], matched: false }; // window has no open slot (e.g. evening when closing at 5) → first slot
    }
    // anytime / no preference → first slot
    return { slot: free[0], matched: true };
  }
  return null;
}

export function pickBestSlot(
  hint: DateTimeHint,
  hours: WeeklyHours,
  busy: Set<string>,
  now: Date,
  tz = "UTC",
  maxLookaheadDays = 14,
): Date | null {
  return pickBestSlotChecked(hint, hours, busy, now, tz, maxLookaheadDays)?.slot ?? null;
}

function windowHours(
  window: "morning" | "afternoon" | "evening",
  dh: DayHours,
): [number, number] {
  switch (window) {
    case "morning":
      return [Math.max(dh.startHour, 9), Math.min(dh.endHour, 12)];
    case "afternoon":
      return [Math.max(dh.startHour, 13), Math.min(dh.endHour, 17)];
    case "evening":
      return [Math.max(dh.startHour, 17), dh.endHour];
  }
}

// ── Formatting ─────────────────────────────────────────────────────────────

/** "today at 2:00 PM" / "tomorrow at 9:00 AM" / "Saturday at 12:00 PM" (in tz). */
export function formatSlot(date: Date, now: Date, tz = "UTC"): string {
  const time = formatClockTime(date, tz);
  const today = startOfDay(now, tz);
  const tomorrow = addDays(now, 1, tz);
  const day = startOfDay(date, tz);
  const dayLabel =
    day.getTime() === today.getTime()
      ? "today"
      : day.getTime() === tomorrow.getTime()
        ? "tomorrow"
        : new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long" }).format(date);
  return `${dayLabel} at ${time}`;
}
