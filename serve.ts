// Production server for the built site. The TanStack Start build emits a portable
// fetch handler (dist/server/server.js) plus static client assets (dist/client);
// this wraps them in a Bun server on port 3000 — static files first, SSR for the
// rest. Run `bun run build` before starting. Restart it with `bun run publish`.
//
// Starting a new instance supersedes the old one: it frees the port no matter
// which user owns the current server (provisioning starts it as `engine`; a team
// member's `bun run publish` runs as their own user), so publish never collides
// with an already-running server. Every sandbox user has passwordless sudo, so
// the takeover works across user boundaries.
import handler from "./dist/server/server.js";
import { handleTwilioVoice, handleTwilioAudio, ReceptionistConfig } from "./twilio-handler.ts";
import { handleApiRequest } from "./api-handler.ts";
import { getSessionCookie, verifySessionToken } from "./src/lib/auth/jwt";
import { db } from "./src/db/index";
import { workspaces } from "./src/db/schema";
import { eq, or } from "drizzle-orm";
import { upsertCallRow, finalizeCallRow } from "./src/lib/call-log";
import { DEMO_WORKSPACE } from "./src/lib/auth/session";

// Pinned, NOT read from the environment. The published preview URL
// (<label>.<PUBLIC_SITE_DOMAIN>) is reverse-proxied to 0.0.0.0:3000 inside the
// sandbox, so the default site MUST bind there. Bun auto-loads .env files, so
// honouring process.env.PORT/HOST would let a stray env var or a .env in the site
// dir silently move the site off :3000 (or onto loopback) and break the public URL.
const PORT = 3000;
const HOST = "0.0.0.0";
const CLIENT_DIR = `${import.meta.dir}/dist/client`;

// Free PORT regardless of which user owns the current listener. lsof runs under
// sudo so it can see (and the kill can signal) a process owned by another user;
// the loop waits for the socket to actually release before we bind.
const freePort =
  `for _ in $(seq 1 25); do ` +
  `pids=$(lsof -t -iTCP:${String(PORT)} -sTCP:LISTEN 2>/dev/null || true); ` +
  `if [ -z "$pids" ]; then exit 0; fi; ` +
  `kill $pids 2>/dev/null || true; sleep 0.2; ` +
  `done`;

// Take over the port, re-freeing and retrying if another publish grabbed it in the
// gap between freeing and binding (last publish wins). Bun.serve throws EADDRINUSE
// synchronously, so without this a raced publish would die while the shell already
// reported success.
for (let attempt = 1; ; attempt++) {
  await Bun.$`sudo sh -c ${freePort}`.quiet().nothrow();
  try {
    Bun.serve({
      port: PORT,
      hostname: HOST,
      async fetch(req) {
        const url = new URL(req.url);
        const { pathname } = url;

        // ── Auth middleware: protect workspace routes ──────────────
        const PROTECTED_PREFIXES = ["/dashboard", "/admin", "/client"];
        const isProtected = PROTECTED_PREFIXES.some((p) => pathname.startsWith(p));

        if (isProtected) {
          const token = getSessionCookie(req);
          if (!token) {
            return new Response(null, {
              status: 302,
              headers: { Location: `/sign-in?redirect=${encodeURIComponent(pathname)}` },
            });
          }
          const payload = await verifySessionToken(token);
          if (!payload) {
            return new Response(null, {
              status: 302,
              headers: { Location: `/sign-in?redirect=${encodeURIComponent(pathname)}` },
            });
          }
        }

        // Twilio voice webhook — handle before SSR (both URL patterns)
        const isTwilioVoice =
          (pathname === "/api/twilio/webhooks/voice" ||
           pathname === "/api/webhooks/twilio/voice") &&
          req.method === "POST";

        // Twilio statusCallback webhook — fires on every call-status change
        // (ringing → in-progress → completed / canceled / failed). This is the
        // RELIABLE completion signal: the Gather action URL only fires while a
        // <Gather> is active, so goodbye/transfer/hangup paths never posted a
        // final event and call rows stayed stuck in-progress forever.
        const isTwilioStatus =
          (pathname === "/api/twilio/webhooks/status" ||
           pathname === "/api/webhooks/twilio/status") &&
          req.method === "POST";

        if (isTwilioStatus) {
          try {
            const body = await req.text();
            const params = new URLSearchParams(body);
            const toNumber = params.get("To") || "";
            let workspaceId = DEMO_WORKSPACE;
            try {
              if (toNumber) {
                const wsByPhone = await db.query.workspaces.findFirst({
                  where: eq(workspaces.twilioPhone, toNumber),
                  columns: { id: true },
                });
                if (wsByPhone) workspaceId = wsByPhone.id;
              }
            } catch (e) {
              console.error("Failed to resolve workspace for status callback:", e);
            }
            const callSid = params.get("CallSid") || "";
            const callStatus = params.get("CallStatus") || "";
            const TERMINAL_STATUSES = ["completed", "canceled", "failed", "busy", "no-answer"];
            console.log(`[serve] status callback callSid=${callSid} status=${callStatus} ws=${workspaceId} action=${TERMINAL_STATUSES.includes(callStatus) ? "finalize" : "upsert"}`);
            if (TERMINAL_STATUSES.includes(callStatus)) {
              finalizeCallRow(workspaceId, callSid).catch((err) =>
                console.warn("[serve] call finalize failed (non-fatal):", err));
            } else {
              upsertCallRow({
                workspaceId,
                callSid,
                callerNumber: params.get("From") || "",
                toNumber,
                status: callStatus,
              }).catch((err) => console.warn("[serve] status upsert failed (non-fatal):", err));
            }
            return new Response('<?xml version="1.0" encoding="UTF-8"?><Response/>', {
              headers: { "Content-Type": "text/xml" },
            });
          } catch (err) {
            console.error("Twilio status callback error:", err);
            return new Response('<?xml version="1.0" encoding="UTF-8"?><Response/>', {
              headers: { "Content-Type": "text/xml" },
            });
          }
        }

        if (isTwilioVoice) {
          try {
            const body = await req.text();
            const params = new URLSearchParams(body);
            const callSid = params.get("CallSid") || "";
            const callStatus = params.get("CallStatus") || "";
            const speechResult = params.get("SpeechResult") || "";
            console.log(`[serve] voice webhook callSid=${callSid} status=${callStatus} hasSpeech=${!!speechResult}`);

            // Resolve workspace by phone number (To field in Twilio webhook)
            const toNumber = params.get("To") || "";
            let workspaceId = DEMO_WORKSPACE;
            let receptionistConfig: ReceptionistConfig | undefined;
            let workspaceTimezone = "UTC";

            try {
              // First, try to find workspace by twilioPhone matching the called number
              if (toNumber) {
                const wsByPhone = await db.query.workspaces.findFirst({
                  where: eq(workspaces.twilioPhone, toNumber),
                  columns: { id: true, receptionistConfig: true, twilioTransferNumber: true, timezone: true },
                });
                if (wsByPhone) {
                  workspaceId = wsByPhone.id;
                  workspaceTimezone = wsByPhone.timezone || "UTC";
                  const cfg = (wsByPhone.receptionistConfig as ReceptionistConfig) || undefined;
                  receptionistConfig = cfg ? { ...cfg, transferNumber: wsByPhone.twilioTransferNumber || undefined } : { transferNumber: wsByPhone.twilioTransferNumber || undefined };
                  console.log(`[serve] voice ws resolved by phone: To=${toNumber} → ws=${workspaceId} tz=${workspaceTimezone}`);
                }
              }

              // Fall back to DEMO_WORKSPACE if no phone match
              if (!receptionistConfig) {
                const ws = await db.query.workspaces.findFirst({
                  where: eq(workspaces.id, workspaceId),
                  columns: { receptionistConfig: true, twilioTransferNumber: true, timezone: true },
                });
                workspaceTimezone = ws?.timezone || "UTC";
                const cfg = (ws?.receptionistConfig as ReceptionistConfig) || undefined;
                receptionistConfig = cfg ? { ...cfg, transferNumber: ws?.twilioTransferNumber || undefined } : { transferNumber: ws?.twilioTransferNumber || undefined };
                console.warn(`[serve] voice ws fallback (no twilioPhone match): To=${toNumber || "(empty)"} → ws=${workspaceId} tz=${workspaceTimezone}`);
              }
            } catch (e) {
              console.error("Failed to load receptionist config:", e);
            }

            // Fire incoming_call automation trigger (non-blocking)
            if (workspaceId && workspaceId !== DEMO_WORKSPACE) {
              const { fireAutomationTrigger } = await import("./src/lib/automation-trigger");
              fireAutomationTrigger(workspaceId, "incoming_call", {
                callSid: params.get("CallSid") || "",
                from: params.get("From") || "",
                callStatus: params.get("CallStatus") || "",
              }).catch((err) => console.error("incoming_call trigger failed:", err));
            }
            // Log the call lifecycle event (non-blocking upsert — never adds
            // latency to the voice path; a ringing-then-hangup call still gets
            // a row). A terminal CallStatus finalizes the row (status
            // completed + endedAt/durationSec, preserving any richer outcome
            // like appointment_booked). Outcome updates happen inside
            // twilio-handler.
            const callStatusForLifecycle = params.get("CallStatus") || "";
            const TERMINAL = ["completed", "canceled", "failed", "busy", "no-answer"];
            console.log(`[serve] voice call-log ${TERMINAL.includes(callStatusForLifecycle) ? "finalize" : "upsert"} callSid=${callSid} ws=${workspaceId}`);
            const lifecycle = TERMINAL.includes(callStatusForLifecycle)
              ? finalizeCallRow(workspaceId, params.get("CallSid") || "")
              : upsertCallRow({
                  workspaceId,
                  callSid: params.get("CallSid") || "",
                  callerNumber: params.get("From") || "",
                  toNumber: params.get("To") || "",
                  status: callStatusForLifecycle,
                });
            lifecycle.catch((err) => console.warn("[serve] call log upsert failed (non-fatal):", err));

            // Use the public-facing URL, not the internal reverse-proxy hostname
            const baseUrl = "https://flowpilotai.ctonew.app";
            return handleTwilioVoice(params, baseUrl, receptionistConfig, workspaceId, workspaceTimezone);
          } catch (err) {
            console.error("Twilio voice error:", err);
            return new Response(
              '<?xml version="1.0" encoding="UTF-8"?><Response><Say>Sorry, we are experiencing technical difficulties. Please try again later.</Say><Hangup/></Response>',
              { headers: { "Content-Type": "text/xml" } }
            );
          }
        }

        // Twilio TTS audio — serve cached mp3 (both URL patterns)
        const audioMatch =
          pathname.match(/^\/api\/(?:twilio\/audio|audio\/twilio)\/(.+)$/);
        if (audioMatch && audioMatch[1] && req.method === "GET") {
          return handleTwilioAudio(audioMatch[1]);
        }

        // API routes — handle all /api/* requests
        if (pathname.startsWith("/api/")) {
          const apiResponse = await handleApiRequest(pathname, req.method, req);
          if (apiResponse) return apiResponse;
        }

        // Static files
        if (pathname !== "/") {
          const file = Bun.file(CLIENT_DIR + pathname);
          if (await file.exists()) return new Response(file);
        }

        // Fall through to TanStack handler
        return (
          handler as { fetch: (r: Request) => Response | Promise<Response> }
        ).fetch(req);
      },
    });
    break;
  } catch (err) {
    if (attempt >= 10) throw err;
    await Bun.sleep(200);
  }
}

console.log(`team-site serving on http://${HOST}:${String(PORT)}`);
