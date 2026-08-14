import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";

export const Route = createFileRoute("/dashboard/ai-employees")({
  component: AiEmployeesPage,
});

interface AiEmployee {
  id: string;
  name: string;
  type: string;
  status: string;
  createdAt: string;
}

function AiEmployeesPage() {
  const [employees, setEmployees] = useState<AiEmployee[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/ai-employees");
        if (res.ok) {
          const data = await res.json();
          setEmployees(data.employees || []);
        }
      } catch (e) {
        console.error("Failed to load employees:", e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  return (
    <div className="bg-gray-50 dark:bg-gray-950 min-h-full">
      <main className="mx-auto max-w-4xl px-4 sm:px-6 py-8">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100 mb-6">🤖 AI Employees</h1>

        {loading ? (
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
            <div className="px-5 py-4 space-y-4">
              {[1, 2, 3].map(i => (
                <div key={i} className="animate-pulse flex items-center gap-4">
                  <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-32" />
                  <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-20" />
                  <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-20 ml-auto" />
                </div>
              ))}
            </div>
          </div>
        ) : employees.length === 0 ? (
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 flex flex-col items-center justify-center py-16">
            <span className="text-4xl mb-4">🤖</span>
            <h2 className="text-lg font-semibold text-gray-700 dark:text-gray-300">No AI Employees</h2>
            <p className="text-sm text-gray-400 mt-1">Create AI employees from the admin dashboard.</p>
          </div>
        ) : (
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Name</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Type</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
                  <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {employees.map(emp => (
                  <tr key={emp.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                    <td className="px-5 py-3.5 font-medium text-gray-900 dark:text-gray-100">{emp.name}</td>
                    <td className="px-5 py-3.5">
                      <span className="inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
                        {emp.type}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        emp.status === "active"
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                          : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                      }`}>
                        {emp.status}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-right text-gray-400 text-xs">{formatDate(emp.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
