import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect, useCallback } from "react";

export const Route = createFileRoute("/dashboard/automations")({
  component: AutomationsPage,
});

// ── Types ──────────────────────────────────────────────────────────────────

interface AiEmployee {
  id: string;
  name: string;
  type: string;
}

interface Automation {
  id: string;
  name: string;
  triggerType: string;
  actionType: string;
  aiEmployeeId: string | null;
  enabled: boolean;
  createdAt: string;
  aiEmployee?: AiEmployee | null;
}

// ── Labels ─────────────────────────────────────────────────────────────────

const TRIGGER_LABELS: Record<string, string> = {
  new_lead: "New Lead",
  new_email: "New Email",
  invoice_request: "Invoice Request",
  web_chat: "Web Chat",
};

const ACTION_LABELS: Record<string, string> = {
  score_lead: "Score Lead",
  generate_reply: "Generate Reply",
  generate_invoice: "Generate Invoice",
  detect_scheduling: "Detect Scheduling",
};

const TRIGGER_COLORS: Record<string, string> = {
  new_lead: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  new_email: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  invoice_request: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  web_chat: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
};

const ACTION_COLORS: Record<string, string> = {
  score_lead: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300",
  generate_reply: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  generate_invoice: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
  detect_scheduling: "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300",
};

// ── Icons ───────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

// ── Toast ───────────────────────────────────────────────────────────────────

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

// ── Confirm Dialog ──────────────────────────────────────────────────────────

function ConfirmDialog({ title, message, onConfirm, onCancel, loading }: {
  title: string; message: string; onConfirm: () => void; onCancel: () => void; loading?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
      <div className="relative z-10 w-full max-w-sm mx-4 rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 shadow-2xl p-6">
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">{title}</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">{message}</p>
        <div className="flex gap-3 mt-6">
          <button onClick={onCancel} className="flex-1 rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-2 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors cursor-pointer">
            Cancel
          </button>
          <button onClick={onConfirm} disabled={loading} className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 transition-colors disabled:opacity-50 cursor-pointer">
            {loading ? "Deleting..." : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Modal Form ──────────────────────────────────────────────────────────────

function AutomationForm({ automation, employees, onSave, onClose, saving }: {
  automation?: Automation | null;
  employees: AiEmployee[];
  onSave: (data: { name: string; triggerType: string; actionType: string; aiEmployeeId: string; enabled: boolean; id?: string }) => void;
  onClose: () => void;
  saving: boolean;
}) {
  const [name, setName] = useState(automation?.name || "");
  const [triggerType, setTriggerType] = useState(automation?.triggerType || "new_lead");
  const [actionType, setActionType] = useState(automation?.actionType || "score_lead");
  const [aiEmployeeId, setAiEmployeeId] = useState(automation?.aiEmployeeId || "");
  const [enabled, setEnabled] = useState(automation?.enabled ?? true);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSave({ name: name.trim(), triggerType, actionType, aiEmployeeId: aiEmployeeId || "", enabled, id: automation?.id });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh]">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg mx-4 rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 shadow-2xl max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-800">
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
            {automation ? "Edit Automation" : "Create Automation"}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xl leading-none cursor-pointer">&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Name</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Follow-up email sequence"
              className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              required
              autoFocus
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Trigger Type</label>
              <select
                value={triggerType}
                onChange={e => setTriggerType(e.target.value)}
                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {Object.entries(TRIGGER_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Action Type</label>
              <select
                value={actionType}
                onChange={e => setActionType(e.target.value)}
                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {Object.entries(ACTION_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">AI Employee</label>
            <select
              value={aiEmployeeId}
              onChange={e => setAiEmployeeId(e.target.value)}
              className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">-- Select AI Employee --</option>
              {employees.map(emp => (
                <option key={emp.id} value={emp.id}>{emp.name} ({emp.type})</option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-3 cursor-pointer">
            <div className={`relative w-10 h-6 rounded-full transition-colors ${enabled ? "bg-indigo-600" : "bg-gray-300 dark:bg-gray-600"}`}>
              <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${enabled ? "left-[18px]" : "left-0.5"}`} />
            </div>
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Enabled</span>
          </label>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-2 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors cursor-pointer">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="flex-1 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 transition-colors disabled:opacity-50 cursor-pointer inline-flex items-center justify-center gap-2">
              {saving && <Spinner />}
              {saving ? "Saving..." : automation ? "Update" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main Page ───────────────────────────────────────────────────────────────

function AutomationsPage() {
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [employees, setEmployees] = useState<AiEmployee[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // Modal state
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Automation | null>(null);
  const [saving, setSaving] = useState(false);

  // Delete state
  const [deleteTarget, setDeleteTarget] = useState<Automation | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchAutomations = useCallback(async () => {
    try {
      const res = await fetch("/api/automations");
      if (res.ok) {
        const data = await res.json();
        setAutomations(data.automations || []);
      }
    } catch (e) {
      console.error("Failed to fetch automations:", e);
    }
  }, []);

  const fetchEmployees = useCallback(async () => {
    try {
      const res = await fetch("/api/ai-employees");
      if (res.ok) {
        const data = await res.json();
        setEmployees(data.employees || []);
      }
    } catch (e) {
      console.error("Failed to fetch employees:", e);
    }
  }, []);

  useEffect(() => {
    (async () => {
      await Promise.all([fetchAutomations(), fetchEmployees()]);
      setLoading(false);
    })();
  }, [fetchAutomations, fetchEmployees]);

  // ── Handlers ────────────────────────────────────────────────────────────

  const handleToggle = async (auto: Automation) => {
    try {
      const res = await fetch("/api/automations", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: auto.id, enabled: !auto.enabled }),
      });
      if (res.ok) {
        setAutomations(prev => prev.map(a => a.id === auto.id ? { ...a, enabled: !a.enabled } : a));
        setToast({ type: "success", message: `${auto.name} ${auto.enabled ? "disabled" : "enabled"}.` });
      } else {
        const err = await res.json();
        setToast({ type: "error", message: err.error || "Failed to update automation." });
      }
    } catch {
      setToast({ type: "error", message: "Network error." });
    }
  };

  const handleSave = async (data: { name: string; triggerType: string; actionType: string; aiEmployeeId: string; enabled: boolean; id?: string }) => {
    setSaving(true);
    try {
      const isEdit = !!data.id;
      const res = await fetch("/api/automations", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        setToast({ type: "success", message: isEdit ? "Automation updated." : "Automation created." });
        setFormOpen(false);
        setEditing(null);
        await fetchAutomations();
      } else {
        const err = await res.json();
        setToast({ type: "error", message: err.error || "Failed to save automation." });
      }
    } catch {
      setToast({ type: "error", message: "Network error." });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/automations?id=${deleteTarget.id}`, { method: "DELETE" });
      if (res.ok) {
        setToast({ type: "success", message: `"${deleteTarget.name}" deleted.` });
        setDeleteTarget(null);
        await fetchAutomations();
      } else {
        const err = await res.json();
        setToast({ type: "error", message: err.error || "Failed to delete automation." });
      }
    } catch {
      setToast({ type: "error", message: "Network error." });
    } finally {
      setDeleting(false);
    }
  };

  // ── Helpers ─────────────────────────────────────────────────────────────

  const getAiEmployee = (auto: Automation) => {
    if (auto.aiEmployee) return auto.aiEmployee.name;
    if (!auto.aiEmployeeId) return "—";
    const emp = employees.find(e => e.id === auto.aiEmployeeId);
    return emp ? emp.name : "—";
  };

  const formatDate = (iso: string) => {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="min-h-dvh bg-gray-50 dark:bg-gray-950">
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}

      {/* Header */}
      <header className="flex items-center justify-between border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-6 py-3">
        <div className="flex items-center gap-4">
          <Link to="/dashboard" className="text-sm text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">
            ← Dashboard
          </Link>
          <span className="text-lg font-bold text-indigo-600 dark:text-indigo-400">FlowPilot AI</span>
          <span className="rounded bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300">AUTOMATIONS</span>
        </div>
        <Link to="/" className="text-sm text-gray-400 hover:text-red-500 transition-colors">Sign out</Link>
      </header>

      <main className="mx-auto max-w-5xl px-4 sm:px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">⚡ Automations</h1>
            <p className="text-gray-500 dark:text-gray-400 mt-1">Create and manage automated workflows for your workspace.</p>
          </div>
          <button
            onClick={() => { setEditing(null); setFormOpen(true); }}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 transition-colors cursor-pointer"
          >
            + Create Automation
          </button>
        </div>

        {/* Content */}
        {loading ? (
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
            <div className="px-5 py-4 space-y-4">
              {[1, 2, 3].map(i => (
                <div key={i} className="animate-pulse flex items-center gap-4">
                  <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-32" />
                  <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-20" />
                  <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-20" />
                  <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-16 ml-auto" />
                </div>
              ))}
            </div>
          </div>
        ) : automations.length === 0 ? (
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 flex flex-col items-center justify-center py-16 px-4">
            <span className="text-4xl mb-4">⚡</span>
            <h2 className="text-lg font-semibold text-gray-700 dark:text-gray-300">No Automations Yet</h2>
            <p className="text-sm text-gray-400 mt-1 mb-6 text-center max-w-sm">
              Create your first automation to automatically handle leads, emails, invoices, and scheduling.
            </p>
            <button
              onClick={() => { setEditing(null); setFormOpen(true); }}
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 transition-colors cursor-pointer"
            >
              + Create Automation
            </button>
          </div>
        ) : (
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
                    <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Name</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Trigger</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Action</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">AI Employee</th>
                    <th className="text-center px-5 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Enabled</th>
                    <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Created</th>
                    <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {automations.map(auto => (
                    <tr key={auto.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors">
                      <td className="px-5 py-3.5">
                        <p className="font-medium text-gray-900 dark:text-gray-100">{auto.name}</p>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${TRIGGER_COLORS[auto.triggerType] || "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"}`}>
                          {TRIGGER_LABELS[auto.triggerType] || auto.triggerType}
                        </span>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${ACTION_COLORS[auto.actionType] || "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"}`}>
                          {ACTION_LABELS[auto.actionType] || auto.actionType}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-gray-600 dark:text-gray-400">
                        {getAiEmployee(auto)}
                      </td>
                      <td className="px-5 py-3.5 text-center">
                        <button
                          onClick={() => handleToggle(auto)}
                          className={`relative w-10 h-6 rounded-full transition-colors cursor-pointer ${auto.enabled ? "bg-indigo-600" : "bg-gray-300 dark:bg-gray-600"}`}
                        >
                          <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${auto.enabled ? "left-[18px]" : "left-0.5"}`} />
                        </button>
                      </td>
                      <td className="px-5 py-3.5 text-right text-gray-400 text-xs whitespace-nowrap">
                        {formatDate(auto.createdAt)}
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => { setEditing(auto); setFormOpen(true); }}
                            className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 dark:hover:text-indigo-400 transition-colors cursor-pointer"
                          >
                            ✏️ Edit
                          </button>
                          <button
                            onClick={() => setDeleteTarget(auto)}
                            className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium text-gray-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 dark:hover:text-red-400 transition-colors cursor-pointer"
                          >
                            🗑️ Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      {/* Form Modal */}
      {formOpen && (
        <AutomationForm
          automation={editing}
          employees={employees}
          onSave={handleSave}
          onClose={() => { setFormOpen(false); setEditing(null); }}
          saving={saving}
        />
      )}

      {/* Delete Confirm */}
      {deleteTarget && (
        <ConfirmDialog
          title="Delete Automation"
          message={`Are you sure you want to delete "${deleteTarget.name}"? This action cannot be undone.`}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
          loading={deleting}
        />
      )}
    </div>
  );
}
