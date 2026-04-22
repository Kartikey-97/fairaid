"use client";

import type { AuthSession, UserRole } from "@/lib/types";

const SESSION_KEY = "fairaid_session";
const THEME_KEY = "fairaid_theme";

export type ThemeMode = "light" | "dark";

export function getSession(): AuthSession | null {
  if (typeof window === "undefined") {
    return null;
  }
  const raw = window.localStorage.getItem(SESSION_KEY);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as AuthSession;
  } catch {
    return null;
  }
}

export function setSession(session: AuthSession): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession(): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(SESSION_KEY);
}

export function requireRole(session: AuthSession | null, role: UserRole): boolean {
  return Boolean(session && session.role === role);
}

export function getStoredTheme(): ThemeMode {
  if (typeof window === "undefined") {
    return "light";
  }
  const value = window.localStorage.getItem(THEME_KEY);
  if (value === "dark" || value === "light") {
    return value;
  }
  return "light";
}

export function setStoredTheme(theme: ThemeMode): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(THEME_KEY, theme);
}
