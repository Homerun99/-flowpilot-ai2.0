import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/sign-up")({
  component: SignUp,
});

function SignUp() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [invited, setInvited] = useState(false);
  const [inviteWorkspace, setInviteWorkspace] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ws = params.get("workspace");
    const inv = params.get("invite");
    const em = params.get("email");
    if (ws && inv) {
      setInvited(true);
      setInviteWorkspace(ws);
      if (em) setEmail(em);
    }
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const body: Record<string, string> = { email: email.trim().toLowerCase(), password, name: name.trim() };
      if (invited) body.workspaceId = inviteWorkspace;

      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "include",
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Sign up failed");
        return;
      }

      if (data.user?.role === "admin") {
        navigate({ to: "/admin" });
      } else if (invited) {
        navigate({ to: "/client/onboarding" });
      } else {
        navigate({ to: "/dashboard" });
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function handleGoogleSignIn() {
    window.location.href = "/api/auth/google";
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
      <Link to="/" className="mb-4 text-sm text-indigo-600 hover:underline">
        ← Back to home
      </Link>

      {invited && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 dark:bg-indigo-950/30 dark:border-indigo-800 p-4 max-w-sm w-full text-left">
          <p className="text-sm font-medium text-indigo-700 dark:text-indigo-300">🎉 You've been invited!</p>
          <p className="text-xs text-indigo-600/70 dark:text-indigo-400 mt-1">
            Create your account to join the workspace and start using FlowPilot AI.
          </p>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-800 p-3 max-w-sm w-full">
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        </div>
      )}

      <h1 className="text-3xl font-bold tracking-tight">
        {invited ? "Create Your Account" : "Start Your Free Trial"}
      </h1>
      <p className="text-gray-500 dark:text-gray-400 max-w-sm">
        {invited ? "Set up your account to get started with AI automation." : "14 days free · $399/mo after · Cancel anytime"}
      </p>

      <form className="flex flex-col gap-4 w-full max-w-sm" onSubmit={handleSubmit}>
        <div className="text-left">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Full Name</label>
          <input
            type="text" name="name" placeholder="Jane Smith"
            value={name} onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-2.5 text-sm bg-white dark:bg-gray-900"
            required
          />
        </div>
        <div className="text-left">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Work Email</label>
          <input
            type="email" name="email" placeholder="jane@company.com"
            value={email} onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-2.5 text-sm bg-white dark:bg-gray-900"
            required
          />
        </div>
        <div className="text-left">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Password</label>
          <input
            type="password" name="password" placeholder="At least 8 characters"
            value={password} onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-2.5 text-sm bg-white dark:bg-gray-900"
            required minLength={8}
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 transition-colors disabled:opacity-50"
        >
          {loading ? "Creating account…" : invited ? "Create Account & Get Started" : "Start Free Trial"}
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
        Sign up with Google
      </button>

      <p className="text-sm text-gray-400">
        Already have an account?{" "}
        <Link to="/sign-in" className="text-indigo-600 hover:underline">Sign in</Link>
      </p>

      <footer className="absolute bottom-6 text-sm text-gray-400 dark:text-gray-600">
        Built with{" "}
        <a href="https://cto.new" className="underline hover:text-gray-600 dark:hover:text-gray-400">cto.new</a>
      </footer>
    </main>
  );
}
