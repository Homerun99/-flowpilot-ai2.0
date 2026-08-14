// Twilio Voice Webhook Handler — called by /api/webhooks/twilio/voice
// Uses OpenAI for TTS and GPT responses, with KB grounding, lead capture,
// and in-call appointment booking against the workspace calendar.

export const conversations = new Map<string, ConversationState>();
const ttsCache = new Map<string, { buffer: Buffer; expires: number }>();

// Per-workspace "has documents" cache — lets searchKB return instantly when a
// workspace has no knowledge base docs (no DB query, no embedding call, no
// activity log). TTL expires so freshly uploaded docs are picked up.
const kbDocCache = new Map<string, { hasDocs: boolean; expires: number }>();
const KB_DOC_CACHE_TTL = 5 * 60 * 1000;

// Cheap regex gate for booking-intent detection: only call the intent LLM
// when the caller's literal message plausibly relates to booking/name/time,
// or the call is mid-booking (awaitingName/pendingTimeHint set). Everything
// else skips the ~1.5s intent call entirely.
const BOOKING_GATE_RE =
  /\b(book|booking|schedule|scheduled|scheduling|appointment|come (out|in|by)|take a look|look(ing)? at|fix(ed|ing)?|repair(ed|ing)?|see (a |the |someone|you|us )|visit(ing|ed)?|when|today|tonight|tomorrow|this week|next week|weekend|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun|morning|afternoon|evening|day|time|asap|as soon as|soon|right away|anytime|available|free|open(ing)?|my name|i'?m (called|named)|call me|name'?s|name is|\d{1,2}\s*:\s*\d{2}\s*(am|pm)?|\d{1,2}\s*(am|pm))\b/i;

const OPENAI_KEY = process.env.OPENAI_API_KEY || "";

// ── Types ──────────────────────────────────────────────────────────────────

export interface ReceptionistConfig {
  businessName?: string;
  businessType?: string;
  businessHours?: string;
  description?: string;
  customInstructions?: string;
  transferNumber?: string;
  /** When true, Nova must capture the caller's service address before booking. */
  requireAddress?: boolean;
  /** Structured open days (full day names) — preferred over businessHours free text when set with openHours. */
  openDays?: string[];
  /** Structured open hours (24h "HH:MM", one window for every open day, v1). */
  openHours?: { start: string; end: string } | null;
  /** Minimum gap (minutes) between consecutive appointments. null/absent = disabled. */
  appointmentSpacer?: number | null;
  /** Conditional qualification rules — IF the caller's situation matches a condition, Nova asks that block's Then-ask questions one at a time. null/absent = disabled. */
  keyQuestions?: { if: string; thenAsk: string[] }[] | null;
  /** ISO timestamp when the workspace owner accepted the Terms of Service. null/absent = not yet accepted. */
  termsAcceptedAt?: string | null;
}

interface ConversationState {
  history: string[];            // "Caller: ..." | "AI: ..."
  callerName?: string;
  callerPhone?: string;
  serviceNeed?: string;
  leadCreated: boolean;
  bookingDone: boolean;         // per-call guard against double-booking
  hasGreeted?: boolean;         // full greeting already played for this call
  silentStreak?: number;        // consecutive no-speech <Gather> timeouts
  pendingTimeHint?: string;     // time preference stated earlier in the call
  awaitingName?: boolean;       // Nova asked for the name; book on next turn
  awaitingAddress?: boolean;    // Nova asked for the service address; book after it's given
  address?: string;             // captured service address (verbatim from caller)
  offeredDay?: Date;            // next open day offered after a closed-day request
  offeredSlot?: Date;           // closest slot offered when the requested time isn't available
}

interface BookingIntent {
  wantsBooking: boolean;        // caller wants an appointment / to be seen
  callerName: string | null;
  serviceNeed: string | null;
  timeHint: string | null;      // e.g. "tomorrow afternoon", "friday morning", "2pm"
  hasTime: boolean;             // timeHint is non-null
}

// ── System Prompt Builder ──────────────────────────────────────────────────

// Key-questions caps — keep in sync with MAX_KEY_QUESTION_BLOCKS /
// MAX_KEY_QUESTIONS_PER_BLOCK / KEY_QUESTION_PROMPT_CHAR_LIMIT in
// src/db/schema.ts (api-handler enforces the same caps at persistence time).
const MAX_KEY_QUESTION_BLOCKS = 20;
const MAX_KEY_QUESTIONS_PER_BLOCK = 20;
const KEY_QUESTION_PROMPT_CHAR_LIMIT = 1500;
/**
 * Build the conditional key-questions block for Nova's system prompt from the
 * workspace's keyQuestions config. Returns "" when the config is null/absent/
 * empty. Shape-safe: entries with a blank `if` or no usable Then-ask questions
 * are skipped; caps of 20 IF blocks and 20 questions per block are enforced,
 * and the whole injected block is truncated to ~1500 chars. The block frames
 * the questions as ONE-AT-A-TIME qualifying questions so they slot into the
 * existing one-question-at-a-time flow (never a list dump).
 */
export function buildKeyQuestionsPrompt(
  keyQuestions?: { if: string; thenAsk: string[] }[] | null,
): string {
  if (!Array.isArray(keyQuestions) || keyQuestions.length === 0) return "";
  const lines: string[] = [];
  for (const block of keyQuestions.slice(0, MAX_KEY_QUESTION_BLOCKS)) {
    if (typeof block !== "object" || block === null) continue;
    const cond = typeof block.if === "string" ? block.if.trim() : "";
    const qs = (Array.isArray(block.thenAsk) ? block.thenAsk : [])
      .map((q) => (typeof q === "string" ? q.trim() : ""))
      .filter((q) => q.length > 0)
      .slice(0, MAX_KEY_QUESTIONS_PER_BLOCK);
    if (!cond || qs.length === 0) continue;
    lines.push(`IF '${cond}' THEN ASK '${qs.join("', '")}'`);
  }
  if (lines.length === 0) return "";
  const text =
    "KEY QUALIFYING QUESTIONS — USE WHEN A CONDITION MATCHES:\n" +
    "When the customer's situation matches one of these conditions, ask the matching questions one at a time (never rattle off the whole list):\n" +
    lines.map((l) => `- ${l}`).join("\n");
  return text.slice(0, KEY_QUESTION_PROMPT_CHAR_LIMIT);
}
export async function buildSystemPrompt(
  config?: ReceptionistConfig,
  kbContext?: string,
  bookingContext?: string,
): Promise<string> {
  const name = config?.businessName?.trim() || "our office";
  const type = config?.businessType?.trim() || "professional services";
  // Prefer the structured openDays/openHours when usable, then the free-text
  // businessHours string, then the generic default.
  const { formatStructuredHours } = await import("./src/lib/booking");
  const hours =
    formatStructuredHours(config?.openDays, config?.openHours) ??
    (config?.businessHours?.trim() || "Monday through Friday, 9am to 5pm");
  const desc = config?.description?.trim() || "";
  const custom = config?.customInstructions?.trim() || "";

  // Build a natural first sentence
  const hasDesc = desc.length > 3;
  const businessIntro = desc
    ? `${name} is a ${type} business. ${desc}`
    : `${name} provides ${type} services.`;

  const base = [
    `You are Nova, the receptionist for ${name}.`,
    businessIntro,
    `Business hours: ${hours}.`,
  ];

  if (custom) base.push(custom);

  // Core receptionist behavioral instructions
  const instructions = [
    "",
    "YOUR ROLE:",
    `- You answer the phone for ${name}. You are professional, warm, and efficient — like a great human receptionist.`,
    "- At the very START of the call only, greet the caller by identifying the business and your name (Nova), then ask how you can help.",
    "- In every reply AFTER the initial greeting, do NOT re-introduce yourself, do NOT repeat the business name, and do NOT say \"you've reached...\" again — just continue the conversation naturally, as if you already greeted them.",
    "",
    "CONVERSATION STYLE:",
    "- Keep every response short and spoken-natural: 1–3 sentences max. This is a voice call.",
    "- Ask ONE question at a time. Do not rattle off a list.",
    "- When a caller describes a problem (leak, damage, issue, need), acknowledge with empathy first, then ask up to 2–3 short qualifying questions — ONE at a time — about the situation (e.g. \"Is water coming in?\" then \"How long has this been going on?\" then \"Is this at your home?\").",
    "  • Only ask questions that genuinely help qualify the job — never interrogate. Stop as soon as you have a clear picture (2–3 max; fewer is fine).",
    "- While asking, also OFFER to schedule — e.g. \"I'm sorry to hear that — is water getting in? And when would you like someone to come out?\" The caller can answer your question and give a time in the same breath.",
    "- Confirm important details before moving on: \"So that's a leak in the master bathroom, correct?\"",
    "- Never say you are \"just an AI\" or \"artificial intelligence.\" If asked, say \"I'm Nova, the virtual receptionist for ${name}.\"",
    "- Do not make up pricing, timelines, or guarantees. If the caller asks something you genuinely don't know, say \"I'd want to make sure I get that right — let me have someone follow up with you about that.\"",
    "",
    "APPOINTMENTS AND SERVICE CALLS:",
    "- When a caller describes a real problem they need help with, acknowledge with empathy, ask a couple of short qualifying questions (2–3 max, one at a time), then OFFER to schedule right away: \"We can get someone out to you — when would you like to be seen?\"",
    "- YOU book the appointment yourself during the call using the business's availability. Do NOT say \"someone will call you back to schedule\" or \"we'll reach out to confirm\" — you schedule it right there.",
    "- To book you need three things: (1) what they need, (2) their name, and (3) a day or time preference. Ask for the missing pieces one at a time.",
    ...(config?.requireAddress
      ? [
          `- This business REQUIRES the caller's SERVICE ADDRESS (where the work will be done) before an appointment can be booked. Ask for it one at a time when the other details are gathered, e.g. "And what's the address for the service?" — never invent, guess, or assume an address; only the caller can give it.`,
        ]
      : []),
    "- When a booking has been made (you will be told the exact day and time in BOOKING STATUS), confirm it warmly WITH the specific time, e.g. \"Great — you're all set for tomorrow at 1:00 PM, Sarah. Anything else I can help with?\"",
    "",
    "SCHEDULING HONESTY — CRITICAL, OVERRIDES EVERYTHING ABOVE:",
    "- You NEVER propose, offer, or confirm a specific day or time yourself. The system (BOOKING STATUS) handles ALL availability checks and bookings. Your only scheduling job is to ASK for what's still missing: when they'd like to come in (\"When would you like to come out?\" / \"Do you have a day or time in mind?\") or their name.",
    "- NEVER say \"how does [day/time] sound\", \"I'll check availability\", \"let me look at the calendar\", \"I can get/fit you in at [time]\", \"you're all set\", \"booked\", \"confirmed\", \"scheduled for\", \"see you then/soon\", or \"I'll see you\" UNLESS BOOKING STATUS for this turn says BOOKED. If BOOKING STATUS says ASK_WHEN / ASK_NAME / ASK_ADDRESS / DAY_CLOSED / TIME_UNAVAILABLE / NO_SLOT, follow it exactly — never invent a time to fill the gap.",
    "- NEVER invent, guess, or repeat an address the caller didn't give. If BOOKING STATUS says ASK_ADDRESS, ask for the service address and wait for the caller to say it — do not book or confirm anything yet.",
    "- If a caller says \"as soon as possible\", \"asap\", \"right away\", \"anytime\", or \"soon\" when asked when they'd like to be seen, just acknowledge briefly and let the system pick the earliest available time — do not propose one yourself.",
    "",
    "TRANSFERS AND MESSAGES:",
    "- If the caller asks to speak to a person, representative, agent, or manager, offer to transfer them.",
    "- If transfer isn't available, offer to take a message: \"I can have someone call you right back. What's the best number?\"",
    "- End calls warmly: \"Thanks for calling ${name}. Have a great day!\"",
    "",
    "KNOWLEDGE BASE:",
    "- If the caller asks about services, pricing, process, warranties, or policies, answer using what you know about ${name} from the context provided below.",
    "- If no context is provided, stick to general helpful answers and offer to have someone follow up with specifics.",
  ];

  let prompt = base.join("\n") + "\n" + instructions.join("\n");

  // Conditional key questions (owner-written IF/Then-ask qualification rules).
  // Only injected when the workspace configured a non-empty array; the rules
  // slot into the one-question-at-a-time qualifying flow above.
  const keyQuestionsBlock = buildKeyQuestionsPrompt(config?.keyQuestions);
  if (keyQuestionsBlock) {
    prompt += `\n\n${keyQuestionsBlock}`;
  }
  // Inject knowledge base context if available
  if (kbContext && kbContext.trim()) {
    prompt += `\n\nRELEVANT BUSINESS INFORMATION (use this to answer factual questions):\n${kbContext}`;
  }

  // Inject booking state context (highest priority instruction for this turn)
  if (bookingContext && bookingContext.trim()) {
    prompt += `\n\nBOOKING STATUS — THIS TURN:\n${bookingContext}\nThis booking status takes priority over the general instructions above for THIS reply.`;
  }

  prompt += `\n\nCurrent date: ${new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}.`;

  return prompt;
}

// ── TTS ────────────────────────────────────────────────────────────────────

export type TtsRaceResult = { kind: "audio"; buffer: Buffer } | { kind: "say" };

/**
 * Race a TTS generation against a short timer. If TTS stalls, resolve with
 * "say" so the caller gets the plain-text <Say> instead — the webhook must
 * never wait on TTS (Twilio's voice webhook times out at ~15s; we aim <8s).
 * A slow TTS that later completes still caches, so the cache stays warm.
 */
export async function raceTts(p: Promise<Buffer | null>, ms: number): Promise<TtsRaceResult> {
  let t: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<TtsRaceResult>((resolve) => {
    t = setTimeout(() => resolve({ kind: "say" }), ms);
  });
  try {
    return await Promise.race([
      p.then((buffer): TtsRaceResult => (buffer ? { kind: "audio", buffer } : { kind: "say" })),
      timeout,
    ]);
  } finally {
    if (t) clearTimeout(t);
  }
}

/** Bound any promise: resolve with `fallback` after `ms` instead of hanging. */
async function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    t = setTimeout(() => resolve(fallback), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (t) clearTimeout(t);
  }
}

/** First literal day word in a caller's message, or null. */
const LITERAL_DAY_RE = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today)\b/i;
function extractLiteralDay(text: string): string | null {
  const m = LITERAL_DAY_RE.exec(text);
  return m ? m[1].toLowerCase() : null;
}

async function generateTTS(text: string, key: string): Promise<Buffer | null> {
  if (!OPENAI_KEY) return null;
  const cached = ttsCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.buffer;

  try {
    const resp = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_KEY}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(5000),
      body: JSON.stringify({
        model: "tts-1",
        voice: "nova",
        input: text,
        response_format: "mp3",
      }),
    });

    if (!resp.ok) {
      console.warn(`[twilio-handler] generateTTS failed (non-fatal): status=${resp.status} for key=${key}`);
      return null;
    }
    const buffer = Buffer.from(await resp.arrayBuffer());
    ttsCache.set(key, { buffer, expires: Date.now() + 10 * 60 * 1000 });
    return buffer;
  } catch (err) {
    console.warn(`[twilio-handler] generateTTS error (non-fatal):`, err);
    return null;
  }
}

// ── KB Search (dynamic import to avoid build coupling) ─────────────────────

/** Cheap deterministic check: does the workspace have any KB documents? */
async function workspaceHasDocuments(workspaceId: string): Promise<boolean> {
  try {
    const { db } = await import("./src/db/index");
    const { documents } = await import("./src/db/schema");
    const { count, eq } = await import("drizzle-orm");
    const [row] = await db
      .select({ c: count() })
      .from(documents)
      .where(eq(documents.workspaceId, workspaceId));
    return (row?.c ?? 0) > 0;
  } catch (err) {
    // On error assume docs exist so we never break KB grounding silently.
    console.warn("[twilio-handler] hasDocuments check failed (assuming true):", err);
    return true;
  }
}

async function searchKB(
  query: string,
  workspaceId: string,
): Promise<string | null> {
  if (!OPENAI_KEY || !workspaceId || workspaceId.length < 5) return null;

  // Per-workspace hasDocuments cache: return instantly when we know the
  // workspace has no docs. TTL expires so uploads get picked up within ~5 min.
  const cached = kbDocCache.get(workspaceId);
  if (cached && cached.expires > Date.now() && !cached.hasDocs) return null;
  if (!cached || cached.expires <= Date.now()) {
    const hasDocs = await workspaceHasDocuments(workspaceId);
    kbDocCache.set(workspaceId, { hasDocs, expires: Date.now() + KB_DOC_CACHE_TTL });
    if (!hasDocs) return null;
  }

  try {
    const { searchKnowledgeBase } = await import("./src/lib/ai-employees");
    // Bound KB search: a slow RAG chain must never stall the voice path.
    const results = await withTimeout(searchKnowledgeBase(query, workspaceId), 3000, null);
    if (!results || results.length === 0) return null;
    return results
      .map((r) => `[${r.filename}] ${r.snippet}`)
      .join("\n---\n");
  } catch (err) {
    console.warn("[twilio-handler] KB search failed (non-fatal):", err);
    return null;
  }
}

// ── AI Response Generation ─────────────────────────────────────────────────

async function generateAIResponse(
  callerMessage: string,
  history: string[],
  config?: ReceptionistConfig,
  kbContext?: string,
  bookingContext?: string,
): Promise<string> {
  if (!OPENAI_KEY) {
    console.warn("[twilio-handler] generateAIResponse: no OPENAI_KEY — returning generic fallback");
    return "I'm here to help! What can I assist you with today?";
  }

  const systemPrompt = await buildSystemPrompt(config, kbContext, bookingContext);

  try {
    const messages = [
      { role: "system" as const, content: systemPrompt },
      // Last ~8 turns (excluding the just-pushed caller message, appended
      // below) — enough context for a phone call, less prompt = faster.
      ...history.slice(-8, -1).map((h) => ({
        role: h.startsWith("Caller:") ? ("user" as const) : ("assistant" as const),
        content: h.replace(/^(Caller|AI): /, ""),
      })),
      { role: "user" as const, content: callerMessage },
    ];

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_KEY}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(6000),
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages,
        max_tokens: 250,
        temperature: 0.5,
      }),
    });

    const data = (await resp.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) {
      console.warn("[twilio-handler] generateAIResponse: empty LLM content — returning repeat fallback");
      return "I'm sorry, could you repeat that?";
    }
    return content;
  } catch (err) {
    console.warn("[twilio-handler] generateAIResponse failed (non-fatal):", err);
    return "I'm here to help! Could you tell me more about what you need?";
  }
}

// ── Booking Intent Detection ───────────────────────────────────────────────

async function detectBookingIntent(
  callerMessage: string,
  history: string[],
  callerPhone: string,
  config?: ReceptionistConfig,
): Promise<BookingIntent> {
  if (!OPENAI_KEY) {
    console.warn("[twilio-handler] detectBookingIntent: no OPENAI_KEY — skipping intent detection");
    return { wantsBooking: false, callerName: null, serviceNeed: null, timeHint: null, hasTime: false };
  }

  try {
    const messages = [
      {
        role: "system" as const,
        content: `You analyze phone conversations for the receptionist of a business. Given the conversation so far, extract a JSON object with:

- wantsBooking: true if the caller wants to schedule/book an appointment, have someone come out, visit, or be seen; OR if the caller answered the receptionist's scheduling question with a day/time (e.g. "tomorrow afternoon", "friday", "2pm", "anytime", "as soon as possible"). A caller describing a problem alone is NOT enough — wantsBooking is false unless they ask to schedule or answer a "when" question.
- IMPORTANT: answering a scheduling ("when...?") question with ANY day/time expression — including "as soon as possible", "asap", "right away", "anytime", "whenever", "soon", "today", "tomorrow", a named weekday, or a clock time — MUST produce wantsBooking=true. When the caller gives ONLY an ASAP-style phrase with no specific day/time, set timeHint to that phrase (e.g. "as soon as possible") and hasTime to true; the system will pick the earliest available slot.
- callerName: The caller's name if they said it (e.g. "John", "Sarah Jones"). Null if never stated.
- serviceNeed: Short description of the problem/service needed (e.g. "hole in roof", "leaking pipe", "estimate"). Null if unclear.
- timeHint: The EXACT day/time preference the caller stated in THIS message, e.g. "tomorrow afternoon", "friday morning", "next saturday at noon", "2pm", "anytime". Include only the time part, not the name. Null if they gave no day/time.
- IMPORTANT — prefer the MOST SPECIFIC, MOST RECENT time expression. If the caller said something vague like "as soon as possible", "soon", or "anytime" AND a specific day or clock time in the same message, timeHint must be the SPECIFIC one — e.g. for "as soon as possible, next saturday at noon" return "next saturday at noon", NEVER "as soon as possible". A named day, "tomorrow"/"today", a clock time ("12pm", "noon", "3:30"), or a window ("morning", "afternoon") always outranks "asap"-style phrases.
- hasTime: true if timeHint is not null.

Be conservative: never invent a name or a time the caller didn't say.`,
      },
      // Last ~8 turns (excluding the just-pushed caller message — it's the
      // "latest message" below). Smaller prompt = faster, cheaper.
      ...history.slice(-8, -1).map((h) => ({
        role: h.startsWith("Caller:") ? ("user" as const) : ("assistant" as const),
        content: h.replace(/^(Caller|AI): /, ""),
      })),
      {
        role: "user" as const,
        content: `Caller's latest message: "${callerMessage}". Caller's phone number (from caller ID): ${callerPhone}. Analyze and return the JSON assessment.`,
      },
    ];

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_KEY}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(4000),
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages,
        max_tokens: 250,
        temperature: 0,
        response_format: { type: "json_object" },
      }),
    });

    const data = (await resp.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = data.choices?.[0]?.message?.content;
    if (!text) {
      console.warn("[twilio-handler] detectBookingIntent: empty LLM content — treating as no intent");
      return { wantsBooking: false, callerName: null, serviceNeed: null, timeHint: null, hasTime: false };
    }

    const parsed = JSON.parse(text) as BookingIntent;
    return {
      wantsBooking: !!parsed.wantsBooking,
      callerName: parsed.callerName || null,
      serviceNeed: parsed.serviceNeed || null,
      timeHint: parsed.timeHint || null,
      hasTime: !!parsed.hasTime && !!parsed.timeHint,
    };
  } catch (err) {
    console.warn("[twilio-handler] Booking intent detection failed:", err);
    return { wantsBooking: false, callerName: null, serviceNeed: null, timeHint: null, hasTime: false };
  }
}

// ── Calendar Availability ──────────────────────────────────────────────────

/**
 * Load the busy-slot key set (`${dateKey}@${hour}` in workspace tz) for the
 * availability window starting at `fromDay` (default 14 days). Keys are built
 * from the appointment's wall-clock hour in the workspace timezone, so they
 * match the keys pickBestSlot generates for the same day. `spacerMinutes`
 * (receptionist appointmentSpacer) extends each appointment's blocked hours —
 * see booking.appointmentBusyKeys.
 */
export async function loadBusyHours(
  workspaceId: string,
  fromDay: Date,
  tz: string,
  days = 14,
  spacerMinutes: number | null | undefined = 0,
): Promise<Set<string>> {
  try {
    const { db } = await import("./src/db/index");
    const { appointments } = await import("./src/db/schema");
    const { and, eq, ne, gte, lt } = await import("drizzle-orm");
    const { startOfDay, addDays, dateKey, getHour, getMinute, appointmentBusyKeys } = await import("./src/lib/booking");

    const start = startOfDay(fromDay, tz);
    const end = addDays(start, days, tz);

    const rows = await db
      .select({ scheduledAt: appointments.scheduledAt })
      .from(appointments)
      .where(
        and(
          eq(appointments.workspaceId, workspaceId),
          ne(appointments.status, "cancelled"),
          gte(appointments.scheduledAt, start),
          lt(appointments.scheduledAt, end),
        ),
      );

    const busy = new Set<string>();
    for (const r of rows) {
      const day = dateKey(r.scheduledAt, tz);
      // Appointment spacer extends the blocked hours (see appointmentBusyKeys):
      // spacer 0 keeps the legacy behavior, spacer > 0 also blocks the next
      // ceil(spacer/60) hours so Nova leaves a gap between appointments.
      for (const k of appointmentBusyKeys(
        day,
        getHour(r.scheduledAt, tz),
        getMinute(r.scheduledAt, tz),
        spacerMinutes,
      )) {
        busy.add(k);
      }
    }
    return busy;
  } catch (err) {
    console.warn("[twilio-handler] Failed to load busy hours (non-fatal):", err);
    return new Set();
  }
}

// ── Lead + Appointment Creation ────────────────────────────────────────────

/**
 * Insert the lead + appointment + activity row FAST (no LLM on the critical
 * path). The voice path awaits this before speaking the booking confirmation,
 * so it must never include the "About the Lead" extraction (gpt-4o-mini, up to
 * 6s) — that runs afterwards as `backfillLeadAbout`. Returns ids, or null on
 * failure so the caller can stay honest (never confirm a booking that wasn't
 * written).
 */
async function createLeadAndAppointmentFast(
  workspaceId: string,
  args: {
    callerName: string;
    callerPhone: string;
    serviceNeed?: string;
    scheduledAt: Date;
    requestedHint?: string;
    address?: string;
  },
): Promise<{ leadId: string; appointmentId: string } | null> {
  try {
    const { db } = await import("./src/db/index");
    const { leads, appointments, activityLog } = await import("./src/db/schema");
    const crypto = await import("node:crypto");

    const leadId = crypto.randomUUID();
    const appointmentId = crypto.randomUUID();
    const now = new Date();

    const notes = [
      `Source: Phone call (AI Receptionist)`,
      args.serviceNeed ? `Service need: ${args.serviceNeed}` : null,
      args.requestedHint ? `Requested: ${args.requestedHint}` : null,
      args.address ? `Address: ${args.address}` : null,
    ].filter(Boolean).join(". ");

    // Insert lead
    await db.insert(leads).values({
      id: leadId,
      workspaceId,
      name: args.callerName,
      phone: args.callerPhone || null,
      email: null,
      address: args.address || null,
      source: "phone",
      status: "new",
      score: 70, // phone leads are higher intent
      notes,
      createdAt: now,
      updatedAt: now,
    });

    // Insert appointment at the availability-engine-chosen time
    await db.insert(appointments).values({
      id: appointmentId,
      workspaceId,
      leadId,
      title: args.serviceNeed
        ? `Phone inquiry: ${args.serviceNeed.slice(0, 50)}`
        : "Phone inquiry follow-up",
      scheduledAt: args.scheduledAt,
      status: "scheduled",
      notes,
      createdAt: now,
    });

    // Log activity
    try {
      await db.insert(activityLog).values({
        id: crypto.randomUUID(),
        workspaceId,
        type: "lead_created",
        description: `Phone lead: ${args.callerName} — ${args.serviceNeed || "General inquiry"}`,
        metadata: {
          leadId,
          appointmentId,
          source: "phone_receptionist",
          callerPhone: args.callerPhone,
          scheduledAt: args.scheduledAt.toISOString(),
        },
        createdAt: now,
      });
    } catch (err) {
      console.warn("[twilio-handler] Activity log failed (non-fatal):", err);
    }

    console.log(`[twilio-handler] Created lead ${leadId} + appointment ${appointmentId} for workspace ${workspaceId} at ${args.scheduledAt.toISOString()}`);
    return { leadId, appointmentId };
  } catch (err) {
    console.error("[twilio-handler] Failed to create lead/appointment:", err);
    return null;
  }
}

/**
 * "About the Lead" backfill — summarize the caller's situation + qualifying
 * Q&A onto the lead AFTER the booking is written (fire-and-forget; the voice
 * path must not wait on it). 6s hard timeout; any failure degrades to
 * { summary: null, qa: [] } and never throws.
 */
async function backfillLeadAbout(
  leadId: string,
  history: string[],
  args: {
    callerName?: string;
    serviceNeed?: string;
    scheduledAt?: Date;
    timezone?: string;
  },
): Promise<void> {
  try {
    const { db } = await import("./src/db/index");
    const { leads } = await import("./src/db/schema");
    const { eq } = await import("drizzle-orm");
    const { extractLeadAbout } = await import("./src/lib/lead-about");
    const about = await extractLeadAbout(history, {
      callerName: args.callerName,
      serviceNeed: args.serviceNeed,
      scheduledAt: args.scheduledAt,
      timezone: args.timezone,
    });
    if (about.summary || (about.qa && about.qa.length > 0)) {
      await db.update(leads).set({ summary: about.summary, qa: about.qa }).where(eq(leads.id, leadId));
      console.log(`[twilio-handler] about-lead backfill written for lead ${leadId} (summary=${about.summary ? "yes" : "no"} qa=${about.qa?.length ?? 0})`);
    } else {
      console.log(`[twilio-handler] about-lead backfill: empty extraction for lead ${leadId} (summary/qa null)`);
    }
  } catch (err) {
    console.warn("[twilio-handler] About-lead backfill failed (non-fatal):", err);
  }
}

// ── Call outcome logging (fire-and-forget, never blocks the voice path) ────

function logCallOutcome(
  workspaceId: string | undefined,
  callSid: string,
  patch: {
    outcome: "lead_captured" | "appointment_booked" | "transferred" | "message_taken";
    leadId?: string | null;
    appointmentId?: string | null;
  },
): void {
  if (!workspaceId || !callSid) {
    console.warn(`[twilio-handler] logCallOutcome skipped (missing workspaceId=${!!workspaceId} callSid=${!!callSid})`);
    return;
  }
  import("./src/lib/call-log")
    .then(({ updateCallOutcome }) =>
      updateCallOutcome({ workspaceId, callSid, ...patch }),
    )
    .catch((err) => console.warn("[twilio-handler] call outcome update failed (non-fatal):", err));
}

// ── Main Handler ───────────────────────────────────────────────────────────

export async function handleTwilioVoice(
  body: URLSearchParams,
  baseUrl: string,
  config?: ReceptionistConfig,
  workspaceId?: string,
  timezone = "UTC",
): Promise<Response> {
  const callSid = body.get("CallSid") || "";
  const speechResult = body.get("SpeechResult") || "";
  const callStatus = body.get("CallStatus") || "";
  const callerPhone = body.get("From") || "";

  const businessName = config?.businessName || "our office";

  // Call completed
  if (callStatus === "completed") {
    console.log(`[twilio-handler] ${callSid} branch=call-completed (hangup, convo cleared)`);
    conversations.delete(callSid);
    return xmlResponse(`<Response><Hangup/></Response>`);
  }

  // No speech yet: either the VERY FIRST webhook for this call (play the full
  // greeting once) or a <Gather input="speech" speechTimeout> timeout re-post
  // from a silent caller. A silent caller must NEVER hear the full intro again
  // and must NEVER be hung up on — respond like a human receptionist: nudge,
  // and keep the call alive with another <Gather>.
  if (!speechResult) {
    let convo = conversations.get(callSid);
    if (!convo) {
      convo = { history: [], leadCreated: false, bookingDone: false };
      conversations.set(callSid, convo);
    }

    if (!convo.hasGreeted) {
      // First webhook for this call → play the greeting exactly once.
      convo.hasGreeted = true;
      convo.silentStreak = 0;
      console.log(`[twilio-handler] ${callSid} branch=greeting (first webhook, no speech yet)`);
      const greeting =
        `Hello, you've reached ${businessName}. This is Nova. How can I help you today?`;
      // Record the greeting as an AI turn so the FIRST speech turn's model
      // context already contains the introduction — otherwise the model sees
      // the system prompt's "greet at the very start" instruction with no prior
      // AI turn and re-introduces Nova mid-call.
      convo.history.push(`AI: ${greeting}`);
      const ttsKey = workspaceId
        ? `ws:greeting:${workspaceId}:${hashString(greeting)}`
        : `${callSid}:greeting`;
      return xmlResponse(await playAndGatherXml(greeting, ttsKey, baseUrl));
    }

    // No-speech Gather re-post after the greeting already played → deterministic
    // nudge WITHOUT re-introducing the business/Nova. Each consecutive silent
    // timeout nudges again (varying the wording), never hangs up.
    convo.silentStreak = (convo.silentStreak || 0) + 1;
    const nudge =
      convo.silentStreak <= 1
        ? "I didn't quite catch that — how can I help you today?"
        : "I'm still here whenever you're ready. How can I help you today?";
    console.log(`[twilio-handler] ${callSid} branch=nudge silentStreak=${convo.silentStreak} (no-speech Gather re-post)`);
    convo.history.push(`AI: ${nudge}`);
    const ttsKey = workspaceId
      ? `ws:nudge:${workspaceId}:${hashString(nudge)}`
      : `${callSid}:nudge`;
    return xmlResponse(await playAndGatherXml(nudge, ttsKey, baseUrl));
  }

  // Hard deadline: ALWAYS answer within ~8s so Twilio's voice webhook
  // timeout (~15s) never fires and the caller never hears Twilio's generic
  // error. If the deadline fires we return safe TwiML immediately; the speech
  // flow keeps running in the background so its DB writes still land.
  return await Promise.race([
    (async () => {
  // Process speech — load or create conversation state
  let convo = conversations.get(callSid);
  if (!convo) {
    // First webhook for this call carried speech (no greeting webhook seen) —
    // unusual but legal; the greeting branch is what normally creates the convo.
    console.log(`[twilio-handler] ${callSid} branch=speech-first-webhook (convo created fresh)`);
    convo = { history: [], leadCreated: false, bookingDone: false };
    if (callerPhone) convo.callerPhone = callerPhone;
    conversations.set(callSid, convo);
  }

  convo.history.push(`Caller: ${speechResult}`);
  console.log(`[twilio-handler] ${callSid} Caller said: ${speechResult}`);
  // Any real speech breaks a silent streak — the next silent timeout starts
  // the nudge sequence over from the first nudge.
  convo.silentStreak = 0;

  const now = new Date();

  // ── Parallel pre-AI work: KB grounding ∥ booking intent detection ─────
  // The intent call is regex-gated so the common path (caller just describing
  // a problem / small talk) skips the ~1.5s LLM call entirely. We're mid-booking
  // when awaitingName or pendingTimeHint is set — then the gate stays open.
  const gatePasses =
    !convo.bookingDone &&
    (BOOKING_GATE_RE.test(speechResult) ||
      convo.awaitingName === true ||
      convo.awaitingAddress === true ||
      !!convo.pendingTimeHint);

  let kbContext: string | null = null;
  let intent: BookingIntent | null = null;
  if (workspaceId) {
    const searchQuery =
      speechResult.length > 5 ? speechResult : convo.history.slice(-3).join(" ");
    [kbContext, intent] = await Promise.all([
      searchKB(searchQuery, workspaceId),
      gatePasses
        ? detectBookingIntent(speechResult, convo.history, callerPhone, config)
        : Promise.resolve(null),
    ]);
    if (kbContext && kbContext.length > 1200) kbContext = kbContext.slice(0, 1200) + "\n…";
    console.log(
      `[twilio-handler] ${callSid} branch=booking-gate ${gatePasses ? "passed (intent LLM invoked)" : "skipped (no booking language)"} | kb=${kbContext ? "hit" : "miss"}`,
    );
  } else {
    console.warn(`[twilio-handler] ${callSid} branch=no-workspace-id (KB + booking disabled for this call)`);
  }

  // ── Booking flow (from intent, if the gate passed) ─────────────────────
  let bookingContext: string | null = null;
  let bookingSlot: Date | null = null;
  let bookingFormatted: string | null = null;
  let lastTimeHint: string | undefined;

  if (workspaceId && !convo.bookingDone && intent) {
    if (intent.callerName) convo.callerName = intent.callerName;
    if (intent.serviceNeed) convo.serviceNeed = intent.serviceNeed;
    if (intent.callerName || intent.serviceNeed || intent.hasTime) {
      console.log(
        `[twilio-handler] ${callSid} branch=intent-extracted name=${intent.callerName ?? "-"} need=${intent.serviceNeed ?? "-"} time=${intent.timeHint ?? "-"} wantsBooking=${intent.wantsBooking}`,
      );
    }
    // Only trust a detected time hint when the caller's literal message
    // actually contains time language — prevents the model from
    // hallucinating a time on name-only turns (e.g. "my name is Jane").
    // A vague new hint (asap/soon/anytime) never downgrades an already
    // specific pending hint, and a fresh hint must not contradict the day
    // the caller literally named (e.g. LLM says "today" for "Monday instead").
    if (intent.hasTime && intent.timeHint && hasTimeLanguage(speechResult)) {
      const newVague = VAGUE_TIME_RE.test(intent.timeHint) && !SPECIFIC_TIME_RE.test(intent.timeHint);
      const oldSpecific = !!convo.pendingTimeHint && SPECIFIC_TIME_RE.test(convo.pendingTimeHint);
      const literalDay = extractLiteralDay(speechResult);
      const hintMatchesLiteral =
        literalDay === null || new RegExp(`\\b${literalDay}\\b`, "i").test(intent.timeHint);
      if (!(newVague && oldSpecific) && hintMatchesLiteral) {
        convo.pendingTimeHint = intent.timeHint;
        console.log(`[twilio-handler] ${callSid} branch=time-hint-accepted hint="${intent.timeHint}"`);
      } else {
        console.log(
          `[twilio-handler] ${callSid} branch=time-hint-rejected hint="${intent.timeHint}" reason=${newVague && oldSpecific ? "vague-new-over-specific-old" : "literal-day-mismatch"}`,
        );
      }
    }
    // Fallback: the caller's literal speech contains day/time language but the
    // intent LLM dropped the hint (common with compound utterances like "my
    // name is X, I'd like to come in Saturday at noon" — or a flaky LLM on
    // "as soon as possible"). Never lose a stated time — parse the hint
    // directly from the raw speech. Safe: name-only or service-only turns
    // parse to null here and skip. This INCLUDES preferEarliest hints: an
    // "as soon as possible" / "right away" answer to a "when" question is a
    // real booking signal (real-call bug CAc25e82b — the exclusion dropped
    // the ASAP hint, the booking flow never started, and the response LLM
    // fabricated a slot offer).
    if (!convo.pendingTimeHint && hasTimeLanguage(speechResult)) {
      const bookingMod = await import("./src/lib/booking");
      const fb = bookingMod.parseDateTimeHint(speechResult, now, timezone);
      if (fb) {
        convo.pendingTimeHint = speechResult.trim();
        console.log(`[twilio-handler] ${callSid} intent LLM missed time; literal fallback used: "${convo.pendingTimeHint}"`);
      } else {
        console.log(`[twilio-handler] ${callSid} branch=literal-time-fallback-no-parse (time language but no parseable hint)`);
      }
    }

    // Deterministic name capture: when we're mid-booking and awaiting the
    // caller's name, a short reply that carries NO time language is very
    // likely the name ("yeah, Jackie", "sure, it's Jackie", "Jackie"). The
    // intent LLM can flake on these; capture it here so the booking proceeds
    // THIS turn. This deliberately does NOT read a time out of such replies
    // (name-only turns must never hallucinate a time).
    if (convo.awaitingName && !convo.callerName && !hasTimeLanguage(speechResult)) {
      const name = extractNameFromReply(speechResult);
      if (name) {
        convo.callerName = name;
        console.log(`[twilio-handler] ${callSid} name captured deterministically: "${name}"`);
      } else {
        console.log(`[twilio-handler] ${callSid} branch=name-capture-failed (awaitingName but reply isn't a name)`);
      }
    }

    // Deterministic address capture: when we're mid-booking and awaiting the
    // service address, the caller's reply IS the address — capture it verbatim
    // (trimmed). Do NOT run name extraction or time parsing on it (the reply
    // is the address, not a name/time answer). The one exception: if the
    // caller misunderstood and answered with ONLY a time ("tomorrow at 10am"),
    // leave awaitingAddress true so the flow re-asks for the address once.
    if (convo.awaitingAddress && !convo.address) {
      const trimmed = speechResult.trim();
      if (trimmed && !isTimeOnlyReply(trimmed)) {
        convo.address = trimmed;
        console.log(`[twilio-handler] ${callSid} address captured deterministically: "${trimmed}"`);
      } else if (trimmed) {
        console.log(`[twilio-handler] ${callSid} branch=address-capture-deferred (time-only reply — re-ask address)`);
      }
    }

    // The caller may be answering our "what's your name?" prompt — treat that
    // as continued booking intent when we're mid-booking with a pending time.
    // A pending offeredDay/offeredSlot also keeps the booking flow alive on
    // agreement replies ("yes", "that works") that carry no booking language.
    // And a captured ASAP hint ("as soon as possible" / "right away" /
    // "anytime") is itself a booking signal when the caller is answering a
    // "when" question or the reply is basically just the ASAP phrase — this
    // is the deterministic net for an intent LLM that flaked on wantsBooking
    // (the exact failure in real-call CAc25e82b).
    const asapTrigger =
      !!convo.pendingTimeHint &&
      (PREFER_EARLIEST_RE.test(convo.pendingTimeHint) ||
        (WHEN_ANSWER_RE.test(convo.pendingTimeHint) &&
          (novaAskedForWhen(convo.history) || isBareAsapReply(speechResult))));
    const wantsBook =
      intent.wantsBooking ||
      (convo.awaitingName === true && !!convo.callerName && !!convo.pendingTimeHint) ||
      (convo.awaitingAddress === true && !!convo.address && !!convo.callerName && !!convo.pendingTimeHint) ||
      // Still awaiting the service address (time-only reply / re-ask): keep the
      // booking flow alive so the chain re-emits ASK_ADDRESS instead of the
      // response LLM freewheeling away from the booking.
      convo.awaitingAddress === true ||
      // The caller literally answered the "when" question (their speech
      // contains day/time language) and we captured the hint — even when the
      // intent LLM flaked on wantsBooking entirely (observed live: B3 "Tuesday
      // at 11am" freewheeled, stalling the booking). This is the deterministic
      // net for a specific-time reply, mirroring the ASAP trigger below.
      (hasTimeLanguage(speechResult) && !!convo.pendingTimeHint) ||
      !!convo.offeredDay ||
      !!convo.offeredSlot ||
      asapTrigger;

    if (workspaceId && !convo.bookingDone && intent) {
      console.log(`[twilio-handler] ${callSid} branch=wantsBook=${wantsBook}`);
    }

    if (wantsBook) {
      const hasTime = !!convo.pendingTimeHint;
      if (!hasTime) {
        convo.awaitingName = false;
        // Caller wants to be seen but hasn't said when — ask.
        console.log(`[twilio-handler] ${callSid} branch=booking-ask-when (no time preference yet)`);
        bookingContext =
          "ASK_WHEN: The caller wants to book an appointment but hasn't given a day or time. Ask them when they'd like to be seen (e.g. \"When would you like to come in?\" or \"Do you have a day or time in mind?\").";
      } else if (!convo.callerName) {
        // Has a time but no name yet — ask for the name, book next turn.
        convo.awaitingName = true;
        console.log(`[twilio-handler] ${callSid} branch=booking-ask-name (time="${convo.pendingTimeHint}", no name yet)`);
        bookingContext =
          `ASK_NAME: The caller wants to book (they mentioned ${convo.pendingTimeHint}) but hasn't given their name. Ask for their name first (and a good phone number if not already known).`;
      } else if (config?.requireAddress && !convo.address) {
        // Has time + name, but this business requires the service address
        // before an appointment can be booked — ask for it, do NOT book yet.
        convo.awaitingName = false;
        convo.awaitingAddress = true;
        console.log(`[twilio-handler] ${callSid} branch=booking-ask-address (requireAddress, no address yet)`);
        bookingContext =
          "ASK_ADDRESS: The caller wants to book but hasn't given the service address. Ask for the address where the work will be done (e.g. \"And what's the address for the service?\"). Do NOT book or confirm anything yet — the appointment must not be scheduled without the address.";
      } else {
        // Has time + name (+ address, when required) — check availability and
        // book now.
        convo.awaitingName = false;
        convo.awaitingAddress = false;
        lastTimeHint = convo.pendingTimeHint;
        try {
          const booking = await import("./src/lib/booking");
          // Structured openDays/openHours win when set; free-text
          // businessHours (or the Mon-Fri 9-5 default) is the fallback.
          const hours =
            booking.structuredToWeeklyHours(config?.openDays, config?.openHours) ??
            booking.parseBusinessHours(config?.businessHours);

          // Pending-offer handling: after we OFFERED the next open day
          // (convo.offeredDay) or a closest slot (convo.offeredSlot), a reply
          // naming the SAME day/time or agreeing ("yes / that works / instead")
          // books exactly what was offered — never re-parse the reply as a
          // fresh request (the intent LLM has hallucinated "today" for such
          // replies, booking the wrong day). Only a genuinely different named
          // day/time overrides the offer and re-runs the normal flow.
          const decision = booking.decideOfferedReply(
            speechResult,
            convo.offeredDay,
            convo.offeredSlot,
            now,
            timezone,
          );
          if (decision.kind === "accept-offered-day") {
            const offered = decision.day;
            convo.offeredDay = undefined;
            convo.offeredSlot = undefined;
            convo.pendingTimeHint = undefined; // the offer wins; don't re-parse
            lastTimeHint = `next open day (${booking.formatDay(offered, timezone)})`;
            const busy = await loadBusyHours(workspaceId, offered, timezone, 14, config?.appointmentSpacer ?? 0);
            const slot = booking.pickBestSlot(
              { day: offered, preferEarliest: false },
              hours,
              busy,
              now,
              timezone,
            );
            if (slot) {
              bookingSlot = slot;
              bookingFormatted = booking.formatSlot(slot, now, timezone);
              console.log(`[twilio-handler] ${callSid} branch=booked offered-day slot=${bookingFormatted}`);
              bookingContext =
                `BOOKED: The appointment has just been scheduled for ${bookingFormatted} (the next open day after the caller's closed request). ` +
                `You MUST confirm this to the caller now, mentioning the EXACT day and time (e.g. "You're all set for ${bookingFormatted}"). ` +
                (convo.callerName ? `Use their name (${convo.callerName}) if natural.` : "") +
                ` Then ask if there's anything else. Do not say someone will call back to confirm — it's booked.`;
            } else {
              console.log(`[twilio-handler] ${callSid} branch=no-slot (offered-day had no free slot in 14 days)`);
              bookingContext =
                "NO_SLOT: No appointment slot could be found in the next two weeks. Apologize and offer to have someone call the caller back to arrange a time.";
            }
          } else if (decision.kind === "accept-offered-slot") {
            const offered = decision.slot;
            convo.offeredDay = undefined;
            convo.offeredSlot = undefined;
            convo.pendingTimeHint = undefined; // the offer wins; don't re-parse
            lastTimeHint = `offered slot (${booking.formatSlot(offered, now, timezone)})`;
            bookingSlot = offered;
            bookingFormatted = booking.formatSlot(offered, now, timezone);
            console.log(`[twilio-handler] ${callSid} branch=booked offered-slot=${bookingFormatted}`);
            bookingContext =
              `BOOKED: The appointment has just been scheduled for ${bookingFormatted}. ` +
              `You MUST confirm this to the caller now, mentioning the EXACT day and time (e.g. "You're all set for ${bookingFormatted}"). ` +
              (convo.callerName ? `Use their name (${convo.callerName}) if natural.` : "") +
              ` Then ask if there's anything else. Do not say someone will call back to confirm — it's booked.`;
          } else {
            // No pending offer, or the caller named a different day/time —
            // normal parse path (closed-day handling stays honest: closed days
            // are never silently booked, they get a fresh offer).
            convo.offeredDay = undefined;
            convo.offeredSlot = undefined;
            const hint = booking.parseDateTimeHint(convo.pendingTimeHint!, now, timezone);
            if (hint) {
              const busy = await loadBusyHours(workspaceId, hint.day, timezone, 14, config?.appointmentSpacer ?? 0);
              const requestedDay = booking.getDayOfWeek(hint.day, timezone);
              const dayClosed = !hint.preferEarliest && hours[requestedDay] === null;
              if (dayClosed) {
                const nextOpen = booking.findNextOpenDay(hint.day, hours, timezone);
                if (nextOpen) {
                  convo.offeredDay = nextOpen;
                  console.log(`[twilio-handler] ${callSid} branch=day-closed offer-next-open=${booking.formatDay(nextOpen, timezone)}`);
                  bookingContext =
                    `DAY_CLOSED: The caller asked for an appointment on ${booking.formatDay(hint.day, timezone)} ` +
                    `but the business is CLOSED that day. Tell them you're sorry, you're closed on ` +
                    `${booking.formatDay(hint.day, timezone)}, and offer the next open day, ` +
                    `${booking.formatDay(nextOpen, timezone)}. Ask if that works for them — do NOT book yet; ` +
                    `wait for their confirmation.`;
                } else {
                  console.log(`[twilio-handler] ${callSid} branch=no-slot (requested day closed, no open day in 14 days)`);
                  bookingContext =
                    "NO_SLOT: The caller's requested day is closed and no open day is available in the next two weeks. Apologize and offer to have someone call them back to arrange a time.";
                }
              } else {
                // Explicit time/window requested → pick; if it had to SNAP
                // (outside business hours or fully booked) do NOT silently
                // book a different time — offer the closest slot and wait for
                // confirmation (mirrors the closed-DAY flow).
                const pick = booking.pickBestSlotChecked(hint, hours, busy, now, timezone);
                if (!pick) {
                  console.log(`[twilio-handler] ${callSid} branch=no-slot (no slot found in 14 days)`);
                  bookingContext =
                    "NO_SLOT: No appointment slot could be found in the next two weeks. Apologize and offer to have someone call the caller back to arrange a time.";
                } else if (pick.matched) {
                  bookingSlot = pick.slot;
                  bookingFormatted = booking.formatSlot(pick.slot, now, timezone);
                  console.log(`[twilio-handler] ${callSid} branch=booked matched slot=${bookingFormatted}`);
                  bookingContext =
                    `BOOKED: The appointment has just been scheduled for ${bookingFormatted}. ` +
                    `You MUST confirm this to the caller now, mentioning the EXACT day and time (e.g. "You're all set for ${bookingFormatted}"). ` +
                    (convo.callerName ? `Use their name (${convo.callerName}) if natural.` : "") +
                    ` Then ask if there's anything else. Do not say someone will call back to confirm — it's booked.`;
                } else {
                  convo.offeredSlot = pick.slot;
                  console.log(`[twilio-handler] ${callSid} branch=time-unavailable offer=${booking.formatSlot(pick.slot, now, timezone)}`);
                  bookingContext =
                    `TIME_UNAVAILABLE: ${booking.timeUnavailableMessage(hint, pick.slot, hours, now, timezone)}`;
                }
              }
            } else {
              console.log(`[twilio-handler] ${callSid} branch=ask-when-repeat (pendingTimeHint "${convo.pendingTimeHint}" unparseable)`);
              bookingContext =
                "ASK_WHEN: Could not understand the caller's time preference. Ask them to repeat when they'd like to be seen.";
            }
          }
        } catch (err) {
          console.warn(`[twilio-handler] ${callSid} branch=booking-engine-error (non-fatal, continues as freeflow):`, err);
        }
      }
    } else if (workspaceId && convo.bookingDone) {
      console.log(`[twilio-handler] ${callSid} branch=booking-flow-skip (already booked)`);
    }
  }

  // ── Generate AI Response ─────────────────────────────────────────────
  let aiResponse: string;
  if (bookingContext?.startsWith("DAY_CLOSED:")) {
    // Deterministic closed-day message — the response LLM sometimes ignores
    // the DAY_CLOSED instruction and "confirms" the closed day instead. Same
    // pattern as the BOOKED confirm: never leave honesty to the LLM.
    const closedDay =
      bookingContext.match(/appointment on ([^.]+) but the business is CLOSED/)?.[1] ?? "that day";
    const offerDay =
      bookingContext.match(/offer the next open day, ([^.]+)\./)?.[1] ?? "the next open day";
    aiResponse = `I'm sorry, we're closed on ${closedDay}. Would ${offerDay} work for you instead?`;
    console.log(`[twilio-handler] ${callSid} Nova says (deterministic closed-day): ${aiResponse}`);
  } else if (bookingContext?.startsWith("TIME_UNAVAILABLE:")) {
    // Deterministic "we're not open at that time" message — same pattern as
    // the closed-day reply; never leave this honesty to the LLM.
    aiResponse = bookingContext.slice("TIME_UNAVAILABLE:".length).trim();
    console.log(`[twilio-handler] ${callSid} Nova says (deterministic time offer): ${aiResponse}`);
  } else if (bookingContext?.startsWith("ASK_ADDRESS:")) {
    // Deterministic address ask — the response LLM was observed (live E2E,
    // 2026-08-12) ignoring the ASK_ADDRESS booking status and freewheeling
    // ("what's the plumbing issue?") instead of asking for the address. Same
    // pattern as DAY_CLOSED/TIME_UNAVAILABLE: never leave the required ask to
    // the LLM. The reply IS the ask; the address is captured on the next turn.
    aiResponse = "And what's the address where the work will be done?";
    console.log(`[twilio-handler] ${callSid} Nova says (deterministic address ask): ${aiResponse}`);
  } else if (bookingSlot && bookingFormatted) {
    // BOOKED turn: the engine chose a slot and the caller gave a name + time —
    // there is nothing left for the response LLM to decide. WRITE the lead +
    // appointment to the DB FIRST, and only speak the confirmation if the
    // write actually landed. Confirming a booking that wasn't written is the
    // exact real-call bug (CAc25e82b) we're eliminating — the confirmation
    // text must never exist unless the rows exist.
    const write = workspaceId && convo.callerName
      ? await createLeadAndAppointmentFast(workspaceId, {
          callerName: convo.callerName,
          callerPhone,
          serviceNeed: convo.serviceNeed,
          scheduledAt: bookingSlot,
          requestedHint: lastTimeHint,
          address: convo.address,
        })
      : null;
    if (write) {
      convo.leadCreated = true;
      convo.bookingDone = true;
      logCallOutcome(workspaceId, callSid, {
        outcome: "appointment_booked",
        leadId: write.leadId,
        appointmentId: write.appointmentId,
      });
      // "About the Lead" (summary + qualifying Q&A) — background backfill so
      // the spoken confirmation never waits on the extraction LLM.
      backfillLeadAbout(write.leadId, convo.history, {
        callerName: convo.callerName,
        serviceNeed: convo.serviceNeed,
        scheduledAt: bookingSlot,
        timezone,
      }).catch((err) => console.warn("[twilio-handler] about-lead backfill failed (non-fatal):", err));

      const name = convo.callerName?.trim();
      aiResponse = name
        ? `Great, ${name} — you're all set for ${bookingFormatted}. Anything else I can help with?`
        : `You're all set for ${bookingFormatted}. Anything else I can help with?`;
      console.log(`[twilio-handler] ${callSid} Nova says (deterministic booking confirm): ${aiResponse}`);
    } else {
      // The write FAILED — never confirm a booking that wasn't written. Say
      // so honestly instead (and drop bookingSlot so nothing downstream
      // treats this as booked).
      bookingSlot = null;
      aiResponse =
        "I'm sorry, I'm having trouble getting that on the calendar right now. Let me take your details and have someone call you right back to confirm the time.";
      console.error(`[twilio-handler] ${callSid} booking write FAILED — honest apology instead of confirmation`);
    }
  } else {
    aiResponse = await generateAIResponse(
      speechResult,
      convo.history,
      config,
      kbContext ?? undefined,
      bookingContext ?? undefined,
    );

    // ANTI-HALLUCINATION GUARD (deterministic): the response LLM must NEVER
    // claim a booking, propose a time, or offer availability that the engine
    // didn't produce. Only the deterministic branches above (DAY_CLOSED /
    // TIME_UNAVAILABLE / BOOKED with a real DB write) may state confirmations
    // or offers — and bookingSlot is null here. If the LLM did anyway
    // (bookingContext null = pure freewheel, or a flaky model ignoring the
    // prompt), rewrite to an honest scheduling question. Skipped once a real
    // booking exists this call (bookingDone) so a truthful re-confirmation is
    // never mangled.
    if (
      !convo.bookingDone &&
      !convo.leadCreated &&
      PHANTOM_BOOKING_RE.test(aiResponse)
    ) {
      aiResponse = "I'd like to get you scheduled — when works best for you?";
      console.log(`[twilio-handler] ${callSid} anti-hallucination guard rewrote fabricated booking/offer claim`);
    }
  }

  console.log(`[twilio-handler] ${callSid} Nova says: ${aiResponse}`);
  convo.history.push(`AI: ${aiResponse}`);

  // ── Pure detections first (no awaits) so nothing serial sits behind TTS ──
  const transferPattern = /\b(talk to (a |the )?(person|someone|representative|agent|manager|human|real person)\b|speak (with|to) (a |the )?(person|representative|agent|manager|human|real person)\b)/i;
  const wantTransfer = transferPattern.test(speechResult) || /\btransfer\b/i.test(aiResponse);
  const hasTransferNumber = !!(config?.transferNumber);

  const goodbyePhrases = ["goodbye", "bye", "have a great day", "talk to you later", "thank you so much"];
  const isGoodbye = goodbyePhrases.some((p) => aiResponse.toLowerCase().includes(p));

  // NOTE: no DB write here anymore. The lead + appointment are written INSIDE
  // the BOOKED branch above (awaiting the write before the confirmation is
  // spoken), so by the time we reach this point a booking is either already
  // persisted (bookingDone=true) or never existed.

  if (wantTransfer) {
    console.log(`[twilio-handler] ${callSid} branch=transfer (hasTransferNumber=${hasTransferNumber})`);
    conversations.delete(callSid);
    if (hasTransferNumber) {
      logCallOutcome(workspaceId, callSid, { outcome: "transferred" });
      return xmlResponse(
        `<Response statusCallback="${baseUrl}/api/twilio/webhooks/status" statusCallbackMethod="POST"><Say>One moment, I'll connect you.</Say><Dial>${escapeXml(config!.transferNumber!)}</Dial></Response>`
      );
    }
    // No transfer number — take a message
    console.log(`[twilio-handler] ${callSid} branch=transfer-no-number take-message`);
    logCallOutcome(workspaceId, callSid, { outcome: "message_taken" });
    return xmlResponse(
      `<Response statusCallback="${baseUrl}/api/twilio/webhooks/status" statusCallbackMethod="POST"><Say>I can't transfer calls right now, but I'll take a message and have someone call you back. Please leave your message after the tone.</Say><Gather input="speech" speechTimeout="auto" action="${baseUrl}/api/twilio/webhooks/voice" method="POST"/></Response>`
    );
  }

  const ttsKey = `${callSid}:${convo.history.length}`;
  // Race TTS against a short timer: if TTS stalls, the <Say> fallback keeps
  // this webhook well under Twilio's timeout.
  const ttsRace = await raceTts(generateTTS(aiResponse, ttsKey), 3500);
  const audio = ttsRace.kind === "audio" ? ttsRace.buffer : null;
  console.log(`[twilio-handler] ${callSid} branch=tts-${audio ? "audio-play" : "fallback-say"}`);

  if (isGoodbye) {
    console.log(`[twilio-handler] ${callSid} branch=goodbye (convo cleared)`);
    conversations.delete(callSid);
  }

  const gatherBlock = isGoodbye
    ? ""
    : `<Gather input="speech" speechTimeout="auto" action="${baseUrl}/api/twilio/webhooks/voice" method="POST"/>`;

  const sayBlock = audio
    ? `<Play>${baseUrl}/api/twilio/audio/${encodeURIComponent(ttsKey)}</Play>`
    : `<Say>${escapeXml(aiResponse)}</Say>`;

  const xml = `<Response statusCallback="${baseUrl}/api/twilio/webhooks/status" statusCallbackMethod="POST">${sayBlock}${gatherBlock}</Response>`;
  return xmlResponse(xml);
    })(),
    new Promise<Response>((resolve) =>
      setTimeout(
        () => {
          console.warn(`[twilio-handler] ${callSid} branch=deadline-8s (webhook exceeded 8s — returning safe TwiML)`);
          resolve(
            xmlResponse(
              `<Response statusCallback="${baseUrl}/api/twilio/webhooks/status" statusCallbackMethod="POST"><Say>Sorry, we're experiencing a brief delay. Please call back in a moment.</Say><Hangup/></Response>`,
            ),
          );
        },
        8000,
      ),
    ),
  ]);
}

export function handleTwilioAudio(key: string): Response {
  const decoded = decodeURIComponent(key);
  const cached = ttsCache.get(decoded);
  if (!cached || cached.expires <= Date.now()) {
    console.warn(`[twilio-handler] audio 404: cache miss/expired for key=${decoded}`);
    return new Response("Audio not found", { status: 404 });
  }
  return new Response(cached.buffer, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "public, max-age=600",
    },
  });
}

/** Vague time phrases — never allowed to overwrite a specific pending hint. */
const VAGUE_TIME_RE = /\b(asap|as soon as possible|soonest|soon|right away|right now|immediately|anytime|whenever|earliest)\b/i;

/** Specific day/time expressions (named day, tomorrow/today, clock, window). */
const SPECIFIC_TIME_RE =
  /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun|tomorrow|today|tonight|this (afternoon|evening|week)|next week|morning|afternoon|evening|noon|midnight|\d{1,2}\s*(am|pm)|\d{1,2}\s*:\s*\d{2})\b/i;

/** True when the caller's message literally contains day/time language. */
function hasTimeLanguage(text: string): boolean {
  return /\b(today|tonight|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun|morning|afternoon|evening|anytime|this week|next week|asap|as soon as possible|soon|right away|noon|midnight|\d{1,2}\s*:\s*\d{2}\s*(am|pm)?|\d{1,2}\s*(am|pm))\b/i.test(
    text,
  );
}

// ── Anti-hallucination guard ────────────────────────────────────────────────

/**
 * Booking-confirmation / slot-offer phrasing that the response LLM must NEVER
 * produce on its own. The only legitimate sources of these statements are the
 * deterministic DAY_CLOSED / TIME_UNAVAILABLE / BOOKED branches (which set
 * bookingSlot and bypass the LLM). If the LLM emits any of these while
 * bookingSlot is null, it is fabricating a booking/offer the engine never
 * made — the guard rewrites the reply to an honest scheduling question.
 */
const PHANTOM_BOOKING_RE =
  /you'?re all set|you are all set|\ball set (for|at)\b|\bbooked\b|booking (made|confirmed)|\bconfirm(ed|s|ing)?\b[^.]{0,40}\b(appointment|for|at)\b|scheduled (for|at|to)|see you (then|soon|at|there)|how (does|about|would) [^.]{0,40}\bsound\b|i'?ll check (the |our )?(availability|calendar|schedule)|let me (check|look at) (the |our )?(availability|calendar|schedule)|check (our|the) availability|i (can|'ll) (get|fit) you (in|into)|get you (in|into|on the)|i'?ll see you|we'?ll (get|fit) you (in|into|on the)|(availability|opening|slot)[^.]{0,40}\b(at|on|for|tomorrow|today|this|next|monday|tuesday|wednesday|thursday|friday|saturday|sunday|soon|right now)\b/i;
export { PHANTOM_BOOKING_RE };

// ── ASAP / when-answer detection (deterministic booking net) ───────────────

/** Phrases that mean "earliest possible slot" — always a booking signal. */
const PREFER_EARLIEST_RE = /\b(asap|as soon as possible|soonest|earliest|right away|right now|immediately)\b/i;

/** Phrases that answer a "when would you like..." question (includes ASAP). */
const WHEN_ANSWER_RE = /\b(asap|as soon as possible|soonest|earliest|right away|right now|immediately|anytime|any time|whenever|soon)\b/i;

/** Is the caller's message basically JUST the time answer (short, no context)? */
function isBareAsapReply(speech: string): boolean {
  const t = speech.trim();
  return t.length > 0 && t.length < 60 && WHEN_ANSWER_RE.test(t);
}

/**
 * True when a reply is essentially ONLY day/time language (e.g. "tomorrow at
 * 10am", "as soon as possible") — used to detect a caller who misunderstood
 * the ASK_ADDRESS prompt and answered with a time instead of an address. The
 * address-capture path then re-asks for the address once instead of treating
 * the time as an address.
 */
function isTimeOnlyReply(text: string): boolean {
  const stripped = text
    .replace(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun|tomorrow|today|tonight|this week|next week|weekend|morning|afternoon|evening|noon|midnight|asap|as soon as possible|soon|right away|right now|anytime|whenever|earliest)\b/gi, " ")
    .replace(/\b(at|on|for|by|around|about|after|before|o'?clock)\b/gi, " ")
    .replace(/\b\d{1,2}\s*:\s*\d{2}\s*(?:am|pm)?\b/gi, " ") // clock "10:30" / "10:30am"
    .replace(/\b\d{1,2}\s*(?:am|pm)\b/gi, " ") // "10am" / "4pm"
    .replace(/[^a-z0-9#]/gi, " ");
  return stripped.trim().length === 0;
}

/** Did Nova's most recent spoken turn ask when the caller wants to be seen? */
function novaAskedForWhen(history: string[]): boolean {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].startsWith("AI:")) {
      return /\bwhen\b|day or time|what (day|time)|availability|come out|be seen|schedule|get you (in|on)/i.test(history[i]);
    }
  }
  return false;
}

/**
 * Pull a caller's name out of a reply to "what's your name?" — strips common
 * filler so "yeah, Jackie", "sure, it's Jackie", "my name is Jackie", and a
 * bare "Jackie" all yield "Jackie". Returns null when the reply isn't a
 * plausible name answer (too long, or not letter-only words).
 */
const NAME_FILLER_RE = /^(?:ok(?:ay)?|yeah|yep|yup|sure|yes|of course|uh|um|hmm|oh|well|right|it'?s|this is|my name is|i'?m called|i'?m|call me|the name'?s|name'?s)(?:[,.\s]+|$)/i;
function extractNameFromReply(speech: string): string | null {
  let t = speech.trim();
  // Strip filler repeatedly so "sure, it's Jackie" → "Jackie" (not "it's Jackie").
  let prev: string;
  do {
    prev = t;
    t = t.replace(NAME_FILLER_RE, "").trim();
  } while (t !== prev && t.length > 0);
  t = t.replace(/^[,.\s]+/, "").replace(/[,.\s]+$/, "");
  if (!t) return null;
  const words = t.split(/\s+/).filter((w) => w.length > 0);
  if (words.length > 2) return null; // too long to be a name answer
  const candidate = words.join(" ");
  if (!/^[A-Za-z][A-Za-z'\-]*(?:\s[A-Za-z][A-Za-z'\-]*)?$/.test(candidate)) return null;
  return candidate;
}
export { extractNameFromReply, isBareAsapReply, isTimeOnlyReply, novaAskedForWhen };

function xmlResponse(xml: string): Response {
  return new Response(xml, {
    headers: { "Content-Type": "text/xml" },
  });
}

/**
 * Build the Play(TTS)/Say(text) + <Gather input="speech"> TwiML used for the
 * greeting and for silent-caller nudges. Races TTS against a short timer so
 * the webhook always answers quickly — <Say> fallback if TTS is slow. The
 * <Gather> keeps the call alive: a silent caller gets a re-post to the voice
 * webhook (no SpeechResult), never a hangup.
 */
async function playAndGatherXml(
  text: string,
  ttsKey: string,
  baseUrl: string,
): Promise<string> {
  const ttsRace = await raceTts(generateTTS(text, ttsKey), 3000);
  const audio = ttsRace.kind === "audio" ? ttsRace.buffer : null;
  if (!audio) {
    console.log(`[twilio-handler] branch=play-gather-tts-fallback-say key=${ttsKey}`);
  }
  return audio
    ? `<Response statusCallback="${baseUrl}/api/twilio/webhooks/status" statusCallbackMethod="POST"><Play>${baseUrl}/api/twilio/audio/${encodeURIComponent(ttsKey)}</Play><Gather input="speech" speechTimeout="auto" action="${baseUrl}/api/twilio/webhooks/voice" method="POST"/></Response>`
    : `<Response statusCallback="${baseUrl}/api/twilio/webhooks/status" statusCallbackMethod="POST"><Say>${escapeXml(text)}</Say><Gather input="speech" speechTimeout="auto" action="${baseUrl}/api/twilio/webhooks/voice" method="POST"/></Response>`;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Small stable hash for cache keys (djb2 → base36). */
function hashString(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
