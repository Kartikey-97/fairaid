"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";

import { getSession } from "@/lib/session";
import type { UserRole } from "@/lib/types";

export function useAuthGuard(requiredRole: UserRole) {
  const router = useRouter();
  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const session = hydrated ? getSession() : null;
  const isAuthorized = Boolean(hydrated && session && session.role === requiredRole);

  useEffect(() => {
    if (hydrated && !isAuthorized) {
      router.replace("/auth/login");
    }
  }, [hydrated, isAuthorized, router]);

  return {
    session,
    isAuthorized,
    isChecking: !hydrated || !isAuthorized,
  };
}
