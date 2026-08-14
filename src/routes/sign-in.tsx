import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";

export const Route = createFileRoute("/sign-in")({
  component: SignIn,
});

function SignIn() {
  const navigate = useNavigate();
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const email = emailRef.current?.value.trim().toLowerCase();
    const password = passwordRef.current?.value;

    if (!email || !password) return;

    try {
      const res = await fetch("/api/auth/signin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
        credentials: "include",
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Sign in failed");
        return;
      }

      // Route based on role
      if (data.user?.role === "admin") {
        navigate({ to: "/admin" });
      } else {
        navigate({ to: "/dashboard" });
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogleSignIn() {
    window.location.href = "/api/auth/google";
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
      <Link to="/" className="mb-4 text-sm text-indigo-600 hover:underline">
        ← Back to home
      </Link>
      <h1 className="text-3xl font-bold tracking-tight">Sign In</h1>
      <p className="text-gray-500 dark:text-gray-400">
        Access your FlowPilot AI workspace
      </p>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-800 p-3 max-w-sm w-full">
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        </div>
      )}

      <form
        className="flex flex-col gap-4 w-full max-w-sm"
        onSubmit={handleSubmit}
      >
        <div className="text-left">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Email
          </label>
          <input
            ref={emailRef}
            type="email"
            name="email"
            placeholder="you@company.com"
            className="w-full rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-2.5 text-sm bg-white dark:bg-gray-900"
            required
          />
        </div>
        <div className="text-left">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Password
          </label>
          <input
            ref={passwordRef}
            type="password"
            name="password"
            placeholder="••••••••"
            className="w-full rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-2.5 text-sm bg-white dark:bg-gray-900"
            required
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 transition-colors disabled:opacity-50"
        >
          {loading ? "Signing in…" : "Sign In"}
        </button>
      </form>

      <div className="flex items-center gap-3 w-full max-w-sm">
        <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
        <span className="text-xs text-gray-400">or</span>
        <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
      </div>

      <button
        onClick={handleGoogleSignIn}
        className="w-full max-w-sm rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-2.5 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors flex items-center justify-center gap-2"
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24">
          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
        </svg>
        Sign in with Google
      </button>

      <p className="text-sm text-gray-400">
        Don't have an account?{" "}
        <Link to="/sign-up" className="text-indigo-600 hover:underline">
          Start free trial
        </Link>
      </p>

      <footer className="absolute bottom-6 text-sm text-gray-400 dark:text-gray-600">
        Built with{" "}
        <a
          href="https://cto.new"
          className="underline hover:text-gray-600 dark:hover:text-gray-400"
        >
          cto.new
        </a>
      </footer>
    </main>
  );
}
