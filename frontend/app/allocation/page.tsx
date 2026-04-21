"use client";

import { useMemo, useState } from "react";

import { runAllocation } from "@/lib/api";
import type { AllocationRequest, AllocationResponse, AllocationState } from "@/lib/types";

const SAMPLE_REQUEST: AllocationRequest = {
  volunteers: [
    {
      id: "v1",
      skills: ["medical", "logistics"],
      availability: true,
      max_travel_km: 35,
      location: { lat: 28.6139, lng: 77.209 },
    },
    {
      id: "v2",
      skills: ["teaching"],
      availability: true,
      max_travel_km: 20,
      location: { lat: 28.7041, lng: 77.1025 },
    },
    {
      id: "v3",
      skills: ["medical"],
      availability: true,
      max_travel_km: 45,
      location: { lat: 28.5355, lng: 77.391 },
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

function asNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return 0;
}

function formatMetric(value: number, digits = 4): string {
  return value.toFixed(digits);
}

function renderStateSummary(lambdaKey: string, state: AllocationState) {
  const metrics = state.metrics;

  return (
    <section
      key={lambdaKey}
      className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg font-semibold text-zinc-900">Lambda {lambdaKey}</h3>
        <p className="text-sm text-zinc-600">
          System Score: {formatMetric(asNumber(state.system_score), 6)}
        </p>
      </div>

      <div className="mb-4 grid gap-2 text-sm text-zinc-700 sm:grid-cols-3">
        <p>Total Assignments: {state.total_assignments ?? 0}</p>
        <p>Total Score: {formatMetric(asNumber(state.total_score), 6)}</p>
        <p>
          Available Pool: {Array.isArray(state.available_volunteers)
            ? state.available_volunteers.length
            : 0}
        </p>
      </div>

      {metrics ? (
        <div className="mb-4 grid gap-2 rounded-md bg-zinc-50 p-3 text-sm text-zinc-700 sm:grid-cols-2">
          <p>Avg Efficiency: {formatMetric(asNumber(metrics.avg_efficiency), 6)}</p>
          <p>Fairness Penalty: {formatMetric(asNumber(metrics.fairness_penalty), 6)}</p>
        </div>
      ) : null}

      <div className="space-y-2">
        {state.needs?.map((need) => (
          <div
            key={String(need.id)}
            className="rounded-md border border-zinc-200 p-3 text-sm"
          >
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium text-zinc-900">Need {String(need.id)}</p>
              <p className="text-zinc-600">
                Fulfillment: {need.assigned_volunteers?.length ?? 0}/{need.required ?? 0}
              </p>
            </div>
            <p className="text-zinc-700">
              Volunteers: {need.assigned_volunteers?.join(", ") || "None"}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function AllocationPage() {
  const [requestJson, setRequestJson] = useState<string>(
    JSON.stringify(SAMPLE_REQUEST, null, 2),
  );
  const [result, setResult] = useState<AllocationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const orderedLambdaKeys = useMemo(() => {
    if (!result) {
      return [];
    }

    return Object.keys(result.states).sort(
      (a, b) => Number.parseFloat(a) - Number.parseFloat(b),
    );
  }, [result]);

  const handleResetSample = () => {
    setRequestJson(JSON.stringify(SAMPLE_REQUEST, null, 2));
    setError(null);
  };

  const handleRunAllocation = async () => {
    setError(null);
    setIsLoading(true);

    try {
      const parsed = JSON.parse(requestJson) as Partial<AllocationRequest>;
      if (!Array.isArray(parsed.volunteers) || !Array.isArray(parsed.needs)) {
        throw new Error("Payload must contain volunteers[] and needs[].");
      }

      const payload: AllocationRequest = {
        volunteers: parsed.volunteers,
        needs: parsed.needs,
      };

      const response = await runAllocation(payload);
      setResult(response);
    } catch (runError) {
      const message =
        runError instanceof Error
          ? runError.message
          : "Something went wrong while running allocation.";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold text-zinc-900">FairAid Allocation Runner</h1>
        <p className="text-sm text-zinc-600">
          Submit volunteers and needs, run the allocator, and compare outcomes for each lambda value.
        </p>
      </header>

      <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={handleRunAllocation}
            disabled={isLoading}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isLoading ? "Running..." : "Run Allocation"}
          </button>
          <button
            type="button"
            onClick={handleResetSample}
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-800 transition hover:bg-zinc-50"
          >
            Reset Sample Input
          </button>
        </div>

        <label htmlFor="allocation-payload" className="mb-2 block text-sm font-medium text-zinc-800">
          Request Payload (JSON)
        </label>
        <textarea
          id="allocation-payload"
          value={requestJson}
          onChange={(event) => setRequestJson(event.target.value)}
          className="h-72 w-full rounded-md border border-zinc-300 bg-zinc-50 p-3 font-mono text-xs leading-5 text-zinc-900 outline-none ring-zinc-300 focus:ring"
        />

        {error ? (
          <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-zinc-900">Allocation Results</h2>

        {!result ? (
          <div className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50 p-6 text-sm text-zinc-600">
            Run allocation to view lambda-wise states and metrics.
          </div>
        ) : (
          <div className="grid gap-4">
            {orderedLambdaKeys.map((lambdaKey) =>
              renderStateSummary(lambdaKey, result.states[lambdaKey]),
            )}
          </div>
        )}
      </section>
    </main>
  );
}
