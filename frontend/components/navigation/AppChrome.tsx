"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { clearSession, getSession, getStoredTheme, setStoredTheme, subscribeSessionStore } from "@/lib/session";

type AppChromeProps = {
  children: ReactNode;
};

const emptySubscribe = () => () => {};
const getTrue = () => true;
const getFalse = () => false;
const getNull = () => null;

export function AppChrome({ children }: AppChromeProps) {
  const pathname = usePathname();
  const router = useRouter();

  const session = useSyncExternalStore(subscribeSessionStore, getSession, getNull);
  const hydrated = useSyncExternalStore(emptySubscribe, getTrue, getFalse);

  const [theme, setTheme] = useState<"light" | "dark">(() => getStoredTheme());

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const isAuthRoute = useMemo(() => pathname.startsWith("/auth"), [pathname]);
  const isInternalToolsPage = useMemo(
    () =>
      pathname.startsWith("/tradeoff") ||
      pathname.startsWith("/fairness") ||
      pathname.startsWith("/allocation"),
    [pathname],
  );

  function toggleTheme() {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    setStoredTheme(next);
  }

  function handleLogout() {
    clearSession();
    router.push("/auth/login");
  }

  const roleHome = session?.role === "ngo" ? "/ngo" : "/volunteer";
  const profilePath = session?.role === "volunteer" ? "/volunteer/profile" : "/ngo";
  const initials = (session?.name ?? "U")
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const avatarGradient =
    session?.role === "ngo"
      ? "linear-gradient(135deg, var(--brand), color-mix(in oklab, var(--brand) 65%, var(--surface)))"
      : "linear-gradient(135deg, var(--pin), color-mix(in oklab, var(--pin) 70%, var(--brand)))";

  return (
    <div className="relative min-h-screen">
      {/* Global background gradient */}
      <div
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(circle at 10% 8%, color-mix(in oklab, var(--brand) 14%, transparent) 0%, transparent 35%), " +
            "radial-gradient(circle at 90% 10%, color-mix(in oklab, var(--accent) 10%, transparent) 0%, transparent 30%), " +
            "linear-gradient(180deg, var(--bg-grad-start), var(--bg-grad-end))",
        }}
      />

      {/* Header */}
      <header
        className="sticky top-0 z-30 border-b border-[var(--border)]"
        style={{
          background: "color-mix(in oklab, var(--surface) 82%, transparent)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
        }}
      >
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
          {/* Logo */}
          <Link href={hydrated && session ? roleHome : "/auth/login"} className="group flex items-center gap-2.5">
            <span
              className="rounded-lg px-2.5 py-1.5 text-[11px] font-black tracking-[0.12em] text-white uppercase"
              style={{
                background: "linear-gradient(135deg, var(--brand), color-mix(in oklab, var(--brand) 70%, var(--accent)))",
                boxShadow: "0 3px 12px rgba(13,124,122,0.35)",
              }}
            >
              FA
            </span>
            <span className="text-sm font-semibold text-[var(--text-strong)] group-hover:text-[var(--brand)] transition-colors">
              FairAid
            </span>
            {hydrated && session && (
              <span
                className="hidden sm:inline-flex text-[10px] font-medium px-2 py-0.5 rounded-full"
                style={{ background: "var(--brand-soft)", color: "var(--brand)" }}
              >
                {session.role === "ngo" ? "NGO" : "Volunteer"}
              </span>
            )}
          </Link>

          <div className="flex items-center gap-2">
            {/* Nav links */}
            {!isAuthRoute && hydrated && session && (
              <nav className="hidden items-center gap-1 md:flex">
                <Link
                  href={roleHome}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                    pathname === roleHome || pathname.startsWith(roleHome + "/")
                      ? "bg-[var(--brand-soft)] text-[var(--brand)]"
                      : "text-[var(--text-muted)] hover:bg-[var(--surface-elevated)] hover:text-[var(--text-strong)]"
                  }`}
                >
                  Dashboard
                </Link>
              </nav>
            )}

            {/* Theme toggle — icon only, suppressHydrationWarning for SSR safety */}
            <button
              type="button"
              onClick={toggleTheme}
              suppressHydrationWarning
              title={theme === "light" ? "Switch to Dark mode" : "Switch to Light mode"}
              className="rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] p-2 text-[var(--text-muted)] hover:text-[var(--text-strong)] hover:border-[var(--brand)] transition-all"
            >
              {theme === "light" ? (
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="4" />
                  <line x1="12" y1="2" x2="12" y2="6" />
                  <line x1="12" y1="18" x2="12" y2="22" />
                  <line x1="4.93" y1="4.93" x2="7.76" y2="7.76" />
                  <line x1="16.24" y1="16.24" x2="19.07" y2="19.07" />
                  <line x1="2" y1="12" x2="6" y2="12" />
                  <line x1="18" y1="12" x2="22" y2="12" />
                  <line x1="4.93" y1="19.07" x2="7.76" y2="16.24" />
                  <line x1="16.24" y1="7.76" x2="19.07" y2="4.93" />
                </svg>
              )}
            </button>

            {/* User avatar + logout */}
            {hydrated && session ? (
              <>
                <Link
                  href={profilePath}
                  title={`${session.name} (${session.role})`}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-bold text-white shadow-md hover:scale-105 transition-transform"
                  style={{ background: avatarGradient }}
                >
                  {initials}
                </Link>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--text-muted)] hover:text-[var(--accent)] hover:border-[var(--accent)] transition-all"
                >
                  Logout
                </button>
              </>
            ) : hydrated ? (
              <Link
                href="/auth/login"
                className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition-all hover:brightness-110"
                style={{
                  background: "linear-gradient(135deg, var(--brand), color-mix(in oklab, var(--brand) 70%, var(--accent)))",
                  boxShadow: "0 2px 8px rgba(13,124,122,0.3)",
                }}
              >
                Sign In
              </Link>
            ) : null}
          </div>
        </div>
      </header>

      <div className="min-h-[calc(100vh-60px)]">{children}</div>

      {!isAuthRoute && isInternalToolsPage ? (
        <footer className="mx-auto mt-8 w-full max-w-7xl px-4 pb-6 pt-2 sm:px-6 lg:px-8">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)]/70 px-4 py-3 text-xs text-[var(--text-muted)]">
            Developer tools:
            <Link className="ml-2 underline-offset-2 hover:underline hover:text-[var(--brand)] transition-colors" href="/tradeoff">
              Trade-off Lab
            </Link>
            <Link className="ml-3 underline-offset-2 hover:underline hover:text-[var(--brand)] transition-colors" href="/fairness">
              Fairness Board
            </Link>
            <Link className="ml-3 underline-offset-2 hover:underline hover:text-[var(--brand)] transition-colors" href="/allocation">
              Allocation Sandbox
            </Link>
          </div>
        </footer>
      ) : null}
    </div>
  );
}
