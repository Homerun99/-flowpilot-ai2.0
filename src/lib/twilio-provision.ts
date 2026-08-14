// Twilio provisioning — search & purchase phone numbers, configure webhooks
// Gracefully degrades when TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN are not set.

const SID = process.env.TWILIO_ACCOUNT_SID || "";
const TOKEN = process.env.TWILIO_AUTH_TOKEN || "";
const API_BASE = `https://api.twilio.com/2010-04-01`;

export function twilioConfigured(): boolean {
  return !!(SID && TOKEN);
}

function authHeaders(): Record<string, string> {
  const encoded = Buffer.from(`${SID}:${TOKEN}`).toString("base64");
  return {
    Authorization: `Basic ${encoded}`,
    "Content-Type": "application/x-www-form-urlencoded",
  };
}

interface TwilioAvailableNumber {
  phone_number: string;
  friendly_name: string;
  locality: string;
  region: string;
  capabilities: { voice: boolean; sms: boolean };
}

interface TwilioIncomingPhoneNumber {
  sid: string;
  phone_number: string;
  friendly_name: string;
  voice_url: string;
  sms_url: string;
}

/**
 * Search for an available US phone number, optionally filtered by area code.
 */
export async function findAvailableNumber(
  areaCode?: string
): Promise<TwilioAvailableNumber | null> {
  if (!twilioConfigured()) return null;

  try {
    const params = new URLSearchParams({ VoiceEnabled: "true", Limit: "3" });
    if (areaCode) params.set("AreaCode", areaCode);

    const resp = await fetch(
      `${API_BASE}/Accounts/${SID}/AvailablePhoneNumbers/US/Local.json?${params}`,
      { headers: authHeaders() }
    );

    if (!resp.ok) {
      console.error("Twilio findAvailableNumber failed:", resp.status, await resp.text().catch(() => ""));
      return null;
    }

    const data = (await resp.json()) as {
      available_phone_numbers?: TwilioAvailableNumber[];
    };

    const numbers = data.available_phone_numbers || [];
    return numbers.length > 0 ? numbers[0] : null;
  } catch (err) {
    console.error("Twilio findAvailableNumber error:", err);
    return null;
  }
}

/**
 * Purchase a phone number by its E.164 value.
 */
export async function purchaseNumber(
  phoneNumber: string
): Promise<TwilioIncomingPhoneNumber | null> {
  if (!twilioConfigured()) return null;

  try {
    const body = new URLSearchParams({ PhoneNumber: phoneNumber });
    const resp = await fetch(
      `${API_BASE}/Accounts/${SID}/IncomingPhoneNumbers.json`,
      {
        method: "POST",
        headers: authHeaders(),
        body,
      }
    );

    if (!resp.ok) {
      console.error("Twilio purchaseNumber failed:", resp.status, await resp.text().catch(() => ""));
      return null;
    }

    return (await resp.json()) as TwilioIncomingPhoneNumber;
  } catch (err) {
    console.error("Twilio purchaseNumber error:", err);
    return null;
  }
}

/**
 * Set the Voice and SMS webhook URLs for an incoming phone number, plus a
 * StatusCallback so Twilio sends lifecycle events (ringing → in-progress →
 * completed) even on calls that end without speech — reliable duration/endedAt.
 */
export async function setVoiceUrl(
  numberSid: string,
  voiceUrl: string
): Promise<boolean> {
  if (!twilioConfigured()) return false;

  try {
    const body = new URLSearchParams({
      VoiceUrl: voiceUrl,
      VoiceMethod: "POST",
      SmsUrl: voiceUrl,
      SmsMethod: "POST",
      StatusCallbackUrl: voiceUrl,
      StatusCallbackMethod: "POST",
    });

    const resp = await fetch(
      `${API_BASE}/Accounts/${SID}/IncomingPhoneNumbers/${numberSid}.json`,
      {
        method: "POST",
        headers: authHeaders(),
        body,
      }
    );

    if (!resp.ok) {
      console.error("Twilio setVoiceUrl failed:", resp.status, await resp.text().catch(() => ""));
      return false;
    }

    return true;
  } catch (err) {
    console.error("Twilio setVoiceUrl error:", err);
    return null;
  }
}

/**
 * Set ONLY the StatusCallbackUrl/StatusCallbackMethod on an existing incoming
 * phone number (no other config touched). Twilio then POSTs every call-status
 * change — including the final "completed" — to our voice webhook, which
 * finalizes the call row (fix E). Needed for numbers provisioned outside
 * setVoiceUrl (e.g. the owner's manually-attached number).
 */
export async function setNumberStatusCallback(
  numberSid: string,
  url: string
): Promise<boolean> {
  if (!twilioConfigured() || !numberSid) return false;
  try {
    const body = new URLSearchParams({
      StatusCallbackUrl: url,
      StatusCallbackMethod: "POST",
    });
    const resp = await fetch(
      `${API_BASE}/Accounts/${SID}/IncomingPhoneNumbers/${numberSid}.json`,
      {
        method: "POST",
        headers: authHeaders(),
        body,
      }
    );
    if (!resp.ok) {
      console.error("Twilio setNumberStatusCallback failed:", resp.status, await resp.text().catch(() => ""));
      return false;
    }
    return true;
  } catch (err) {
    console.error("Twilio setNumberStatusCallback error:", err);
    return false;
  }
}

/**
 * Release (delete) a purchased incoming phone number — stops recurring charges.
 */
export async function releaseNumber(numberSid: string): Promise<boolean> {
  if (!twilioConfigured() || !numberSid) return false;
  try {
    const resp = await fetch(
      `${API_BASE}/Accounts/${SID}/IncomingPhoneNumbers/${numberSid}.json`,
      {
        method: "DELETE",
        headers: authHeaders(),
      }
    );
    if (!resp.ok) {
      console.error("Twilio releaseNumber failed:", resp.status, await resp.text().catch(() => ""));
      return false;
    }
    return true;
  } catch (err) {
    console.error("Twilio releaseNumber error:", err);
    return false;
  }
}

/**
 * Full provisioning flow: find → purchase → set webhook URL.
 * Returns the new phone number and SID, or null on failure.
 */
export async function provisionForWorkspace(areaCode?: string): Promise<{
  number: string;
  sid: string;
} | null> {
  if (!twilioConfigured()) return null;

  // 1. Find an available number
  const available = await findAvailableNumber(areaCode);
  if (!available) {
    console.error("Twilio provision: no available numbers found");
    return null;
  }

  // 2. Purchase it
  const purchased = await purchaseNumber(available.phone_number);
  if (!purchased) {
    console.error("Twilio provision: failed to purchase number");
    return null;
  }

  // 3. Set voice URL
  const voiceUrl = "https://flowpilotai.ctonew.app/api/twilio/webhooks/voice";
  const ok = await setVoiceUrl(purchased.sid, voiceUrl);
  if (!ok) {
    console.error("Twilio provision: failed to set voice URL");
    // Number was purchased but webhook not set — still return it (partial success)
  }

  return { number: purchased.phone_number, sid: purchased.sid };
}
