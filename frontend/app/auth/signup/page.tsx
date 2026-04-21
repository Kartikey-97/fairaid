"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

import { signup } from "@/lib/api";
import { setSession } from "@/lib/session";
import type { UserRole } from "@/lib/types";
import { Button } from "@/components/ui/Button";

export default function SignupPage() {
  const router = useRouter();
  const [role, setRole] = useState<UserRole>("volunteer");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function handleSignup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      const session = await signup({ name, email, password, role });
      setSession(session);
      router.push(role === "ngo" ? "/ngo" : "/volunteer/profile");
    } catch (signupError) {
      const message = signupError instanceof Error ? signupError.message : "Sign up failed.";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-[calc(100vh-64px)] w-full max-w-4xl items-center px-4 py-10 sm:px-6">
      <section className="mx-auto w-full max-w-xl rounded-[32px] border border-[var(--border)] bg-[var(--surface-overlay)] p-7 shadow-[0_24px_60px_rgba(8,30,48,0.18)] backdrop-blur-xl">
        <h1 className="text-3xl text-[var(--text-strong)]">Create Your Account</h1>
        <p className="mt-2 text-sm text-[var(--text-muted)]">
          Register as an NGO coordinator or a volunteer responder.
        </p>

        <form className="mt-5 space-y-4" onSubmit={handleSignup}>
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setRole("ngo")}
              className={`rounded-2xl border px-3 py-2 text-sm font-semibold transition ${role === "ngo"
                  ? "border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand)]"
                  : "border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--text-muted)] hover:border-[var(--brand)]"
                }`}
            >
              NGO Account
            </button>
            <button
              type="button"
              onClick={() => setRole("volunteer")}
              className={`rounded-2xl border px-3 py-2 text-sm font-semibold transition ${role === "volunteer"
                  ? "border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand)]"
                  : "border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--text-muted)] hover:border-[var(--brand)]"
                }`}
            >
              Volunteer Account
            </button>
          </div>

          <label className="block space-y-1 text-sm">
            <span>Full Name</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="w-full rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2.5 outline-none transition focus:border-[var(--brand)]"
            />
          </label>
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

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Button type="submit" disabled={isLoading || !name || !email || !password}>
              {isLoading ? "Creating..." : "Create Account"}
            </Button>
            <Link href="/auth/login" className="text-sm font-semibold text-[var(--brand)] hover:underline">
              Already have an account?
            </Link>
          </div>
        </form>

        {error ? (
          <p className="mt-4 rounded-2xl border border-[#d9867b] bg-[#fff1ee] px-3 py-2 text-sm text-[#a43a2d]">
            {error}
          </p>
        ) : null}
      </section>
    </main>
  );
}
