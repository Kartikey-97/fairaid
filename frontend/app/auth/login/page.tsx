"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

import { fetchHealth, login } from "@/lib/api";
import { getSession, setSession } from "@/lib/session";
import type { UserRole } from "@/lib/types";
import { Button } from "@/components/ui/Button";

export default function LoginPage() {
  const router = useRouter();
  const [role, setRole] = useState<UserRole>("ngo");
  const [email, setEmail] = useState("ngo@fairaid.org");
  const [password, setPassword] = useState("demo123");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [backendHealth, setBackendHealth] = useState<string>("Checking backend...");

  useEffect(() => {
    const session = getSession();
    if (!session) {
      return;
    }
    router.replace(session.role === "ngo" ? "/ngo" : "/volunteer");
  }, [router]);

  useEffect(() => {
    if (role === "ngo") {
      setEmail("ngo@fairaid.org");
    } else {
      setEmail("volunteer@fairaid.org");
    }
    setPassword("demo123");
  }, [role]);

  useEffect(() => {
    fetchHealth()
      .then((health) => {
        const db = health.db.active_backend;
        if (db === "postgres") {
          setBackendHealth("Backend connected to PostgreSQL");
          return;
        }
        if (db === "sqlite-fallback") {
          setBackendHealth("Backend online (PostgreSQL unreachable, using local fallback)");
          return;
        }
        setBackendHealth("Backend online");
      })
      .catch(() => {
        setBackendHealth("Backend unreachable at http://127.0.0.1:8000");
      });
  }, []);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      const session = await login({ email, password, role });
      setSession(session);
      if (role === "ngo") {
        router.push("/ngo");
        return;
      }
      router.push(session.volunteer_id ? "/volunteer" : "/volunteer/profile");
    } catch (loginError) {
      const message = loginError instanceof Error ? loginError.message : "Failed to login.";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="relative mx-auto grid min-h-[calc(100vh-64px)] w-full max-w-7xl gap-6 px-4 py-10 sm:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:px-8">
      <section className="relative overflow-hidden rounded-[32px] border border-[var(--border)] bg-[var(--surface-overlay)] p-8 shadow-[0_24px_60px_rgba(8,30,48,0.18)] backdrop-blur-xl">
        <div className="ambient-shift pointer-events-none absolute -left-14 -top-16 h-52 w-52 rounded-full bg-[color:color-mix(in_oklab,var(--brand)_38%,transparent)] blur-3xl" />
        <div className="ambient-shift pointer-events-none absolute -bottom-20 right-[-20px] h-64 w-64 rounded-full bg-[color:color-mix(in_oklab,var(--accent)_28%,transparent)] blur-3xl" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_72%_35%,color-mix(in_oklab,var(--brand)_25%,transparent),transparent_48%)]" />
        <p className="inline-flex rounded-full bg-[var(--brand-soft)] px-3 py-1 text-xs font-bold uppercase tracking-wide text-[var(--brand)]">
          FairAid Response Grid
        </p>
        <h1 className="mt-5 text-4xl leading-tight text-[var(--text-strong)] sm:text-5xl">
          Match community requests with nearby volunteers in real time.
        </h1>
        <p className="mt-4 max-w-2xl text-base text-[var(--text-muted)] sm:text-lg">
          Emergency routing, role-aware recommendations, and transparent fairness metrics in one operational workspace.
        </p>

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {[
            "Distance-first volunteer ranking with skill and specialist fit",
            "Emergency notifications for in-radius responders",
            "Committed timeline for volunteer schedule clarity",
            "Offline queue and auto-sync for disaster scenarios",
          ].map((item) => (
            <div
              key={item}
              className="rounded-2xl border border-[var(--border)] bg-[var(--surface-overlay)] p-3 text-sm text-[var(--text-muted)]"
            >
              {item}
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-[32px] border border-[var(--border)] bg-[var(--surface-overlay)] p-6 shadow-[0_24px_60px_rgba(8,30,48,0.18)] backdrop-blur-xl sm:p-7">
        <h2 className="text-3xl text-[var(--text-strong)]">Sign In</h2>
        <p className="mt-2 text-sm text-[var(--text-muted)]">
          Choose role and continue to your workspace.
        </p>
        <p className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface-overlay)] px-3 py-2 text-xs text-[var(--text-muted)]">
          {backendHealth}
        </p>

        <form className="mt-5 space-y-4" onSubmit={handleLogin}>
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setRole("ngo")}
              className={`rounded-2xl border px-3 py-2 text-sm font-semibold transition ${role === "ngo"
                  ? "border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand)]"
                  : "border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--text-muted)] hover:border-[var(--brand)]"
                }`}
            >
              NGO
            </button>
            <button
              type="button"
              onClick={() => setRole("volunteer")}
              className={`rounded-2xl border px-3 py-2 text-sm font-semibold transition ${role === "volunteer"
                  ? "border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand)]"
                  : "border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--text-muted)] hover:border-[var(--brand)]"
                }`}
            >
              Volunteer
            </button>
          </div>

          <label className="block space-y-1 text-sm">
            <span>Email</span>
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2.5 outline-none transition focus:border-[var(--brand)]"
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2.5 outline-none transition focus:border-[var(--brand)]"
            />
          </label>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={isLoading}>
              {isLoading ? "Signing in..." : "Sign In"}
            </Button>
            <Link href="/auth/signup" className="text-sm font-semibold text-[var(--brand)] hover:underline">
              Create account
            </Link>
          </div>
        </form>

        {error ? (
          <p className="mt-4 rounded-2xl border border-[#d9867b] bg-[#fff1ee] px-3 py-2 text-sm text-[#a43a2d]">
            {error}
          </p>
        ) : null}

        <div className="mt-6 rounded-2xl border border-[var(--border)] bg-[var(--surface-overlay)] p-3 text-xs text-[var(--text-muted)]">
          Demo credentials:
          <div className="mt-1">NGO: ngo@fairaid.org / demo123</div>
          <div>Volunteer: volunteer@fairaid.org / demo123</div>
        </div>
      </section>
    </main>
  );
}
