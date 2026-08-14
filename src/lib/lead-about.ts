// Lead "About" extraction — summarize a phone-receptionist conversation and
// capture the qualifying Q&A, so the dashboard can show what's happening.
//
// This runs at lead-creation time INSIDE the parallel booking write (never on
// the TwiML response path). Hard 6s timeout; any failure/timeout degrades to
// { summary: null, qa: [] } — it must never throw or block the voice path.
import { formatSlot } from "./booking";

export interface LeadQaPair {
  question: string;
  answer: string;
}
export interface LeadAbout {
  summary: string | null;
  qa: LeadQaPair[];
}

const EMPTY: LeadAbout = { summary: null, qa: [] };
const OPENAI_KEY = process.env.OPENAI_API_KEY;

/** Injectable for tests; defaults to a real gpt-4o-mini call. */
export type AboutLlm = (system: string, user: string) => Promise<string>;

export async function extractLeadAbout(
  history: string[],
  opts: {
    callerName?: string;
    serviceNeed?: string;
    scheduledAt?: Date;
    timezone?: string;
    llm?: AboutLlm;
  } = {},
): Promise<LeadAbout> {
  const turns = (history ?? []).filter((h) => typeof h === "string" && h.trim());
  // Nothing to summarize — no LLM call at all.
  if (turns.length === 0) return EMPTY;

  const callerName = opts.callerName?.trim() || "the caller";
  const serviceNeed = opts.serviceNeed?.trim();
  const when = opts.scheduledAt
    ? formatSlot(opts.scheduledAt, new Date(), opts.timezone || "UTC")
    : "";
  const convo = turns.join("\n");

  const system =
    "You are the lead-intake assistant for a small business. You read a phone " +
    "conversation between the business's AI receptionist and a caller, and you " +
    "produce a handoff note for the business owner. Return ONLY a JSON object " +
    "with exactly two keys:\n" +
    '- "summary": a 2-3 sentence plain-English summary of the situation — what ' +
    "the caller needs, what is happening at their property, WHEN they want " +
    "service, and any other key facts a business owner would want before " +
    "calling back. Write it as if for the business owner (\"Caller has a leaking " +
    'pipe under the kitchen sink…\"). Use the caller\'s name if known.\n' +
    '- "qa": the qualifying questions the receptionist asked and the caller\'s ' +
    "answers, as an array of {question, answer} objects (max 5). Only include " +
    "real question→answer pairs from the conversation; never invent questions " +
    "or answers. If none, return an empty array.";

  const user = [
    "CALLER INFO:",
    `Name: ${callerName}`,
    serviceNeed ? `Service need: ${serviceNeed}` : "Service need: (not stated)",
    when ? `Scheduled appointment: ${when}` : "Scheduled appointment: (none)",
    "",
    "CONVERSATION (most recent last):",
    convo,
    "",
    'Return the JSON object now — {"summary": "...", "qa": [...]}.',
  ].join("\n");

  if (opts.llm) {
    try {
      return parseAbout(await opts.llm(system, user));
    } catch {
      return EMPTY;
    }
  }
  if (!OPENAI_KEY) return EMPTY;
  try {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_KEY}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(6000),
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        max_tokens: 450,
        temperature: 0.3,
        response_format: { type: "json_object" },
      }),
    });
    if (!resp.ok) return EMPTY;
    const data = (await resp.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) return EMPTY;
    return parseAbout(content);
  } catch {
    return EMPTY;
  }
}

function parseAbout(content: string): LeadAbout {
  try {
    const raw = JSON.parse(content) as {
      summary?: unknown;
      qa?: unknown;
    };
    const summary =
      typeof raw.summary === "string" && raw.summary.trim()
        ? raw.summary.trim().slice(0, 2000)
        : null;
    const qa: LeadQaPair[] = Array.isArray(raw.qa)
      ? raw.qa
          .filter(
            (p): p is { question: unknown; answer: unknown } =>
              !!p && typeof p === "object",
          )
          .filter(
            (p) =>
              typeof p.question === "string" &&
              p.question.trim() &&
              typeof p.answer === "string" &&
              p.answer.trim(),
          )
          .slice(0, 5)
          .map((p) => ({
            question: (p.question as string).trim().slice(0, 500),
            answer: (p.answer as string).trim().slice(0, 500),
          }))
      : [];
    return { summary, qa };
  } catch {
    return EMPTY;
  }
}
