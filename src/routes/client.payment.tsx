import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";

export const Route = createFileRoute("/client/payment")({
  component: ClientPayment,
});

function ClientPayment() {
  const [cardNumber, setCardNumber] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cvc, setCvc] = useState("");
  const [processing, setProcessing] = useState(false);
  const [complete, setComplete] = useState(false);

  const workspaceId =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("workspace") || "ws_demo"
      : "ws_demo";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setProcessing(true);
    // Simulate payment setup
    setTimeout(() => {
      setProcessing(false);
      setComplete(true);
      localStorage.setItem("fp_payment_setup", "true");
    }, 2000);
  };

  return (
    <div className="min-h-dvh bg-gray-50 dark:bg-gray-950">
      <header className="flex items-center justify-between border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-6 py-3">
        <span className="text-lg font-bold text-indigo-600">FlowPilot AI</span>
      </header>

      <main className="mx-auto max-w-lg px-6 py-12">
        {complete ? (
          <div className="text-center">
            <span className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-100 dark:bg-emerald-900 text-3xl mb-6">✅</span>
            <h1 className="text-2xl font-bold tracking-tight">Payment Setup Complete</h1>
            <p className="text-gray-500 dark:text-gray-400 mt-3">
              Your 14-day free trial has started. You won&apos;t be charged until the trial ends. Cancel anytime.
            </p>
            <div className="mt-8 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-6 text-left space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Plan</span>
                <span className="font-medium">FlowPilot AI</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Billing</span>
                <span className="font-medium">$399/month</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Trial ends</span>
                <span className="font-medium text-emerald-600">14 days</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">AI Employees</span>
                <span className="font-medium">3 included</span>
              </div>
            </div>
            <Link
              to="/client/deck"
              search={{ workspace: workspaceId }}
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 transition-colors mt-6"
            >
              Continue Setup
              <span>→</span>
            </Link>
          </div>
        ) : (
          <>
            <div className="text-center mb-8">
              <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 mb-4 text-2xl">💳</span>
              <h1 className="text-2xl font-bold tracking-tight">Set Up Payment</h1>
              <p className="text-gray-500 dark:text-gray-400 mt-2">
                Your 14-day free trial starts now. You won&apos;t be charged until it ends.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Card Number</label>
                  <input
                    type="text"
                    value={cardNumber}
                    onChange={(e) => setCardNumber(e.target.value)}
                    placeholder="4242 4242 4242 4242"
                    maxLength={19}
                    className="w-full rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-2.5 text-sm bg-gray-50 dark:bg-gray-800 font-mono"
                    required
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Expiry</label>
                    <input
                      type="text"
                      value={expiry}
                      onChange={(e) => setExpiry(e.target.value)}
                      placeholder="MM/YY"
                      maxLength={5}
                      className="w-full rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-2.5 text-sm bg-gray-50 dark:bg-gray-800 font-mono"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">CVC</label>
                    <input
                      type="text"
                      value={cvc}
                      onChange={(e) => setCvc(e.target.value)}
                      placeholder="123"
                      maxLength={4}
                      className="w-full rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-2.5 text-sm bg-gray-50 dark:bg-gray-800 font-mono"
                      required
                    />
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 p-4 text-sm text-amber-800 dark:text-amber-300">
                <p className="font-medium">🔒 Test mode</p>
                <p className="mt-1">This is a demo. In production, your card will be processed securely via Stripe.</p>
              </div>

              <button
                type="submit"
                disabled={processing}
                className="w-full rounded-lg bg-indigo-600 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-500 transition-colors disabled:opacity-50"
              >
                {processing ? (
                  <span className="inline-flex items-center gap-2">
                    <span className="animate-spin">⏳</span> Processing...
                  </span>
                ) : (
                  "Start Free Trial — $399/mo after"
                )}
              </button>
              <p className="text-xs text-gray-400 text-center">
                By starting your trial, you agree to our Terms of Service. Cancel anytime in your dashboard.
              </p>
            </form>
          </>
        )}
      </main>
    </div>
  );
}
