"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { fetchHotspots, fetchNeeds } from "@/lib/api";
import type { HotspotsResponse, NeedRecord } from "@/lib/types";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

function StatTile({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <Card className="p-5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">{label}</p>
      <p className="mt-2 text-3xl font-bold text-[var(--text-strong)]">{value}</p>
      {sub && <p className="mt-1 text-xs text-[var(--text-muted)]">{sub}</p>}
    </Card>
  );
}

function FulfillmentBar({ needed, assigned, label }: { needed: number; assigned: number; label: string }) {
  const pct = needed > 0 ? Math.min(100, Math.round((assigned / needed) * 100)) : 0;
  const color = pct >= 90 ? "var(--accent)" : pct >= 60 ? "#cc7f37" : "var(--brand)";
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-[var(--text-strong)] capitalize">{label.replaceAll("-", " ")}</span>
        <span className="text-[var(--text-muted)]">{assigned}/{needed} ({pct}%)</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--border)]">
        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const [needs, setNeeds] = useState<NeedRecord[]>([]);
  const [hotspots, setHotspots] = useState<HotspotsResponse | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [needsData, hotspotsData] = await Promise.all([
        fetchNeeds(),
        fetchHotspots().catch(() => null),
      ]);
      setNeeds(needsData);
      setHotspots(hotspotsData);
      setLastRefresh(new Date());
    } catch {
      // ignore; show stale data
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();

    // Auto-refresh every 5 minutes — only when tab is visible
    const interval = setInterval(() => {
      if (typeof document === "undefined" || document.visibilityState !== "hidden") {
        void loadData();
      }
    }, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [loadData]);

  const stats = useMemo(() => {
    const emergency = needs.filter((n) => n.emergency_level === "emergency").length;
    const notified = needs.reduce((s, n) => s + n.notified_volunteer_ids.length, 0);
    const headcount = needs.reduce((s, n) => s + n.required_volunteers, 0);
    const committed = needs.reduce((s, n) => s + n.accepted_count, 0);
    const fillRate = headcount > 0 ? Math.round((committed / headcount) * 100) : 0;
    const openNeeds = needs.filter((n) => n.status === "open").length;
    return { emergency, notified, headcount, committed, fillRate, openNeeds };
  }, [needs]);

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-[32px] border border-[var(--border)] bg-[var(--surface-overlay)] p-6 shadow-[0_16px_45px_rgba(8,30,48,0.16)] backdrop-blur-xl">
        <div
          className="pointer-events-none absolute inset-0 bg-cover bg-center opacity-20"
          style={{ backgroundImage: "url(https://images.unsplash.com/photo-1618477462146-050d2767eac4?auto=format&fit=crop&w=1400&q=80)" }}
        />
        <div className="absolute inset-0" style={{ background: "var(--hero-mask)" }} />
        <div className="relative flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-[var(--brand)]">Control Center</p>
            <h1 className="mt-2 text-4xl leading-tight text-[var(--text-strong)]">Operations Dashboard</h1>
            <p className="mt-3 max-w-2xl text-sm text-[var(--text-muted)]">
              Real-time overview of active requests, emergency demand, and volunteer coverage across the network.
            </p>
            {lastRefresh && (
              <p className="mt-2 text-xs text-[var(--text-muted)]">Last refresh: {lastRefresh.toLocaleTimeString()}</p>
            )}
          </div>
          <Button variant="secondary" onClick={() => void loadData()} disabled={isLoading} className="shrink-0">
            {isLoading ? "Refreshing…" : "Refresh"}
          </Button>
        </div>
      </section>

      {/* Stat tiles */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Open Needs" value={stats.openNeeds} />
        <Card tone="emergency" className="p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">Emergency Needs</p>
          <p className="mt-2 text-3xl font-bold text-[var(--text-strong)]">{stats.emergency}</p>
        </Card>
        <StatTile label="Volunteers Needed" value={stats.headcount} />
        <StatTile label="Fill Rate" value={`${stats.fillRate}%`} sub={`${stats.committed} of ${stats.headcount} committed`} />
      </div>

      {/* Hotspot fulfillment bars */}
      {hotspots && hotspots.urgent_categories.length > 0 && (
        <Card>
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="text-xl text-[var(--text-strong)]">Volunteer Coverage by Category</h2>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                Bars show fill rate — <span style={{ color: "var(--brand)" }}>blue = under-staffed</span>,{" "}
                <span style={{ color: "#cc7f37" }}>amber = getting full</span>,{" "}
                <span style={{ color: "var(--accent)" }}>red = over-subscribed / urgent</span>
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-xs text-[var(--text-muted)]">Total needed</p>
              <p className="text-2xl font-bold text-[var(--text-strong)]">{hotspots.total_volunteers_needed}</p>
            </div>
          </div>
          <div className="space-y-3">
            {hotspots.urgent_categories.slice(0, 10).map((cat) => (
              <FulfillmentBar
                key={cat.category}
                label={cat.category}
                needed={cat.required_volunteers}
                assigned={cat.accepted_volunteers}
              />
            ))}
          </div>
          <div className="mt-4 grid grid-cols-3 gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-3">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Open Requests</p>
              <p className="text-lg font-bold text-[var(--text-strong)]">{hotspots.total_open_needs}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Total Needed</p>
              <p className="text-lg font-bold text-[var(--text-strong)]">{hotspots.total_volunteers_needed}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Assigned</p>
              <p className="text-lg font-bold text-[var(--text-strong)]">{hotspots.total_volunteers_assigned}</p>
            </div>
          </div>
        </Card>
      )}

      {/* Recent requests */}
      <Card>
        <h2 className="text-xl text-[var(--text-strong)]">Recent Requests</h2>
        <div className="mt-3 space-y-3">
          {needs.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No needs yet. Create one from the NGO workspace to activate this board.</p>
          ) : (
            needs.slice(0, 8).map((need) => {
              const pct = need.required_volunteers > 0
                ? Math.round((need.accepted_count / need.required_volunteers) * 100)
                : 0;
              return (
                <div key={need.id} className="rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-[var(--text-strong)] truncate">{need.title}</p>
                      <p className="mt-0.5 text-sm text-[var(--text-muted)]">
                        {need.ngo_name} • {need.need_type} • {need.required_volunteers} needed
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${need.emergency_level === "emergency" ? "bg-[var(--accent-soft)] text-[var(--accent)]" : "bg-[var(--brand-soft)] text-[var(--brand)]"}`}>
                        {need.emergency_level === "emergency" ? "EMERGENCY" : "standard"}
                      </span>
                      <p className="mt-1 text-xs text-[var(--text-muted)]">{pct}% filled</p>
                    </div>
                  </div>
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--border)]">
                    <div className="h-full rounded-full bg-[var(--brand)] transition-all" style={{ width: `${pct}%` }} />
                  </div>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">
                    <span className="font-medium" style={{ color: "var(--success)" }}>{need.accepted_count} committed</span>
                    {" · "}
                    <span className="font-medium" style={{ color: "var(--pin)" }}>{need.interested_count} pinned</span>
                    {" · "}
                    <span>{need.declined_count} declined</span>
                  </p>
                </div>
              );
            })
          )}
        </div>
      </Card>
    </main>
  );
}
