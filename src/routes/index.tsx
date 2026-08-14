import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { readFile } from "node:fs/promises";

const getBusinessName = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const cfg = JSON.parse(await readFile("site.json", "utf8")) as {
      businessName?: string;
    };
    return cfg.businessName?.trim() ?? "";
  } catch {
    return "";
  }
});

export const Route = createFileRoute("/")({
  loader: () => getBusinessName(),
  component: Home,
});

const features = [
  {
    title: "Email Agent",
    desc: "Auto-responds to customer emails using your knowledge base",
    icon: "✉️",
  },
  {
    title: "Invoice Clerk",
    desc: "Generates and tracks invoices without manual entry",
    icon: "🧾",
  },
  {
    title: "Scheduler",
    desc: "Books appointments and manages your calendar",
    icon: "📅",
  },
];

function Home() {
  const businessName = Route.useLoaderData();
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
      <div className="space-y-4">
        <h1 className="max-w-3xl text-5xl font-bold tracking-tight sm:text-6xl">
          AI Employees for{" "}
          <span className="text-indigo-600">Your Business</span>
        </h1>
        <p className="max-w-2xl mx-auto text-xl text-gray-600 dark:text-gray-400">
          {businessName || "FlowPilot AI"} lets you create a team of AI employees
          that automate repetitive office work — from lead qualification and email
          responses to appointment scheduling and invoicing. No coding, no hiring.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 justify-center mt-2">
        <a
          href="/sign-up"
          className="rounded-lg bg-indigo-600 px-8 py-3 text-base font-semibold text-white hover:bg-indigo-500 transition-colors"
        >
          Start Free Trial
        </a>
        <a
          href="/sign-in"
          className="rounded-lg bg-indigo-50 px-8 py-3 text-base font-semibold text-indigo-600 hover:bg-indigo-100 transition-colors dark:bg-indigo-950 dark:text-indigo-300 dark:hover:bg-indigo-900"
        >
          Sign In
        </a>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 pt-12 max-w-3xl w-full">
        {features.map((feature) => (
          <div
            key={feature.title}
            className="rounded-xl border border-gray-200 dark:border-gray-800 p-6 text-left"
          >
            <div className="text-2xl mb-3">{feature.icon}</div>
            <h3 className="font-semibold text-gray-900 dark:text-gray-100">
              {feature.title}
            </h3>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              {feature.desc}
            </p>
          </div>
        ))}
      </div>

      <p className="text-sm text-gray-400 dark:text-gray-500 pt-8">
        $399/mo · 3 AI Employees · 14-day free trial
      </p>

      <footer className="absolute bottom-6 text-sm text-gray-400 dark:text-gray-600">
        Built with{" "}
        <a href="https://cto.new" className="underline hover:text-gray-600 dark:hover:text-gray-400">
          cto.new
        </a>
      </footer>
    </main>
  );
}
