import { createFileRoute, Link, Outlet, useLocation } from "@tanstack/react-router";
import { useState, useEffect, useMemo, useRef } from "react";

export const Route = createFileRoute("/dashboard")({
  component: Dashboard,
});

// ── Types ──────────────────────────────────────────────────────────────────

interface Lead {
  id: string; name: string; email: string | null; phone: string | null;
  source: string | null; status: string; score: number; notes: string | null; createdAt: string;
  address?: string | null;
  summary?: string | null;
  qa?: { question: string; answer: string }[] | null;
}

interface ActivityItem {
  id: string; type: string; description: string;
  metadata: Record<string, unknown> | null; createdAt: string;
}

interface Invoice {
  id: string; customerName: string; customerEmail: string | null;
  amountCents: number; status: string; dueDate: string | null; createdAt: string;
}

interface Appointment {
  id: string; title: string; scheduledAt: string; status: string;
  lead: { name: string } | null;
}

interface CalAppt {
  id: string; leadId: string | null; title: string; scheduledAt: string;
  status: string; notes: string | null;
}

interface Doc {
  id: string; filename: string; fileType: string; fileSize: number; createdAt: string;
}

interface CallRow {
  id: string; callSid: string; callerNumber: string | null; toNumber: string | null;
  status: string; outcome: string; startedAt: string; endedAt: string | null;
  durationSec: number | null; leadId: string | null; appointmentId: string | null;
  leadName: string | null; appointmentTitle: string | null;
}

interface StatsData {
  totalLeads: number; totalInvoices: number; totalAppointments: number;
  totalAutomations: number; totalAutomationRuns: number;
  totalCalls: number; callsToday: number; leadsByStatus: Record<string, number>;
}

// ── Constants ──────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  new: "bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-300",
  contacted: "bg-blue-100 text-blue-700 dark:bg-blue-900/60 dark:text-blue-300",
  qualified: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-300",
  proposal: "bg-violet-100 text-violet-700 dark:bg-violet-900/60 dark:text-violet-300",
  won: "bg-green-100 text-green-700 dark:bg-green-900/60 dark:text-green-300",
  lost: "bg-red-100 text-red-700 dark:bg-red-900/60 dark:text-red-300",
};

const INVOICE_STATUS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  sent: "bg-blue-100 text-blue-700 dark:bg-blue-900/60 dark:text-blue-300",
  paid: "bg-green-100 text-green-700 dark:bg-green-900/60 dark:text-green-300",
  overdue: "bg-red-100 text-red-700 dark:bg-red-900/60 dark:text-red-300",
  cancelled: "bg-gray-100 text-gray-500 line-through dark:bg-gray-800",
};

const APT_STATUS: Record<string, string> = {
  scheduled: "bg-blue-100 text-blue-700 dark:bg-blue-900/60 dark:text-blue-300",
  confirmed: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-300",
  cancelled: "bg-red-100 text-red-700 dark:bg-red-900/60 dark:text-red-300",
  completed: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
};

const TYPE_ICONS: Record<string, string> = {
  lead_scorer: "📊", email_agent: "✉️", invoice_clerk: "💰", scheduler: "📅",
  automation: "⚡", document_uploaded: "📁", invite_sent: "📨", lead_created: "👤",
};

const CALL_OUTCOME: Record<string, { label: string; cls: string }> = {
  appointment_booked: { label: "Appointment booked", cls: "bg-green-100 text-green-700 dark:bg-green-900/60 dark:text-green-300" },
  lead_captured: { label: "Lead captured", cls: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/60 dark:text-indigo-300" },
  transferred: { label: "Transferred", cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-300" },
  message_taken: { label: "Message taken", cls: "bg-gray-200 text-gray-600 dark:bg-gray-700/60 dark:text-gray-300" },
  completed: { label: "Completed", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-300" },
  incomplete: { label: "No action", cls: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500" },
};

// ── Helpers ────────────────────────────────────────────────────────────────

function timeAgo(d: string) {
  const m = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
  if (m < 1) return "Just now";
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.floor(m / 60)}h ago`;
  if (m < 10080) return `${Math.floor(m / 1440)}d ago`;
  return new Date(d).toLocaleDateString();
}

function fmtDate(d: string) { return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }
function fmt$(c: number) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(c / 100); }
function fmtSize(b: number) { return b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(1)} MB`; }
function scoreColor(s: number) { return s >= 80 ? "bg-emerald-500" : s >= 60 ? "bg-amber-500" : s >= 30 ? "bg-amber-400" : "bg-red-500"; }
function scoreText(s: number) { return s >= 80 ? "text-emerald-700 dark:text-emerald-400" : s >= 60 ? "text-amber-700 dark:text-amber-400" : "text-red-700 dark:text-red-400"; }
function rowHL(s: number) { return s >= 60 ? "border-l-green-400 dark:border-l-green-500" : s >= 30 ? "border-l-amber-400 dark:border-l-amber-500" : "border-l-red-400 dark:border-l-red-500"; }
function fileIcon(t: string) { const x: Record<string, string> = { pdf: "📄", docx: "📝", csv: "📊", ics: "📅", txt: "📃", md: "📋", png: "🖼️", jpg: "🖼️", jpeg: "🖼️" }; return x[t.split("/").pop()?.toLowerCase() || ""] || "📁"; }

function fmtPhone(p: string) {
  const d = p.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) return `+${d[0]} (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  return p;
}

function fmtDuration(sec: number | null) {
  if (sec == null) return "—";
  const s = Math.max(0, Math.round(sec));
  const mm = Math.floor(s / 60);
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function fmtDateTime(d: string) {
  return new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function parseServiceNeed(notes: string | null): string | null {
  if (!notes) return null;
  const m = notes.match(/service\s*need\s*:\s*([^\n]+)/i);
  return m && m[1] ? m[1].trim() : null;
}

// ── Calendar helpers ───────────────────────────────────────────────────────

const CAL_DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const CAL_MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function localDateKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmtTime(d: string) {
  return new Date(d).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function fmtDayHeading(key: string) {
  const d = new Date(`${key}T12:00:00`);
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

function OutcomeBadge({ outcome, status }: { outcome: string; status: string }) {
  const live = status === "ringing" || status === "in-progress";
  if (live) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-100 text-sky-700 dark:bg-sky-900/60 dark:text-sky-300 px-2 py-0.5 text-[10px] font-semibold uppercase shrink-0">
        <span className="h-1.5 w-1.5 rounded-full bg-sky-500 animate-pulse" />In progress
      </span>
    );
  }
  const o = CALL_OUTCOME[outcome] || { label: outcome.replace(/_/g, " "), cls: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400" };
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase shrink-0 ${o.cls}`}>{o.label}</span>;
}

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700 ${className}`} />;
}

function Empty({ msg }: { msg: string }) {
  return <div className="flex flex-col items-center justify-center py-8 text-center"><span className="text-3xl mb-2">📭</span><p className="text-sm text-gray-400 dark:text-gray-500">{msg}</p></div>;
}

function TrashIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={className}>
      <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 1 0 .23 1.482l.149-.022.841 10.518A2.75 2.75 0 0 0 7.596 19h4.807a2.75 2.75 0 0 0 2.742-2.53l.841-10.52.149.023a.75.75 0 0 0 .23-1.482 41.03 41.03 0 0 0-2.365-.298V3.75A2.75 2.75 0 0 0 11.25 1h-2.5ZM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4ZM8.58 7.72a.75.75 0 0 0-1.5.06l.3 7.5a.75.75 0 1 0 1.5-.06l-.3-7.5Zm4.34.06a.75.75 0 1 0-1.5-.06l-.3 7.5a.75.75 0 1 0 1.5.06l.3-7.5Z" clipRule="evenodd" />
    </svg>
  );
}

function Toast({ msg, type, onClose }: { msg: string; type: "success" | "error"; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 4000);
    return () => clearTimeout(t);
  }, [onClose]);

  return (
    <div className={`fixed bottom-6 right-6 z-50 ${type === "success" ? "bg-emerald-600" : "bg-red-600"} text-white px-4 py-3 rounded-lg shadow-lg text-sm max-w-sm animate-in slide-in-from-right-2`}>
      <div className="flex items-center justify-between gap-2">
        <span>{msg}</span>
        <button onClick={onClose} className="text-white/80 hover:text-white cursor-pointer">✕</button>
      </div>
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────

// ── Receptionist Parameters Card ──────────────────────────────────────────
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
type KeyQuestion = { if: string; thenAsk: string[] };

function ReceptionistParametersCard({ notify }: { notify: (msg: string, type: "success" | "error") => void }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [openDays, setOpenDays] = useState<string[]>([]);
  const [openStart, setOpenStart] = useState("");
  const [openEnd, setOpenEnd] = useState("");
  const [instructions, setInstructions] = useState("");
  const [spacer, setSpacer] = useState<number | null>(null);
  const [keyQuestions, setKeyQuestions] = useState<KeyQuestion[]>([]);
  // Full config echo — the backend nulls persona fields it doesn't receive
  // (businessName etc.), so re-send whatever was loaded to avoid clobbering
  // values the Settings persona card owns.
  const [persona, setPersona] = useState<Record<string, unknown>>({});
  // ── Autosave plumbing ────────────────────────────────────────────────────
  // dirty: any field changed since the last successful save. Saving uses refs
  // too so the debounce timer and beforeunload guard always see fresh truth
  // without re-subscribing on every keystroke.
  const [dirty, setDirty] = useState(false);
  const [hasSaved, setHasSaved] = useState(false);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  // After a failed autosave, don't hammer the server with retries — wait for
  // the next user change (markDirty) or an explicit Save click instead.
  const suppressAutosaveRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const markDirty = () => {
    dirtyRef.current = true;
    suppressAutosaveRef.current = false;
    setDirty(true);
  };

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/workspace/receptionist-config");
        if (res.ok) {
          const d = await res.json();
          const c = d?.config || {};
          setOpenDays(Array.isArray(c.openDays) ? c.openDays.filter((x: unknown) => typeof x === "string") : []);
          if (c.openHours && typeof c.openHours.start === "string") setOpenStart(c.openHours.start);
          if (c.openHours && typeof c.openHours.end === "string") setOpenEnd(c.openHours.end);
          setInstructions(typeof c.customInstructions === "string" ? c.customInstructions : "");
          setSpacer(typeof c.appointmentSpacer === "number" ? c.appointmentSpacer : null);
          setKeyQuestions(
            Array.isArray(c.keyQuestions)
              ? c.keyQuestions
                  .filter((k: unknown): k is Record<string, unknown> => !!k && typeof k === "object")
                  .map(k => ({
                    if: typeof k.if === "string" ? k.if : "",
                    thenAsk: Array.isArray(k.thenAsk) ? k.thenAsk.filter((q: unknown): q is string => typeof q === "string") : [],
                  }))
              : []
          );
          setPersona({
            businessName: typeof c.businessName === "string" ? c.businessName : null,
            businessType: typeof c.businessType === "string" ? c.businessType : null,
            businessHours: typeof c.businessHours === "string" ? c.businessHours : null,
            description: typeof c.description === "string" ? c.description : null,
            requireAddress: typeof c.requireAddress === "boolean" ? c.requireAddress : undefined,
          });
        }
      } catch (e) {
        console.error("Failed to load receptionist config:", e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const toggleDay = (day: string) => {
    markDirty();
    setOpenDays(prev => (prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]));
  };

  const addCondition = () => {
    markDirty();
    setKeyQuestions(prev => [...prev, { if: "", thenAsk: [] }]);
  };
  const removeCondition = (bi: number) => {
    markDirty();
    setKeyQuestions(prev => prev.filter((_, i) => i !== bi));
  };
  const updateConditionIf = (bi: number, v: string) => {
    markDirty();
    setKeyQuestions(prev => prev.map((b, i) => (i === bi ? { ...b, if: v } : b)));
  };
  const addQuestion = (bi: number) => {
    markDirty();
    setKeyQuestions(prev => prev.map((b, i) => (i === bi ? { ...b, thenAsk: [...b.thenAsk, ""] } : b)));
  };
  const removeQuestion = (bi: number, qi: number) => {
    markDirty();
    setKeyQuestions(prev => prev.map((b, i) => (i === bi ? { ...b, thenAsk: b.thenAsk.filter((_, j) => j !== qi) } : b)));
  };
  const updateQuestion = (bi: number, qi: number, v: string) => {
    markDirty();
    setKeyQuestions(prev => prev.map((b, i) => (i === bi ? { ...b, thenAsk: b.thenAsk.map((q, j) => (j === qi ? v : q)) } : b)));
  };

  // Build the exact payload the backend merge expects. Reuses the loaded
  // persona fields so autosave can't clobber values the Settings page owns.
  const buildSavePayload = () => {
    const hasHours = openStart.trim() !== "" && openEnd.trim() !== "";
    const kqTrimmed = keyQuestions
      .map(b => ({ if: b.if.trim(), thenAsk: b.thenAsk.map(q => q.trim()).filter(q => q !== "") }))
      .filter(b => b.if !== "");
    return {
      ...persona,
      openDays,
      openHours: hasHours ? { start: openStart, end: openEnd } : null,
      customInstructions: instructions,
      appointmentSpacer: spacer,
      keyQuestions: kqTrimmed.length > 0 ? kqTrimmed : null,
    };
  };

  // Shared by the explicit Save button (silent=false → toast) and the debounced
  // autosave (silent=true → status indicator only). Guards against concurrent
  // saves via savingRef. Clears the dirty flag optimistically so changes made
  // while the request is in flight (markDirty re-fires) can't be wrongly
  // reported as saved; on failure the flag is restored.
  const doSave = async (silent: boolean) => {
    if (savingRef.current) return false;
    savingRef.current = true;
    setSaving(true);
    dirtyRef.current = false;
    setDirty(false);
    try {
      const res = await fetch("/api/workspace/receptionist-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildSavePayload()),
      });
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      setHasSaved(true);
      if (!silent) notify("Receptionist parameters saved.", "success");
      return true;
    } catch (e) {
      dirtyRef.current = true;
      setDirty(true);
      if (silent) suppressAutosaveRef.current = true;
      if (!silent) notify(e instanceof Error ? e.message : "Failed to save receptionist parameters", "error");
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const handleSave = () => void doSave(false);

  // Debounced autosave — fires ~900ms after the last change to ANY field.
  // Skips while the initial config is still loading, while a save is in
  // flight, when nothing is dirty, and after a failed autosave (retry waits
  // for the next change or an explicit Save). Each keystroke resets the timer.
  // `saving` is a dep so edits made mid-flight re-arm a follow-up save once
  // the in-flight request finishes.
  useEffect(() => {
    if (loading || savingRef.current || !dirtyRef.current || suppressAutosaveRef.current) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      void doSave(true);
    }, 900);
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [openDays, openStart, openEnd, instructions, spacer, keyQuestions, dirty, saving, loading]);

  // beforeunload guard — belt-and-suspenders; with autosave this should
  // rarely fire, but a refresh mid-keystroke (or mid-save) still prompts
  // instead of silently discarding. Attached only while dirty or saving.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current || savingRef.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    if (dirty || saving) window.addEventListener("beforeunload", handler);
    else window.removeEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty, saving]);

  return (
    <section>
      <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-gray-800">
          <h2 className="text-sm font-bold text-gray-700 dark:text-gray-300">🎙️ Receptionist Parameters</h2>
          <span className="text-xs text-gray-400">How your AI receptionist answers calls</span>
        </div>
        {loading ? (
          <div className="space-y-3 px-5 py-4">
            <Skeleton className="h-4 w-40" />
            <div className="flex flex-wrap gap-2">{[1, 2, 3, 4, 5, 6, 7].map(i => <Skeleton key={i} className="h-8 w-16 rounded-lg" />)}</div>
            <Skeleton className="h-4 w-40" />
            <div className="flex flex-wrap gap-4"><Skeleton className="h-9 w-32" /><Skeleton className="h-9 w-32" /></div>
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-24 w-full" />
            <div className="flex justify-end"><Skeleton className="h-9 w-24" /></div>
          </div>
        ) : (
          <div className="px-5 py-4 space-y-4">
            {/* Open days */}
            <div>
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Open days of the week</p>
              <div className="flex flex-wrap gap-2">
                {DAYS.map(day => {
                  const checked = openDays.includes(day);
                  return (
                    <label
                      key={day}
                      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium cursor-pointer select-none transition-colors ${checked
                        ? "border-indigo-600 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300"
                        : "border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:border-indigo-300 dark:hover:border-indigo-700"}`}
                    >
                      <input type="checkbox" className="accent-indigo-600" checked={checked} onChange={() => toggleDay(day)} />
                      {day}
                    </label>
                  );
                })}
              </div>
            </div>
            {/* Open hours */}
            <div>
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Open hours</p>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                  Open
                  <input
                    type="time"
                    value={openStart}
                    onChange={e => { setOpenStart(e.target.value); markDirty(); }}
                    className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-2.5 py-1.5 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                  Close
                  <input
                    type="time"
                    value={openEnd}
                    onChange={e => { setOpenEnd(e.target.value); markDirty(); }}
                    className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-2.5 py-1.5 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </label>
                {openStart && openEnd && (
                  <span className="text-xs text-gray-400">
                    {new Date(`2000-01-01T${openStart}`).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} – {new Date(`2000-01-01T${openEnd}`).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                  </span>
                )}
              </div>
            </div>
            {/* Appointment spacer */}
            <div>
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Appointment spacer</p>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                  Gap
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={spacer ?? ""}
                    onChange={e => {
                      const n = e.target.value === "" ? NaN : Number(e.target.value);
                      setSpacer(Number.isFinite(n) && n >= 0 ? Math.round(n) : null);
                      markDirty();
                    }}
                    placeholder="0"
                    className="w-24 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-2.5 py-1.5 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <span className="text-xs text-gray-400">minutes</span>
                </label>
                <span className="text-xs text-gray-400">
                  {spacer !== null && spacer > 0 ? `${spacer} minute${spacer === 1 ? "" : "s"}` : "No spacer"}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {[0, 15, 30, 60].map(v => {
                  const active = spacer === v;
                  return (
                    <button
                      key={v}
                      type="button"
                      onClick={() => { setSpacer(v); markDirty(); }}
                      className={`rounded-lg border px-2.5 py-1 text-xs font-medium cursor-pointer transition-colors ${active
                        ? "border-indigo-600 bg-indigo-600 text-white"
                        : "border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:border-indigo-300 dark:hover:border-indigo-700"}`}
                    >
                      {v === 0 ? "None" : `${v} min`}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-gray-400 mt-1.5">Minimum gap between appointments (in minutes) — how long the receptionist must leave between consecutive bookings.</p>
            </div>
            {/* Free response */}
            <div>
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Free response</p>
              <textarea
                value={instructions}
                onChange={e => { setInstructions(e.target.value); markDirty(); }}
                rows={3}
                placeholder="How should the AI receptionist act? What questions should it ask callers? Example: Always confirm the service address before booking an appointment."
                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y"
              />
            </div>
            {/* Key question */}
            <div>
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Key question</p>
              <p className="text-xs text-gray-400 mb-2">
                Ask a question only when the customer's situation matches a condition. IF &lt;condition&gt;, THEN ASK &lt;question&gt;.
                Add one question per line — click + to add more. Leave empty to disable.
              </p>
              {keyQuestions.length === 0 ? (
                <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-700 px-3 py-4 text-center">
                  <p className="text-xs text-gray-400 mb-2">No conditions set yet. Add one to guide the receptionist's questions.</p>
                  <button
                    type="button"
                    onClick={addCondition}
                    className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 dark:border-indigo-800 text-indigo-600 dark:text-indigo-400 px-2.5 py-1 text-xs font-medium hover:bg-indigo-50 dark:hover:bg-indigo-900/20 cursor-pointer transition-colors"
                  >
                    + Add condition
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  {keyQuestions.map((block, bi) => (
                    <div key={bi} className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 p-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wide pt-1.5 shrink-0">If</span>
                        <input
                          value={block.if}
                          onChange={e => updateConditionIf(bi, e.target.value)}
                          placeholder="The customer needs a repair of any kind"
                          className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2.5 py-1.5 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                        <button
                          type="button"
                          onClick={() => removeCondition(bi)}
                          title="Remove condition"
                          className="shrink-0 p-1 rounded-md text-gray-300 dark:text-gray-600 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 cursor-pointer transition-colors"
                        >
                          ×
                        </button>
                      </div>
                      <div className="space-y-1.5">
                        {block.thenAsk.map((q, qi) => (
                          <div key={qi} className="flex items-center gap-2">
                            <span className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wide pt-1.5 shrink-0 w-16">Then ask</span>
                            <input
                              value={q}
                              onChange={e => updateQuestion(bi, qi, e.target.value)}
                              placeholder="e.g. What type of repair?"
                              className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2.5 py-1.5 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            />
                            <button
                              type="button"
                              onClick={() => removeQuestion(bi, qi)}
                              title="Remove question"
                              className="shrink-0 p-1 rounded-md text-gray-300 dark:text-gray-600 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 cursor-pointer transition-colors"
                            >
                              ×
                            </button>
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={() => addQuestion(bi)}
                          className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 dark:border-indigo-800 text-indigo-600 dark:text-indigo-400 px-2.5 py-1 text-xs font-medium hover:bg-indigo-50 dark:hover:bg-indigo-900/20 cursor-pointer transition-colors"
                        >
                          + Add question
                        </button>
                      </div>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={addCondition}
                    className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 dark:border-indigo-800 text-indigo-600 dark:text-indigo-400 px-2.5 py-1 text-xs font-medium hover:bg-indigo-50 dark:hover:bg-indigo-900/20 cursor-pointer transition-colors"
                  >
                    + Add condition
                  </button>
                </div>
              )}
            </div>
            <div className="flex items-center justify-end gap-3 pt-1">
              <span className="text-xs text-gray-400" aria-live="polite">
                {saving
                  ? "Saving…"
                  : dirty
                    ? "Unsaved changes"
                    : hasSaved
                      ? "Saved ✓"
                      : "Applies to new calls"}
              </span>
              <button
                onClick={handleSave}
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer transition-colors"
              >
                {saving ? (
                  <>
                    <svg className="animate-spin w-4 h-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                    Saving…
                  </>
                ) : (
                  "Save"
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
function Dashboard() {
  const [name, setName] = useState("There");
  const [leads, setLeads] = useState<Lead[]>([]);
  const [acts, setActs] = useState<ActivityItem[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [appts, setAppts] = useState<Appointment[]>([]);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [calls, setCalls] = useState<CallRow[]>([]);
  const [calAppts, setCalAppts] = useState<CalAppt[]>([]);
  const [calMonth, setCalMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [expandedCalAppt, setExpandedCalAppt] = useState<string | null>(null);
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [sortField, setSortField] = useState<"score" | "createdAt">("createdAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showAbout, setShowAbout] = useState(false);
  const [expandedCall, setExpandedCall] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ kind: "lead" | "appointment" | "doc"; id: string; label: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);
  // Client's business email (workspaces.fromEmail) for the header pill; null
  // when the workspace isn't provisioned yet — pill hides in that case.
  const [businessEmail, setBusinessEmail] = useState<string | null>(null);
  const [copiedEmail, setCopiedEmail] = useState(false);
  const location = useLocation();
  const isDashboardIndex = location.pathname === "/dashboard";

  useEffect(() => { const n = localStorage.getItem("fp_client_name"); if (n) setName(n); }, []);
  // Fetch the business email for the header pill. Never crashes on failure —
  // the pill simply stays hidden until an email is available.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/workspace/email-config");
        if (!res.ok) return;
        const d = await res.json();
        const em = typeof d?.from_email === "string" ? d.from_email.trim() : "";
        if (em) setBusinessEmail(em);
      } catch (e) {
        console.error("Failed to load email config:", e);
      }
    })();
  }, []);

  const copyBusinessEmail = async () => {
    if (!businessEmail) return;
    try {
      await navigator.clipboard.writeText(businessEmail);
      setCopiedEmail(true);
      setTimeout(() => setCopiedEmail(false), 1500);
    } catch {
      // Clipboard may be blocked (e.g. insecure context) — the pill still
      // displays the address for manual copying.
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const [lR, sR, aR, iR, apR, dR, cR] = await Promise.all([
          fetch("/api/leads?limit=50"), fetch("/api/stats"),
          fetch("/api/activity?limit=15"), fetch("/api/invoices?limit=10"),
          fetch("/api/appointments?limit=10"), fetch("/api/documents?limit=10"),
          fetch("/api/workspace/calls?limit=10"),
        ]);
        if (lR.ok) setLeads((await lR.json()).leads || []);
        if (sR.ok) setStats((await sR.json()).stats);
        if (aR.ok) setActs((await aR.json()).activities || []);
        if (iR.ok) setInvoices((await iR.json()).invoices || []);
        if (apR.ok) {
          const apts = (await apR.json()).appointments || [];
          setAppts(apts);
          setCalAppts(apts);
        }
        if (dR.ok) setDocs((await dR.json()).documents || []);
        if (cR.ok) setCalls((await cR.json()).calls || []);
      } catch (e) { console.error(e); } finally { setLoading(false); }
    })();
  }, []);

  const sorted = useMemo(() => {
    const s = [...leads];
    s.sort((a, b) => { const cmp = sortField === "score" ? (a.score || 0) - (b.score || 0) : new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(); return sortDir === "asc" ? cmp : -cmp; });
    return s;
  }, [leads, sortField, sortDir]);

  const toggleSort = (f: "score" | "createdAt") => setSortField(f) || setSortDir(d => sortField === f ? (d === "asc" ? "desc" : "asc") : "desc");
  const si = (f: "score" | "createdAt") => sortField !== f ? " ↕" : sortDir === "asc" ? " ↑" : " ↓";

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/workspace/${deleteTarget.kind === "doc" ? "documents" : deleteTarget.kind === "lead" ? "leads" : "appointments"}?id=${encodeURIComponent(deleteTarget.id)}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to delete");
      }
      if (deleteTarget.kind === "lead") {
        setLeads((prev) => prev.filter((l) => l.id !== deleteTarget.id));
      } else if (deleteTarget.kind === "appointment") {
        setAppts((prev) => prev.filter((a) => a.id !== deleteTarget.id));
        setCalAppts((prev) => prev.filter((a) => a.id !== deleteTarget.id));
      } else {
        setDocs((prev) => prev.filter((d) => d.id !== deleteTarget.id));
      }
      // Refetch stats so the top cards stay truthful
      if (deleteTarget.kind === "lead" || deleteTarget.kind === "appointment") {
        fetch("/api/stats")
          .then((r) => r.ok && r.json().then((d) => setStats(d.stats)))
          .catch(() => {});
      }
      setToast({ msg: `Deleted ${deleteTarget.label}.`, type: "success" });
      setDeleteTarget(null);
    } catch (err) {
      setToast({ msg: err instanceof Error ? err.message : "Failed to delete", type: "error" });
    } finally {
      setDeleting(false);
    }
  };

  // Jump from a call row to the linked lead/appointment elsewhere on the page
  const openLead = (leadId: string) => {
    setExpanded(leadId);
    setExpandedCall(null);
    document.getElementById("leads-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const openAppointment = () => {
    setExpandedCall(null);
    document.getElementById("appointments-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // ── Calendar computations ────────────────────────────────────────────────
  const calGrid = useMemo(() => {
    const first = new Date(calMonth.getFullYear(), calMonth.getMonth(), 1);
    const start = new Date(first);
    start.setDate(first.getDate() - first.getDay()); // back up to Sunday
    const days: Date[] = [];
    for (let i = 0; i < 42; i++) days.push(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
    return days;
  }, [calMonth]);

  const calByDay = useMemo(() => {
    const map: Record<string, CalAppt[]> = {};
    for (const a of calAppts) {
      const key = localDateKey(new Date(a.scheduledAt));
      (map[key] = map[key] || []).push(a);
    }
    for (const k of Object.keys(map)) {
      map[k].sort((x, y) => new Date(x.scheduledAt).getTime() - new Date(y.scheduledAt).getTime());
    }
    return map;
  }, [calAppts]);

  const monthHasAppts = useMemo(() => {
    const prefix = `${calMonth.getFullYear()}-${String(calMonth.getMonth() + 1).padStart(2, "0")}`;
    return Object.keys(calByDay).some((k) => k.startsWith(prefix));
  }, [calByDay, calMonth]);

  const leadNameOf = (leadId: string | null) => {
    if (!leadId) return null;
    return leads.find((l) => l.id === leadId)?.name || null;
  };

  const todayKey = localDateKey(new Date());
  const selectedAppts = selectedDay ? (calByDay[selectedDay] || []) : [];

  const changeMonth = (delta: number) => {
    setCalMonth(new Date(calMonth.getFullYear(), calMonth.getMonth() + delta, 1));
    setSelectedDay(null);
    setExpandedCalAppt(null);
  };
  const goToday = () => {
    const d = new Date();
    setCalMonth(new Date(d.getFullYear(), d.getMonth(), 1));
    setSelectedDay(null);
    setExpandedCalAppt(null);
  };

  return (
    <div className="min-h-dvh bg-gray-50 dark:bg-gray-950">
      <header className="flex items-center justify-between border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-6 py-3 sticky top-0 z-10">
        <div className="flex items-center gap-6">
          <span className="text-lg font-bold text-indigo-600 dark:text-indigo-400">FlowPilot AI</span>
          <nav className="hidden sm:flex items-center gap-1">
            <Link to="/dashboard" className="px-3 py-1.5 text-sm rounded-md text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 [&.active]:bg-indigo-50 [&.active]:text-indigo-600 dark:[&.active]:bg-indigo-900/30 dark:[&.active]:text-indigo-400">Dashboard</Link>
            <Link to="/dashboard/chat" className="px-3 py-1.5 text-sm rounded-md text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 [&.active]:bg-indigo-50 [&.active]:text-indigo-600 dark:[&.active]:bg-indigo-900/30 dark:[&.active]:text-indigo-400">AI Chat</Link>
            <Link to="/dashboard/invoices" className="px-3 py-1.5 text-sm rounded-md text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 [&.active]:bg-indigo-50 [&.active]:text-indigo-600 dark:[&.active]:bg-indigo-900/30 dark:[&.active]:text-indigo-400">Invoices</Link>
            <Link to="/dashboard/emails" className="px-3 py-1.5 text-sm rounded-md text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 [&.active]:bg-indigo-50 [&.active]:text-indigo-600 dark:[&.active]:bg-indigo-900/30 dark:[&.active]:text-indigo-400">Email Inbox</Link>
            <Link to="/dashboard/automations" className="px-3 py-1.5 text-sm rounded-md text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 [&.active]:bg-indigo-50 [&.active]:text-indigo-600 dark:[&.active]:bg-indigo-900/30 dark:[&.active]:text-indigo-400">Automations</Link>
            <Link to="/dashboard/ai-employees" className="px-3 py-1.5 text-sm rounded-md text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 [&.active]:bg-indigo-50 [&.active]:text-indigo-600 dark:[&.active]:bg-indigo-900/30 dark:[&.active]:text-indigo-400">AI Team</Link>
            <Link to="/dashboard/settings" className="px-3 py-1.5 text-sm rounded-md text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 [&.active]:bg-indigo-50 [&.active]:text-indigo-600 dark:[&.active]:bg-indigo-900/30 dark:[&.active]:text-indigo-400">Settings</Link>
          </nav>
        </div>
        <div className="flex items-center gap-4">
          {businessEmail && (
            <button
              type="button"
              onClick={copyBusinessEmail}
              title={`Copy ${businessEmail} to clipboard`}
              className="hidden md:inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-gray-200 dark:border-gray-700 bg-indigo-50/10 px-3 py-1 text-xs font-medium text-gray-700 dark:text-gray-300 hover:border-indigo-300 dark:hover:border-indigo-600 cursor-pointer transition-colors"
            >
              <span aria-hidden="true">{copiedEmail ? "✓" : "📧"}</span>
              <span className="max-w-[260px] truncate">{businessEmail}</span>
              {copiedEmail && <span className="font-semibold text-indigo-500 dark:text-indigo-400">Copied!</span>}
            </button>
          )}
          <span className="text-sm text-gray-500 dark:text-gray-400">👤 {name}</span>
          <Link to="/" className="text-sm text-gray-400 hover:text-red-500">Sign out</Link>
        </div>
      </header>

      {isDashboardIndex ? (
        <main className="mx-auto max-w-7xl px-4 sm:px-6 py-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">Welcome back, {name} 👋</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">Here's what your AI employees have been up to.</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          {[{ l: "Total Leads", v: stats?.totalLeads ?? 0, i: "👥" }, { l: "Calls Today", v: stats?.callsToday ?? 0, i: "📞" }, { l: "Active Invoices", v: stats?.totalInvoices ?? 0, i: "💰" }, { l: "Appointments", v: stats?.totalAppointments ?? 0, i: "📅" }, { l: "Documents", v: docs.length, i: "📁" }].map(s => (
            <div key={s.l} className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 hover:shadow-md transition-shadow">
              <span className="text-2xl">{s.i}</span>
              {loading ? <Skeleton className="h-8 w-16 mt-2" /> : <p className="text-2xl font-bold mt-2 text-gray-900 dark:text-gray-100">{s.v}</p>}
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{s.l}</p>
            </div>
          ))}
        </div>

        {/* Leads Table + AI Activity */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Leads (3/5) */}
          <section id="leads-section" className="lg:col-span-3 scroll-mt-20">
            <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-gray-800">
                <h2 className="text-sm font-bold text-gray-700 dark:text-gray-300">📋 Leads</h2>
                <Link to="/dashboard/leads" className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">View all →</Link>
              </div>
              <div className="grid grid-cols-6 gap-3 px-5 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700">
                <span className="col-span-2">Name</span><span>Source</span><span>Status</span>
                <button className="flex items-center gap-0.5 hover:text-gray-700 dark:hover:text-gray-200 cursor-pointer text-left" onClick={() => toggleSort("score")}>Score{si("score")}</button>
                <button className="flex items-center gap-0.5 hover:text-gray-700 dark:hover:text-gray-200 cursor-pointer text-left" onClick={() => toggleSort("createdAt")}>Date{si("createdAt")}</button>
              </div>
              {loading ? (
                <div className="space-y-3 px-5 py-4">{[1, 2, 3, 4, 5].map(i => <div key={i} className="grid grid-cols-6 gap-3 items-center"><div className="col-span-2 space-y-1.5"><Skeleton className="h-4 w-24" /><Skeleton className="h-3 w-32" /></div><Skeleton className="h-3 w-16" /><Skeleton className="h-5 w-16 rounded-full" /><Skeleton className="h-3 w-10" /><Skeleton className="h-3 w-12" /></div>)}</div>
              ) : sorted.length === 0 ? <Empty msg="No leads yet. Add your first lead to get started." /> : (
                <div>
                  {sorted.map(l => (
                    <div key={l.id}>
                      <div className={`w-full grid grid-cols-6 gap-3 px-5 py-3 text-sm border-b border-gray-100 dark:border-gray-800 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-800/30 cursor-pointer text-left border-l-4 ${rowHL(l.score)}`} onClick={() => { setExpanded(expanded === l.id ? null : l.id); setShowAbout(false); }}>
                        <div className="col-span-2 min-w-0"><p className="font-medium text-gray-900 dark:text-gray-100 truncate">{l.name}</p><p className="text-xs text-gray-400 dark:text-gray-500 truncate">{l.email || "—"}</p></div>
                        <span className="text-xs text-gray-500 dark:text-gray-400 self-center truncate">{l.source || "—"}</span>
                        <span className="self-center"><span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_COLORS[l.status] || "bg-gray-100 text-gray-600"}`}>{l.status}</span></span>
                        <span className="self-center"><span className="inline-flex items-center gap-1.5"><span className="w-12 h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden"><span className={`block h-full rounded-full ${scoreColor(l.score)}`} style={{ width: `${Math.min(100, l.score || 0)}%` }} /></span><span className={`text-xs font-semibold ${scoreText(l.score)}`}>{l.score}</span></span></span>
                        <span className="flex items-center justify-end gap-1 text-xs text-gray-400 self-center">
                          {timeAgo(l.createdAt)}
                          <button
                            onClick={(e) => { e.stopPropagation(); setDeleteTarget({ kind: "lead", id: l.id, label: `lead ${l.name}` }); }}
                            title="Delete lead"
                            className="p-1.5 rounded-md text-gray-300 hover:text-red-600 dark:text-gray-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 cursor-pointer transition-colors"
                          >
                            <TrashIcon />
                          </button>
                        </span>
                      </div>
                      {expanded === l.id && (
                        <div className="px-5 py-4 bg-gray-50 dark:bg-gray-800/30 border-b border-gray-100 dark:border-gray-800 space-y-3">
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                            <div><p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Contact</p><p className="text-sm mt-1 text-gray-700 dark:text-gray-300">{l.email || "No email"}</p><p className="text-sm text-gray-500">{l.phone || "No phone"}</p></div>
                            <div><p className="text-xs font-medium text-gray-500 uppercase tracking-wide">AI Score</p><div className="flex items-center gap-2 mt-1"><span className={`text-lg font-bold ${scoreText(l.score)}`}>{l.score}/100</span><span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${l.score >= 60 ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-300" : "bg-red-100 text-red-700 dark:bg-red-900/60 dark:text-red-300"}`}>{l.score >= 80 ? "Hot" : l.score >= 60 ? "Warm" : l.score >= 30 ? "Cool" : "Cold"}</span></div></div>
                            <div><p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Source & Date</p><p className="text-sm mt-1 text-gray-700 dark:text-gray-300">{l.source || "Unknown"}</p><p className="text-sm text-gray-500">{fmtDate(l.createdAt)}</p></div>
                          </div>
                          {l.address && (
                            <div>
                              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Service Address</p>
                              <p className="text-sm mt-1 text-gray-600 dark:text-gray-400">{l.address}</p>
                            </div>
                          )}
                          {l.notes && <div><p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Notes</p><p className="text-sm mt-1 text-gray-600 dark:text-gray-400">{l.notes}</p></div>}
                          <div className="flex gap-2 pt-1">
                            <button className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-500 cursor-pointer">Send Email</button>
                            <button
                              onClick={() => setShowAbout(v => !v)}
                              className={`text-xs px-3 py-1.5 rounded-lg cursor-pointer transition-colors ${
                                showAbout
                                  ? "bg-indigo-600 text-white hover:bg-indigo-500"
                                  : "border border-indigo-200 dark:border-indigo-800 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/30"
                              }`}
                            >
                              {showAbout ? "Hide About Lead" : "About Lead"}
                            </button>
                          </div>
                          {showAbout && (
                            <div className="space-y-3">
                              <div>
                                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Summary</p>
                                <p className="text-sm mt-1 text-gray-600 dark:text-gray-400">
                                  {l.summary || "No summary yet — this lead was captured before summaries were added."}
                                </p>
                              </div>
                              {parseServiceNeed(l.notes) && (
                                <div>
                                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Service Need</p>
                                  <p className="text-sm mt-1 text-gray-600 dark:text-gray-400">{parseServiceNeed(l.notes)}</p>
                                </div>
                              )}
                              {l.qa && l.qa.length > 0 && (
                                <div>
                                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Situation Q&A</p>
                                  <div className="mt-1.5 space-y-2">
                                    {l.qa.map((q, i) => (
                                      <div key={i} className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2">
                                        <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{q.question}</p>
                                        <p className="text-sm mt-0.5 text-gray-600 dark:text-gray-400">{q.answer}</p>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* AI Activity (2/5) */}
          <section className="lg:col-span-2">
            <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-gray-800">
                <h2 className="text-sm font-bold text-gray-700 dark:text-gray-300">⚡ Recent Activity</h2>
                <span className="text-xs text-gray-400">{acts.length} events</span>
              </div>
              <div className="divide-y divide-gray-100 dark:divide-gray-800">
                {loading ? (
                  <div className="space-y-4 px-5 py-4">{[1, 2, 3].map(i => <div key={i} className="flex gap-3"><Skeleton className="h-8 w-8 rounded-full shrink-0" /><div className="flex-1 space-y-1.5"><Skeleton className="h-4 w-3/4" /><Skeleton className="h-3 w-1/2" /></div></div>)}</div>
                ) : acts.length === 0 ? <Empty msg="No recent activity yet." /> : (
                  <div className="max-h-[600px] overflow-y-auto">
                    {acts.map(a => (
                      <div key={a.id} className="flex items-start gap-3 px-5 py-3.5 hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors">
                        <span className="text-lg shrink-0 mt-0.5">{TYPE_ICONS[a.type] || "🔔"}</span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-gray-700 dark:text-gray-300">{a.description}</p>
                          <p className="text-xs text-gray-400 mt-0.5">{timeAgo(a.createdAt)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="px-5 py-2.5 border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/30">
                <Link to="/dashboard/automations" className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">View all activity →</Link>
              </div>
            </div>
          </section>
        </div>

        {/* Recent Calls */}
        <section>
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-gray-800">
              <h2 className="text-sm font-bold text-gray-700 dark:text-gray-300">📞 Recent Calls</h2>
              <span className="text-xs text-gray-400">{calls.length} calls</span>
            </div>
            {loading ? (
              <div className="space-y-3 px-5 py-3">{[1, 2, 3].map(i => <div key={i} className="flex items-center gap-3"><Skeleton className="h-9 w-9 rounded-full shrink-0" /><div className="flex-1 space-y-1.5"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-3 w-1/3" /></div><Skeleton className="h-3 w-10" /><Skeleton className="h-5 w-20 rounded-full" /></div>)}</div>
            ) : calls.length === 0 ? (
              <Empty msg="No calls yet — your AI receptionist will log calls here." />
            ) : (
              <div className="divide-y divide-gray-100 dark:divide-gray-800">
                {calls.map(c => (
                  <div key={c.id}>
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => setExpandedCall(expandedCall === c.id ? null : c.id)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpandedCall(expandedCall === c.id ? null : c.id); } }}
                      className="w-full flex items-center gap-3 px-5 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800/30 cursor-pointer transition-colors"
                    >
                      <span className="h-9 w-9 rounded-full bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center text-indigo-600 dark:text-indigo-400 shrink-0">📞</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                          {c.callerNumber ? fmtPhone(c.callerNumber) : "Unknown caller"}
                          <span className="text-xs font-normal text-gray-400 ml-2">{timeAgo(c.startedAt)}</span>
                        </p>
                        <p className="text-xs text-gray-400 truncate">
                          {c.leadName ? `${c.leadName}${c.appointmentTitle ? " · " + c.appointmentTitle : ""}` : c.toNumber ? `Called ${fmtPhone(c.toNumber)}` : "AI receptionist call"}
                        </p>
                      </div>
                      <span className="text-xs text-gray-400 font-mono shrink-0">{fmtDuration(c.durationSec)}</span>
                      <OutcomeBadge outcome={c.outcome} status={c.status} />
                    </div>
                    {expandedCall === c.id && (
                      <div className="px-5 py-4 bg-gray-50 dark:bg-gray-800/30 border-b border-gray-100 dark:border-gray-800 space-y-3">
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                          <div><p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Caller</p><p className="text-sm mt-1 text-gray-700 dark:text-gray-300">{c.callerNumber ? fmtPhone(c.callerNumber) : "Unknown"}</p><p className="text-sm text-gray-500">{fmtDateTime(c.startedAt)}</p></div>
                          <div><p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Duration</p><p className="text-sm mt-1 text-gray-700 dark:text-gray-300">{fmtDuration(c.durationSec)}</p>{c.toNumber && <p className="text-sm text-gray-500">to {fmtPhone(c.toNumber)}</p>}</div>
                          <div><p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Outcome</p><div className="mt-1"><OutcomeBadge outcome={c.outcome} status={c.status} /></div>{c.leadName && <p className="text-sm text-gray-500 mt-1">{c.leadName}</p>}</div>
                        </div>
                        {(c.leadId || c.appointmentId) && (
                          <div className="flex flex-wrap gap-2 pt-1">
                            {c.leadId && (
                              <button onClick={() => openLead(c.leadId!)} className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-500 cursor-pointer">
                                View lead →
                              </button>
                            )}
                            {c.appointmentId && (
                              <button onClick={openAppointment} className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer">
                                View appointment →
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Calendar */}
        <section id="calendar-section" className="scroll-mt-20">
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
            <div className="flex items-center justify-between gap-2 flex-wrap px-5 py-3 border-b border-gray-200 dark:border-gray-800">
              <h2 className="text-sm font-bold text-gray-700 dark:text-gray-300">📅 Calendar</h2>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => changeMonth(-1)}
                  aria-label="Previous month"
                  className="h-7 w-7 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer text-sm leading-none"
                >
                  ‹
                </button>
                <span className="text-sm font-semibold text-gray-800 dark:text-gray-200 min-w-[130px] text-center">
                  {CAL_MONTH_NAMES[calMonth.getMonth()]} {calMonth.getFullYear()}
                </span>
                <button
                  onClick={() => changeMonth(1)}
                  aria-label="Next month"
                  className="h-7 w-7 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer text-sm leading-none"
                >
                  ›
                </button>
                <button
                  onClick={goToday}
                  className="ml-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 cursor-pointer"
                >
                  Today
                </button>
              </div>
            </div>

            {loading ? (
              <div className="p-5">
                <div className="grid grid-cols-7 gap-2">{[1, 2, 3, 4, 5, 6, 7].map(i => <Skeleton key={i} className="h-20" />)}</div>
              </div>
            ) : (
              <>
                {/* Weekday row */}
                <div className="grid grid-cols-7 gap-px bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-800">
                  {CAL_DAY_NAMES.map(d => (
                    <div key={d} className="px-2 py-1.5 text-center text-[10px] font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500 bg-white dark:bg-gray-900">
                      {d}
                    </div>
                  ))}
                </div>
                {/* Day grid */}
                <div className="grid grid-cols-7 gap-px bg-gray-100 dark:bg-gray-800">
                  {calGrid.map((day, i) => {
                    const key = localDateKey(day);
                    const inMonth = day.getMonth() === calMonth.getMonth();
                    const isToday = key === todayKey;
                    const dayAppts = calByDay[key] || [];
                    return (
                      <button
                        key={key + "-" + i}
                        onClick={() => setSelectedDay(selectedDay === key ? null : key)}
                        className={`min-h-[76px] text-left align-top p-1.5 transition-colors cursor-pointer ${
                          selectedDay === key
                            ? "bg-indigo-50 dark:bg-indigo-950/40"
                            : "bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800/40"
                        }`}
                      >
                        <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold ${
                          isToday
                            ? "bg-indigo-600 text-white"
                            : inMonth
                              ? "text-gray-700 dark:text-gray-300"
                              : "text-gray-300 dark:text-gray-600"
                        }`}>
                          {day.getDate()}
                        </span>
                        <span className="block mt-1 space-y-0.5">
                          {dayAppts.slice(0, 3).map(a => (
                            <span
                              key={a.id}
                              className={`block truncate rounded px-1 py-0.5 text-[10px] leading-tight ${
                                a.status === "cancelled"
                                  ? "bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 line-through"
                                  : "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300"
                              }`}
                            >
                              {fmtTime(a.scheduledAt)} {a.title}
                            </span>
                          ))}
                          {dayAppts.length > 3 && (
                            <span className="block px-1 text-[10px] font-semibold text-gray-400">+{dayAppts.length - 3} more</span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {!monthHasAppts && (
                  <div className="px-5 py-4 text-center text-sm text-gray-400 dark:text-gray-500">No appointments this month.</div>
                )}
                {/* Day details panel */}
                {selectedDay && (
                  <div className="border-t border-gray-200 dark:border-gray-800">
                    <div className="px-5 py-3 flex items-center justify-between bg-gray-50 dark:bg-gray-800/30 border-b border-gray-200 dark:border-gray-800">
                      <p className="text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wide">{fmtDayHeading(selectedDay)}</p>
                      <span className="text-xs text-gray-400">{selectedAppts.length} appointment{selectedAppts.length === 1 ? "" : "s"}</span>
                    </div>
                    {selectedAppts.length === 0 ? (
                      <p className="px-5 py-4 text-sm text-gray-400 dark:text-gray-500">No appointments this day.</p>
                    ) : (
                      <div className="divide-y divide-gray-100 dark:divide-gray-800">
                        {selectedAppts.map(a => {
                          const leadName = leadNameOf(a.leadId);
                          const cancelled = a.status === "cancelled";
                          return (
                            <div key={a.id}>
                              <div
                                role="button"
                                tabIndex={0}
                                onClick={() => setExpandedCalAppt(expandedCalAppt === a.id ? null : a.id)}
                                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpandedCalAppt(expandedCalAppt === a.id ? null : a.id); } }}
                                className={`w-full flex items-center gap-3 px-5 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800/30 cursor-pointer transition-colors ${cancelled ? "opacity-60" : ""}`}
                              >
                                <span className={`h-9 w-9 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${
                                  cancelled
                                    ? "bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500"
                                    : "bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400"
                                }`}>
                                  {fmtTime(a.scheduledAt)}
                                </span>
                                <div className="min-w-0 flex-1">
                                  <p className={`text-sm font-medium text-gray-900 dark:text-gray-100 truncate ${cancelled ? "line-through" : ""}`}>{a.title}</p>
                                  <p className="text-xs text-gray-400 truncate">
                                    {leadName ? `${leadName} · ` : ""}{fmtTime(a.scheduledAt)}
                                  </p>
                                </div>
                                <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium uppercase shrink-0 ${cancelled ? "bg-gray-200 text-gray-500 dark:bg-gray-700/60 dark:text-gray-400" : APT_STATUS[a.status] || "bg-gray-100 text-gray-600"}`}>
                                  {a.status}
                                </span>
                              </div>
                              {expandedCalAppt === a.id && (
                                <div className="px-5 py-4 bg-gray-50 dark:bg-gray-800/30 border-t border-gray-100 dark:border-gray-800 space-y-3">
                                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                    <div><p className="text-xs font-medium text-gray-500 uppercase tracking-wide">When</p><p className="text-sm mt-1 text-gray-700 dark:text-gray-300">{fmtDateTime(a.scheduledAt)}</p></div>
                                    <div><p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Status</p><span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium mt-1 ${cancelled ? "bg-gray-200 text-gray-500 dark:bg-gray-700/60 dark:text-gray-400" : APT_STATUS[a.status] || "bg-gray-100 text-gray-600"}`}>{a.status}</span></div>
                                    <div><p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Client</p><p className="text-sm mt-1 text-gray-700 dark:text-gray-300">{leadName || "—"}</p></div>
                                  </div>
                                  {a.notes && <div><p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Notes</p><p className="text-sm mt-1 text-gray-600 dark:text-gray-400">{a.notes}</p></div>}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </section>

        {/* Receptionist Parameters */}
        <ReceptionistParametersCard notify={(msg, type) => setToast({ msg, type })} />
        {/* Bottom Row */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Appointments */}
          <section id="appointments-section" className="scroll-mt-20">
            <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-gray-800"><h2 className="text-sm font-bold text-gray-700 dark:text-gray-300">📅 Appointments</h2><Link to="/dashboard/appointments" className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">View all →</Link></div>
              {loading ? <div className="space-y-3 px-5 py-3">{[1, 2].map(i => <div key={i} className="flex items-center gap-3"><Skeleton className="h-10 w-10 rounded-lg shrink-0" /><div className="flex-1 space-y-1.5"><Skeleton className="h-4 w-3/4" /><Skeleton className="h-3 w-1/2" /></div></div>)}</div>
              : appts.length === 0 ? <Empty msg="No appointments scheduled." /> : (
                <div className="divide-y divide-gray-100 dark:divide-gray-800">
                  {appts.slice(0, 5).map(a => (
                    <div key={a.id} className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/30">
                      <div className="w-10 h-10 rounded-lg bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center text-indigo-600 dark:text-indigo-400 shrink-0"><span className="text-xs font-bold">{new Date(a.scheduledAt).getDate()}</span></div>
                      <div className="min-w-0 flex-1"><p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{a.title}</p><div className="flex items-center gap-2 mt-0.5"><span className="text-xs text-gray-400">{fmtDate(a.scheduledAt)}</span>{a.lead && <span className="text-xs text-gray-400">· {a.lead.name}</span>}</div></div>
                      <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium uppercase shrink-0 ${APT_STATUS[a.status] || "bg-gray-100 text-gray-600"}`}>{a.status}</span>
                      <button
                        onClick={() => setDeleteTarget({ kind: "appointment", id: a.id, label: `appointment ${a.title}` })}
                        title="Delete appointment"
                        className="p-1.5 rounded-md text-gray-300 hover:text-red-600 dark:text-gray-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 cursor-pointer transition-colors shrink-0"
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* Invoices */}
          <section>
            <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-gray-800"><h2 className="text-sm font-bold text-gray-700 dark:text-gray-300">💰 Invoices</h2><Link to="/dashboard/invoices" className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">View all →</Link></div>
              {loading ? <div className="space-y-3 px-5 py-3">{[1, 2].map(i => <div key={i} className="flex items-center justify-between"><div className="space-y-1.5"><Skeleton className="h-4 w-28" /><Skeleton className="h-3 w-16" /></div><Skeleton className="h-5 w-14 rounded-full" /></div>)}</div>
              : invoices.length === 0 ? <Empty msg="No invoices yet." /> : (
                <div className="divide-y divide-gray-100 dark:divide-gray-800">
                  {invoices.slice(0, 5).map(inv => (
                    <div key={inv.id} className="flex items-center justify-between px-5 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/30">
                      <div className="min-w-0"><p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{inv.customerName}</p><p className="text-xs text-gray-400">{fmt$(inv.amountCents)}{inv.dueDate && ` · Due ${fmtDate(inv.dueDate)}`}</p></div>
                      <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium uppercase shrink-0 ${INVOICE_STATUS[inv.status] || "bg-gray-100 text-gray-600"}`}>{inv.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* Documents */}
          <section>
            <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-gray-800"><h2 className="text-sm font-bold text-gray-700 dark:text-gray-300">📁 Documents</h2><Link to="/client/upload" className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">Upload →</Link></div>
              {loading ? <div className="space-y-3 px-5 py-3">{[1, 2].map(i => <div key={i} className="flex items-center gap-3"><Skeleton className="h-8 w-8 rounded shrink-0" /><div className="flex-1 space-y-1.5"><Skeleton className="h-4 w-3/4" /><Skeleton className="h-3 w-1/2" /></div></div>)}</div>
              : docs.length === 0 ? <Empty msg="No documents uploaded yet." /> : (
                <div className="divide-y divide-gray-100 dark:divide-gray-800">
                  {docs.slice(0, 5).map(d => (
                    <div key={d.id} className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/30">
                      <span className="text-lg shrink-0">{fileIcon(d.fileType)}</span>
                      <div className="min-w-0 flex-1"><p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{d.filename}</p><p className="text-xs text-gray-400">{fmtSize(d.fileSize)} · {timeAgo(d.createdAt)}</p></div>
                      <button
                        onClick={() => setDeleteTarget({ kind: "doc", id: d.id, label: `document ${d.filename}` })}
                        title="Delete document"
                        className="p-1.5 rounded-md text-gray-300 hover:text-red-600 dark:text-gray-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 cursor-pointer transition-colors shrink-0"
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>
        </main>
      ) : (
        <Outlet />
      )}

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => !deleting && setDeleteTarget(null)}>
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/40 flex items-center justify-center shrink-0">
                <span className="text-red-600 dark:text-red-400"><TrashIcon className="w-5 h-5" /></span>
              </div>
              <div>
                <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">Delete {deleteTarget.kind === "doc" ? "document" : deleteTarget.kind === "lead" ? "lead" : "appointment"}?</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  Delete {deleteTarget.label}? This can't be undone.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="px-4 py-2 text-sm font-semibold rounded-lg bg-red-600 text-white hover:bg-red-500 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer flex items-center gap-2"
              >
                {deleting ? (
                  <>
                    <svg className="animate-spin w-4 h-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                    Deleting…
                  </>
                ) : (
                  "Delete"
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
