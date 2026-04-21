"use client";

import { useEffect, useMemo, useState } from "react";

import { runAllocation } from "@/lib/api";
import type { AllocationResponse } from "@/lib/types";
import { BarChart } from "@/components/charts/BarChart";
import { LineChart } from "@/components/charts/LineChart";
import { Card } from "@/components/ui/Card";

const SAMPLE_PAYLOAD = {
  volunteers: [
    {
      id: "v1",
      skills: ["medical", "logistics"],
      location: { lat: 28.6139, lng: 77.209 },
      availability: true,
      max_travel_km: 30,
    },
    {
      id: "v2",
      skills: ["teaching", "community outreach"],
      location: { lat: 28.7041, lng: 77.1025 },
      availability: true,
      max_travel_km: 20,
    },
    {
      id: "v3",
      skills: ["medical", "counseling"],
      location: { lat: 28.5355, lng: 77.391 },
      availability: true,
      max_travel_km: 50,
    },
  ],
  needs: [
    {
      id: "n1",
      skills_required: ["medical"],
      required: 2,
      is_critical: true,
      urgency: 9,
      impact: 8,
      location: { lat: 28.61, lng: 77.23 },
    },
    {
      id: "n2",
      skills_required: ["teaching"],
      required: 1,
      is_critical: false,
      urgency: 6,
      impact: 7,
      location: { lat: 28.7, lng: 77.11 },
    },
  ],
};

export default function FairnessPage() {
  const [result, setResult] = useState<AllocationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    runAllocation(SAMPLE_PAYLOAD)
      .then((response) => setResult(response))
      .catch((runError) => {
        const message =
          runError instanceof Error
            ? runError.message
            : "Failed to compute fairness results.";
        setError(message);
      });
  }, []);

  const linePoints = useMemo(() => {
    if (!result) {
      return [];
    }
    return Object.entries(result.states)
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([lambdaKey, state]) => ({
        label: lambdaKey,
        value: state.system_score ?? 0,
      }));
  }, [result]);

  const barItems = useMemo(() => {
    if (!result) {
      return [];
    }
    const lambdaHalf = result.states["0.5"];
    if (!lambdaHalf?.metrics) {
      return [];
    }
    return [
      {
        label: "Avg Efficiency",
        value: lambdaHalf.metrics.avg_efficiency,
        color: "var(--brand)",
      },
      {
        label: "Fairness Penalty",
        value: lambdaHalf.metrics.fairness_penalty,
        color: "var(--accent)",
      },
    ];
  }, [result]);

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
      <Card>
        <h1 className="text-3xl text-[var(--text-strong)]">Fairness Dashboard</h1>
        <p className="mt-2 text-sm text-[var(--text-muted)]">
          Monitor how fairness penalty changes as lambda increases and validate the efficiency-equity tradeoff.
        </p>
      </Card>
      {error ? (
        <Card tone="emergency">
          <p className="text-sm text-[var(--text-strong)]">{error}</p>
        </Card>
      ) : null}
      <section className="grid gap-6 lg:grid-cols-2">
        <LineChart
          title="System Score Across λ"
          points={linePoints.length ? linePoints : [{ label: "0", value: 0 }]}
        />
        <BarChart
          title="λ = 0.5 Metrics Snapshot"
          items={
            barItems.length
              ? barItems
              : [
                  { label: "Avg Efficiency", value: 0, color: "var(--brand)" },
                  { label: "Fairness Penalty", value: 0, color: "var(--accent)" },
                ]
          }
        />
      </section>
      <Card>
        <h2 className="text-xl text-[var(--text-strong)]">Judge Explanation Script</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-[var(--text-muted)]">
          <li>Phase 1 prioritizes assignment quality with hard feasibility constraints.</li>
          <li>Phase 2 nudges toward equity using only local accepted improvements.</li>
          <li>Lambda is a transparent policy knob from pure efficiency to fairness-heavy.</li>
        </ul>
      </Card>
    </main>
  );
}
