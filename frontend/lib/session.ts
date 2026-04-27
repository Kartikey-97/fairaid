"use client";

import type { AuthSession, UserRole } from "@/lib/types";

const SESSION_KEY = "fairaid_session";
const THEME_KEY = "fairaid_theme";
const SESSION_EVENT = "fairaid:session-change";

export type ThemeMode = "light" | "dark";

function notifySessionChanged(): void {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new Event(SESSION_EVENT));
}

let cachedRaw: string | null = null;
let cachedSession: AuthSession | null = null;

export function getSession(): AuthSession | null {
  if (typeof window === "undefined") {
    return null;
  }
  const raw = window.localStorage.getItem(SESSION_KEY);
  if (!raw) {
    cachedRaw = null;
    cachedSession = null;
    return null;
  }
  if (raw === cachedRaw) {
    return cachedSession;
  }
  try {
    cachedSession = JSON.parse(raw) as AuthSession;
    cachedRaw = raw;
    return cachedSession;
  } catch {
    return null;
  }
}

export function setSession(session: AuthSession): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  notifySessionChanged();
}

export function clearSession(): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(SESSION_KEY);
  notifySessionChanged();
}

export function subscribeSessionStore(onChange: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handleInternal = () => onChange();
  const handleStorage = (event: StorageEvent) => {
    if (!event.key || event.key === SESSION_KEY) {
      onChange();
    }
  };

  window.addEventListener(SESSION_EVENT, handleInternal);
  window.addEventListener("storage", handleStorage);

  return () => {
    window.removeEventListener(SESSION_EVENT, handleInternal);
    window.removeEventListener("storage", handleStorage);
  };
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
