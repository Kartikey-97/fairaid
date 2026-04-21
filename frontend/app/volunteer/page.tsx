"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  ApiError,
  fetchHotspots,
  fetchVolunteerByUser,
  fetchVolunteerFeed,
  fetchVolunteerNotifications,
  markVolunteerNotificationRead,
  setVolunteerDecision,
} from "@/lib/api";
import { getNeedCardImage } from "@/lib/event-media";
import { buildMapEmbedUrl } from "@/lib/location";
import { appendQueueItem, readCached, readQueue, writeCached, writeQueue } from "@/lib/offline";
import { useAuthGuard } from "@/lib/use-auth-guard";
import type {
  HotspotsResponse,
  VolunteerDecision,
  VolunteerFeedResponse,
  VolunteerNeedCard,
  VolunteerProfile,
} from "@/lib/types";
import { Timeline } from "@/components/gantt/Timeline";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

type CachedDecision = {
  need_id: string;
  decision: VolunteerDecision;
  created_at: string;
};

type TimingFilter = "any" | "morning" | "afternoon" | "evening";
type TopTab = "all" | "emergency" | "matches";

function toTimeLabel(value?: string): string {
  if (!value) return "--:--";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value.slice(11, 16);
  return parsed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

function fitPercent(score: number): string {
  return `${(score * 100).toFixed(1)}%`;
}

function decisionLabel(decision?: VolunteerDecision | null): string {
  if (decision === "accepted") return "You committed";
  if (decision === "pinned" || decision === "interested") return "Saved for later";
  if (decision === "declined") return "You declined";
  return "";
}

function getTimeBucket(value?: string): TimingFilter {
  if (!value) return "any";
  const parsed = new Date(value);
  const hour = Number.isNaN(parsed.getTime()) ? Number(value.slice(11, 13)) : parsed.getHours();
  if (Number.isNaN(hour)) return "any";
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  return "evening";
}

function TaskCard({
  item,
  onOpen,
  onDecision,
  isUpdating,
}: {
  item: VolunteerNeedCard;
  onOpen: (item: VolunteerNeedCard) => void;
  onDecision: (needId: string, decision: VolunteerDecision) => Promise<void>;
  isUpdating: boolean;
}) {
  const isEmergency = item.emergency_level === "emergency";
  const isPinned = item.user_decision === "pinned" || item.user_decision === "interested";
  const isAccepted = item.user_decision === "accepted";
  const isDeclined = item.user_decision === "declined";
  const spotsLeft = Math.max(item.required_volunteers - item.accepted_count, 0);
  const matchPct = Math.round(item.recommendation_score * 100);

  const accentColor = isEmergency
    ? "var(--accent)"
    : isAccepted ? "var(--success)"
    : isPinned   ? "var(--pin)"
    : "var(--brand)";

  return (
    <article
      className="relative overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg"
      style={{ borderLeft: `4px solid ${accentColor}` }}
    >
      <div
        className="pointer-events-none absolute inset-0 z-0 bg-cover bg-center opacity-[0.12]"
        style={{ backgroundImage: `url(${getNeedCardImage(item.need_type, item.title, item.ngo_name)})` }}
      />
      <div className="pointer-events-none absolute inset-0 z-[1] bg-[linear-gradient(160deg,color-mix(in_oklab,var(--surface)_95%,transparent),color-mix(in_oklab,var(--surface)_90%,var(--brand-soft))_52%,color-mix(in_oklab,var(--surface)_96%,transparent))]" />
      <div className="relative z-10 p-4">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex flex-wrap gap-1.5 items-center">
            {isEmergency && (
              <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white" style={{ background: "var(--accent)" }}>
                <span className="h-1 w-1 rounded-full bg-white animate-pulse" />
                Emergency
              </span>
            )}
            <span className="rounded-full border border-[var(--border)] bg-[var(--surface-elevated)] px-2 py-0.5 text-[10px] font-medium text-[var(--text-muted)] capitalize">
              {item.need_type.replaceAll("-", " ")}
            </span>
          </div>
          <span
            className="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold"
            style={{
              background: matchPct >= 70 ? "var(--brand-soft)" : "var(--surface-elevated)",
              color:      matchPct >= 70 ? "var(--brand)"      : "var(--text-muted)",
            }}
          >
            {matchPct}% match
          </span>
        </div>

        <h3 className="text-base font-bold text-[var(--text-strong)] leading-tight">{item.title}</h3>
        <p className="mt-0.5 text-xs text-[var(--text-muted)]">{item.ngo_name}</p>

        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-[var(--text-muted)]">
          <span>Distance {item.distance_km} km</span>
          {item.shift_start && <span>Shift {toTimeLabel(item.shift_start)} - {toTimeLabel(item.shift_end)}</span>}
          <span>{spotsLeft} of {item.required_volunteers} spots left</span>
        </div>

        <div className="mt-2.5">
          <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: "var(--border)" }}>
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${Math.min(100, (item.accepted_count / Math.max(item.required_volunteers, 1)) * 100)}%`,
                background: item.accepted_count >= item.required_volunteers ? "var(--accent)" : "var(--brand)",
              }}
            />
          </div>
        </div>

        {item.matching_reasons.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {item.matching_reasons.slice(0, 3).map((r) => (
              <span key={r} className="rounded-full border px-2 py-0.5 text-[10px] font-medium" style={{ borderColor: "var(--brand-soft)", background: "var(--brand-soft)", color: "var(--brand)" }}>
                {r}
              </span>
            ))}
          </div>
        )}

        {item.user_decision && (
          <p className="mt-1.5 text-[11px] font-semibold" style={{ color: accentColor }}>
            {decisionLabel(item.user_decision)}
          </p>
        )}

        <div className="mt-3 grid grid-cols-4 gap-1.5">
          <button type="button" disabled={isUpdating} onClick={() => onDecision(item.need_id, "pinned")}
            className="rounded-xl border py-2 text-xs font-bold transition disabled:opacity-50"
            style={{
              borderColor: isPinned ? "var(--pin)" : "var(--border)",
              background:  isPinned ? "var(--pin-soft)"  : "var(--surface-elevated)",
              color:       isPinned ? "var(--pin)"  : "var(--text-muted)",
            }}>
            Pin
          </button>
          <button type="button" disabled={isUpdating} onClick={() => onDecision(item.need_id, "accepted")}
            className="rounded-xl py-2 text-xs font-bold text-white transition hover:brightness-110 disabled:opacity-50"
            style={{ background: isAccepted ? "var(--success)" : "var(--brand)" }}>
            {isAccepted ? "Committed" : "I Can Join"}
          </button>
          <button type="button" disabled={isUpdating} onClick={() => onDecision(item.need_id, "declined")}
            className="rounded-xl border py-2 text-xs font-bold transition disabled:opacity-50"
            style={{
              borderColor: isDeclined ? "var(--accent)" : "var(--border)",
              background:  isDeclined ? "var(--accent-soft)" : "var(--surface-elevated)",
              color:       isDeclined ? "var(--accent)" : "var(--text-muted)",
            }}>
            Can&apos;t Join
          </button>
          <button type="button" onClick={() => onOpen(item)}
            className="rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] py-2 text-xs font-semibold text-[var(--text-strong)] transition hover:border-[var(--brand)] hover:text-[var(--brand)]">
            Details
          </button>
        </div>
      </div>
    </article>
  );
}

export default function VolunteerPage() {
  const { session: rawSession, isChecking, isAuthorized } = useAuthGuard("volunteer");

  // ── FIX: Stabilise the session reference so it doesn't recreate on every
  // render.  getSession() calls JSON.parse which produces a new object each
  // time; without this useMemo the loadVolunteerWorkspace useCallback would
  // see a new `session` dep on every render, recreating itself and triggering
  // an infinite useEffect → setState → re-render loop (visible as the terminal
  // spam of repeated POST /feed and GET /notifications requests).
  const session = useMemo(
    () => rawSession,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rawSession?.user_id, rawSession?.role],
  );

  const [volunteer, setVolunteer] = useState<VolunteerProfile | null>(null);
  const [feed, setFeed] = useState<VolunteerFeedResponse | null>(null);
  const [hotspots, setHotspots] = useState<HotspotsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isUpdatingDecision, setIsUpdatingDecision] = useState(false);
  const [offlineMode, setOfflineMode] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<Array<{ id: string; title: string; message: string }>>([]);
  const [showTasks, setShowTasks] = useState(false);
  const [selectedNeed, setSelectedNeed] = useState<VolunteerNeedCard | null>(null);
  const [isFeedLoading, setIsFeedLoading] = useState(false);

  const [topTab, setTopTab] = useState<TopTab>("all");
  const [maxDistanceFilter, setMaxDistanceFilter] = useState(30);
  const [typeFilter, setTypeFilter] = useState("all");
  const [timingFilter, setTimingFilter] = useState<TimingFilter>("any");
  const [locationFilter, setLocationFilter] = useState("");
  const [searchFilter, setSearchFilter] = useState("");

  // Refs to avoid stale closures without adding unstable deps
  const mountedRef = useRef(false);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const profileCacheKey = session ? `fairaid_cache_vol_profile_${session.user_id}` : "fairaid_cache_vol_profile";
  const feedCacheKey = session ? `fairaid_cache_vol_feed_${session.user_id}` : "fairaid_cache_vol_feed";
  const hotspotCacheKey = "fairaid_cache_hotspots";
  const decisionQueueKey = session ? `fairaid_queue_vol_decisions_${session.user_id}` : "fairaid_queue_vol_decisions";

  // ── Flush queued offline decisions when back online
  const flushQueuedDecisions = useCallback(async (volunteerId: string) => {
    const queued = readQueue<CachedDecision>(decisionQueueKey);
    if (!queued.length || !navigator.onLine) return;
    const remaining: CachedDecision[] = [];
    for (const queuedDecision of queued) {
      try {
        await setVolunteerDecision(volunteerId, queuedDecision.need_id, { decision: queuedDecision.decision });
      } catch {
        remaining.push(queuedDecision);
      }
    }
    writeQueue(decisionQueueKey, remaining);
  }, [decisionQueueKey]);

  // ── Core workspace loader (stable: only recreates if user_id/role changes)
  const loadVolunteerWorkspace = useCallback(async (useCacheOnFailure = true) => {
    if (!session) return;
    try {
      const profile = await fetchVolunteerByUser(session.user_id);
      if (!mountedRef.current) return;
      setVolunteer(profile);
      setMaxDistanceFilter(Math.max(5, Math.round(profile.radius_km || 25)));
      writeCached(profileCacheKey, profile);

      const [newFeed, hot] = await Promise.all([
        fetchVolunteerFeed(profile.id, { limit: 32, include_non_emergency: true }),
        fetchHotspots().catch(() => null),
      ]);
      if (!mountedRef.current) return;
      setFeed(newFeed);
      writeCached(feedCacheKey, newFeed);
      if (hot) {
        setHotspots(hot);
        writeCached(hotspotCacheKey, hot);
      }
      setLastSyncAt(new Date().toISOString());
      setOfflineMode(false);
      setError(null);
    } catch (loadError) {
      if (!mountedRef.current) return;
      if (!useCacheOnFailure) {
        setError(loadError instanceof Error ? loadError.message : "Could not load volunteer workspace.");
        return;
      }
      const cachedProfile = readCached<VolunteerProfile>(profileCacheKey);
      const cachedFeed = readCached<VolunteerFeedResponse>(feedCacheKey);
      const cachedHotspots = readCached<HotspotsResponse>(hotspotCacheKey);
      if (cachedProfile?.data) {
        setVolunteer(cachedProfile.data);
        setMaxDistanceFilter(Math.max(5, Math.round(cachedProfile.data.radius_km || 25)));
      }
      if (cachedFeed?.data) setFeed(cachedFeed.data);
      if (cachedHotspots?.data) setHotspots(cachedHotspots.data);
      setLastSyncAt(cachedFeed?.updated_at ?? cachedProfile?.updated_at ?? null);
      setOfflineMode(Boolean(cachedProfile || cachedFeed));
      setError(`Offline mode: ${loadError instanceof Error ? loadError.message : "Network unavailable."}`);
    }
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [session]);

  // ── Initial load — runs once per authorised session
  useEffect(() => {
    if (!session || !isAuthorized) return;
    mountedRef.current = true;
    void loadVolunteerWorkspace(true);
    return () => { mountedRef.current = false; };
  }, [isAuthorized, session, loadVolunteerWorkspace]);

  // ── Notification polling — separate, slower interval (60 s), visibility-aware
  useEffect(() => {
    if (!volunteer) return;

    if ("Notification" in window && Notification.permission === "default") {
      void Notification.requestPermission();
    }

    const pollNotifications = async () => {
      // Don't hammer the server when the tab is hidden
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      try {
        const unread = await fetchVolunteerNotifications(volunteer.id, true);
        if (!unread.length) return;
        setNotifications((prev) => {
          const merged = [...unread.map((n) => ({ id: n.id, title: n.title, message: n.message })), ...prev];
          return Array.from(new Map(merged.map((n) => [n.id, n])).values()).slice(0, 6);
        });
        if ("Notification" in window && Notification.permission === "granted") {
          unread.forEach((n) => new Notification(n.title, { body: n.message }));
        }
        await Promise.all(unread.map((n) => markVolunteerNotificationRead(volunteer.id, n.id)));
      } catch {
        // Silent — network may be flaky
      }
    };

    void pollNotifications();
    // 60 s poll instead of 20 s to reduce server load significantly
    pollTimerRef.current = setInterval(() => void pollNotifications(), 60_000);

    const onlineHandler = () => {
      void flushQueuedDecisions(volunteer.id);
      void loadVolunteerWorkspace(true);
    };
    window.addEventListener("online", onlineHandler);

    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      window.removeEventListener("online", onlineHandler);
    };
  // Deliberately NOT including loadVolunteerWorkspace so this effect only
  // re-runs when the volunteer profile itself changes (i.e. on login).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [volunteer?.id, flushQueuedDecisions]);

  // ── Derived data
  const timelineItems = useMemo(() => {
    if (!feed) return [];
    return feed.all
      .filter((item) => item.user_decision === "accepted")
      .slice(0, 8)
      .map((item, index) => ({
        id: item.need_id,
        label: item.title,
        start: toTimeLabel(item.shift_start),
        end: toTimeLabel(item.shift_end),
        color: index % 2 === 0 ? "#2f91a8" : "#69a97e",
      }));
  }, [feed]);

  const committedEvents = useMemo(() => feed?.all.filter((item) => item.user_decision === "accepted") ?? [], [feed]);
  const pinnedTasks = useMemo(() => feed?.all.filter((item) => item.user_decision === "pinned" || item.user_decision === "interested") ?? [], [feed]);

  const needTypeOptions = useMemo(() => {
    if (!feed) return [];
    return Array.from(new Set(feed.all.map((item) => item.need_type))).sort();
  }, [feed]);

  const filteredTasks = useMemo(() => {
    if (!feed) return [];
    return feed.all
      .filter((item) => {
        if (topTab === "emergency" && item.emergency_level !== "emergency") return false;
        if (topTab === "matches" && !(item.within_distance && (item.capability_score > 0 || item.recommendation_score >= 0.5))) return false;
        if (item.distance_km > maxDistanceFilter) return false;
        if (typeFilter !== "all" && item.need_type !== typeFilter) return false;
        if (timingFilter !== "any" && getTimeBucket(item.shift_start) !== timingFilter) return false;
        if (locationFilter.trim() && !String(item.need_address ?? "").toLowerCase().includes(locationFilter.toLowerCase())) return false;
        if (searchFilter.trim() && !`${item.title} ${item.ngo_name} ${item.need_type}`.toLowerCase().includes(searchFilter.toLowerCase())) return false;
        return true;
      })
      .sort((a, b) => b.recommendation_score - a.recommendation_score);
  }, [feed, locationFilter, maxDistanceFilter, searchFilter, timingFilter, topTab, typeFilter]);

  // ── Actions
  const refreshFeed = useCallback(async (volunteerId: string) => {
    setIsFeedLoading(true);
    try {
      const updatedFeed = await fetchVolunteerFeed(volunteerId, { limit: 32, include_non_emergency: true });
      setFeed(updatedFeed);
      writeCached(feedCacheKey, updatedFeed);
      setOfflineMode(false);
      setLastSyncAt(new Date().toISOString());
    } catch {
      const cachedFeed = readCached<VolunteerFeedResponse>(feedCacheKey);
      if (cachedFeed?.data) { setFeed(cachedFeed.data); setOfflineMode(true); }
    } finally {
      setIsFeedLoading(false);
    }
  }, [feedCacheKey]);

  async function handleDecision(needId: string, decision: VolunteerDecision) {
    if (!volunteer) return;
    setError(null);
    setIsUpdatingDecision(true);
    try {
      await setVolunteerDecision(volunteer.id, needId, { decision });
      await refreshFeed(volunteer.id);
    } catch (decisionError) {
      if (decisionError instanceof ApiError && decisionError.status < 500) {
        setError(decisionError.message);
        return;
      }
      appendQueueItem<CachedDecision>(decisionQueueKey, {
        need_id: needId,
        decision,
        created_at: new Date().toISOString(),
      });
      setOfflineMode(true);
      setError(`Saved offline — will sync when connectivity returns.`);
      setFeed((prev) => {
        if (!prev) return prev;
        const patch = (cards: VolunteerNeedCard[]) =>
          cards.map((c) => (c.need_id === needId ? { ...c, user_decision: decision } : c));
        return { ...prev, emergency: patch(prev.emergency), recommended: patch(prev.recommended), all: patch(prev.all) };
      });
    } finally {
      setIsUpdatingDecision(false);
    }
  }

  if (isChecking) {
    return (
      <main className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <Card>Loading volunteer workspace...</Card>
      </main>
    );
  }

  if (!volunteer) {
    return (
      <main className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
        <Card>
          <h1 className="text-2xl text-[var(--text-strong)]">Complete your volunteer profile</h1>
          <p className="mt-2 text-sm text-[var(--text-muted)]">
            Add your address, response radius, skills, and job category so we can compute distance and recommend relevant opportunities.
          </p>
          <div className="mt-4">
            <Link href="/volunteer/profile" className="text-sm font-semibold text-[var(--brand)] hover:underline">
              Open profile setup
            </Link>
          </div>
          {error ? <p className="mt-3 text-sm text-[#b63a32]">{error}</p> : null}
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
      {offlineMode && (
        <Card tone="emergency">
          <p className="text-sm font-semibold text-[var(--text-strong)]">Offline Mode Active</p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            Showing last synced tasks.{lastSyncAt ? ` Last sync: ${new Date(lastSyncAt).toLocaleString()}` : " No sync timestamp available."}
          </p>
        </Card>
      )}
      {error && (
        <Card tone="emergency">
          <p className="text-sm text-[var(--text-strong)]">{error}</p>
        </Card>
      )}

      {/* Hero */}
      <section className="relative overflow-hidden rounded-[32px] border border-[var(--border)] bg-[var(--surface-overlay)] p-6 shadow-[0_16px_45px_rgba(8,30,48,0.16)] backdrop-blur-xl">
        <div className="absolute inset-0 bg-cover bg-center opacity-30" style={{ backgroundImage: "url(https://images.unsplash.com/photo-1469571486292-b53601020f0d?auto=format&fit=crop&w=1400&q=80)" }} />
        <div className="absolute inset-0" style={{ background: "var(--hero-mask)" }} />
        <div className="relative grid gap-4 lg:grid-cols-[1.35fr_1fr]">
          <div>
            <p className="text-sm font-semibold text-[var(--brand)]">Welcome back, {volunteer.name.split(" ")[0]}!</p>
            <h1 className="mt-2 text-4xl leading-tight text-[var(--text-strong)]">Ready to make a difference today?</h1>
            <p className="mt-3 text-sm text-[var(--text-muted)]">Distance-first matching with skill and specialist fit.</p>
            <div className="mt-5 flex flex-wrap gap-3">
              <Button
                onClick={() => {
                  setShowTasks(true);
                  if (volunteer) void refreshFeed(volunteer.id);
                }}
                disabled={isFeedLoading}
              >
                {isFeedLoading ? "Refreshing..." : "Refresh Tasks"}
              </Button>
              <Link href="/volunteer/profile"><Button variant="secondary">View Profile</Button></Link>
              <Link href="/volunteer/field-intel"><Button variant="ghost">Ground Report</Button></Link>
              <Link href="/volunteer/accessibility"><Button variant="ghost">Gesture Aid</Button></Link>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-overlay-strong)] px-3 py-3">
              <p className="text-xs text-[var(--text-muted)]">Committed</p>
              <p className="text-2xl font-bold text-[var(--text-strong)]">{committedEvents.length}</p>
            </div>
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-overlay-strong)] px-3 py-3">
              <p className="text-xs text-[var(--text-muted)]">Emergency Matches</p>
              <p className="text-2xl font-bold text-[var(--text-strong)]">{feed?.emergency.length ?? 0}</p>
            </div>
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-overlay-strong)] px-3 py-3 sm:col-span-2">
              <p className="text-xs text-[var(--text-muted)]">Address</p>
              <p className="text-sm font-semibold text-[var(--text-strong)]">{volunteer.address ?? "Not set"}</p>
            </div>
          </div>
        </div>
      </section>

      {/* Emergency alerts */}
      {notifications.length > 0 && (
        <Card tone="emergency">
          <h2 className="text-lg text-[var(--text-strong)]">Emergency Alerts</h2>
          <div className="mt-3 space-y-2">
            {notifications.slice(0, 4).map((item) => (
              <div key={item.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2">
                <p className="text-sm font-semibold text-[var(--text-strong)]">{item.title}</p>
                <p className="text-xs text-[var(--text-muted)]">{item.message}</p>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Hotspots */}
      {hotspots && hotspots.urgent_categories.length > 0 && (
        <Card>
          <h2 className="text-xl text-[var(--text-strong)]">Regional Hotspots</h2>
          <p className="mt-1 text-xs text-[var(--text-muted)]">Most under-supported categories across active requests.</p>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            {hotspots.urgent_categories.slice(0, 6).map((category) => {
              const deficit = Math.max(0, category.required_volunteers - category.accepted_volunteers);
              const pct = category.required_volunteers > 0 ? Math.min(100, (category.accepted_volunteers / category.required_volunteers) * 100) : 0;
              return (
                <div key={category.category} className="rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-3">
                  <p className="text-sm font-semibold capitalize text-[var(--text-strong)]">{category.category.replaceAll("-", " ")}</p>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">Deficit: {deficit} volunteers</p>
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--border)]">
                    <div className="h-full rounded-full bg-[var(--brand)]" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Task list */}
      {!showTasks ? (
        <Card>
          <h2 className="text-xl text-[var(--text-strong)]">Task Stream</h2>
          <p className="mt-2 text-sm text-[var(--text-muted)]">Click <strong>Refresh Tasks</strong> above to load and filter opportunities.</p>
        </Card>
      ) : (
        <>
          {/* Filters */}
          <Card>
            <div className="flex flex-wrap items-center gap-2">
              {(["all", "emergency", "matches"] as TopTab[]).map((tab) => (
                <button key={tab} type="button" onClick={() => setTopTab(tab)}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold ${topTab === tab ? (tab === "emergency" ? "bg-[var(--accent)] text-white" : "bg-[var(--brand)] text-white") : "bg-[var(--surface-elevated)] text-[var(--text-muted)]"}`}>
                  {tab === "all" ? "All Tasks" : tab === "emergency" ? "Emergency" : "Matches"}
                </button>
              ))}
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              <label className="space-y-1 text-xs">
                <span>Search</span>
                <input value={searchFilter} onChange={(e) => setSearchFilter(e.target.value)} placeholder="title / ngo / type"
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2 text-sm" />
              </label>
              <label className="space-y-1 text-xs">
                <span>Work Type</span>
                <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2 text-sm">
                  <option value="all">All</option>
                  {needTypeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
              <label className="space-y-1 text-xs">
                <span>Timing</span>
                <select value={timingFilter} onChange={(e) => setTimingFilter(e.target.value as TimingFilter)}
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2 text-sm">
                  <option value="any">Any</option>
                  <option value="morning">Morning</option>
                  <option value="afternoon">Afternoon</option>
                  <option value="evening">Evening/Night</option>
                </select>
              </label>
              <label className="space-y-1 text-xs">
                <span>Location</span>
                <input value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)} placeholder="city / area"
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2 text-sm" />
              </label>
              <label className="space-y-1 text-xs">
                <span>Max Distance ({maxDistanceFilter} km)</span>
                <input type="range" min={1} max={Math.max(10, Math.round(volunteer.radius_km || 25))}
                  value={maxDistanceFilter} onChange={(e) => setMaxDistanceFilter(Number(e.target.value))} className="w-full" />
              </label>
            </div>
          </Card>

          {/* Pinned */}
          <div>
            <div className="mb-2 flex items-center gap-2">
              <span className="text-sm font-bold text-[var(--text-strong)]">Pinned for Later</span>
              <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: "var(--pin-soft)", color: "var(--pin)" }}>
                {pinnedTasks.length}
              </span>
            </div>
            {pinnedTasks.length > 0 ? (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {pinnedTasks.map((item) => (
                  <div key={item.need_id} className="flex items-center gap-3 rounded-xl border p-3"
                    style={{ borderColor: "color-mix(in oklab, var(--pin) 45%, var(--border))", background: "var(--surface-elevated)", borderLeft: "3px solid var(--pin)" }}>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate text-[var(--text-strong)]">{item.title}</p>
                      <p className="text-xs text-[var(--text-muted)] mt-0.5">{item.ngo_name} · {item.distance_km} km</p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <button type="button" disabled={isUpdatingDecision} onClick={() => handleDecision(item.need_id, "accepted")}
                        className="rounded-lg px-2 py-1 text-[10px] font-bold text-white" style={{ background: "var(--brand)" }}>
                        Join
                      </button>
                      <button type="button" disabled={isUpdatingDecision} onClick={() => handleDecision(item.need_id, "declined")}
                        className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[10px] text-[var(--text-muted)]">
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <Card><p className="text-xs text-[var(--text-muted)]">No pinned events yet. Use &apos;Pin&apos; on a card to save it here.</p></Card>
            )}
          </div>

          {/* Tasks grid */}
          <section className="space-y-4">
            {filteredTasks.length ? (
              filteredTasks.map((item) => (
                <TaskCard key={item.need_id} item={item} onOpen={setSelectedNeed} onDecision={handleDecision} isUpdating={isUpdatingDecision} />
              ))
            ) : (
              <Card><p className="text-sm text-[var(--text-muted)]">No tasks match the current filters.</p></Card>
            )}
          </section>
        </>
      )}

      {/* Timeline */}
      <Card>
        <h2 className="text-xl text-[var(--text-strong)]">Confirmed Commitments</h2>
        {timelineItems.length ? (
          <div className="mt-3"><Timeline title="Committed Shift Timeline" items={timelineItems} /></div>
        ) : (
          <p className="mt-3 text-sm text-[var(--text-muted)]">No committed shifts yet.</p>
        )}
      </Card>

      {/* Detail modal */}
      {selectedNeed && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-3 sm:items-center">
          <div className="relative w-full max-w-2xl overflow-hidden rounded-[26px] border border-[var(--border)] bg-[var(--surface-overlay-strong)] shadow-[0_20px_60px_rgba(8,28,44,0.34)] backdrop-blur-xl">
            <div className="flex items-start justify-between border-b border-[var(--border)] p-4">
              <div>
                <h3 className="text-xl font-bold text-[var(--text-strong)]">{selectedNeed.title}</h3>
                <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                  {selectedNeed.ngo_name} • {selectedNeed.need_type}
                </p>
              </div>
              <button type="button" onClick={() => setSelectedNeed(null)}
                className="rounded-full border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-1 text-xs font-semibold">
                Close
              </button>
            </div>
            <div className="space-y-3 p-4">
              <p className="text-sm text-[var(--text-muted)]">{selectedNeed.need_address ?? "Address unavailable"}</p>
              <p className="text-sm text-[var(--text-muted)]">Distance: {selectedNeed.distance_km} km • Fit: {fitPercent(selectedNeed.recommendation_score)}</p>
              <p className="text-sm text-[var(--text-muted)]">Shift: {toTimeLabel(selectedNeed.shift_start)} - {toTimeLabel(selectedNeed.shift_end)}</p>
              <div className="flex flex-wrap gap-2">
                {selectedNeed.required_skills.slice(0, 8).map((skill) => (
                  <span key={skill} className="rounded-full bg-[var(--surface-elevated)] px-2.5 py-1 text-xs font-semibold text-[var(--text-muted)]">{skill}</span>
                ))}
              </div>
              {selectedNeed.need_location && (
                <div className="overflow-hidden rounded-xl border border-[var(--border)]">
                  <iframe title={`${selectedNeed.title} map`} src={buildMapEmbedUrl(selectedNeed.need_location.lat, selectedNeed.need_location.lng)} className="h-56 w-full" loading="lazy" />
                </div>
              )}
              <div className="grid grid-cols-3 gap-2">
                <Button variant="secondary" onClick={() => handleDecision(selectedNeed.need_id, "pinned")} disabled={isUpdatingDecision}>Pin</Button>
                <Button onClick={() => handleDecision(selectedNeed.need_id, "accepted")} disabled={isUpdatingDecision}>I&apos;m In</Button>
                <Button variant="danger" onClick={() => handleDecision(selectedNeed.need_id, "declined")} disabled={isUpdatingDecision}>Can&apos;t Join</Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}