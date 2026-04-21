"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { getSession } from "@/lib/session";
import { Card } from "@/components/ui/Card";

export default function EntryPage() {
  const router = useRouter();

  useEffect(() => {
    const session = getSession();
    if (!session) {
      router.replace("/auth/login");
      return;
    }
    router.replace(session.role === "ngo" ? "/ngo" : "/volunteer");
  }, [router]);

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <Card>Opening your workspace...</Card>
    </main>
  );
}
