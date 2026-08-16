/**
 * Parsing helpers for inbound email payloads (SendGrid Inbound Parse and
 * JSON simulation payloads).
 *
 * SendGrid Inbound Parse sends the `from` field as the RAW From header, e.g.
 *   "Jane Doe <jane@example.com>"
 *   Jane Doe <jane@example.com>
 *   "Jane Doe" <jane@example.com>
 *   <jane@example.com>
 *   jane@example.com
 * plus a separate `envelope` JSON field whose `from` is the bare envelope
 * sender ("jane@example.com").
 *
 * All functions here are pure and NEVER throw — a malformed input falls back
 * to the raw string so the webhook can still ack 200.
 */

export interface ParsedAddress {
  /** Bare email address, lowercased (safe for lead.email + dedupe + replies). */
  email: string;
  /** Display name, if any, trimmed of surrounding quotes. */
  name: string | null;
  /** True when the input could not be parsed and `email` is the raw string. */
  fallback: boolean;
}

const EMAIL_RE = /<([^<>]*@[^<>]*)>/;
const BARE_EMAIL_RE = /^[^\s<>]+@[^\s<>]+$/;

/** Strip surrounding quotes / whitespace from a display-name fragment. */
function cleanName(raw: string): string {
  return raw.replace(/^[\s"'“”]+|[\s"'“”]+$/g, "").trim();
}

/**
 * Parse a From header / address field into {email, name}.
 * Handles: "Name <a@b.c>", Name <a@b.c>, "Name" <a@b.c>, <a@b.c>, bare a@b.c.
 * Malformed input → { email: raw (lowercased), name: null, fallback: true }.
 */
export function parseAddressField(raw: string | null | undefined): ParsedAddress {
  const input = (raw ?? "").trim();
  if (!input) return { email: "", name: null, fallback: true };

  // 1. Angled form: anything before <...> is the display name.
  const angled = input.match(EMAIL_RE);
  if (angled) {
    const email = angled[1].trim().toLowerCase();
    if (email) {
      const namePart = input.slice(0, angled.index).trim();
      return {
        email,
        name: namePart ? cleanName(namePart) : null,
        fallback: false,
      };
    }
  }

  // 2. Bare email: "jane@example.com" (also strip a trailing comma).
  const bare = input.replace(/,$/, "").trim();
  if (BARE_EMAIL_RE.test(bare)) {
    return { email: bare.toLowerCase(), name: null, fallback: false };
  }

  // 3. Fallback — never crash, keep the raw string.
  return { email: input.toLowerCase(), name: null, fallback: true };
}

/** Parse a bare email possibly wrapped in <...> (e.g. envelope.to entries). */
export function parseEnvelopeAddress(raw: string | null | undefined): string {
  return parseAddressField(raw).email;
}

/**
 * Parse the SendGrid `envelope` JSON field: {"to":["a@b.c"],"from":"x@y.z"}.
 * Returns null when absent or invalid (caller keeps the top-level fields).
 */
export function parseEnvelope(
  raw: string | null | undefined,
): { to: string[]; from: string } | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { to?: unknown; from?: unknown };
    if (!parsed || typeof parsed !== "object") return null;
    const toArr = Array.isArray(parsed.to)
      ? parsed.to.filter((t): t is string => typeof t === "string")
      : typeof parsed.to === "string"
        ? [parsed.to]
        : [];
    const from = typeof parsed.from === "string" ? parsed.from : "";
    return { to: toArr.map(parseEnvelopeAddress), from: parseEnvelopeAddress(from) };
  } catch {
    return null;
  }
}
