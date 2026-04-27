"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  createNeed,
  deleteFieldIntelReport,
  deleteNgoNeed,
  draftNeedFromText,
  fetchCatalog,
  fetchNeedAudit,
  fetchNeedTemplates,
  fetchNgoNeeds,
  geocodeSuggestions,
  fetchHotspots,
  fetchNeedVolunteers,
  removeVolunteerFromNeed,
  runAutonomousDispatch,
  fetchFieldIntelReports,
} from "@/lib/api";
import { DEFAULT_CATALOG } from "@/lib/catalog";
import { getNeedCardImage } from "@/lib/event-media";
import { geocodeAddress, reverseGeocode } from "@/lib/location";
import { appendQueueItem, readCached, readQueue, writeCached, writeQueue } from "@/lib/offline";
import { useAuthGuard } from "@/lib/use-auth-guard";
import type {
  NeedAuditEntry,
  NeedCreateRequest,
  NeedRecord,
  NeedTemplate,
  NeedVolunteerApplication,
  SkillCatalog,
  HotspotsResponse,
  AutonomousDispatchResponse,
  FieldIntelReport,
} from "@/lib/types";
//import { DraggablePinMap } from "@/components/maps/DraggablePinMap";
import dynamic from "next/dynamic";

// Dynamically import the map and disable SSR
const DraggablePinMap = dynamic(
  () => import("@/components/maps/DraggablePinMap").then((mod) => mod.DraggablePinMap),
  {
    ssr: false,
    loading: () => <div className="h-64 w-full animate-pulse bg-gray-200 rounded-md">Loading map...</div>
  }
);

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

type SpeechRecognitionCtor = new () => {
  lang: string;
  interimResults: boolean;
  onresult: ((event: {
    resultIndex: number;
    results: ArrayLike<{
      isFinal: boolean;
      [index: number]: { transcript: string };
      length: number;
    }>;
  }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type QueuedNeed = NeedCreateRequest & {
  queued_at: string;
  local_id: string;
};

function toggleInList(list: string[], value: string): string[] {
  if (list.includes(value)) {
    return list.filter((item) => item !== value);
  }
  return [...list, value];
}

function formatAuditAction(action: string): string {
  return action.replaceAll("_", " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function LocalTime({ value }: { value: string }) {
  const parsed = new Date(value);
  return <>{Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString()}</>;
}

export default function NgoPage() {
  const { session, isChecking, isAuthorized } = useAuthGuard("ngo");
  const sessionUserId = session?.user_id ?? "";
  const sessionName = session?.name ?? "";
  const sessionEmail = session?.email ?? "";

  const [catalog, setCatalog] = useState<SkillCatalog>(DEFAULT_CATALOG);
  const [templates, setTemplates] = useState<NeedTemplate[]>([]);
  const [form, setForm] = useState<NeedCreateRequest | null>(null);
  const [needs, setNeeds] = useState<NeedRecord[]>([]);
  const [hotspots, setHotspots] = useState<HotspotsResponse | null>(null);
  const [auditByNeed, setAuditByNeed] = useState<Record<string, NeedAuditEntry[]>>({});
  const [expandedNeedId, setExpandedNeedId] = useState<string | null>(null);
  const [nlpPrompt, setNlpPrompt] = useState("");
  const [isDrafting, setIsDrafting] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [addressSuggestions, setAddressSuggestions] = useState<Array<{ lat: number; lng: number; display_name: string }>>([]);
  const [isAddressMenuOpen, setIsAddressMenuOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offlineMode, setOfflineMode] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const [rosterByNeed, setRosterByNeed] = useState<Record<string, NeedVolunteerApplication[]>>({});
  const [rosterLoadingId, setRosterLoadingId] = useState<string | null>(null);
  const [expandedRosterId, setExpandedRosterId] = useState<string | null>(null);
  const [dispatchLoadingId, setDispatchLoadingId] = useState<string | null>(null);
  const [dispatchByNeed, setDispatchByNeed] = useState<Record<string, AutonomousDispatchResponse>>({});
  const [fieldReports, setFieldReports] = useState<FieldIntelReport[]>([]);
  const recognitionRef = useRef<{
    stop?: () => void;
  } | null>(null);
  const speechCommittedRef = useRef("");

  function buildDefaultNeed(userName: string, userEmail: string, userId: string, source: SkillCatalog): NeedCreateRequest {
    return {
      ngo_id: userId,
      ngo_name: userName,
      title: "Community Support Request",
      description:
        "Describe the support needed, expected outcomes, and operational notes.",
      need_type: source.need_types[0] ?? "community-support",
      job_category: source.jobs[0] ?? "operations volunteer",
      emergency_level: "non_emergency",
      is_critical: false,
      urgency: 3,
      impact_level: 3,
      required_volunteers: 15,
      required_skills: [source.skills[0] ?? "community outreach"],
      required_specialists: [source.specialists[0] ?? "logistics"],
      language_requirements: ["hindi"],
      beneficiary_count: 120,
      emergency_radius_km: 25,
      location: { lat: 28.6139, lng: 77.209 },
      address: "Community Center",
      start_time: "2026-04-08T10:00:00+05:30",
      end_time: "2026-04-08T17:00:00+05:30",
      contact: {
        name: userName,
        email: userEmail,
      },
      safety_notes: "Carry IDs and follow on-site safety briefing.",
      resources_available: "Basic supplies and coordinator support.",
      logistics_notes: "Check in 20 minutes early.",
    };
  }

  const ngoNeedsCacheKey = sessionUserId ? `fairaid_cache_ngo_needs_${sessionUserId}` : "fairaid_cache_ngo_needs";
  const ngoHotspotCacheKey = "fairaid_cache_hotspots";
  const ngoCatalogCacheKey = "fairaid_cache_catalog";
  const ngoTemplateCacheKey = "fairaid_cache_templates";
  const ngoQueueKey = sessionUserId ? `fairaid_queue_ngo_needs_${sessionUserId}` : "fairaid_queue_ngo_needs";

  const syncQueuedNeeds = useCallback(async (ngoId: string) => {
    const queue = readQueue<QueuedNeed>(ngoQueueKey);
    if (!queue.length || !navigator.onLine) {
      return;
    }
    const remaining: QueuedNeed[] = [];
    let synced = 0;
    for (const queuedNeed of queue) {
      const { local_id, queued_at, ...payload } = queuedNeed;
      void local_id;
      void queued_at;
      try {
        await createNeed(payload);
        synced += 1;
      } catch {
        remaining.push(queuedNeed);
      }
    }
    writeQueue(ngoQueueKey, remaining);
    if (synced > 0) {
      setSyncNotice(`${synced} offline request(s) synced.`);
      const refreshedNeeds = await fetchNgoNeeds(ngoId).catch(() => null);
      if (refreshedNeeds) {
        setNeeds(refreshedNeeds);
        writeCached(ngoNeedsCacheKey, refreshedNeeds);
      }
      const latestHotspots = await fetchHotspots().catch(() => null);
      if (latestHotspots) {
        setHotspots(latestHotspots);
        writeCached(ngoHotspotCacheKey, latestHotspots);
      }
      const latestReports = await fetchFieldIntelReports(20).catch(() => []);
      setFieldReports(latestReports);
    }
  }, [ngoHotspotCacheKey, ngoNeedsCacheKey, ngoQueueKey]);

  useEffect(() => {
    if (!sessionUserId || !isAuthorized) {
      return;
    }

    const loadNgoWorkspace = async () => {
      try {
        const [library, templateData, ngoNeeds, hotspotsData, reports] = await Promise.all([
          fetchCatalog(),
          fetchNeedTemplates(),
          fetchNgoNeeds(sessionUserId),
          fetchHotspots().catch(() => null),
          fetchFieldIntelReports(20).catch(() => []),
        ]);
        setCatalog(library);
        setTemplates(templateData);
        setNeeds(ngoNeeds);
        setHotspots(hotspotsData);
        setFieldReports(reports);
        setForm(buildDefaultNeed(sessionName, sessionEmail, sessionUserId, library));

        writeCached(ngoCatalogCacheKey, library);
        writeCached(ngoTemplateCacheKey, templateData);
        writeCached(ngoNeedsCacheKey, ngoNeeds);
        if (hotspotsData) {
          writeCached(ngoHotspotCacheKey, hotspotsData);
        }
        setOfflineMode(false);
        setLastSyncAt(new Date().toISOString());
        setError(null);
        await syncQueuedNeeds(sessionUserId);
      } catch (loadError) {
        const cachedCatalog = readCached<SkillCatalog>(ngoCatalogCacheKey)?.data ?? DEFAULT_CATALOG;
        const cachedTemplates = readCached<NeedTemplate[]>(ngoTemplateCacheKey)?.data ?? [];
        const cachedNeeds = readCached<NeedRecord[]>(ngoNeedsCacheKey)?.data ?? [];
        const cachedHotspots = readCached<HotspotsResponse>(ngoHotspotCacheKey)?.data ?? null;
        setCatalog(cachedCatalog);
        setTemplates(cachedTemplates);
        setNeeds(cachedNeeds);
        setHotspots(cachedHotspots);
        setFieldReports([]);
        setForm(buildDefaultNeed(sessionName, sessionEmail, sessionUserId, cachedCatalog));
        setOfflineMode(true);
        setLastSyncAt(readCached<NeedRecord[]>(ngoNeedsCacheKey)?.updated_at ?? null);
        const message =
          loadError instanceof Error ? loadError.message : "Failed to load NGO workspace.";
        setError(`Offline mode: ${message}`);
      }
    };

    void loadNgoWorkspace();

    const onlineHandler = () => {
      void syncQueuedNeeds(sessionUserId);
      void loadNgoWorkspace();
    };
    window.addEventListener("online", onlineHandler);
    return () => window.removeEventListener("online", onlineHandler);
  }, [
    isAuthorized,
    sessionUserId,
    sessionName,
    sessionEmail,
    ngoCatalogCacheKey,
    ngoHotspotCacheKey,
    ngoNeedsCacheKey,
    ngoTemplateCacheKey,
    syncQueuedNeeds,
  ]);

  useEffect(() => {
    if (!isAddressMenuOpen) {
      setAddressSuggestions([]);
      return;
    }
    const query = (form?.address ?? "").trim();
    if (query.length < 3) {
      setAddressSuggestions([]);
      return;
    }
    const timer = setTimeout(() => {
      geocodeSuggestions(query)
        .then((items) => setAddressSuggestions(items))
        .catch(() => setAddressSuggestions([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [form?.address, isAddressMenuOpen]);

  function applyAddressInput(value: string) {
    const normalized = value.trim().toLowerCase();
    const matched = addressSuggestions.find(
      (item) => item.display_name.trim().toLowerCase() === normalized,
    );
    setForm((prev) =>
      prev
        ? {
          ...prev,
          address: value,
          location: matched ? { lat: matched.lat, lng: matched.lng } : prev.location,
        }
        : prev,
    );
  }

  function applyAddressSuggestion(item: { lat: number; lng: number; display_name: string }) {
    setForm((prev) =>
      prev
        ? {
          ...prev,
          address: item.display_name,
          location: { lat: item.lat, lng: item.lng },
        }
        : prev,
    );
    setAddressSuggestions([]);
    setIsAddressMenuOpen(false);
  }

  const stats = useMemo(() => {
    const emergency = needs.filter((need) => need.emergency_level === "emergency" && need.status === "open").length;
    const accepted = needs.reduce((sum, need) => sum + need.accepted_count, 0);
    const interested = needs.reduce((sum, need) => sum + need.interested_count, 0);
    const open = needs.filter((need) => need.status === "open").length;
    const closed = needs.filter((need) => need.status === "closed").length;
    return { emergency, accepted, interested, open, closed };
  }, [needs]);

  async function handleLocateAddress() {
    if (!form?.address) {
      setError("Enter an address first.");
      return;
    }
    setError(null);
    setIsLocating(true);
    try {
      const result = await geocodeAddress(form.address);
      if (!result) {
        setError("Could not locate address. Try a more specific location.");
        return;
      }
      setForm((prev) =>
        prev
          ? {
            ...prev,
            address: result.display_name ?? prev.address,
            location: { lat: result.lat, lng: result.lng },
          }
          : prev,
      );
    } catch {
      setError("Could not map this address right now.");
    } finally {
      setIsLocating(false);
    }
  }

  async function handleUseCurrentLocation() {
    if (!navigator.geolocation) {
      setError("Geolocation is not available in this browser.");
      return;
    }
    setError(null);
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        const resolved = await reverseGeocode(lat, lng);
        setForm((prev) =>
          prev
            ? {
              ...prev,
              address: resolved ?? prev.address,
              location: { lat, lng },
            }
            : prev,
        );
        setIsLocating(false);
      },
      () => {
        setError("Could not access location. Please allow location access.");
        setIsLocating(false);
      },
      { enableHighAccuracy: true, timeout: 12000 },
    );
  }

  async function applyTemplate(template: NeedTemplate) {
    if (!form) {
      return;
    }
    const defaults = template.defaults;
    setForm({
      ...form,
      title: String(defaults.title ?? form.title),
      need_type: String(defaults.need_type ?? form.need_type),
      job_category: String(defaults.job_category ?? form.job_category ?? ""),
      emergency_level: (defaults.emergency_level as NeedCreateRequest["emergency_level"]) ?? form.emergency_level,
      required_skills: (defaults.required_skills as string[]) ?? form.required_skills,
      required_specialists: (defaults.required_specialists as string[]) ?? form.required_specialists,
      urgency: Number(defaults.urgency ?? form.urgency),
      impact_level: Number(defaults.impact_level ?? form.impact_level),
      required_volunteers: Number(defaults.required_volunteers ?? form.required_volunteers),
      emergency_radius_km: Number(defaults.emergency_radius_km ?? form.emergency_radius_km ?? 25),
    });
  }

  async function handleDraftFromText() {
    if (!form || !nlpPrompt.trim()) {
      return;
    }
    setError(null);
    setIsDrafting(true);
    try {
      const response = await draftNeedFromText(nlpPrompt.trim());
      const draft = response.draft;
      setForm((prev) =>
        prev
          ? {
            ...prev,
            title: String(draft.title ?? prev.title),
            description: nlpPrompt.trim(),
            need_type: String(draft.need_type ?? prev.need_type),
            job_category: String(draft.job_category ?? prev.job_category ?? ""),
            emergency_level: (draft.emergency_level as NeedCreateRequest["emergency_level"]) ?? prev.emergency_level,
            required_skills: (draft.required_skills as string[]) ?? prev.required_skills,
            required_specialists: (draft.required_specialists as string[]) ?? prev.required_specialists,
            required_volunteers: Number(draft.required_volunteers ?? prev.required_volunteers),
            urgency: Number(draft.urgency ?? prev.urgency),
            impact_level: Number(draft.impact_level ?? prev.impact_level),
            emergency_radius_km: Number(draft.emergency_radius_km ?? prev.emergency_radius_km ?? 25),
          }
          : prev,
      );
    } catch (draftError) {
      const message = draftError instanceof Error ? draftError.message : "Could not create draft from text.";
      setError(message);
    } finally {
      setIsDrafting(false);
    }
  }

  function handleVoiceInput() {
    const SpeechCtor = (
      (window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor }).SpeechRecognition
      ?? (window as unknown as { webkitSpeechRecognition?: SpeechRecognitionCtor }).webkitSpeechRecognition
    );
    if (!SpeechCtor) {
      setError("Speech input is not supported in this browser.");
      return;
    }

    if (isListening && recognitionRef.current?.stop) {
      recognitionRef.current.stop();
      setIsListening(false);
      return;
    }

    const recognition = new SpeechCtor();
    recognition.lang = "en-IN";
    recognition.interimResults = true;
    speechCommittedRef.current = nlpPrompt.trim();
    recognition.onresult = (event) => {
      let finalized = "";
      let interim = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const text = result[0]?.transcript?.trim() ?? "";
        if (!text) {
          continue;
        }
        if (result.isFinal) {
          finalized = `${finalized} ${text}`.trim();
        } else {
          interim = `${interim} ${text}`.trim();
        }
      }
      if (finalized) {
        speechCommittedRef.current = `${speechCommittedRef.current} ${finalized}`.trim();
      }
      const liveText = `${speechCommittedRef.current} ${interim}`.trim();
      setNlpPrompt(liveText);
    };
    recognition.onerror = () => {
      setError("Could not capture voice input.");
      setIsListening(false);
    };
    recognition.onend = () => {
      setIsListening(false);
    };
    recognition.start();
    recognitionRef.current = { stop: () => recognition.stop() };
    setIsListening(true);
  }

  async function handleSubmitNeed() {
    if (!form) {
      return;
    }

    setError(null);
    setIsSubmitting(true);
    try {
      const createdNeed = await createNeed(form);
      setNeeds((previous) => [createdNeed, ...previous]);
      writeCached(ngoNeedsCacheKey, [createdNeed, ...needs]);
      const latestHotspots = await fetchHotspots().catch(() => null);
      if (latestHotspots) {
        setHotspots(latestHotspots);
        writeCached(ngoHotspotCacheKey, latestHotspots);
      }
      setOfflineMode(false);
      setLastSyncAt(new Date().toISOString());
      if (sessionUserId) {
        setForm(buildDefaultNeed(sessionName, sessionEmail, sessionUserId, catalog));
      }
    } catch (createError) {
      const queued: QueuedNeed = {
        ...form,
        local_id: `offline_need_${Date.now()}`,
        queued_at: new Date().toISOString(),
      };
      appendQueueItem(ngoQueueKey, queued);
      const optimisticNeed: NeedRecord = {
        ...form,
        id: queued.local_id,
        status: "open",
        assigned_volunteers: [],
        notified_volunteer_ids: [],
        accepted_count: 0,
        interested_count: 0,
        declined_count: 0,
        created_at: queued.queued_at,
        updated_at: queued.queued_at,
      };
      setNeeds((previous) => [optimisticNeed, ...previous]);
      setOfflineMode(true);
      setSyncNotice("Request saved offline. It will sync automatically when internet returns.");
      const message = createError instanceof Error ? createError.message : "Could not create NGO need.";
      setError(`Saved offline: ${message}`);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDeleteNeed(needId: string) {
    if (!sessionUserId) {
      return;
    }
    setError(null);
    try {
      await deleteNgoNeed(sessionUserId, needId);
      const refreshed = await fetchNgoNeeds(sessionUserId);
      setNeeds(refreshed);
      writeCached(ngoNeedsCacheKey, refreshed);
      const latestHotspots = await fetchHotspots().catch(() => null);
      if (latestHotspots) {
        setHotspots(latestHotspots);
        writeCached(ngoHotspotCacheKey, latestHotspots);
      }
    } catch (deleteError) {
      const message =
        deleteError instanceof Error ? deleteError.message : "Could not delete request.";
      setError(message);
    }
  }

  async function toggleAudit(needId: string) {
    if (expandedNeedId === needId) {
      setExpandedNeedId(null);
      return;
    }
    setExpandedNeedId(needId);
    if (!auditByNeed[needId]) {
      const audit = await fetchNeedAudit(needId).catch(() => []);
      setAuditByNeed((prev) => ({ ...prev, [needId]: audit }));
    }
  }

  async function handleAutoDispatch(needId: string) {
    if (!sessionUserId) {
      return;
    }
    setError(null);
    setDispatchLoadingId(needId);
    try {
      const response = await runAutonomousDispatch(sessionUserId, needId);
      setDispatchByNeed((prev) => ({ ...prev, [needId]: response }));
      const refreshedNeeds = await fetchNgoNeeds(sessionUserId).catch(() => null);
      if (refreshedNeeds) {
        setNeeds(refreshedNeeds);
        writeCached(ngoNeedsCacheKey, refreshedNeeds);
      }
    } catch (dispatchError) {
      const message = dispatchError instanceof Error ? dispatchError.message : "Could not run autonomous dispatch.";
      setError(message);
    } finally {
      setDispatchLoadingId(null);
    }
  }

  function applyFieldReportToDraft(report: FieldIntelReport) {
    setForm((prev) => {
      if (!prev) {
        return prev;
      }
      const topCategory = report.categories[0] ?? "community-support";
      const emergencyLevel =
        report.severity === "critical" || report.severity === "high"
          ? "emergency"
          : "non_emergency";

      return {
        ...prev,
        title: `Field Alert: ${topCategory.replaceAll("-", " ")}`,
        description: report.summary || prev.description,
        need_type: topCategory,
        emergency_level: emergencyLevel,
        required_volunteers: Math.max(1, report.required_volunteers_estimate || prev.required_volunteers),
        required_skills: report.categories.length ? report.categories : prev.required_skills,
        address: report.address ?? prev.address,
        location: report.location ?? prev.location,
      };
    });
    const formElement = document.getElementById("create-request");
    if (formElement) {
      formElement.scrollIntoView({ behavior: "smooth" });
    } else {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  if (isChecking || !form) {
    return (
      <main className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <Card>Loading NGO workspace...</Card>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
      {offlineMode ? (
        <Card tone="emergency">
          <p className="text-sm font-semibold text-[var(--text-strong)]">Offline Mode Active</p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            You can still create requests. They will sync when connectivity returns.
            {lastSyncAt ? ` Last sync: ${new Date(lastSyncAt).toLocaleString()}` : ""}
          </p>
        </Card>
      ) : null}
      {syncNotice ? (
        <Card>
          <p className="text-sm text-[var(--text-strong)]">{syncNotice}</p>
        </Card>
      ) : null}
      <Card>
        <h1 className="text-3xl text-[var(--text-strong)]">NGO Workspace</h1>
        <p className="mt-2 text-sm text-[var(--text-muted)]">
          Welcome, {sessionName}. Use templates, AI drafting, and map-assisted location to post high-quality volunteer requests.
        </p>
        <div className="mt-3">
          <Link href="/surveys/upload">
            <Button variant="secondary">Upload Survey CSV</Button>
          </Link>
        </div>
      </Card>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Card>
          <p className="text-xs uppercase tracking-wide text-[var(--text-muted)]">Open Requests</p>
          <p className="mt-2 text-3xl font-bold text-[var(--text-strong)]">{stats.open}</p>
        </Card>
        <Card>
          <p className="text-xs uppercase tracking-wide text-[var(--text-muted)]">Closed Requests</p>
          <p className="mt-2 text-3xl font-bold text-[var(--text-strong)]">{stats.closed}</p>
        </Card>
        <Card tone="emergency">
          <p className="text-xs uppercase tracking-wide text-[var(--text-muted)]">Emergency</p>
          <p className="mt-2 text-3xl font-bold text-[var(--text-strong)]">{stats.emergency}</p>
        </Card>
        <Card>
          <p className="text-xs uppercase tracking-wide text-[var(--text-muted)]">Committed Volunteers</p>
          <p className="mt-2 text-3xl font-bold text-[var(--text-strong)]">{stats.accepted}</p>
        </Card>
        <Card>
          <p className="text-xs uppercase tracking-wide text-[var(--text-muted)]">Interested Volunteers</p>
          <p className="mt-2 text-3xl font-bold text-[var(--text-strong)]">{stats.interested}</p>
        </Card>
      </section>

      {hotspots && hotspots.urgent_categories.length > 0 && (
        <section className="mb-2">
          <Card className="border-[color:color-mix(in_oklab,var(--accent)_45%,var(--border))] bg-[color:color-mix(in_oklab,var(--surface)_78%,var(--accent-soft))]">
            <div className="flex items-center gap-2 mb-4">
              <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" strokeWidth="2" fill="none" className="text-[var(--accent)]"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
              <h2 className="text-xl font-bold text-[var(--text-strong)]">Community Hotspots</h2>
            </div>
            <p className="text-sm text-[var(--text-muted)] mb-4">
              Areas with the largest deficit of volunteers across all active NGOs in your network.
            </p>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {hotspots.urgent_categories.slice(0, 6).map((cat) => {
                const deficit = Math.max(0, cat.required_volunteers - cat.accepted_volunteers);
                const percent = cat.required_volunteers > 0
                  ? Math.min((cat.accepted_volunteers / cat.required_volunteers) * 100, 100)
                  : 0;

                return (
                  <div key={cat.category} className="relative overflow-hidden rounded-xl border border-[color:color-mix(in_oklab,var(--accent)_40%,var(--border))] bg-[color:color-mix(in_oklab,var(--surface)_75%,var(--accent-soft))] p-4 transition-all hover:brightness-105">
                    <div className="flex items-start justify-between mb-2">
                      <p className="font-bold text-[var(--text-strong)] capitalize leading-tight">
                        {cat.category.replace(/-/g, " ")}
                      </p>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-md shrink-0 bg-[color:color-mix(in_oklab,var(--accent)_16%,var(--surface))] text-[var(--accent)]">
                        {cat.count} Requests
                      </span>
                    </div>
                    <p className="text-xs font-semibold text-[var(--accent)] mb-3">
                      Shortfall: {deficit} volunteers needed
                    </p>
                    <div className="w-full rounded-full h-2.5 shadow-inner overflow-hidden border border-[var(--border)] bg-[var(--surface-overlay)]">
                      <div className="h-full rounded-full transition-all duration-500 bg-[var(--accent)]" style={{ width: `${percent}%` }}></div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </section>
      )}

      <Card>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-xl text-[var(--text-strong)]">Ground Updates Feed</h2>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              Live reports coming from volunteers (photo, audio, and gesture alerts).
            </p>
          </div>
          <Button
            variant="secondary"
            onClick={() => {
              fetchFieldIntelReports(20).then((items) => setFieldReports(items)).catch(() => setFieldReports([]));
            }}
          >
            Refresh Feed
          </Button>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {fieldReports.length ? (
            fieldReports.slice(0, 8).map((report) => (
              <div key={report.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-3">
                <div className="flex items-center justify-between gap-2">
                  <span
                    className="rounded-full px-2 py-0.5 text-[10px] font-bold text-white"
                    style={{
                      background:
                        report.severity === "critical" ? "var(--accent)"
                          : report.severity === "high" ? "#cc7f37"
                          : report.severity === "low" ? "var(--success)"
                          : "var(--brand)",
                    }}
                  >
                    {report.severity.toUpperCase()}
                  </span>
                  <span className="text-[10px] text-[var(--text-muted)]">
                    {new Date(report.created_at).toLocaleString()}
                  </span>
                </div>
                <p className="mt-2 text-sm font-semibold text-[var(--text-strong)]">{report.summary}</p>
                <p className="mt-1 text-xs text-[var(--text-muted)]">{report.address ?? "Location unavailable"}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {report.categories.slice(0, 3).map((category) => (
                    <span key={category} className="rounded-full bg-[var(--surface)] px-2 py-0.5 text-[10px] font-semibold text-[var(--text-muted)]">
                      {category}
                    </span>
                  ))}
                </div>
                <div className="mt-3">
                  <div className="flex flex-wrap gap-2">
                    <Button variant="ghost" onClick={() => applyFieldReportToDraft(report)}>
                      Use in Request Draft
                    </Button>
                    <Button
                      variant="danger"
                      onClick={() => {
                        deleteFieldIntelReport(report.id, sessionUserId)
                          .then(() => setFieldReports((prev) => prev.filter((item) => item.id !== report.id)))
                          .catch((deleteError) =>
                            setError(deleteError instanceof Error ? deleteError.message : "Could not delete update."),
                          );
                      }}
                    >
                      Delete Update
                    </Button>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-[var(--text-muted)]">No field updates yet.</p>
          )}
        </div>
      </Card>

      <section className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <Card id="create-request">
          <h2 className="text-xl text-[var(--text-strong)]">Post a New Request</h2>

          <div className="mt-3 flex flex-wrap gap-2">
            {templates.map((template) => (
              <button
                key={template.id}
                type="button"
                onClick={() => applyTemplate(template)}
                className="rounded-full border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-1 text-xs text-[var(--text-muted)] hover:border-[var(--brand)] hover:text-[var(--brand)]"
              >
                {template.name}
              </button>
            ))}
          </div>

          <div className="mt-4 space-y-2 rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">AI Draft Assistant</p>
            <textarea
              value={nlpPrompt}
              onChange={(event) => setNlpPrompt(event.target.value)}
              className="h-20 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
              placeholder="Example: We need 30 volunteers and 4 doctors for urgent flood relief in Ghaziabad from 9am to 8pm tomorrow..."
            />
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={handleDraftFromText} disabled={isDrafting || !nlpPrompt.trim()}>
                {isDrafting ? "Generating..." : "Generate Draft"}
              </Button>
              <Button variant="ghost" onClick={handleVoiceInput}>
                {isListening ? "Stop Voice" : "Voice Input"}
              </Button>
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm sm:col-span-2">
              <span>Title</span>
              <input
                value={form.title}
                onChange={(event) => setForm((prev) => prev ? ({ ...prev, title: event.target.value }) : prev)}
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2"
              />
            </label>

            <label className="space-y-1 text-sm sm:col-span-2">
              <span>Description</span>
              <textarea
                value={form.description}
                onChange={(event) =>
                  setForm((prev) => prev ? ({ ...prev, description: event.target.value }) : prev)
                }
                className="h-24 w-full rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2"
              />
            </label>

            <label className="space-y-1 text-sm">
              <span>Need Type</span>
              <select
                value={form.need_type}
                onChange={(event) =>
                  setForm((prev) => prev ? ({ ...prev, need_type: event.target.value }) : prev)
                }
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2"
              >
                {catalog.need_types.map((needType) => (
                  <option key={needType} value={needType}>{needType}</option>
                ))}
              </select>
            </label>

            <label className="space-y-1 text-sm">
              <span>Job Category</span>
              <select
                value={form.job_category ?? ""}
                onChange={(event) =>
                  setForm((prev) => prev ? ({ ...prev, job_category: event.target.value }) : prev)
                }
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2"
              >
                <option value="">Any volunteer</option>
                {catalog.jobs.map((job) => (
                  <option key={job} value={job}>{job}</option>
                ))}
              </select>
            </label>

            <label className="space-y-1 text-sm">
              <span>Emergency</span>
              <select
                value={form.emergency_level}
                onChange={(event) =>
                  setForm((prev) =>
                    prev
                      ? {
                        ...prev,
                        emergency_level: event.target.value as NeedCreateRequest["emergency_level"],
                      }
                      : prev,
                  )
                }
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2"
              >
                <option value="non_emergency">Non-Emergency</option>
                <option value="emergency">Emergency</option>
              </select>
            </label>

            <label className="space-y-1 text-sm">
              <span>Required Volunteers</span>
              <input
                type="number"
                min={1}
                value={form.required_volunteers}
                onChange={(event) =>
                  setForm((prev) =>
                    prev
                      ? {
                        ...prev,
                        required_volunteers: Number(event.target.value || 1),
                      }
                      : prev,
                  )
                }
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2"
              />
            </label>

            <label className="space-y-1 text-sm">
              <span>Emergency Radius (km)</span>
              <input
                type="number"
                min={1}
                value={form.emergency_radius_km ?? 25}
                onChange={(event) =>
                  setForm((prev) =>
                    prev
                      ? {
                        ...prev,
                        emergency_radius_km: Number(event.target.value || 25),
                      }
                      : prev,
                  )
                }
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2"
              />
            </label>

            <label className="space-y-1 text-sm sm:col-span-2">
              <span>Address</span>
              <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
                <div className="relative">
                  <input
                    value={form.address ?? ""}
                    onFocus={() => setIsAddressMenuOpen(true)}
                    onBlur={() => {
                      window.setTimeout(() => setIsAddressMenuOpen(false), 120);
                    }}
                    onChange={(event) => {
                      applyAddressInput(event.target.value);
                      setIsAddressMenuOpen(true);
                    }}
                    className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2"
                    placeholder="Start typing area/city/street..."
                    list="ngo-address-suggestions"
                  />
                  <datalist id="ngo-address-suggestions">
                    {addressSuggestions.map((item) => (
                      <option key={`${item.lat}-${item.lng}`} value={item.display_name} />
                    ))}
                  </datalist>
                  {isAddressMenuOpen && addressSuggestions.length > 0 ? (
                    <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-20 max-h-48 overflow-auto rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-[0_14px_34px_rgba(9,26,41,0.12)]">
                      {addressSuggestions.slice(0, 5).map((item) => (
                        <button
                          key={`${item.lat}-${item.lng}-${item.display_name}`}
                          type="button"
                          onMouseDown={(event) => {
                            event.preventDefault();
                            applyAddressSuggestion(item);
                          }}
                          className="block w-full border-b border-[var(--border)] px-3 py-2 text-left text-xs text-[var(--text-muted)] hover:bg-[var(--surface-elevated)]"
                        >
                          {item.display_name}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                <Button variant="secondary" onClick={handleLocateAddress} disabled={isLocating}>
                  Find on Map
                </Button>
                <Button variant="ghost" onClick={handleUseCurrentLocation} disabled={isLocating}>
                  Use My Location
                </Button>
              </div>
            </label>
          </div>

          <div className="mt-3">
            <DraggablePinMap
              location={form.location}
              onLocationChange={(location) =>
                setForm((prev) =>
                  prev
                    ? {
                      ...prev,
                      location,
                    }
                    : prev,
                )
              }
            />
          </div>

          <div className="mt-4">
            <p className="mb-2 text-sm font-medium text-[var(--text-strong)]">Required Skills</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {catalog.skills.map((skill) => {
                const selected = (form.required_skills ?? []).includes(skill);
                return (
                  <label
                    key={skill}
                    className={`cursor-pointer rounded-xl border px-3 py-2 text-sm ${selected
                        ? "border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand)]"
                        : "border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--text-muted)]"
                      }`}
                  >
                    <input
                      type="checkbox"
                      className="mr-2"
                      checked={selected}
                      onChange={() =>
                        setForm((prev) =>
                          prev
                            ? {
                              ...prev,
                              required_skills: toggleInList(
                                (prev.required_skills as string[]) ?? [],
                                skill,
                              ),
                            }
                            : prev,
                        )
                      }
                    />
                    {skill}
                  </label>
                );
              })}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-3">
            <Button onClick={handleSubmitNeed} disabled={isSubmitting}>
              {isSubmitting ? "Posting..." : "Post Request"}
            </Button>
          </div>

          {error ? (
            <p className="mt-3 rounded-xl border border-[#c97e74] bg-[#fff5f3] px-3 py-2 text-sm text-[#9c3d31]">
              {error}
            </p>
          ) : null}
        </Card>

        <Card>
          <h2 className="text-xl text-[var(--text-strong)]">Current Requests</h2>
          <div className="mt-3 space-y-3">
            {needs.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] px-4 py-8 text-center">
                <svg
                  className="mb-3 h-10 w-10 opacity-35"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                >
                  <path d="M8 3h8l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3z" />
                  <path d="M13 3v5h5" />
                  <path d="M8 12h8M8 16h6" />
                </svg>
                <p className="text-sm text-[var(--text-muted)]">
                  No active requests. {" "}
                  <a href="#create-request" className="font-semibold text-[var(--brand)] hover:underline">
                    Create one on the left to get started.
                  </a>
                </p>
              </div>
            ) : (
              needs.map((need) => (
                <article
                  key={need.id}
                  className="relative overflow-hidden rounded-[24px] border border-[var(--border)] bg-[var(--surface-overlay)] p-4 shadow-[0_12px_34px_rgba(9,25,40,0.14)] backdrop-blur-xl"
                >
                  <div
                    className="absolute inset-0 bg-cover bg-center opacity-35"
                    style={{ backgroundImage: `url(${getNeedCardImage(need.need_type, need.title, need.description)})` }}
                  />
                  <div className="absolute inset-0" style={{ background: "var(--hero-mask)" }} />
                  <div className="relative">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-[var(--text-strong)]">{need.title}</p>
                        <p className="text-sm text-[var(--text-muted)]">
                          {need.need_type}
                          {need.job_category ? ` • ${need.job_category}` : ""}
                          {` • Required ${need.required_volunteers}`}
                          {` • ${need.status}`}
                        </p>
                      </div>
                      {need.status === "open" ? (
                        <Button variant="danger" className="px-3 py-1.5 text-xs" onClick={() => handleDeleteNeed(need.id)}>
                          Close
                        </Button>
                      ) : null}
                    </div>

                    <p className="mt-1 text-xs text-[var(--text-muted)]">
                      <span className="font-semibold" style={{ color: "var(--success)" }}>{need.accepted_count} committed</span>
                      {" · "}
                      <span className="font-semibold" style={{ color: "var(--pin)" }}>{need.interested_count} pinned</span>
                      {" · "}
                      <span>{need.declined_count} declined</span>
                    </p>

                    <div className="mt-2 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => void toggleAudit(need.id)}
                          className="text-xs font-semibold text-[var(--brand)] hover:underline"
                        >
                          {expandedNeedId === need.id ? "Hide Timeline" : "Show Timeline"}
                        </button>
                        <button
                          type="button"
                          className="text-xs font-semibold hover:underline"
                          style={{ color: "var(--pin)" }}
                          onClick={() => {
                            if (expandedRosterId === need.id) {
                              setExpandedRosterId(null);
                              return;
                            }
                            setExpandedRosterId(need.id);
                            if (!rosterByNeed[need.id]) {
                              setRosterLoadingId(need.id);
                              fetchNeedVolunteers(sessionUserId, need.id)
                                .then((res) => setRosterByNeed((prev) => ({ ...prev, [need.id]: res.applications })))
                                .catch(() => setRosterByNeed((prev) => ({ ...prev, [need.id]: [] })))
                                .finally(() => setRosterLoadingId(null));
                            }
                          }}
                        >
                          {expandedRosterId === need.id ? "Hide Roster" : "View Roster"}
                          {need.accepted_count + need.interested_count > 0 && (
                            <span className="ml-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold" style={{ background: "var(--pin-soft)", color: "var(--pin)" }}>
                              {need.accepted_count + need.interested_count}
                            </span>
                          )}
                        </button>
                        <button
                          type="button"
                          className="text-xs font-semibold hover:underline"
                          style={{ color: "var(--brand)" }}
                          disabled={dispatchLoadingId === need.id}
                          onClick={() => void handleAutoDispatch(need.id)}
                        >
                          {dispatchLoadingId === need.id ? "Dispatching..." : "Auto Dispatch"}
                        </button>
                      </div>
                      <span className="text-xs text-[var(--text-muted)]">
                        <LocalTime value={need.updated_at} />
                      </span>
                    </div>

                    {/* Volunteer Roster Panel */}
                    {expandedRosterId === need.id && (
                      <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-3">
                        <p className="mb-2 text-xs font-bold text-[var(--text-strong)]">Volunteer Roster</p>
                        {rosterLoadingId === need.id ? (
                          <p className="text-xs text-[var(--text-muted)] animate-pulse">Loading...</p>
                        ) : !rosterByNeed[need.id] || rosterByNeed[need.id].length === 0 ? (
                          <p className="text-xs text-[var(--text-muted)]">No volunteers have applied yet.</p>
                        ) : (
                          <div className="space-y-2">
                            {rosterByNeed[need.id].map((app) => (
                              <div key={app.app_id} className="flex items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
                                <div
                                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                                  style={{
                                    background:
                                      app.decision === "accepted" ? "var(--success)"
                                      : (app.decision === "pinned" || app.decision === "interested") ? "var(--pin)"
                                      : "var(--text-muted)",
                                  }}
                                >
                                  {app.name.slice(0, 2).toUpperCase()}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs font-semibold truncate text-[var(--text-strong)]">
                                    {app.name}
                                    {app.license_verified && (
                                      <span className="ml-1 text-[9px] text-[var(--success)]">Verified</span>
                                    )}
                                  </p>
                                  <p className="text-[10px] text-[var(--text-muted)] truncate">
                                    {app.job_title ?? "Volunteer"}
                                    {app.decision === "accepted" ? " · Committed"
                                      : (app.decision === "pinned" || app.decision === "interested") ? " · Pinned"
                                      : " · Declined"}
                                  </p>
                                </div>
                                {app.decision !== "declined" && (
                                  <button
                                    type="button"
                                    title="Remove volunteer"
                                    className="shrink-0 rounded-lg border px-2 py-1 text-[10px] font-medium transition hover:opacity-80"
                                    style={{ borderColor: "var(--accent)", color: "var(--accent)", background: "var(--accent-soft)" }}
                                    onClick={() => {
                                      removeVolunteerFromNeed(sessionUserId, need.id, app.volunteer_id)
                                        .then(() => {
                                          setRosterByNeed((prev) => ({
                                            ...prev,
                                            [need.id]: (prev[need.id] ?? []).map((a) =>
                                              a.volunteer_id === app.volunteer_id ? { ...a, decision: "declined" as const } : a,
                                            ),
                                          }));
                                          setNeeds((prev) =>
                                            prev.map((n) =>
                                              n.id === need.id
                                                ? { ...n, accepted_count: Math.max(0, n.accepted_count - (app.decision === "accepted" ? 1 : 0)) }
                                                : n,
                                            )
                                          );
                                        })
                                        .catch(() => setError("Failed to remove volunteer."));
                                    }}
                                  >
                                    Remove
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {expandedNeedId === need.id ? (
                      <div className="mt-3 space-y-2 rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-3">
                        {(auditByNeed[need.id] ?? []).length ? (
                          (auditByNeed[need.id] ?? []).map((event) => (
                            <div key={event.id} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
                              <p className="text-xs font-semibold text-[var(--text-strong)]">{formatAuditAction(event.action)}</p>
                              <p className="text-xs text-[var(--text-muted)]"><LocalTime value={event.created_at} /></p>
                            </div>
                          ))
                        ) : (
                          <p className="text-xs text-[var(--text-muted)]">No activity yet.</p>
                        )}
                      </div>
                    ) : null}

                    {dispatchByNeed[need.id] ? (
                      <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-3">
                        <p className="text-xs font-bold uppercase tracking-wide text-[var(--text-muted)]">
                          Autonomous Dispatch
                        </p>
                        <p className="mt-1 text-xs text-[var(--text-muted)]">
                          {dispatchByNeed[need.id].status === "queued"
                            ? `${dispatchByNeed[need.id].dispatcher?.selected.length ?? 0} volunteers queued`
                            : dispatchByNeed[need.id].message ?? "No action taken"}
                        </p>
                        {dispatchByNeed[need.id].communicator?.briefing ? (
                          <p className="mt-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text-strong)]">
                            {dispatchByNeed[need.id].communicator?.briefing}
                          </p>
                        ) : null}
                        {dispatchByNeed[need.id].dispatcher?.selected?.length ? (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {dispatchByNeed[need.id].dispatcher?.selected.slice(0, 6).map((item) => (
                              <span key={item.id} className="rounded-full bg-[var(--brand-soft)] px-2 py-0.5 text-[10px] font-semibold text-[var(--brand)]">
                                {item.name} • {item.distance_km}km
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </article>
              ))
            )}
          </div>
        </Card>
      </section>
    </main>
  );
}
