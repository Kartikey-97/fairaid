"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { fetchNeeds } from "@/lib/api";
import type { NeedRecord } from "@/lib/types";
import { Card } from "@/components/ui/Card";

// Dynamic import for Leaflet map to prevent SSR issues
const NeedsMap = dynamic(() => import("@/components/maps/NeedsMap").then(mod => mod.NeedsMap), { ssr: false });

export default function InsightsMapPage() {
  const [needs, setNeeds] = useState<NeedRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadNeeds() {
      try {
        const activeNeeds = await fetchNeeds({ status: "open" });
        setNeeds(activeNeeds);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load active needs.");
      } finally {
        setIsLoading(false);
      }
    }
    void loadNeeds();
  }, []);

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <Card>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl text-[var(--text-strong)]">Regional Hotspots Map</h1>
            <p className="mt-2 text-sm text-[var(--text-muted)]">
              Geographic distribution of all active needs. Red pins indicate emergency level requests.
            </p>
          </div>
          <div className="flex gap-4 text-xs font-semibold">
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-[var(--accent)]" />
              <span className="text-[var(--text-muted)]">Emergency</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-[var(--brand)]" />
              <span className="text-[var(--text-muted)]">Standard</span>
            </div>
          </div>
        </div>

        {error && (
          <p className="mt-4 text-sm text-red-500">{error}</p>
        )}

        <div className="mt-6">
          {isLoading ? (
            <div className="h-[500px] w-full rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] flex items-center justify-center">
              <span className="text-sm text-[var(--text-muted)]">Loading map data...</span>
            </div>
          ) : (
            <NeedsMap needs={needs} className="h-[500px]" />
          )}
        </div>
      </Card>
    </main>
  );
}
