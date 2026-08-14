import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, type FormEvent } from "react";

export const Route = createFileRoute("/dashboard/settings")({
  component: Settings,
});

// ── Toast ──────────────────────────────────────────────────────────────────

function Toast({ type, message, onClose }: { type: "success" | "error"; message: string; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 4000);
    return () => clearTimeout(t);
  }, [onClose]);

  return (
    <div className={`fixed top-6 right-6 z-50 flex items-center gap-3 rounded-xl border px-4 py-3 shadow-lg animate-[slideIn_0.3s_ease-out] ${
      type === "success"
        ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
        : "border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/60 dark:text-red-300"
    }`}>
      <span>{type === "success" ? "✅" : "❌"}</span>
      <span className="text-sm font-medium">{message}</span>
      <button onClick={onClose} className="ml-2 text-current/50 hover:text-current cursor-pointer">&times;</button>
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────

function PhoneCard() {
  const [twilioPhone, setTwilioPhone] = useState<string | null>(null);
  const [twilioSid, setTwilioSid] = useState<string | null>(null);
  const [transferNumber, setTransferNumber] = useState("");
  const [phoneMode, setPhoneMode] = useState("none");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [provisionMsg, setProvisionMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [copied, setCopied] = useState(false);

  // Load phone config
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/workspace/phone-config");
        if (res.ok) {
          const data = await res.json();
          setTwilioPhone(data.twilio_phone || null);
          setTwilioSid(data.twilio_sid || null);
          setTransferNumber(data.transfer_number || "");
          setPhoneMode(data.phone_mode || "none");
        }
      } catch { /* ignore */ }
      setLoading(false);
    })();
  }, []);

  const copyNumber = () => {
    if (!twilioPhone) return;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(twilioPhone).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }).catch(() => {});
    }
  };

  const handleTransferSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/workspace/phone-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transfer_number: transferNumber || null,
          phone_mode: phoneMode,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setTwilioPhone(data.twilio_phone);
        setPhoneMode(data.phone_mode);
      }
    } catch { /* ignore */ }
    setSaving(false);
  };

  const handleProvision = async () => {
    setProvisioning(true);
    setProvisionMsg(null);
    try {
      const res = await fetch("/api/workspace/phone-config/provision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (data.success && data.twilio_phone) {
        setTwilioPhone(data.twilio_phone);
        setTwilioSid(data.twilio_sid || null);
        setPhoneMode("provisioned");
        setProvisionMsg({ type: "success", text: `Number ready: ${data.twilio_phone}. Calls to this number now route to your workspace.` });
      } else if (data.configured === false) {
        // Never surface the raw API message (it mentions internal Twilio setup)
        setProvisionMsg({ type: "error", text: "We'll assign your number automatically — check back shortly, or use the forwarding option." });
      } else {
        setProvisionMsg({ type: "error", text: data.message || "We couldn't set up your number right now. Please try again." });
      }
    } catch {
      setProvisionMsg({ type: "error", text: "We couldn't reach the number service. Please try again in a moment." });
    }
    setProvisioning(false);
  };

  const handleModeChange = (mode: string) => {
    setPhoneMode(mode);
    // Auto-save mode change
    fetch("/api/workspace/phone-config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone_mode: mode }),
    }).catch(() => {});
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-800">
          <h2 className="text-sm font-bold text-gray-700 dark:text-gray-300">📞 AI Receptionist Phone</h2>
        </div>
        <div className="px-5 py-8 space-y-5">
          {[1, 2, 3].map(i => (
            <div key={i} className="space-y-2">
              <div className="animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700 h-4 w-20" />
              <div className="animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700 h-10 w-full" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-800">
        <h2 className="text-sm font-bold text-gray-700 dark:text-gray-300">📞 AI Receptionist Phone</h2>
        <p className="text-xs text-gray-400 mt-0.5">Your AI answers calls on this number and logs every call to your dashboard.</p>
      </div>

      <div className="px-5 py-6 space-y-5">
        {/* Current AI Number */}
        <div>
          {twilioPhone ? (
            <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 p-4">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <p className="text-xs font-semibold text-emerald-800 dark:text-emerald-300 uppercase tracking-wide">Your AI Phone Number</p>
                <span className="inline-block rounded-full bg-white dark:bg-gray-900 border border-emerald-200 dark:border-emerald-800 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300 uppercase shrink-0">
                  {phoneMode === "provisioned" ? "Dedicated FlowPilot number" : phoneMode === "forward" ? "Forwarded from your number" : "AI receptionist"}
                </span>
              </div>
              <div className="flex items-center gap-2 mt-2">
                <code className="text-xl font-mono font-bold text-emerald-700 dark:text-emerald-300">{twilioPhone}</code>
                <button
                  onClick={copyNumber}
                  className="shrink-0 rounded-lg border border-emerald-300 dark:border-emerald-700 px-3 py-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition-colors cursor-pointer"
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
              <p className="text-xs text-emerald-700 dark:text-emerald-400 mt-2 flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Connected to this workspace — calls to this number route to your AI receptionist.
                {twilioSid && <span className="text-emerald-600 dark:text-emerald-500">Managed by FlowPilot.</span>}
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 p-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Your AI Phone Number</label>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">No number assigned yet. Get a dedicated number and your AI receptionist starts taking calls.</p>
              <button
                onClick={handleProvision}
                disabled={provisioning}
                className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 transition-colors disabled:opacity-50 cursor-pointer shadow-sm shadow-indigo-500/25"
              >
                {provisioning ? (
                  <><span className="animate-spin">⏳</span> Connecting your number…</>
                ) : (
                  <>📱 Get my number</>
                )}
              </button>
              {provisionMsg && (
                <p className={`text-xs mt-2 ${provisionMsg.type === "success" ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
                  {provisionMsg.type === "success" ? "✅ " : "⚠️ "}{provisionMsg.text}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Connection Mode */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">How do you want to connect?</label>
          <div className="space-y-3">
            <label className={`flex items-start gap-3 rounded-lg border p-4 cursor-pointer transition-colors ${
              phoneMode === "forward"
                ? "border-indigo-300 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-950/30"
                : "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
            }`}>
              <input
                type="radio"
                name="phoneMode"
                value="forward"
                checked={phoneMode === "forward"}
                onChange={() => handleModeChange("forward")}
                className="mt-0.5 accent-indigo-600"
              />
              <div className="min-w-0">
                <span className="text-sm font-medium text-gray-800 dark:text-gray-200">Use my existing number</span>
                <p className="text-xs text-gray-400 mt-0.5">Your customers still call YOUR number — the AI answers as your company.</p>
                {phoneMode === "forward" && twilioPhone && (
                  <div className="mt-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-3">
                    <p className="text-xs font-semibold text-amber-800 dark:text-amber-300 mb-2">📋 Forwarding Instructions</p>
                    <ol className="text-xs text-amber-700 dark:text-amber-400 space-y-1.5 list-decimal list-inside">
                      <li>Call your phone provider or log into your account.</li>
                      <li>Set <strong>unconditional call forwarding</strong> to <code className="bg-amber-100 dark:bg-amber-900/50 px-1 rounded font-mono">{twilioPhone}</code>.</li>
                      <li>Test by calling your old number — the AI should answer.</li>
                    </ol>
                  </div>
                )}
                {phoneMode === "forward" && !twilioPhone && (
                  <p className="text-xs text-gray-400 mt-2">Get your FlowPilot number above, then forward calls to it from your phone provider.</p>
                )}
              </div>
            </label>

            <label className={`flex items-start gap-3 rounded-lg border p-4 cursor-pointer transition-colors ${
              phoneMode === "provisioned"
                ? "border-indigo-300 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-950/30"
                : "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
            }`}>
              <input
                type="radio"
                name="phoneMode"
                value="provisioned"
                checked={phoneMode === "provisioned"}
                onChange={() => handleModeChange("provisioned")}
                className="mt-0.5 accent-indigo-600"
              />
              <div className="min-w-0">
                <span className="text-sm font-medium text-gray-800 dark:text-gray-200">Get a new number</span>
                <p className="text-xs text-gray-400 mt-0.5">A dedicated number FlowPilot sets up for your business.</p>
                {phoneMode === "provisioned" && !twilioPhone && (
                  <p className="text-xs text-gray-400 mt-2">Click "Get my number" above — we'll assign your dedicated line right away.</p>
                )}
                {phoneMode === "provisioned" && twilioPhone && (
                  <p className="text-xs text-gray-400 mt-2">This dedicated number is ready — publish it on your website and Google listing.</p>
                )}
              </div>
            </label>
          </div>
        </div>

        {/* Transfer Number */}
        <div className="pt-2 border-t border-gray-100 dark:border-gray-800">
          <label htmlFor="transferNumber" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
            Transfer calls to
          </label>
          <div className="flex items-center gap-3">
            <input
              id="transferNumber"
              type="tel"
              value={transferNumber}
              onChange={e => setTransferNumber(e.target.value)}
              placeholder="+15551234567"
              className="flex-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-shadow"
            />
            <button
              onClick={handleTransferSave}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 transition-colors disabled:opacity-50 cursor-pointer shrink-0"
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-1">When a caller asks to speak to a person, the AI will dial this number.</p>
        </div>
      </div>
    </div>
  );
}

const RECEPTIONIST_BUSINESS_TYPES = [
  "Plumbing", "HVAC", "Roofing", "Real Estate", "Legal", "Medical", "Marketing", "Retail", "Other",
] as const;

// ── AI Receptionist persona ────────────────────────────────────────────────

function ReceptionistCard() {
  const [businessName, setBusinessName] = useState("");
  const [businessType, setBusinessType] = useState("");
  const [businessHours, setBusinessHours] = useState("");
  const [description, setDescription] = useState("");
  const [customInstructions, setCustomInstructions] = useState("");
  const [requireAddress, setRequireAddress] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // Load current receptionist config
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/workspace/receptionist-config");
        if (res.ok) {
          const data = await res.json();
          const cfg = data.config || {};
          setBusinessName(cfg.businessName || "");
          setBusinessType(cfg.businessType || "");
          setBusinessHours(cfg.businessHours || "");
          setDescription(cfg.description || "");
          setCustomInstructions(cfg.customInstructions || "");
          setRequireAddress(!!cfg.requireAddress);
        }
      } catch { /* ignore */ }
      setLoading(false);
    })();
  }, []);

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!businessName.trim()) {
      setToast({ type: "error", message: "Please enter your business name." });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/workspace/receptionist-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessName: businessName.trim(),
          businessType: businessType.trim(),
          businessHours: businessHours.trim(),
          description: description.trim(),
          customInstructions: customInstructions.trim(),
          requireAddress,
        }),
      });
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      setToast({ type: "success", message: "Receptionist settings saved successfully." });
    } catch {
      setToast({ type: "error", message: "Failed to save receptionist settings. Please try again." });
    } finally {
      setSaving(false);
    }
  };

  const inputClasses =
    "w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-shadow";

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-800">
        <h2 className="text-sm font-bold text-gray-700 dark:text-gray-300">🧠 AI Receptionist</h2>
        <p className="text-xs text-gray-400 mt-0.5">The persona, knowledge, and calling rules Nova uses when answering your business line.</p>
      </div>

      {toast && <Toast {...toast} onClose={() => setToast(null)} />}

      {loading ? (
        <div className="px-5 py-8 space-y-5">
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="space-y-2">
              <div className="animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700 h-4 w-20" />
              <div className="animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700 h-10 w-full" />
            </div>
          ))}
        </div>
      ) : (
        <form onSubmit={handleSave} className="px-5 py-6 space-y-5">
          <div>
            <label htmlFor="rcBusinessName" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              Business name *
            </label>
            <input
              id="rcBusinessName"
              type="text"
              value={businessName}
              onChange={e => setBusinessName(e.target.value)}
              placeholder="e.g. Acme Roofing & Repairs"
              className={inputClasses}
            />
          </div>

          <div>
            <label htmlFor="rcBusinessType" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              Business type
            </label>
            <select
              id="rcBusinessType"
              value={businessType}
              onChange={e => setBusinessType(e.target.value)}
              className={inputClasses}
            >
              <option value="">Select a category</option>
              {RECEPTIONIST_BUSINESS_TYPES.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="rcBusinessHours" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              Business hours
            </label>
            <input
              id="rcBusinessHours"
              type="text"
              value={businessHours}
              onChange={e => setBusinessHours(e.target.value)}
              placeholder="e.g. Mon-Fri 9am-5pm"
              className={inputClasses}
            />
            <p className="text-xs text-gray-400 mt-1">Describes when you're open. Nova uses this plus your timezone to only offer bookable slots.</p>
          </div>

          <div>
            <label htmlFor="rcDescription" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              About the business
            </label>
            <textarea
              id="rcDescription"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Brief description of your services..."
              rows={2}
              className={inputClasses}
            />
          </div>

          <div>
            <label htmlFor="rcCustomInstructions" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              Custom instructions
            </label>
            <textarea
              id="rcCustomInstructions"
              value={customInstructions}
              onChange={e => setCustomInstructions(e.target.value)}
              placeholder="Anything special the AI receptionist should know about your business..."
              rows={2}
              className={inputClasses}
            />
          </div>

          {/* Require address toggle */}
          <div className="flex items-start justify-between gap-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 px-4 py-3">
            <div className="min-w-0">
              <label htmlFor="rcRequireAddress" className="text-sm font-medium text-gray-800 dark:text-gray-200 cursor-pointer">
                Ask for a service address when booking appointments
              </label>
              <p className="text-xs text-gray-400 mt-0.5">When enabled, Nova captures the caller's service address before confirming a booking.</p>
            </div>
            <button
              id="rcRequireAddress"
              type="button"
              role="switch"
              aria-checked={requireAddress}
              onClick={() => setRequireAddress(v => !v)}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors cursor-pointer ${
                requireAddress ? "bg-indigo-600" : "bg-gray-300 dark:bg-gray-600"
              }`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                requireAddress ? "translate-x-6" : "translate-x-1"
              }`} />
            </button>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 transition-colors disabled:opacity-50 cursor-pointer"
            >
              {saving ? (
                <>
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Saving...
                </>
              ) : (
                "Save Receptionist Settings"
              )}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function Settings() {
  const [fromName, setFromName] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [replyTo, setReplyTo] = useState("");
  const [paymentLink, setPaymentLink] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // Domain verification state
  const [domain, setDomain] = useState("");
  const [domainSubdomain, setDomainSubdomain] = useState("mail");
  const [domainVerified, setDomainVerified] = useState(false);
  const [domainStatus, setDomainStatus] = useState<"none" | "pending" | "verified">("none");
  const [dnsRecords, setDnsRecords] = useState<{ host: string; type: string; data: string; validated?: boolean }[]>([]);
  const [domainLoading, setDomainLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  // Load current config
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/workspace/email-config");
        if (res.ok) {
          const data = await res.json();
          // Support both camelCase (from our API) and snake_case (legacy/proxy)
          setFromName(data.from_name || data.config?.fromName || data.fromName || "");
          setFromEmail(data.from_email || data.config?.fromEmail || data.fromEmail || "");
          setReplyTo(data.reply_to || data.config?.replyTo || data.replyTo || "");
          setPaymentLink(data.payment_link || data.config?.paymentLink || data.paymentLink || "");
        }
      } catch (e) {
        console.error("Failed to load email config:", e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Auto-check domain verification status on load
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/workspace/verify-domain");
        if (res.ok) {
          const data = await res.json();
          if (data.domain) {
            setDomain(data.domain);
            setDomainSubdomain(data.subdomain || "mail");
            setDomainVerified(data.verified || false);
            setDomainStatus(data.verified ? "verified" : "pending");
            setDnsRecords(data.dns_records || []);
          }
        } else if (res.status === 404) {
          // No verification started yet — normal
          setDomainStatus("none");
        }
      } catch (e) {
        console.error("Failed to load domain status:", e);
      } finally {
        setDomainLoading(false);
      }
    })();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/workspace/email-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from_name: fromName, from_email: fromEmail, reply_to: replyTo, payment_link: paymentLink }),
      });
      if (res.ok) {
        setToast({ type: "success", message: "Email configuration saved successfully." });
      } else {
        const err = await res.json();
        setToast({ type: "error", message: err.error || "Failed to save configuration." });
      }
    } catch {
      setToast({ type: "error", message: "Network error. Please try again." });
    } finally {
      setSaving(false);
    }
  };

  const handleTestEmail = async () => {
    if (!fromEmail) {
      setToast({ type: "error", message: "Please set a From Email address first." });
      return;
    }
    setTesting(true);
    try {
      const res = await fetch("/api/ai/send-reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lead_email: fromEmail,
          subject: "FlowPilot AI — Test Email",
          reply_text: `Hi there from FlowPilot AI! 👋\n\nThis is a test email from your configured sending identity:\n\nFrom Name: ${fromName || "(not set)"}\nFrom Email: ${fromEmail}\nReply-To: ${replyTo || "(not set)"}\n\nIf you received this, your email configuration is working correctly.`,
        }),
      });
      if (res.ok) {
        setToast({ type: "success", message: `Test email sent to ${fromEmail}` });
      } else {
        const err = await res.json();
        setToast({ type: "error", message: err.error || "Failed to send test email." });
      }
    } catch {
      setToast({ type: "error", message: "Network error. Please try again." });
    } finally {
      setTesting(false);
    }
  };

  const handleVerifyDomain = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!domain || !domain.includes(".")) {
      setToast({ type: "error", message: "Please enter a valid domain (e.g. example.com)." });
      return;
    }
    setVerifying(true);
    try {
      const res = await fetch("/api/workspace/verify-domain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain, subdomain: domainSubdomain }),
      });
      const data = await res.json();
      if (res.ok) {
        setDomain(data.domain);
        setDomainSubdomain(data.subdomain || "mail");
        setDomainVerified(data.verified || false);
        setDomainStatus(data.verified ? "verified" : "pending");
        setDnsRecords(data.dns_records || []);
        setToast({ type: "success", message: "DNS records generated. Add them to your domain provider." });
      } else {
        setToast({ type: "error", message: data.error || "Failed to start verification." });
      }
    } catch {
      setToast({ type: "error", message: "Network error. Please try again." });
    } finally {
      setVerifying(false);
    }
  };

  const copyDnsValue = (value: string, index: number) => {
    navigator.clipboard.writeText(value);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  return (
    <div className="bg-gray-50 dark:bg-gray-950 min-h-full">
      {/* Toast */}
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}

      <main className="mx-auto max-w-3xl px-4 sm:px-6 py-8 space-y-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">⚙️ Settings</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">Configure your workspace email identity, sending preferences, and domain verification.</p>
        </div>

        {/* Email Configuration */}
        <section>
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-800">
              <h2 className="text-sm font-bold text-gray-700 dark:text-gray-300">📧 Email Configuration</h2>
              <p className="text-xs text-gray-400 mt-0.5">Set the sender identity for all outgoing emails from your workspace.</p>
            </div>

            {loading ? (
              <div className="px-5 py-8 space-y-5">
                {[1, 2, 3].map(i => (
                  <div key={i} className="space-y-2">
                    <div className="animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700 h-4 w-20" />
                    <div className="animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700 h-10 w-full" />
                  </div>
                ))}
              </div>
            ) : (
              <form onSubmit={handleSave} className="px-5 py-6 space-y-5">
                <div>
                  <label htmlFor="fromName" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                    From Name
                  </label>
                  <input
                    id="fromName"
                    type="text"
                    value={fromName}
                    onChange={e => setFromName(e.target.value)}
                    placeholder="FlowPilot AI"
                    className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-shadow"
                  />
                  <p className="text-xs text-gray-400 mt-1">The display name recipients will see in their inbox.</p>
                </div>

                <div>
                  <label htmlFor="fromEmail" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                    From Email
                  </label>
                  <input
                    id="fromEmail"
                    type="email"
                    value={fromEmail}
                    onChange={e => setFromEmail(e.target.value)}
                    placeholder="flowpilot@yourdomain.com"
                    className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-shadow"
                  />
                  <p className="text-xs text-gray-400 mt-1">Must be a verified sending address in your email provider.</p>
                </div>

                <div>
                  <label htmlFor="replyTo" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                    Reply-To Email
                  </label>
                  <input
                    id="replyTo"
                    type="email"
                    value={replyTo}
                    onChange={e => setReplyTo(e.target.value)}
                    placeholder="replies@yourdomain.com"
                    className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-shadow"
                  />
                  <p className="text-xs text-gray-400 mt-1">Where replies to your emails will be directed.</p>
                </div>

                <div>
                  <label htmlFor="paymentLink" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                    Default Payment Link
                  </label>
                  <input
                    id="paymentLink"
                    type="url"
                    value={paymentLink}
                    onChange={e => setPaymentLink(e.target.value)}
                    placeholder="https://buy.stripe.com/xxx or https://paypal.me/yourname/50"
                    className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-shadow"
                  />
                  <p className="text-xs text-gray-400 mt-1">Paste your Stripe Payment Link, PayPal.Me, or Venmo link — invoices will include a "Pay Now" button by default. FlowPilot never touches money; this is purely a delivery link.</p>
                </div>

                <div className="flex items-center gap-3 pt-2">
                  <button
                    type="submit"
                    disabled={saving}
                    className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    {saving ? (
                      <>
                        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Saving...
                      </>
                    ) : (
                      "Save Configuration"
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={handleTestEmail}
                    disabled={testing}
                    className="inline-flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 px-5 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    {testing ? (
                      <>
                        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Sending...
                      </>
                    ) : (
                      <>
                        ✉️ Send Test Email
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}
          </div>
        </section>

        {/* Current Identity Preview */}
        {!loading && (
          <section>
            <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-800">
                <h2 className="text-sm font-bold text-gray-700 dark:text-gray-300">👁️ Identity Preview</h2>
                <p className="text-xs text-gray-400 mt-0.5">How your email identity will appear to recipients.</p>
              </div>
              <div className="px-5 py-4 space-y-3">
                <div className="flex items-center gap-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-800/50">
                  <div className="w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-900 flex items-center justify-center text-sm font-bold text-indigo-600 dark:text-indigo-400">
                    {fromName ? fromName.charAt(0).toUpperCase() : "F"}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      {fromName || "FlowPilot AI"}
                    </p>
                    <p className="text-xs text-gray-400">
                      {fromEmail || "flowpilot@example.com"}
                    </p>
                  </div>
                </div>
                <div className="text-xs text-gray-400 space-y-1">
                  <div className="flex justify-between">
                    <span>Reply-To:</span>
                    <span className="font-mono">{replyTo || fromEmail || "(not set)"}</span>
                  </div>
                  {paymentLink && (
                    <div className="flex justify-between gap-4">
                      <span>Payment Link:</span>
                      <span className="font-mono truncate text-indigo-500">{paymentLink}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>
        )}
        {/* AI Receptionist Phone */}
        <section>
        <PhoneCard />
        </section>

        {/* AI Receptionist Persona */}
        <section>
          <ReceptionistCard />
        </section>

        {/* Domain Verification */}
        <section>
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-800">
              <h2 className="text-sm font-bold text-gray-700 dark:text-gray-300">🌐 Domain Verification</h2>
              <p className="text-xs text-gray-400 mt-0.5">Verify your business domain to improve email deliverability and brand trust.</p>
            </div>

            {domainLoading ? (
              <div className="px-5 py-8 space-y-4">
                <div className="animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700 h-4 w-24" />
                <div className="animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700 h-10 w-full" />
              </div>
            ) : domainStatus === "none" ? (
              <form onSubmit={handleVerifyDomain} className="px-5 py-6 space-y-4">
                <div>
                  <label htmlFor="domain" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                    Business Domain
                  </label>
                  <input
                    id="domain"
                    type="text"
                    value={domain}
                    onChange={e => setDomain(e.target.value)}
                    placeholder="example.com"
                    className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-shadow"
                  />
                  <p className="text-xs text-gray-400 mt-1">Enter your business domain to generate DNS verification records.</p>
                </div>
                <button
                  type="submit"
                  disabled={verifying}
                  className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {verifying ? (
                    <>
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Generating Records...
                    </>
                  ) : (
                    "🔍 Verify Domain"
                  )}
                </button>
              </form>
            ) : (
              <div className="px-5 py-6 space-y-4">
                {/* Status Banner */}
                <div className={`rounded-lg border p-4 flex items-start gap-3 ${
                  domainStatus === "verified"
                    ? "border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/60"
                    : "border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/60"
                }`}>
                  <span className="text-xl">
                    {domainStatus === "verified" ? "✅" : "⏳"}
                  </span>
                  <div className="min-w-0">
                    <p className={`text-sm font-semibold ${
                      domainStatus === "verified"
                        ? "text-emerald-800 dark:text-emerald-300"
                        : "text-amber-800 dark:text-amber-300"
                    }`}>
                      {domainStatus === "verified" ? "Domain Verified" : "Verification Pending"}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      {domainStatus === "verified"
                        ? `${domain} is verified and authenticated.`
                        : `DNS records for ${domain} (subdomain: ${domainSubdomain}) have been generated. Add them to your DNS provider and check back.`}
                    </p>
                  </div>
                </div>

                {/* DNS Records */}
                {dnsRecords.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                      DNS Records to Add
                    </h3>
                    <div className="space-y-3">
                      {dnsRecords.map((rec, i) => (
                        <div key={i} className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 p-4 hover:border-indigo-200 dark:hover:border-indigo-700 transition-colors">
                          <div className="flex items-start justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <span className="inline-flex items-center justify-center rounded-md bg-indigo-100 dark:bg-indigo-900/50 px-2 py-0.5 text-xs font-mono font-bold text-indigo-700 dark:text-indigo-300">
                                {rec.type}
                              </span>
                              <span className="text-xs font-mono text-gray-500 dark:text-gray-400">
                                {rec.host}
                              </span>
                              {rec.validated !== undefined && (
                                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                                  rec.validated
                                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300"
                                    : "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300"
                                }`}>
                                  {rec.validated ? "✅ Valid" : "⏳ Pending"}
                                </span>
                              )}
                            </div>
                            <button
                              onClick={() => copyDnsValue(rec.data, i)}
                              className="inline-flex items-center gap-1 rounded-md border border-gray-200 dark:border-gray-600 px-2.5 py-1 text-xs font-medium text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-white dark:hover:bg-gray-700 transition-colors cursor-pointer shrink-0"
                            >
                              {copiedIndex === i ? (
                                <>✅ Copied</>
                              ) : (
                                <>📋 Copy</>
                              )}
                            </button>
                          </div>
                          <div className="rounded-md bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 px-3 py-2">
                            <code className="text-xs text-gray-700 dark:text-gray-300 break-all font-mono">{rec.data}</code>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Re-verify button */}
                <form onSubmit={handleVerifyDomain} className="flex items-center gap-3 pt-2 border-t border-gray-100 dark:border-gray-800">
                  <input
                    type="text"
                    value={domain}
                    onChange={e => setDomain(e.target.value)}
                    placeholder="Enter a different domain..."
                    className="flex-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-shadow"
                  />
                  <button
                    type="submit"
                    disabled={verifying}
                    className="inline-flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50 cursor-pointer shrink-0"
                  >
                    {verifying ? "Generating..." : "🔄 Re-verify"}
                  </button>
                </form>
              </div>
            )}
          </div>
        </section>

      </main>
    </div>
  );
}
