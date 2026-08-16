import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect, useCallback } from "react";
export const Route = createFileRoute("/dashboard/emails")({
  component: EmailInbox,
});
// ── Types ──────────────────────────────────────────────────────────────────
interface EmailItem {
  id: string;
  fromEmail: string;
  fromName: string | null;
  toEmail: string;
  subject: string;
  body: string;
  summary: string | null;
  aiSubject: string | null;
  aiBody: string | null;
  status: "draft" | "sent" | "error";
  regenPrompt: string | null;
  error: string | null;
  leadId: string | null;
  createdAt: string;
  sentAt: string | null;
}
// ── Helpers ────────────────────────────────────────────────────────────────
function timeAgo(d: string) {
  const m = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
  if (m < 1) return "Just now";
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.floor(m / 60)}h ago`;
  if (m < 10080) return `${Math.floor(m / 1440)}d ago`;
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function fmtFull(d: string) {
  return new Date(d).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  });
}
function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700 ${className}`} />;
}
const STATUS_BADGE: Record<string, string> = {
  draft: "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300",
  sent: "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300",
  error: "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300",
};
const STATUS_LABEL: Record<string, string> = { draft: "New", sent: "Sent", error: "Error" };
// ── Toast ──────────────────────────────────────────────────────────────────
function Toast({ msg, type, onClose }: { msg: string; type: "success" | "error"; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 4000);
    return () => clearTimeout(t);
  }, [onClose]);
  const bg = type === "success" ? "bg-emerald-600" : "bg-red-600";
  return (
    <div className={`fixed bottom-6 right-6 z-50 ${bg} text-white px-4 py-3 rounded-lg shadow-lg text-sm max-w-sm animate-in slide-in-from-right-2`}>
      <div className="flex items-center justify-between gap-2">
        <span>{msg}</span>
        <button onClick={onClose} className="text-white/80 hover:text-white cursor-pointer">✕</button>
      </div>
    </div>
  );
}
// ── Page ───────────────────────────────────────────────────────────────────
function EmailInbox() {
  const [emails, setEmails] = useState<EmailItem[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [sending, setSending] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/emails");
      const j = await r.json();
      const list: EmailItem[] = (j.emails || []).map((e: Record<string, unknown>) => ({
        id: String(e.id),
        fromEmail: String(e.fromEmail ?? ""),
        fromName: (e.fromName as string | null) ?? null,
        toEmail: String(e.toEmail ?? ""),
        subject: String(e.subject ?? "(no subject)"),
        body: String(e.body ?? ""),
        summary: (e.summary as string | null) ?? null,
        aiSubject: (e.aiSubject as string | null) ?? null,
        aiBody: (e.aiBody as string | null) ?? null,
        status: (e.status as EmailItem["status"]) ?? "draft",
        regenPrompt: (e.regenPrompt as string | null) ?? null,
        error: (e.error as string | null) ?? null,
        leadId: (e.leadId as string | null) ?? null,
        createdAt: String(e.createdAt ?? new Date().toISOString()),
        sentAt: (e.sentAt as string | null) ?? null,
      }));
      setEmails(list);
      setSelectedId((cur) => cur ?? list[0]?.id ?? null);
    } catch (err) {
      console.error("Failed to load emails:", err);
      setEmails([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const selected = emails?.find((e) => e.id === selectedId) ?? null;

  async function handleSend() {
    if (!selected) return;
    setSending(true);
    try {
      const r = await fetch(`/api/emails/${encodeURIComponent(selected.id)}/send`, { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Send failed");
      setToast({ msg: "Sent ✓", type: "success" });
      await load();
    } catch (err) {
      setToast({ msg: (err as Error).message, type: "error" });
    } finally {
      setSending(false);
    }
  }

  async function handleRegenerate() {
    if (!selected) return;
    setRegenerating(true);
    try {
      const r = await fetch(`/api/emails/${encodeURIComponent(selected.id)}/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt.trim() || undefined }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Regenerate failed");
      setToast({ msg: "Draft regenerated", type: "success" });
      setPrompt("");
      setManualOpen(false);
      await load();
    } catch (err) {
      setToast({ msg: (err as Error).message, type: "error" });
    } finally {
      setRegenerating(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">📬 Email Inbox</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Customer emails land here with an AI summary + draft reply. You approve before anything sends.
          </p>
        </div>
      </div>

      {emails === null ? (
        <div className="grid md:grid-cols-[320px_1fr] gap-4">
          <div className="space-y-2"><Skeleton className="h-16" /><Skeleton className="h-16" /><Skeleton className="h-16" /></div>
          <Skeleton className="h-96" />
        </div>
      ) : emails.length === 0 ? (
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 flex flex-col items-center justify-center py-16 text-center">
          <span className="text-4xl mb-3">📬</span>
          <p className="text-sm text-gray-400 dark:text-gray-500 max-w-sm">
            No emails yet — when customers email you@your-address, they'll appear here.
          </p>
        </div>
      ) : (
        <div className="grid md:grid-cols-[320px_1fr] gap-4">
          {/* ── Inbox list ── */}
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden max-h-[75vh] overflow-y-auto">
            {emails.map((e) => (
              <button
                key={e.id}
                onClick={() => { setSelectedId(e.id); setShowOriginal(false); setManualOpen(false); }}
                className={`w-full text-left px-4 py-3 border-b border-gray-100 dark:border-gray-800 cursor-pointer transition-colors ${
                  selectedId === e.id ? "bg-indigo-50 dark:bg-indigo-900/20" : "hover:bg-gray-50 dark:hover:bg-gray-800/50"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-gray-800 dark:text-gray-200 truncate">
                    {e.fromName || e.fromEmail.split("@")[0]}
                  </span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full shrink-0 ${STATUS_BADGE[e.status] ?? STATUS_BADGE.draft}`}>
                    {STATUS_LABEL[e.status] ?? e.status}
                  </span>
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">{e.subject}</div>
                <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">{timeAgo(e.createdAt)}</div>
              </button>
            ))}
          </div>

          {/* ── Detail ── */}
          {selected ? (
            <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 space-y-4 overflow-y-auto max-h-[75vh]">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-base font-bold text-gray-900 dark:text-white truncate">{selected.subject}</h2>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    <span className="font-medium text-gray-700 dark:text-gray-300">From:</span> {selected.fromName ? `${selected.fromName} <${selected.fromEmail}>` : selected.fromEmail}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    <span className="font-medium text-gray-700 dark:text-gray-300">To:</span> {selected.toEmail} · {fmtFull(selected.createdAt)}
                  </p>
                </div>
                {selected.status === "sent" && (
                  <span className={`text-[10px] px-2 py-1 rounded-full shrink-0 ${STATUS_BADGE.sent}`}>
                    Sent {selected.sentAt ? timeAgo(selected.sentAt) : ""}
                  </span>
                )}
              </div>

              {/* AI Summary */}
              <div className="rounded-lg border border-indigo-100 dark:border-indigo-900/50 bg-indigo-50/60 dark:bg-indigo-950/30 p-4">
                <div className="text-xs font-bold text-indigo-700 dark:text-indigo-300 mb-1.5">✨ AI Summary</div>
                {selected.summary
                  ? <p className="text-sm text-gray-700 dark:text-gray-300">{selected.summary}</p>
                  : <p className="text-sm text-gray-400 dark:text-gray-500 italic">No summary yet{selected.status === "error" ? " (draft generation failed)" : ""}.</p>}
              </div>

              {/* Original email (collapsible) */}
              <div>
                <button
                  onClick={() => setShowOriginal((v) => !v)}
                  className="text-xs font-semibold text-gray-600 dark:text-gray-300 hover:text-indigo-600 dark:hover:text-indigo-400 cursor-pointer"
                >
                  {showOriginal ? "▾ Hide original email" : "▸ Show original email"}
                </button>
                {showOriginal && (
                  <pre className="mt-2 text-xs text-gray-600 dark:text-gray-400 whitespace-pre-wrap break-words rounded-lg bg-gray-50 dark:bg-gray-800/60 p-3 border border-gray-200 dark:border-gray-700 max-h-56 overflow-y-auto">
                    {selected.body || "(no body)"}
                  </pre>
                )}
              </div>

              {/* AI Draft Reply */}
              <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-bold text-gray-700 dark:text-gray-300">🤖 AI Draft Reply</div>
                  {selected.status === "sent" && <span className="text-xs text-green-600 dark:text-green-400 font-semibold">✓ Sent</span>}
                </div>

                {selected.status === "error" ? (
                  <div className="text-sm">
                    <p className="text-red-600 dark:text-red-400 mb-2">The AI couldn't draft a reply{selected.error ? `: ${selected.error}` : ""}.</p>
                    <button
                      onClick={() => { setManualOpen(true); }}
                      className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-500 cursor-pointer"
                    >
                      Try again
                    </button>
                  </div>
                ) : selected.aiSubject || selected.aiBody ? (
                  <>
                    <div className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-1">{selected.aiSubject}</div>
                    <pre className="text-sm text-gray-600 dark:text-gray-400 whitespace-pre-wrap break-words mb-3">{selected.aiBody}</pre>
                    {selected.regenPrompt && (
                      <div className="text-[11px] text-gray-400 dark:text-gray-500 mb-3 italic">Regenerated with: “{selected.regenPrompt}”</div>
                    )}
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        onClick={handleSend}
                        disabled={sending}
                        className="px-4 py-1.5 rounded-lg bg-green-600 text-white text-sm font-semibold hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                      >
                        {sending ? "Sending…" : "Send"}
                      </button>
                      <button
                        onClick={() => setManualOpen((v) => !v)}
                        className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer"
                      >
                        Manual Draft
                      </button>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-gray-400 dark:text-gray-500 italic">Draft is being generated… refresh in a moment.</p>
                )}

                {manualOpen && (
                  <div className="mt-3 border-t border-gray-200 dark:border-gray-700 pt-3">
                    <textarea
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      placeholder="Tell the AI how to redo the reply, e.g. “Make it shorter and offer a call this week.”"
                      rows={3}
                      className="w-full text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 p-2.5 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    <div className="flex justify-end mt-2">
                      <button
                        onClick={handleRegenerate}
                        disabled={regenerating}
                        className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                      >
                        {regenerating ? "Regenerating…" : "Regenerate Draft"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 flex items-center justify-center py-16 text-gray-400 dark:text-gray-500 text-sm">
              Select an email to view it
            </div>
          )}
        </div>
      )}

      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
