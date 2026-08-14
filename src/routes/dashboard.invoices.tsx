import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect, useCallback } from "react";

export const Route = createFileRoute("/dashboard/invoices")({
  component: InvoiceDashboard,
});

// ── Types ──────────────────────────────────────────────────────────────────

interface Invoice {
  id: string;
  customerName: string;
  customerEmail: string | null;
  amountCents: number;
  status: string;
  dueDate: string | null;
  createdAt: string;
  invoiceNumber?: string;
}

// ── Constants ──────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  sent: "bg-blue-100 text-blue-700 dark:bg-blue-900/60 dark:text-blue-300",
  paid: "bg-green-100 text-green-700 dark:bg-green-900/60 dark:text-green-300",
  overdue: "bg-red-100 text-red-700 dark:bg-red-900/60 dark:text-red-300",
  cancelled: "bg-gray-100 text-gray-500 line-through dark:bg-gray-800",
};

// ── Helpers ────────────────────────────────────────────────────────────────

function fmt$(c: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(c / 100);
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function timeAgo(d: string) {
  const m = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
  if (m < 1) return "Just now";
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.floor(m / 60)}h ago`;
  if (m < 10080) return `${Math.floor(m / 1440)}d ago`;
  return new Date(d).toLocaleDateString();
}

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700 ${className}`} />;
}

function Empty({ msg }: { msg: string }) {
  return <div className="flex flex-col items-center justify-center py-12 text-center">
    <span className="text-4xl mb-3">💰</span>
    <p className="text-sm text-gray-400 dark:text-gray-500">{msg}</p>
  </div>;
}

// ── Toast ──────────────────────────────────────────────────────────────────

function Toast({ msg, type, onClose }: { msg: string; type: "success" | "error"; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 4000);
    return () => clearTimeout(t);
  }, [onClose]);

  const bg = type === "success"
    ? "bg-emerald-600"
    : "bg-red-600";

  return (
    <div className={`fixed bottom-6 right-6 z-50 ${bg} text-white px-4 py-3 rounded-lg shadow-lg text-sm max-w-sm animate-in slide-in-from-right-2`}>
      <div className="flex items-center justify-between gap-2">
        <span>{msg}</span>
        <button onClick={onClose} className="text-white/80 hover:text-white cursor-pointer">✕</button>
      </div>
    </div>
  );
}

// ── Send Invoice Modal ────────────────────────────────────────────────────

function SendInvoiceModal({ onClose, onSent }: { onClose: () => void; onSent: (inv: Invoice) => void }) {
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [serviceDescription, setServiceDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [paymentInstructions, setPaymentInstructions] = useState("");
  const [paymentLink, setPaymentLink] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const handleSend = async () => {
    setError("");
    if (!customerName.trim() || !customerEmail.trim() || !amount) {
      setError("Customer name, email, and amount are required.");
      return;
    }

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setError("Please enter a valid amount.");
      return;
    }

    // Basic email validation
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail.trim())) {
      setError("Please enter a valid email address.");
      return;
    }

    setSending(true);
    try {
      const res = await fetch("/api/workspace/send-invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_name: customerName.trim(),
          customer_email: customerEmail.trim(),
          service_description: serviceDescription.trim() || "Services",
          amount: parsedAmount,
          due_date: dueDate || undefined,
          payment_instructions: paymentInstructions.trim() || undefined,
          payment_link: paymentLink.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to send invoice. Please try again.");
        setSending(false);
        return;
      }

      onSent(data.invoice);
      onClose();
    } catch (err) {
      setError("Network error. Please try again.");
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-800">
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">📧 Send Invoice</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-pointer text-xl leading-none">✕</button>
        </div>

        <div className="px-6 py-4 space-y-4">
          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-2.5 rounded-lg text-sm">{error}</div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">Customer Name *</label>
              <input
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Jane Smith"
                className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">Email *</label>
              <input
                type="email"
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
                placeholder="jane@example.com"
                className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">Service Description</label>
              <input
                type="text"
                value={serviceDescription}
                onChange={(e) => setServiceDescription(e.target.value)}
                placeholder="e.g. Roof inspection"
                className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">Amount ($) *</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">Due Date</label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">Payment Instructions</label>
            <textarea
              value={paymentInstructions}
              onChange={(e) => setPaymentInstructions(e.target.value)}
              placeholder="Please remit payment at your earliest convenience."
              rows={2}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">Payment Link (optional)</label>
            <input
              type="url"
              value={paymentLink}
              onChange={(e) => setPaymentLink(e.target.value)}
              placeholder="https://buy.stripe.com/xxx or https://paypal.me/yourname/50"
              className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <p className="text-xs text-gray-400 mt-1">Paste your Stripe Payment Link, PayPal.Me, or Venmo link to add a "Pay Now" button to the email and PDF. Leave blank to use your workspace default.</p>
          </div>

          <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3 text-xs text-gray-500 dark:text-gray-400">
            💡 A professional PDF invoice will be generated and emailed to the customer. You can customize payment instructions above.
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200 dark:border-gray-800">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleSend}
            disabled={sending}
            className="px-5 py-2 text-sm font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-500 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer flex items-center gap-2"
          >
            {sending ? (
              <>
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Sending...
              </>
            ) : (
              "Send Invoice"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────

function InvoiceDashboard() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [showSendModal, setShowSendModal] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Invoice | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [name, setName] = useState("There");
  const [emailConfigured, setEmailConfigured] = useState(true);

  const fetchInvoices = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      const res = await fetch(`/api/invoices?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setInvoices(data.invoices || []);
      }
    } catch (err) {
      console.error("Failed to fetch invoices:", err);
    }
  }, [statusFilter]);

  useEffect(() => {
    const n = localStorage.getItem("fp_client_name");
    if (n) setName(n);
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchInvoices().finally(() => setLoading(false));
  }, [fetchInvoices]);

  // Check if workspace email is configured
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/workspace/email-config");
        if (res.ok) {
          const data = await res.json();
          if (!data.from_email) setEmailConfigured(false);
        }
      } catch {
        setEmailConfigured(false);
      }
    })();
  }, []);

  const handleInvoiceSent = (inv: Invoice) => {
    setInvoices((prev) => [inv, ...prev]);
    setToast({ msg: `Invoice sent to ${inv.customerName}!`, type: "success" });
  };

  const handleDeleteInvoice = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/workspace/invoices?id=${encodeURIComponent(deleteTarget.id)}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to delete invoice");
      }
      setInvoices((prev) => prev.filter((i) => i.id !== deleteTarget.id));
      setToast({ msg: `Invoice for ${deleteTarget.customerName} deleted.`, type: "success" });
      setDeleteTarget(null);
    } catch (err) {
      setToast({ msg: err instanceof Error ? err.message : "Failed to delete invoice", type: "error" });
    } finally {
      setDeleting(false);
    }
  };

  const filtered = invoices.filter((inv) => {
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        inv.customerName.toLowerCase().includes(q) ||
        (inv.customerEmail || "").toLowerCase().includes(q) ||
        inv.id.toLowerCase().includes(q)
      );
    }
    return true;
  });

  // Summary stats
  const totalAmount = filtered.reduce((sum, inv) => sum + inv.amountCents, 0);
  const pendingAmount = filtered.filter((i) => i.status === "sent" || i.status === "overdue").reduce((sum, inv) => sum + inv.amountCents, 0);
  const overdueCount = filtered.filter((i) => i.status === "overdue").length;
  const paidCount = filtered.filter((i) => i.status === "paid").length;

  return (
    <div className="min-h-dvh bg-gray-50 dark:bg-gray-950">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-6 py-3 sticky top-0 z-10">
        <div className="flex items-center gap-6">
          <Link to="/dashboard" className="text-lg font-bold text-indigo-600 dark:text-indigo-400 hover:opacity-80">FlowPilot AI</Link>
          <nav className="hidden sm:flex items-center gap-4 text-sm">
            <Link to="/dashboard" className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">Dashboard</Link>
            <span className="text-indigo-600 dark:text-indigo-400 font-semibold">Invoices</span>
            <Link to="/dashboard/automations" className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">Automations</Link>
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-500 dark:text-gray-400">👤 {name}</span>
          <Link to="/" className="text-sm text-gray-400 hover:text-red-500">Sign out</Link>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 sm:px-6 py-6 space-y-6">
        {/* Page Title */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">💰 Invoices</h1>
            <p className="text-gray-500 dark:text-gray-400 mt-1">Generate and send professional PDF invoices to your customers.</p>
          </div>
          <button
            onClick={() => setShowSendModal(true)}
            disabled={!emailConfigured}
            className="px-4 py-2.5 text-sm font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-500 disabled:bg-gray-400 dark:disabled:bg-gray-700 disabled:cursor-not-allowed cursor-pointer flex items-center gap-2 shadow-sm"
            title={!emailConfigured ? "Configure your email in Admin Settings first" : undefined}
          >
            <span>📧</span> Send Invoice
          </button>
        </div>

        {!emailConfigured && (
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 px-4 py-3 rounded-xl text-sm flex items-center justify-between">
            <span>⚠️ Workspace email not configured. Set up your sender email in <Link to="/dashboard/settings" className="underline font-medium">Workspace Settings</Link> before sending invoices.</span>
          </div>
        )}

        {/* Stats Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: "Total Invoices", value: filtered.length, icon: "📋" },
            { label: "Outstanding", value: fmt$(pendingAmount), icon: "⏳" },
            { label: "Overdue", value: overdueCount, icon: "🚩" },
            { label: "Paid", value: paidCount, icon: "✅" },
          ].map((s) => (
            <div key={s.label} className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 hover:shadow-md transition-shadow">
              <span className="text-2xl">{s.icon}</span>
              {loading ? <Skeleton className="h-8 w-20 mt-2" /> : <p className="text-2xl font-bold mt-2 text-gray-900 dark:text-gray-100">{s.value}</p>}
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔍</span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search invoices..."
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
          >
            <option value="">All Statuses</option>
            <option value="draft">Draft</option>
            <option value="sent">Sent</option>
            <option value="paid">Paid</option>
            <option value="overdue">Overdue</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>

        {/* Invoices Table */}
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-12 gap-3 px-5 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700">
            <span className="col-span-2">Customer</span>
            <span className="col-span-2">Amount</span>
            <span className="col-span-2">Status</span>
            <span className="col-span-2">Due Date</span>
            <span className="col-span-2">Created</span>
            <span className="col-span-2 text-right">Actions</span>
          </div>

          {loading ? (
            <div className="space-y-3 px-5 py-4">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="grid grid-cols-12 gap-3 items-center">
                  <div className="col-span-2 space-y-1.5">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-3 w-32" />
                  </div>
                  <Skeleton className="h-4 w-16 col-span-2" />
                  <Skeleton className="h-5 w-16 rounded-full col-span-2" />
                  <Skeleton className="h-3 w-20 col-span-2" />
                  <Skeleton className="h-3 w-12 col-span-2" />
                  <Skeleton className="h-4 w-12 ml-auto col-span-2" />
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <Empty msg={searchQuery || statusFilter ? "No invoices match your filters." : "No invoices yet. Send your first one!"} />
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {filtered.map((inv) => (
                <div key={inv.id} className="grid grid-cols-12 gap-3 px-5 py-3.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors items-center">
                  <div className="col-span-2 min-w-0">
                    <p className="font-medium text-gray-900 dark:text-gray-100 truncate">{inv.customerName}</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 truncate">{inv.customerEmail || "—"}</p>
                  </div>
                  <span className="col-span-2 font-mono text-sm text-gray-700 dark:text-gray-300">{fmt$(inv.amountCents)}</span>
                  <span className="col-span-2">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium uppercase ${STATUS_COLORS[inv.status] || "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"}`}>
                      {inv.status}
                    </span>
                  </span>
                  <span className="col-span-2 text-xs text-gray-500 dark:text-gray-400">{inv.dueDate ? fmtDate(inv.dueDate) : "—"}</span>
                  <span className="col-span-2 text-xs text-gray-400">{timeAgo(inv.createdAt)}</span>
                  <div className="col-span-2 flex items-center justify-end gap-2">
                    {inv.status === "sent" && (
                      <button
                        onClick={async () => {
                          // Resend functionality — re-trigger endpoint
                          setToast({ msg: "Resend coming soon", type: "error" });
                        }}
                        className="text-xs px-2 py-1 rounded-md text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 cursor-pointer"
                      >
                        Resend
                      </button>
                    )}
                    <Link
                      to="/dashboard"
                      className="text-xs px-2 py-1 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer"
                    >
                      View
                    </Link>
                    <button
                      onClick={() => setDeleteTarget(inv)}
                      title="Delete invoice"
                      className="p-1.5 rounded-md text-gray-300 hover:text-red-600 dark:text-gray-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 cursor-pointer transition-colors"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                        <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 1 0 .23 1.482l.149-.022.841 10.518A2.75 2.75 0 0 0 7.596 19h4.807a2.75 2.75 0 0 0 2.742-2.53l.841-10.52.149.023a.75.75 0 0 0 .23-1.482 41.03 41.03 0 0 0-2.365-.298V3.75A2.75 2.75 0 0 0 11.25 1h-2.5ZM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4ZM8.58 7.72a.75.75 0 0 0-1.5.06l.3 7.5a.75.75 0 1 0 1.5-.06l-.3-7.5Zm4.34.06a.75.75 0 1 0-1.5-.06l-.3 7.5a.75.75 0 1 0 1.5.06l.3-7.5Z" clipRule="evenodd" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Footer with total */}
          {!loading && filtered.length > 0 && (
            <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/30 flex items-center justify-between">
              <span className="text-sm text-gray-500 dark:text-gray-400">
                {filtered.length} invoice{filtered.length !== 1 ? "s" : ""} • Total: <span className="font-semibold text-gray-700 dark:text-gray-300">{fmt$(totalAmount)}</span>
              </span>
            </div>
          )}
        </div>
      </main>

      {/* Send Invoice Modal */}
      {showSendModal && (
        <SendInvoiceModal
          onClose={() => setShowSendModal(false)}
          onSent={handleInvoiceSent}
        />
      )}

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => !deleting && setDeleteTarget(null)}>
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/40 flex items-center justify-center shrink-0">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-red-600 dark:text-red-400">
                  <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 1 0 .23 1.482l.149-.022.841 10.518A2.75 2.75 0 0 0 7.596 19h4.807a2.75 2.75 0 0 0 2.742-2.53l.841-10.52.149.023a.75.75 0 0 0 .23-1.482 41.03 41.03 0 0 0-2.365-.298V3.75A2.75 2.75 0 0 0 11.25 1h-2.5ZM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4ZM8.58 7.72a.75.75 0 0 0-1.5.06l.3 7.5a.75.75 0 1 0 1.5-.06l-.3-7.5Zm4.34.06a.75.75 0 1 0-1.5-.06l-.3 7.5a.75.75 0 1 0 1.5.06l.3-7.5Z" clipRule="evenodd" />
                </svg>
              </div>
              <div>
                <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">Delete invoice?</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  Delete invoice {deleteTarget.invoiceNumber || `for ${deleteTarget.customerName}`}? This can't be undone.
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
                onClick={handleDeleteInvoice}
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
