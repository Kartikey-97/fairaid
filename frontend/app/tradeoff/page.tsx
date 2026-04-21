"use client";

import { useMemo, useState } from "react";

import { runAllocation } from "@/lib/api";
import type { AllocationResponse } from "@/lib/types";
import { LambdaSlider } from "@/components/slider/LambdaSlider";
import { Button } from "@/components/ui/Button";
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
      skills: ["teaching"],
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

export default function TradeoffPage() {
  const [result, setResult] = useState<AllocationResponse | null>(null);
  const [selectedLambda, setSelectedLambda] = useState<number>(0.5);
  const [error, setError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const lambdaValues = [0, 0.25, 0.5, 0.75, 1];

  const state = useMemo(() => {
    if (!result) {
      return null;
    }
    return result.states[selectedLambda.toString()] ?? null;
  }, [result, selectedLambda]);

  async function runModel() {
    setError(null);
    setIsRunning(true);
    try {
      const response = await runAllocation(SAMPLE_PAYLOAD);
      setResult(response);
    } catch (runError) {
      const message =
        runError instanceof Error ? runError.message : "Failed to run trade-off model.";
      setError(message);
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-10 px-4 py-12 sm:px-6 lg:px-8">
      {/* Header Section */}
      <header className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div className="max-w-2xl">
          <h1 className="text-4xl font-bold text-[var(--text-strong)] tracking-tight">Trade-off Lab</h1>
          <p className="mt-4 text-lg text-[var(--text-muted)] leading-relaxed">
            Simulate allocation strategies to analyze the balance between <span className="font-semibold text-[var(--brand)]">operational efficiency</span> and <span className="font-semibold text-[var(--accent)]">equitable distribution</span> of resources.
          </p>
        </div>
        <div className="shrink-0 pb-1">
          <Button onClick={runModel} disabled={isRunning} className="px-6 py-3.5 shadow-lg shadow-[var(--brand-soft)]">
            {isRunning ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                Running Simulation...
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                Run Simulation
              </span>
            )}
          </Button>
        </div>
      </header>

      {error && (
        <Card tone="emergency" className="animate-in fade-in slide-in-from-top-2">
          <div className="flex items-center gap-3">
            <svg className="w-6 h-6 text-[var(--accent)]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
            <p className="text-sm font-medium text-[var(--text-strong)]">{error}</p>
          </div>
        </Card>
      )}

      {/* Control Panel */}
      <Card className="p-6 md:p-8 overflow-hidden relative">
        <div className="absolute inset-0 bg-gradient-to-br from-[var(--surface)] to-[var(--surface-elevated)] opacity-50 pointer-events-none"></div>
        <div className="relative flex flex-col lg:flex-row gap-8 items-start lg:items-center">
          <div className="flex-1 w-full">
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-xl font-bold text-[var(--text-strong)] flex items-center gap-2">
                <svg className="w-5 h-5 text-[var(--brand)]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"></path></svg>
                Optimization Focus
              </h2>
              <span className="inline-flex items-center rounded-full bg-[var(--brand-soft)] px-3.5 py-1 text-sm font-bold text-[var(--brand)] shadow-sm">
                λ = {selectedLambda}
              </span>
            </div>
            <div className="px-1">
              <LambdaSlider
                values={lambdaValues}
                current={selectedLambda}
                onChange={setSelectedLambda}
              />
              <div className="mt-4 flex justify-between text-xs text-[var(--text-muted)] uppercase tracking-wider font-semibold">
                <span>Pure Efficiency</span>
                <span>Balanced</span>
                <span>Pure Fairness</span>
              </div>
            </div>
          </div>
          <div className="hidden lg:block w-px h-28 bg-[var(--border)] mx-4"></div>
          <div className="w-full lg:w-1/3 flex flex-col gap-3">
             <h3 className="text-sm font-bold text-[var(--text-muted)] uppercase tracking-wider flex items-center gap-1.5">
               <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
               What does this do?
             </h3>
             <p className="text-sm text-[var(--text)] leading-relaxed">
               Adjust the lambda (λ) slider to shift the objective function. A value of <strong className="text-[var(--text-strong)]">0</strong> ignores fairness completely, while <strong className="text-[var(--text-strong)]">1</strong> optimizes solely for equity among requests.
             </p>
          </div>
        </div>
      </Card>

      {/* Results Section */}
      {state ? (
        <div className="space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-500 fill-mode-both">
          <div>
            <h2 className="text-2xl font-bold text-[var(--text-strong)] mb-6">Simulation Results</h2>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
              <StatCard label="System Score" value={state.system_score?.toFixed(4)} highlight />
              <StatCard label="Total Matches" value={state.total_assignments} />
              <StatCard label="Avg Efficiency" value={state.metrics?.avg_efficiency.toFixed(4)} />
              <StatCard label="Fairness Penalty" value={state.metrics?.fairness_penalty.toFixed(4)} />
            </div>
          </div>

          <div>
             <h3 className="text-2xl font-bold text-[var(--text-strong)] mb-6">Need Fulfillment Status</h3>
               <div className="grid gap-5 md:grid-cols-2">
                 {state.needs?.map((need) => {
                 const requiredCount = Number(need.required ?? 0);
                 const safeRequired = requiredCount > 0 ? requiredCount : 1;
                 const percent = Math.min(100, Math.round((need.assigned_volunteers.length / safeRequired) * 100));
                 const isFulfilled = need.assigned_volunteers.length >= requiredCount;
                 return (
                   <Card key={String(need.id)} className={`p-6 overflow-hidden relative group transition-shadow hover:shadow-md ${isFulfilled ? 'border-[var(--brand)]' : ''}`}>
                     {isFulfilled && (
                        <div className="absolute top-0 right-0 p-5">
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--brand-soft)] px-2.5 py-1 text-xs font-bold text-[var(--brand)] shadow-sm">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"></path></svg>
                            Fulfilled
                          </span>
                        </div>
                     )}
                     <div className="flex flex-col gap-5">
                       <div>
                         <p className="text-xl font-bold text-[var(--text-strong)] mb-1.5">Need {String(need.id)}</p>
                         <p className="text-sm font-medium text-[var(--text-muted)] flex items-center gap-1.5">
                           <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"></path></svg>
                           {need.assigned_volunteers.length} of {requiredCount} volunteers assigned
                         </p>
                       </div>
                       <div className="space-y-2">
                         <div className="flex justify-between text-sm font-bold text-[var(--text-muted)]">
                           <span>Progress</span>
                           <span className={isFulfilled ? 'text-[var(--brand)]' : ''}>{percent}%</span>
                         </div>
                         <div className="h-3 w-full rounded-full bg-[var(--surface-elevated)] border border-[var(--border)] overflow-hidden shadow-inner">
                           <div
                             className={`h-full transition-all duration-1000 ease-out ${isFulfilled ? 'bg-[var(--brand)]' : 'bg-gradient-to-r from-[var(--brand)] to-[var(--brand-soft)] opacity-85'}`}
                             style={{ width: `${percent}%` }}
                           />
                         </div>
                       </div>
                     </div>
                   </Card>
                 );
               })}
             </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-28 text-center border-2 border-dashed border-[var(--border)] rounded-3xl bg-[color:color-mix(in_oklab,var(--surface)_50%,transparent)] opacity-90 transition-opacity hover:opacity-100">
          <div className="w-20 h-20 bg-[var(--surface-elevated)] rounded-full flex items-center justify-center mb-6 shadow-sm border border-[var(--border)]">
            <svg className="w-10 h-10 text-[var(--text-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"></path>
            </svg>
          </div>
          <h3 className="text-2xl font-bold text-[var(--text-strong)] mb-3 tracking-tight">No Simulation Data</h3>
          <p className="text-[var(--text-muted)] max-w-md mx-auto text-lg">
            Click the <strong className="font-semibold text-[var(--text)]">Run Simulation</strong> button above to evaluate allocation strategies and view results.
          </p>
        </div>
      )}
    </main>
  );
}

function StatCard({ label, value, highlight = false }: { label: string; value: string | number | undefined; highlight?: boolean }) {
  return (
    <div className={`flex flex-col gap-3 rounded-2xl border p-6 transition-all hover:-translate-y-1 hover:shadow-md ${highlight ? 'border-[var(--brand)] bg-[color:color-mix(in_oklab,var(--brand-soft)_30%,var(--surface))] shadow-sm' : 'border-[var(--border)] bg-[var(--surface)]'}`}>
      <span className="text-sm font-bold text-[var(--text-muted)] uppercase tracking-wider">{label}</span>
      <span className={`text-4xl font-black tracking-tighter ${highlight ? 'text-[var(--brand)]' : 'text-[var(--text-strong)]'}`}>
        {value !== undefined ? value : "—"}
      </span>
    </div>
  );
}
