import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useCallback, useEffect } from "react";

export const Route = createFileRoute("/client/deck")({
  component: ClientDeck,
});

// ─── Slide Props ─────────────────────────────────────────────────────

interface SlideContentProps {
  workspaceId: string;
  onAdvance: () => void;
}

// ─── Helper ──────────────────────────────────────────────────────────

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

// ─── Slide 1: Welcome ────────────────────────────────────────────────

function SlideWelcome(_props: SlideContentProps) {
  return (
    <ul className="space-y-3 text-left">
      {[
        "Respond to leads and customer emails 24/7",
        "Schedule appointments and manage your calendar",
        "Generate invoices and track payments automatically",
        "No coding, no hiring — set up in under 10 minutes",
      ].map((item, i) => (
        <li key={i} className="flex items-start gap-3 text-base text-gray-600 dark:text-gray-300">
          <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-indigo-500" />
          {item}
        </li>
      ))}
    </ul>
  );
}

// ─── Slide 2: Business Profile ───────────────────────────────────────

const BUSINESS_TYPES = [
  "Plumbing",
  "HVAC",
  "Roofing",
  "Real Estate",
  "Legal",
  "Medical",
  "Marketing",
  "Retail",
  "Other",
] as const;

interface BusinessForm {
  businessName: string;
  businessType: string;
  businessTypeOther: string;
  businessHours: string;
  about: string;
  customInstructions: string;
}

function SlideBusinessProfile({ workspaceId, onAdvance }: SlideContentProps) {
  const [form, setForm] = useState<BusinessForm>({
    businessName: "",
    businessType: "",
    businessTypeOther: "",
    businessHours: "",
    about: "",
    customInstructions: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const update = (field: keyof BusinessForm, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (error) setError("");
  };

  const handleSave = async () => {
    if (!form.businessName.trim()) {
      setError("Please enter your business name.");
      return;
    }

    setSaving(true);
    setError("");

    try {
      const businessType =
        form.businessType === "Other" && form.businessTypeOther.trim()
          ? form.businessTypeOther.trim()
          : form.businessType;

      const resp = await fetch("/api/workspace/receptionist-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          businessName: form.businessName.trim(),
          businessType,
          businessHours: form.businessHours.trim(),
          description: form.about.trim(),
          customInstructions: form.customInstructions.trim(),
        }),
      });

      if (!resp.ok) {
        throw new Error(`Server error: ${resp.status}`);
      }

      onAdvance();
    } catch (err) {
      try {
        localStorage.setItem("fp_business_profile", JSON.stringify(form));
      } catch {}
      onAdvance();
    } finally {
      setSaving(false);
    }
  };

  const inputClasses =
    "w-full rounded-lg border border-gray-200 dark:border-gray-700 px-3.5 py-2.5 text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 transition-colors";
  const labelClasses = "block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5";
  const errorClasses = "text-xs text-red-500 mt-1";

  return (
    <div className="space-y-4 text-left">
      <div>
        <label className={labelClasses}>Business name *</label>
        <input
          type="text"
          value={form.businessName}
          onChange={(e) => update("businessName", e.target.value)}
          placeholder="e.g. Acme Roofing & Repairs"
          className={inputClasses}
        />
      </div>

      <div>
        <label className={labelClasses}>Business type</label>
        <select
          value={form.businessType}
          onChange={(e) => update("businessType", e.target.value)}
          className={inputClasses}
        >
          <option value="">Select a category</option>
          {BUSINESS_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        {form.businessType === "Other" && (
          <div className="mt-2">
            <input
              type="text"
              value={form.businessTypeOther}
              onChange={(e) => update("businessTypeOther", e.target.value)}
              placeholder="Describe your business type"
              className={inputClasses}
            />
          </div>
        )}
      </div>

      <div>
        <label className={labelClasses}>Business hours</label>
        <input
          type="text"
          value={form.businessHours}
          onChange={(e) => update("businessHours", e.target.value)}
          placeholder="e.g. Mon-Fri 9am-5pm"
          className={inputClasses}
        />
      </div>

      <div>
        <label className={labelClasses}>About the business</label>
        <textarea
          value={form.about}
          onChange={(e) => update("about", e.target.value)}
          placeholder="Brief description of your services..."
          rows={2}
          className={inputClasses}
        />
      </div>

      <div>
        <label className={labelClasses}>Custom instructions</label>
        <textarea
          value={form.customInstructions}
          onChange={(e) => update("customInstructions", e.target.value)}
          placeholder="Anything special the AI receptionist should know about your business..."
          rows={2}
          className={inputClasses}
        />
      </div>

      {error && <p className={errorClasses}>{error}</p>}

      <div className="space-y-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 transition-colors cursor-pointer shadow-sm shadow-indigo-500/25 disabled:opacity-50 w-full justify-center"
        >
          {saving ? (
            <><span className="animate-spin">⏳</span> Saving...</>
          ) : (
            <>Save & Continue<span>→</span></>
          )}
        </button>
        <button
          onClick={onAdvance}
          className="w-full text-xs text-gray-400 hover:text-gray-500 dark:hover:text-gray-300 transition-colors cursor-pointer py-1"
        >
          Skip for now — you can set this up later
        </button>
      </div>

      <p className="text-xs text-gray-400 text-center">
        You can change these anytime in Settings.
      </p>
    </div>
  );
}

// ─── Slide 3: Email Picker ───────────────────────────────────────────

function SlideEmailPicker({ workspaceId, onAdvance }: SlideContentProps) {
  // Derive suggested prefix from workspace or localStorage business name
  const suggestedPrefix = (() => {
    try {
      const saved = localStorage.getItem("fp_business_profile");
      if (saved) {
        const data = JSON.parse(saved);
        if (data.businessName) return slugify(data.businessName);
      }
    } catch {}
    return slugify(workspaceId.replace("ws_", "team-"));
  })();

  const [emailPrefix, setEmailPrefix] = useState(suggestedPrefix);
  const [fromName, setFromName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const domain = "klerkitai.com";
  const fullEmail = `${emailPrefix || "your-name"}@${domain}`;

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    let failed = false;
    try {
      const resp = await fetch("/api/workspace/email-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from_email: fullEmail,
          from_name: fromName.trim() || emailPrefix,
        }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || `Server error: ${resp.status}`);
      }
    } catch (err) {
      failed = true;
      // Keep the input in localStorage so it isn't lost, but tell the user
      // the save failed instead of silently advancing.
      try {
        localStorage.setItem("fp_email_config", JSON.stringify({ from_email: fullEmail, from_name: fromName }));
      } catch {}
      setSaveError(`Couldn't save this email yet: ${err instanceof Error ? err.message : "network error"}. You can retry, or set it up later in Admin Settings.`);
    } finally {
      setSaving(false);
    }
    if (!failed) onAdvance();
  };

  const inputClasses =
    "w-full rounded-lg border border-gray-200 dark:border-gray-700 px-3.5 py-2.5 text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 transition-colors";
  const labelClasses = "block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5";

  return (
    <div className="space-y-5 text-left">
      {/* Email prefix */}
      <div>
        <label className={labelClasses}>Email address</label>
        <div className="flex items-center rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus-within:ring-2 focus-within:ring-indigo-500/20 focus-within:border-indigo-400 transition-colors overflow-hidden">
          <input
            type="text"
            value={emailPrefix}
            onChange={(e) => setEmailPrefix(e.target.value.replace(/\s+/g, "-").toLowerCase())}
            placeholder="your-name"
            className="flex-1 px-3.5 py-2.5 text-sm bg-transparent text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none"
          />
          <span className="shrink-0 px-3.5 py-2.5 text-sm text-gray-400 bg-gray-50 dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700">
            @{domain}
          </span>
        </div>
        <p className="text-xs text-gray-400 mt-1.5">
          This is your default sending address. You can verify your own domain later in Settings.
        </p>
      </div>

      {/* Live preview */}
      {emailPrefix && (
        <div className="rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50/50 dark:bg-indigo-950/20 p-4">
          <p className="text-xs font-medium text-indigo-600 dark:text-indigo-400 mb-1">
            Your AI emails will come from:
          </p>
          <p className="text-lg font-bold text-indigo-700 dark:text-indigo-300 font-mono">
            {fullEmail}
          </p>
        </div>
      )}

      {/* Display name */}
      <div>
        <label className={labelClasses}>Display name</label>
        <input
          type="text"
          value={fromName}
          onChange={(e) => setFromName(e.target.value)}
          placeholder="e.g. Sarah from Acme Roofing"
          className={inputClasses}
        />
        <p className="text-xs text-gray-400 mt-1.5">
          How your name appears in recipients&apos; inboxes.
        </p>
      </div>

      {/* Error */}
      {saveError && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/50 px-3.5 py-2.5 text-xs text-amber-800 dark:text-amber-300">
          ⚠️ {saveError}
        </div>
      )}

      {/* Buttons */}
      <div className="space-y-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 transition-colors cursor-pointer shadow-sm shadow-indigo-500/25 disabled:opacity-50 w-full justify-center"
        >
          {saving ? (
            <><span className="animate-spin">⏳</span> Saving...</>
          ) : (
            <>Save & Continue<span>→</span></>
          )}
        </button>
        <button
          onClick={onAdvance}
          className="w-full text-xs text-gray-400 hover:text-gray-500 dark:hover:text-gray-300 transition-colors cursor-pointer py-1"
        >
          Skip for now — you can set this up later
        </button>
      </div>
    </div>
  );
}

// ─── Slide 4: AI Receptionist Phone ────────────────────────────────

function SlidePhone({ onAdvance }: SlideContentProps) {
  const [phoneMode, setPhoneMode] = useState<string>(""); // "" | "forward" | "provisioned"
  const [twilioPhone, setTwilioPhone] = useState<string | null>(null);
  const [transferNumber, setTransferNumber] = useState("");
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false); // provision in-flight during Save
  const [provisionAttempted, setProvisionAttempted] = useState(false); // don't re-provision after a failure
  const [provisionNote, setProvisionNote] = useState<string | null>(null); // friendly failure/fallback note
  const [justProvisioned, setJustProvisioned] = useState(false); // show "number ready" confirmation
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  // Load saved phone config on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/workspace/phone-config");
        if (res.ok) {
          const data = await res.json();
          if (data.phone_mode === "forward" || data.phone_mode === "provisioned") {
            setPhoneMode(data.phone_mode);
          }
          setTwilioPhone(data.twilio_phone || null);
          setTransferNumber(data.transfer_number || "");
        }
      } catch {
        // Leave defaults — the client can still pick an option and retry on save
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const copyNumber = (num: string) => {
    const done = () => {
      setCopied(num);
      setTimeout(() => setCopied(null), 2000);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(num).then(done).catch(() => {});
    } else {
      const ta = document.createElement("textarea");
      ta.value = num;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); done(); } catch {}
      document.body.removeChild(ta);
    }
  };

  /**
   * Save & Continue: if the workspace has no number yet, auto-provision one
   * (one step, no dead-ends). On success show the new number + a confirmation
   * line, then advance. On failure save phone_mode without a number, show a
   * friendly note, and let the user continue from there.
   */
  const handleSave = async () => {
    if (!phoneMode) {
      setSaveError("Please choose how you'd like your AI receptionist to answer your calls.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    setProvisionNote(null);
    let outcome: "advance" | "success" | "note" = "advance";

    // 1. Auto-provision when no number is assigned yet
    if (!twilioPhone && !provisionAttempted) {
      setConnecting(true);
      try {
        const res = await fetch("/api/workspace/phone-config/provision", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        const data = await res.json().catch(() => ({}));
        if (data.success && data.twilio_phone) {
          setTwilioPhone(data.twilio_phone);
          setJustProvisioned(true);
          outcome = "success";
        } else if (data.configured === false) {
          // Never surface the raw API message (it mentions internal Twilio setup)
          setProvisionNote("We'll assign your number automatically — you can finish in Settings.");
          outcome = "note";
        } else {
          setProvisionNote("We couldn't set up your number right now — you can finish in Settings.");
          outcome = "note";
        }
      } catch {
        setProvisionNote("We'll assign your number automatically — you can finish in Settings.");
        outcome = "note";
      } finally {
        setProvisionAttempted(true);
        setConnecting(false);
      }
    }

    // 2. Save the phone-mode + transfer config (with or without a number)
    let failed = false;
    try {
      const resp = await fetch("/api/workspace/phone-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone_mode: phoneMode,
          transfer_number: transferNumber.trim() || null,
        }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || `Server error: ${resp.status}`);
      }
    } catch (err) {
      failed = true;
      setSaveError(`Couldn't save this yet: ${err instanceof Error ? err.message : "network error"}. You can retry, or set it up later in Settings.`);
    }

    if (failed) {
      setSaving(false);
      return;
    }

    if (outcome === "success") {
      // Number is ready — show the confirmation, then advance automatically
      window.setTimeout(onAdvance, 1200);
    } else if (outcome === "note") {
      // Provision failed gracefully — config is saved, stay here with the note.
      // The next Save & Continue (or later, Settings) completes the number.
      setSaving(false);
    } else {
      onAdvance();
    }
  };

  const inputClasses =
    "w-full rounded-lg border border-gray-200 dark:border-gray-700 px-3.5 py-2.5 text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 transition-colors";
  const labelClasses = "block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5";

  const cardBase = "w-full text-left rounded-xl border-2 p-4 transition-all cursor-pointer";
  const cardActive = "border-indigo-500 bg-indigo-50/60 dark:bg-indigo-950/20 shadow-sm";
  const cardInactive = "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 hover:border-gray-300 dark:hover:border-gray-600";
  const numberChip =
    "flex-1 min-w-0 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 px-3.5 py-2.5 font-mono text-sm font-semibold text-gray-900 dark:text-gray-100 truncate";
  const copyBtn =
    "shrink-0 rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors cursor-pointer";

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10 text-sm text-gray-400">
        <span className="animate-spin mr-2">⏳</span> Loading your phone settings…
      </div>
    );
  }

  return (
    <div className="space-y-4 text-left">
      {/* Option cards */}
      <div className="space-y-3">
        {/* Option A — Use my existing number */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => { setPhoneMode("forward"); setProvisionNote(null); setJustProvisioned(false); }}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setPhoneMode("forward"); setProvisionNote(null); setJustProvisioned(false); } }}
          className={`${cardBase} ${phoneMode === "forward" ? cardActive : cardInactive}`}
        >
          <div className="flex items-start gap-3">
            <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${phoneMode === "forward" ? "border-indigo-500" : "border-gray-300 dark:border-gray-600"}`}>
              {phoneMode === "forward" && <span className="h-2.5 w-2.5 rounded-full bg-indigo-500" />}
            </span>
            <div>
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Use my existing number</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                Keep your current business number. Customers call the same number — the AI answers.
              </p>
            </div>
          </div>
        </div>

        {/* Option A details */}
        {phoneMode === "forward" && (
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-4 space-y-4">
            {twilioPhone ? (
              <div>
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Forward calls to</p>
                <div className="mt-1.5 flex items-center gap-2">
                  <span className={numberChip}>{twilioPhone}</span>
                  <button onClick={() => copyNumber(twilioPhone)} className={copyBtn}>
                    {copied === twilioPhone ? "Copied!" : "Copy"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-amber-700 dark:text-amber-400">
                  We'll set up your FlowPilot forwarding number automatically when you continue.
                </p>
                {provisionNote && <p className="text-sm text-amber-700 dark:text-amber-400">⚠️ {provisionNote}</p>}
                {connecting && (
                  <p className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300"><span className="animate-spin">⏳</span> Connecting your number…</p>
                )}
              </div>
            )}
            <ol className="space-y-2.5">
              {[
                "Call your phone provider or sign in to your phone account.",
                "Set unconditional call forwarding to the FlowPilot number shown above.",
                "Test it — call your old number and your AI receptionist will answer as your company.",
              ].map((step, i) => (
                <li key={i} className="flex items-start gap-3 text-sm text-gray-600 dark:text-gray-300">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-900/50 text-[11px] font-bold text-indigo-600 dark:text-indigo-400">
                    {i + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
            <p className="text-xs text-gray-400">
              Your customers keep calling the same number. The AI answers as your receptionist.
            </p>
          </div>
        )}

        {/* Option B — Get a new number */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => { setPhoneMode("provisioned"); setProvisionNote(null); setJustProvisioned(false); }}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setPhoneMode("provisioned"); setProvisionNote(null); setJustProvisioned(false); } }}
          className={`${cardBase} ${phoneMode === "provisioned" ? cardActive : cardInactive}`}
        >
          <div className="flex items-start gap-3">
            <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${phoneMode === "provisioned" ? "border-indigo-500" : "border-gray-300 dark:border-gray-600"}`}>
              {phoneMode === "provisioned" && <span className="h-2.5 w-2.5 rounded-full bg-indigo-500" />}
            </span>
            <div>
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Get a new number</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                A dedicated number FlowPilot sets up for your business.
              </p>
            </div>
          </div>
        </div>

        {/* Option B details */}
        {phoneMode === "provisioned" && (
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-4 space-y-4">
            {twilioPhone ? (
              <div>
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Your number is ready</p>
                <div className="mt-1.5 flex items-center gap-2">
                  <span className={numberChip}>{twilioPhone}</span>
                  <button onClick={() => copyNumber(twilioPhone)} className={copyBtn}>
                    {copied === twilioPhone ? "Copied!" : "Copy"}
                  </button>
                </div>
                <p className="text-xs text-gray-400 mt-1.5">
                  Calls to this number route to your workspace. Publish it on your website and Google listing.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-gray-600 dark:text-gray-300">
                  We'll set up your new number automatically when you continue.
                </p>
                {provisionNote && <p className="text-sm text-amber-700 dark:text-amber-400">⚠️ {provisionNote}</p>}
                {connecting && (
                  <p className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300"><span className="animate-spin">⏳</span> Connecting your number…</p>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Number ready confirmation (after auto-provision) */}
      {justProvisioned && twilioPhone && (
        <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 p-4 space-y-2">
          <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300 flex items-center gap-1.5">✅ Your number is ready</p>
          <div className="flex items-center gap-2">
            <span className={numberChip}>{twilioPhone}</span>
            <button onClick={() => copyNumber(twilioPhone)} className={copyBtn}>
              {copied === twilioPhone ? "Copied!" : "Copy"}
            </button>
          </div>
          <p className="text-xs text-emerald-700 dark:text-emerald-400">Calls to this number route to your workspace.</p>
        </div>
      )}

      {/* Transfer number */}
      <div>
        <label className={labelClasses}>Transfer calls to <span className="font-normal text-gray-400">(optional)</span></label>
        <input
          type="tel"
          value={transferNumber}
          onChange={(e) => setTransferNumber(e.target.value)}
          placeholder="+15551234567"
          className={inputClasses}
        />
        <p className="text-xs text-gray-400 mt-1.5">
          When a caller asks to speak to a person, the AI will dial this number.
        </p>
      </div>

      {/* Error */}
      {saveError && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/50 px-3.5 py-2.5 text-xs text-amber-800 dark:text-amber-300">
          ⚠️ {saveError}
        </div>
      )}

      {/* Buttons */}
      <div className="space-y-2">
        <button
          onClick={handleSave}
          disabled={saving || connecting}
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 transition-colors cursor-pointer shadow-sm shadow-indigo-500/25 disabled:opacity-50 w-full justify-center"
        >
          {connecting ? (
            <><span className="animate-spin">⏳</span> Connecting your number…</>
          ) : justProvisioned ? (
            <>✓ Connected — moving on…</>
          ) : saving ? (
            <><span className="animate-spin">⏳</span> Saving...</>
          ) : (
            <>Save & Continue<span>→</span></>
          )}
        </button>
        <button
          onClick={onAdvance}
          disabled={connecting}
          className="w-full text-xs text-gray-400 hover:text-gray-500 dark:hover:text-gray-300 transition-colors cursor-pointer py-1 disabled:opacity-50"
        >
          Skip for now — you can set this up later
        </button>
      </div>
    </div>
  );
}

// ─── Slide 5: Meet Your Team ─────────────────────────────────────────

function SlideMeetTeam(_props: SlideContentProps) {
  const employees = [
    {
      name: "Sarah",
      role: "Sales & Email Agent",
      icon: "✉️",
      color: "from-blue-500 to-indigo-500",
      tasks: "Qualifies leads, replies to inquiries, follows up on proposals",
    },
    {
      name: "Max",
      role: "Invoice Clerk",
      icon: "🧾",
      color: "from-emerald-500 to-teal-500",
      tasks: "Generates invoices, tracks payments, sends reminders",
    },
    {
      name: "Olivia",
      role: "Scheduler",
      icon: "📅",
      color: "from-violet-500 to-purple-500",
      tasks: "Books appointments, manages your calendar, sends confirmations",
    },
  ];

  return (
    <div className="space-y-4 text-left">
      {employees.map((emp) => (
        <div
          key={emp.name}
          className="flex items-start gap-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4"
        >
          <span
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${emp.color} text-xl shadow-sm`}
          >
            {emp.icon}
          </span>
          <div>
            <p className="font-semibold text-gray-800 dark:text-gray-200">
              {emp.name}
              <span className="ml-2 text-xs font-normal text-gray-400">{emp.role}</span>
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{emp.tasks}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Slide 5: Train AI ───────────────────────────────────────────────

function SlideTrainAI(_props: SlideContentProps) {
  return (
    <div className="space-y-5 text-left">
      <p className="text-base text-gray-600 dark:text-gray-300 leading-relaxed">
        Your AI employees learn directly from your business documents. Upload
        anything that describes how you work — the more they know, the smarter
        they get.
      </p>
      <div className="grid grid-cols-2 gap-2">
        {[
          { icon: "📄", label: "PDFs" },
          { icon: "📝", label: "Word Docs" },
          { icon: "📊", label: "CSVs" },
          { icon: "📅", label: "Calendars" },
          { icon: "📋", label: "FAQs" },
          { icon: "💰", label: "Price Lists" },
        ].map((f) => (
          <div
            key={f.label}
            className="flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2.5 text-sm"
          >
            <span className="text-base">{f.icon}</span>
            <span className="text-gray-600 dark:text-gray-300">{f.label}</span>
          </div>
        ))}
      </div>
      <Link
        to="/client/upload"
        className="inline-flex items-center gap-2 text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
      >
        Go to document upload →
      </Link>
    </div>
  );
}

// ─── Slide 6: All Set ────────────────────────────────────────────────

function SlideAllSet(_props: SlideContentProps) {
  return (
    <div className="space-y-5 text-left">
      <p className="text-base text-gray-600 dark:text-gray-300 leading-relaxed">
        Your AI team is configured and ready to work. Here&apos;s a quick recap:
      </p>
      <div className="space-y-3">
        {[
          { check: "✅", text: "3 AI employees are live in your workspace" },
          { check: "💳", text: "14-day free trial — $399/mo after, cancel anytime" },
          { check: "📧", text: "Emails send from your @klerkitai.com address — connect your domain later" },
          { check: "📚", text: "Upload documents anytime from the Dashboard" },
        ].map((item, i) => (
          <div key={i} className="flex items-center gap-3 text-sm text-gray-600 dark:text-gray-300">
            <span>{item.check}</span>
            {item.text}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Slide definitions ──────────────────────────────────────────────

interface SlideDef {
  icon: string;
  title: string;
  subtitle: string;
  Content: React.ComponentType<SlideContentProps>;
  linkTo?: string;
  linkLabel?: string;
  hideContinue?: boolean;
}

const SLIDES: SlideDef[] = [
  {
    icon: "🚀",
    title: "Welcome to FlowPilot AI",
    subtitle:
      "You've just hired an AI team that handles the repetitive office work — emails, scheduling, invoicing, and more.",
    Content: SlideWelcome,
  },
  {
    icon: "🏢",
    title: "Tell Us About Your Business",
    subtitle:
      "Help your AI receptionist get to know your company. This info helps it answer calls accurately from day one.",
    Content: SlideBusinessProfile,
    hideContinue: true,
  },
  {
    icon: "📧",
    title: "Set Up Your Sending Identity",
    subtitle:
      "Pick your email address. Your AI employees will send from this address until you connect your own domain.",
    Content: SlideEmailPicker,
    hideContinue: true,
  },
  {
    icon: "📞",
    title: "Your AI Receptionist Phone",
    subtitle:
      "Choose how your AI receptionist answers your business line. You can change this anytime in Settings.",
    Content: SlidePhone,
    hideContinue: true,
  },
  {
    icon: "🤖",
    title: "Your AI Employees Are Ready",
    subtitle:
      "Meet the three AI team members already configured in your workspace.",
    Content: SlideMeetTeam,
  },
  {
    icon: "📚",
    title: "Upload Your Business Documents",
    subtitle:
      "Your AIs learn from your documents. Upload PDFs, docs, CSVs, and more to train your knowledge base.",
    Content: SlideTrainAI,
    linkTo: "/client/upload",
    linkLabel: "Go to document upload",
  },
  {
    icon: "🎉",
    title: "You're All Set!",
    subtitle:
      "Your AI team is ready to start working. Head to your dashboard to manage everything.",
    Content: SlideAllSet,
    linkTo: "/dashboard",
    linkLabel: "Go to Dashboard",
  },
];

// ─── Component ──────────────────────────────────────────────────────

function ClientDeck() {
  const navigate = useNavigate();
  const [slideIndex, setSlideIndex] = useState(0);

  const isFirst = slideIndex === 0;
  const isLast = slideIndex === SLIDES.length - 1;
  const slide = SLIDES[slideIndex];
  const { Content } = slide;

  const workspaceId =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("workspace") || "ws_demo"
      : "ws_demo";

  const goNext = useCallback(() => {
    if (isLast) {
      navigate({ to: slide.linkTo || "/dashboard", search: { workspace: workspaceId } });
      return;
    }
    setSlideIndex((i) => i + 1);
  }, [isLast, navigate, slide.linkTo, workspaceId]);

  const goPrev = useCallback(() => {
    if (isFirst) return;
    setSlideIndex((i) => i - 1);
  }, [isFirst]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault();
        if (slide.hideContinue) return;
        goNext();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrev();
      }
    },
    [goNext, goPrev, slide.hideContinue],
  );

  return (
    <div
      className="min-h-dvh bg-gray-50 dark:bg-gray-950 outline-none"
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <header className="flex items-center justify-between border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-6 py-3">
        <span className="text-lg font-bold text-indigo-600">FlowPilot AI</span>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-400">
            {slideIndex + 1} / {SLIDES.length}
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-lg px-6 py-8 md:py-12">
        {/* Progress dots */}
        <div className="flex items-center justify-center gap-2 mb-10">
          {SLIDES.map((_, i) => (
            <button
              key={i}
              onClick={() => setSlideIndex(i)}
              className={`h-2 rounded-full transition-all duration-300 cursor-pointer ${
                i === slideIndex
                  ? "w-6 bg-indigo-600"
                  : "w-2 bg-gray-300 dark:bg-gray-600 hover:bg-gray-400 dark:hover:bg-gray-500"
              }`}
              aria-label={`Go to slide ${i + 1}`}
            />
          ))}
        </div>

        {/* Slide content */}
        <div
          key={slideIndex}
          className="animate-[fp-deck-in_400ms_ease-out] text-center"
        >
          <style>{`
            @keyframes fp-deck-in {
              from { opacity: 0; transform: translateY(20px); }
              to   { opacity: 1; transform: translateY(0); }
            }
          `}</style>

          <div className="flex justify-center mb-6">
            <span className="inline-flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-indigo-500 to-violet-600 text-4xl shadow-lg shadow-indigo-500/20">
              {slide.icon}
            </span>
          </div>

          <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-gray-900 dark:text-white">
            {slide.title}
          </h1>

          <p className="text-base text-gray-500 dark:text-gray-400 mt-3 max-w-md mx-auto leading-relaxed">
            {slide.subtitle}
          </p>

          <div className="mt-8">
            <Content workspaceId={workspaceId} onAdvance={goNext} />
          </div>
        </div>

        {/* Navigation (hidden on form slides) */}
        {!slide.hideContinue && (
          <div className="flex items-center justify-between mt-10">
            <button
              onClick={goPrev}
              className={`inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors cursor-pointer ${
                isFirst
                  ? "text-gray-300 dark:text-gray-600 cursor-default"
                  : "text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
              }`}
              disabled={isFirst}
            >
              ← Back
            </button>

            {isLast ? (
              <Link
                to="/dashboard"
                search={{ workspace: workspaceId }}
                className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-6 py-3 text-sm font-semibold text-white hover:bg-indigo-500 transition-colors cursor-pointer shadow-sm shadow-indigo-500/25"
              >
                Go to Dashboard
                <span>→</span>
              </Link>
            ) : (
              <button
                onClick={goNext}
                className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 transition-colors cursor-pointer shadow-sm shadow-indigo-500/25"
              >
                Continue
                <span>→</span>
              </button>
            )}
          </div>
        )}

        {/* Skip link (hidden on form slides) */}
        {!isLast && !slide.hideContinue && (
          <div className="text-center mt-6">
            <Link
              to="/dashboard"
              search={{ workspace: workspaceId }}
              className="text-xs text-gray-400 hover:text-gray-500 dark:hover:text-gray-300 transition-colors underline underline-offset-2"
            >
              Skip to Dashboard
            </Link>
          </div>
        )}

        {/* Form slides: Back button + skip below */}
        {slide.hideContinue && (
          <div className="flex items-center justify-between mt-10">
            <button
              onClick={goPrev}
              className={`inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors cursor-pointer ${
                isFirst
                  ? "text-gray-300 dark:text-gray-600 cursor-default"
                  : "text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
              }`}
              disabled={isFirst}
            >
              ← Back
            </button>
            <Link
              to="/dashboard"
              search={{ workspace: workspaceId }}
              className="text-xs text-gray-400 hover:text-gray-500 dark:hover:text-gray-300 transition-colors underline underline-offset-2"
            >
              Skip to Dashboard
            </Link>
          </div>
        )}
      </main>
    </div>
  );
}
