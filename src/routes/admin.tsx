import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";

export const Route = createFileRoute("/admin")({
  component: Admin,
});

// ── Icons (inline SVGs) ─────────────────────────────────────────────────────

function Icon({ d, className = "h-5 w-5" }: { d: string; className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  );
}
const Building = "M2.25 21h19.5M3.75 21v-4.5M7.5 21v-4.5M11.25 21v-4.5M14.25 21v-4.5M18.75 21v-4.5M3.75 16.5V5.625c0-.621.504-1.125 1.125-1.125h14.25c.621 0 1.125.504 1.125 1.125V16.5M6.75 7.5h3.75M6.75 10.5h10.5M6.75 13.5h7.5";
const Bot = "M9.75 3.75h4.5M12 3.75v3M8.25 9.75h7.5M8.25 12.75h7.5M12 18.75c4.97 0 9-2.015 9-4.5s-4.03-4.5-9-4.5-9 2.015-9 4.5 4.03 4.5 9 4.5zM8.25 15.75h7.5";
const Zap = "M13 10V3L4 14h7v7l9-11h-7z";
const ChartBar = "M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zm7.5-4.5c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zm7.5-4.5c0-.621.504-1.125 1.125-1.125h2.25C22.496 3 23 3.504 23 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z";
const Clock = "M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z";
const Rocket = "M15.59 14.37a6 6 0 01-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.631 8.41m5.96 5.96a14.93 14.93 0 01-5.841 2.58m-.119-8.54a6 6 0 00-7.381 5.84h4.8m2.581-5.84a14.93 14.93 0 00-2.58 5.84m2.699 2.7c-.103.021-.207.041-.311.06a15.09 15.09 0 01-2.448-2.448 14.9 14.9 0 01.06-.312m-2.24 2.39a4.493 4.493 0 00-1.757 4.306 4.493 4.493 0 004.306-1.758M16.5 9a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z";
const Flame = "M15.362 5.214A8.252 8.252 0 0112 21 8.25 8.25 0 016.038 7.048 8.287 8.287 0 009 9.6a8.983 8.983 0 013.361-6.867 8.21 8.21 0 003 2.48z";
const Users = "M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z";
const Phone = "M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25Z";
const BookOpen = "M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25";

// ── Spinner ─────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

// ── Stat Card ───────────────────────────────────────────────────────────────

function StatCard({ label, value, icon, loading }: { label: string; value: string | number; icon: string; loading?: boolean }) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
      <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-800 mb-3">
        <Icon d={icon} className="h-4 w-4 text-gray-500" />
      </span>
      {loading ? (
        <div className="animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700 h-7 w-16 mb-1" />
      ) : (
        <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{value}</p>
      )}
      <p className="text-sm text-gray-400">{label}</p>
    </div>
  );
}

// ── Nav Card ────────────────────────────────────────────────────────────────

function NavCard({ to, emoji, title, desc }: { to: string; emoji: string; title: string; desc: string }) {
  return (
    <Link
      to={to}
      className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 hover:shadow-md hover:border-indigo-300 dark:hover:border-indigo-700 transition-all group"
    >
      <span className="text-2xl mb-3 block">{emoji}</span>
      <h3 className="font-semibold text-gray-900 dark:text-gray-100 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">{title}</h3>
      <p className="text-xs text-gray-400 mt-1">{desc}</p>
    </Link>
  );
}

// ── Main Admin Dashboard ────────────────────────────────────────────────────

function Admin() {
  // Session / guard state
  const [authorized, setAuthorized] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [sessionEmail, setSessionEmail] = useState("");

  // Stats
  const [totalLeads, setTotalLeads] = useState<number | null>(null);
  const [activeAutomations, setActiveAutomations] = useState<number | null>(null);
  const [automationRunsToday, setAutomationRunsToday] = useState<number | null>(null);

  // System status
  const [systemStatus, setSystemStatus] = useState<{ name: string; status: string; color: string }[]>([]);

  // Invite dialog
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteLink, setInviteLink] = useState("");
  const [inviteCopied, setInviteCopied] = useState(false);
  const [inviteGenerating, setInviteGenerating] = useState(false);
  const [inviteSent, setInviteSent] = useState(false);
  const [inviteSending, setInviteSending] = useState(false);

  // ── Auth guard ──────────────────────────────────────────────────────────

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/auth/session");
        if (res.ok) {
          const data = await res.json();
          // Any admin-role user (not just a hard-coded email) can reach the portal
          if (data.user?.role === "admin") {
            setSessionEmail(data.user.email || "");
            setAuthorized(true);
            return;
          }
        }
      } catch (e) {
        console.error("Auth check failed:", e);
      }
      // Not the owner — redirect
      window.location.href = "/dashboard";
    })();
  }, []);

  // ── Load stats after auth ───────────────────────────────────────────────

  useEffect(() => {
    if (!authorized) return;
    (async () => {
      try {
        const [statsRes, automationsRes] = await Promise.all([
          fetch("/api/stats"),
          fetch("/api/automations"),
        ]);
        if (statsRes.ok) {
          const d = await statsRes.json();
          setTotalLeads(d.stats?.totalLeads ?? 0);
          setAutomationRunsToday(d.stats?.totalAutomationRuns ?? 0);
        }
        if (automationsRes.ok) {
          const d = await automationsRes.json();
          const automations = d.automations || [];
          setActiveAutomations(automations.filter((a: { enabled: boolean }) => a.enabled).length);
        }
      } catch (e) {
        console.error("Failed to load stats:", e);
      } finally {
        setAuthLoading(false);
      }

      // System status (static checks for demo)
      setSystemStatus([
        { name: "Twilio Voice (AI Receptionist)", status: "Live", color: "green" },
        { name: "OpenAI GPT + TTS", status: "Connected", color: "green" },
        { name: "SendGrid Email", status: "Connected", color: "green" },
        { name: "Google OAuth", status: "Not configured", color: "yellow" },
        { name: "Stripe Connect", status: "Not configured", color: "yellow" },
      ]);
    })();
  }, [authorized]);

  // ── Invite handlers ─────────────────────────────────────────────────────

  const generateInvite = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail) return;
    setInviteGenerating(true);
    setTimeout(async () => {
      const workspaceId = "ws_" + Math.random().toString(36).slice(2, 10);
      const inviteCode = "inv_" + Math.random().toString(36).slice(2, 14);
      const link = `${window.location.origin}/sign-up?workspace=${workspaceId}&invite=${inviteCode}&email=${encodeURIComponent(inviteEmail)}`;
      setInviteLink(link);
      setInviteGenerating(false);
      try {
        const invites = JSON.parse(localStorage.getItem("fp_invites") || "[]");
        invites.push({ email: inviteEmail, workspaceId, inviteCode, date: new Date().toISOString() });
        localStorage.setItem("fp_invites", JSON.stringify(invites));
      } catch {}
      setInviteSending(true);
      try {
        const res = await fetch("/api/send-invite", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: inviteEmail, inviteLink: link }),
        });
        if (res.ok) setInviteSent(true);
      } catch (err) {
        console.error("Failed to send invite email:", err);
      } finally {
        setInviteSending(false);
      }
    }, 800);
  };

  const copyInviteLink = () => {
    navigator.clipboard.writeText(inviteLink);
    setInviteCopied(true);
    setTimeout(() => setInviteCopied(false), 2000);
  };

  const closeInvite = () => {
    setInviteOpen(false);
    setInviteEmail("");
    setInviteLink("");
    setInviteCopied(false);
    setInviteSent(false);
    setInviteGenerating(false);
  };

  // ── Loading guard ────────────────────────────────────────────────────────

  if (!authorized) {
    return (
      <div className="min-h-dvh bg-gray-50 dark:bg-gray-950 flex items-center justify-center">
        <div className="flex items-center gap-3 text-gray-400">
          <Spinner />
          <span className="text-sm">Checking access...</span>
        </div>
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="min-h-dvh bg-gray-50 dark:bg-gray-950">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-6 py-3">
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold text-indigo-600 dark:text-indigo-400">FlowPilot AI</span>
          <span className="rounded bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300">ADMIN</span>
        </div>
        <div className="flex items-center gap-4">
          <Link to="/dashboard/settings" className="text-sm text-gray-500 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">
            ⚙️ Settings
          </Link>
          <button
            onClick={() => setInviteOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 transition-colors cursor-pointer"
          >
            <span>👥</span> Invite Client
          </button>
          <span className="text-sm text-gray-500">{sessionEmail}</span>
          <Link to="/" className="text-sm text-gray-400 hover:text-red-500 transition-colors">Sign out</Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 sm:px-6 py-8 space-y-8">
        {/* Stats Bar */}
        <section>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Total Leads" value={totalLeads ?? "—"} icon={Users} loading={authLoading} />
            <StatCard label="Active Automations" value={activeAutomations ?? "—"} icon={Zap} loading={authLoading} />
            <StatCard label="Automation Runs" value={automationRunsToday ?? "—"} icon={ChartBar} loading={authLoading} />
            <StatCard label="AI Employees" value="3" icon={Bot} loading={authLoading} />
          </div>
        </section>

        {/* Navigation Cards */}
        <section>
          <h2 className="text-lg font-bold tracking-tight text-gray-900 dark:text-gray-100 mb-4">Quick Actions</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <NavCard to="/dashboard/settings" emoji="⚙️" title="Settings" desc="Email config, domain verification, workspace preferences." />
            <NavCard to="/dashboard/automations" emoji="⚡" title="Automations" desc="Create and manage workflow automations." />
            <NavCard to="/dashboard/ai-employees" emoji="🤖" title="AI Employees" desc="View and manage your AI employee team." />
            <NavCard to="/client/deck" emoji="📋" title="Onboarding Deck" desc="Replay the onboarding setup wizard." />
          </div>
        </section>

        {/* System Status */}
        <section>
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-800">
              <h2 className="text-sm font-bold text-gray-700 dark:text-gray-300">🔌 System Status</h2>
            </div>
            <div className="px-5 py-4">
              <div className="space-y-3">
                {systemStatus.map(s => (
                  <div key={s.name} className="flex items-center justify-between text-sm">
                    <span className="text-gray-600 dark:text-gray-400">{s.name}</span>
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      s.color === "green"
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                        : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                    }`}>{s.status}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Onboarding Replay */}
        <section>
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-800">
              <h2 className="text-sm font-bold text-gray-700 dark:text-gray-300">📋 Onboarding</h2>
            </div>
            <div className="px-5 py-6 text-center">
              <span className="text-3xl mb-3 block">🚀</span>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                Walk through the client onboarding experience to see what new users see.
              </p>
              <a
                href="/client/deck"
                className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 transition-colors"
              >
                Replay Onboarding Deck →
              </a>
            </div>
          </div>
        </section>
      </main>

      {/* ── Invite Dialog ──────────────────────────────────────────────────── */}
      {inviteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={closeInvite} />
          <div className="relative z-10 w-full max-w-md mx-4 rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 shadow-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">👥 Invite Client</h2>
              <button onClick={closeInvite} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xl leading-none">&times;</button>
            </div>

            {!inviteLink ? (
              <form onSubmit={generateInvite} className="space-y-4">
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Enter your client's email to generate an invite link and email it to them.
                </p>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Client Email</label>
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={e => setInviteEmail(e.target.value)}
                    placeholder="client@company.com"
                    className="w-full rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-2.5 text-sm bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                    required
                    autoFocus
                  />
                </div>
                <div className="flex gap-3">
                  <button type="button" onClick={closeInvite} className="flex-1 rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-2 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors cursor-pointer">
                    Cancel
                  </button>
                  <button type="submit" disabled={inviteGenerating} className="flex-1 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 transition-colors disabled:opacity-50 cursor-pointer">
                    {inviteGenerating ? "Generating..." : "Generate & Send Invite"}
                  </button>
                </div>
              </form>
            ) : (
              <div className="space-y-4">
                {inviteSent ? (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-800 p-4">
                    <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">✅ Invite Queued — Delivering Now</p>
                    <p className="text-xs text-emerald-600/70 dark:text-emerald-400 mt-1">
                      Invite for <strong>{inviteEmail}</strong> is on its way.
                    </p>
                  </div>
                ) : (
                  <div className="rounded-xl border border-indigo-200 bg-indigo-50 dark:bg-indigo-950/30 dark:border-indigo-800 p-4">
                    <p className="text-sm font-medium text-indigo-700 dark:text-indigo-300">
                      {inviteSending ? "⏳ Sending invite..." : "✅ Invite Link Ready"}
                    </p>
                    <p className="text-xs text-indigo-600/70 dark:text-indigo-400 mt-1">
                      {inviteSending ? "Delivering email to" : "Sending invite to"} <strong>{inviteEmail}</strong>.
                    </p>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <input
                    readOnly
                    value={inviteLink}
                    className="flex-1 rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 text-xs font-mono bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 truncate"
                    onClick={e => (e.target as HTMLInputElement).select()}
                  />
                  <button onClick={copyInviteLink} className="shrink-0 rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors cursor-pointer">
                    {inviteCopied ? "✅ Copied" : "📋 Copy"}
                  </button>
                </div>
                <button onClick={closeInvite} className="w-full rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-2 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors cursor-pointer">
                  Done
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
