import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";

export const Route = createFileRoute("/client/onboarding")({
  component: ClientOnboarding,
});

type Step = {
  num: number;
  title: string;
  desc: string;
  icon: string;
  done: boolean;
};

const initialSteps: Step[] = [
  { num: 1, title: "Create AI Employees", desc: "Set up your email agent, invoice clerk, and scheduler — your AI team is ready in one click.", icon: "🤖", done: false },
  { num: 2, title: "Upload Knowledge Base", desc: "Upload your documents, FAQs, pricing guides, and templates so your AIs learn your business.", icon: "📚", done: false },
  { num: 3, title: "Build Automations", desc: "Create workflows for lead follow-up, invoicing, and appointment scheduling.", icon: "⚡", done: false },
  { num: 4, title: "Configure Phone", desc: "Set up your AI phone receptionist to answer calls, qualify leads, and book appointments 24/7.", icon: "📞", done: false },
];

function ClientOnboarding() {
  const [steps, setSteps] = useState<Step[]>(() => {
    try {
      const saved = localStorage.getItem("fp_onboarding_steps");
      if (saved) return JSON.parse(saved);
    } catch {}
    return initialSteps;
  });

  const completeStep = (i: number) => {
    const next = steps.map((s, idx) => (idx === i ? { ...s, done: true } : s));
    setSteps(next);
    localStorage.setItem("fp_onboarding_steps", JSON.stringify(next));
  };

  const allDone = steps.every((s) => s.done);
  const doneCount = steps.filter((s) => s.done).length;

  return (
    <div className="min-h-dvh bg-gray-50 dark:bg-gray-950">
      <header className="flex items-center justify-between border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-6 py-3">
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold text-indigo-600">FlowPilot AI</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-500">Getting Started</span>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-12">
        {/* Header */}
        <div className="text-center mb-10">
          <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 mb-4 text-2xl">🚀</span>
          <h1 className="text-2xl font-bold tracking-tight">Welcome to FlowPilot AI</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-2 max-w-md mx-auto">
            Let&apos;s get your AI employees up and running. Complete these steps to start automating your office work.
          </p>
          {/* Progress bar */}
          <div className="mt-6 max-w-sm mx-auto">
            <div className="flex items-center justify-between text-sm text-gray-500 mb-2">
              <span>{doneCount} of 4 completed</span>
              <span>{Math.round((doneCount / 4) * 100)}%</span>
            </div>
            <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-indigo-500 to-violet-600 rounded-full transition-all duration-500"
                style={{ width: `${(doneCount / 4) * 100}%` }}
              />
            </div>
          </div>
        </div>

        {/* Steps */}
        <div className="space-y-4">
          {steps.map((step, i) => (
            <div
              key={i}
              className={`rounded-xl border p-5 transition-all ${
                step.done
                  ? "bg-emerald-50/30 border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-800"
                  : "bg-white border-gray-200 dark:bg-gray-900 dark:border-gray-700 hover:shadow-md"
              }`}
            >
              <div className="flex items-start gap-4">
                <span
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-xl ${
                    step.done
                      ? "bg-emerald-100 dark:bg-emerald-900"
                      : "bg-gray-100 dark:bg-gray-800"
                  }`}
                >
                  {step.done ? "✅" : step.icon}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-medium text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded">
                      Step {step.num}
                    </span>
                    {step.done && (
                      <span className="text-xs font-medium text-emerald-600 bg-emerald-50 dark:bg-emerald-950 dark:text-emerald-300 px-2 py-0.5 rounded">
                        ✓ Completed
                      </span>
                    )}
                  </div>
                  <h3 className="font-semibold mt-1.5">{step.title}</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{step.desc}</p>
                  {!step.done && (
                    <button
                      onClick={() => completeStep(i)}
                      className="inline-flex items-center gap-2 mt-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-1.5 text-xs font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors cursor-pointer"
                    >
                      Get Started
                      <span className="text-gray-400">→</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* All done CTA */}
        {allDone && (
          <div className="mt-8 rounded-xl bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-950 dark:to-teal-950 border border-emerald-200 dark:border-emerald-800 p-8 text-center">
            <span className="text-3xl">🎉</span>
            <h2 className="text-xl font-bold mt-3">You&apos;re all set!</h2>
            <p className="text-gray-500 dark:text-gray-400 mt-2 max-w-sm mx-auto">
              Your AI employees are configured and ready. The last step is setting up your payment method.
            </p>
            <Link
              to="/client/payment"
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 transition-colors mt-4"
            >
              Set Up Payment
              <span>→</span>
            </Link>
            <p className="text-xs text-gray-400 mt-3">
              $399/mo after your 14-day free trial. Cancel anytime.
            </p>
          </div>
        )}

        {/* Help section */}
        {!allDone && (
          <div className="mt-10 rounded-xl bg-gradient-to-r from-indigo-50 to-violet-50 dark:from-indigo-950 dark:to-violet-950 border border-indigo-100 dark:border-indigo-800 p-6 text-center">
            <h3 className="font-semibold">Need help?</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Schedule a personalized onboarding call with our team.
            </p>
            <a
              href="#"
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 transition-colors mt-3"
            >
              Book a Call
              <span>→</span>
            </a>
          </div>
        )}
      </main>
    </div>
  );
}
