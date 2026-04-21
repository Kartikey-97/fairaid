"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  createFieldIntelReport,
  fetchFieldIntelReports,
  fetchVolunteerByUser,
} from "@/lib/api";
import { useAuthGuard } from "@/lib/use-auth-guard";
import type { FieldIntelReport, VolunteerProfile } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

function severityTone(level: FieldIntelReport["severity"]): string {
  if (level === "critical") return "var(--accent)";
  if (level === "high") return "#cc7f37";
  if (level === "low") return "var(--success)";
  return "var(--brand)";
}

function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const earth = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earth * c;
}

export default function FieldIntelPage() {
  const { session, isChecking } = useAuthGuard("volunteer");
  const [volunteer, setVolunteer] = useState<VolunteerProfile | null>(null);
  const [notes, setNotes] = useState("");
  const [address, setAddress] = useState("");
  const [lat, setLat] = useState<number | undefined>(undefined);
  const [lng, setLng] = useState<number | undefined>(undefined);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdReport, setCreatedReport] = useState<FieldIntelReport | null>(null);
  const [analysisEngine, setAnalysisEngine] = useState<string>("");
  const [reports, setReports] = useState<FieldIntelReport[]>([]);
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);

  const [recorderState, setRecorderState] = useState<"idle" | "recording">("idle");
  const recorderRef = useRef<MediaRecorder | null>(null);

  useEffect(() => {
    if (!session) {
      return;
    }
    fetchVolunteerByUser(session.user_id)
      .then((profile) => {
        setVolunteer(profile);
        setAddress(profile.address ?? "");
        setLat(profile.location.lat);
        setLng(profile.location.lng);
      })
      .catch(() => {
        setVolunteer(null);
      });
  }, [session]);

  async function loadReports() {
    try {
      const latest = await fetchFieldIntelReports(16);
      setReports(latest);
    } catch {
      setReports([]);
    }
  }

  useEffect(() => {
    void loadReports();
  }, []);

  const canSubmit = useMemo(() => {
    return Boolean(volunteer && (notes.trim() || imageFile || audioFile));
  }, [audioFile, imageFile, notes, volunteer]);

  async function handleUseCurrentLocation() {
    if (!navigator.geolocation) {
      setError("Geolocation is not available in this browser.");
      return;
    }
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const nextLat = Number(position.coords.latitude.toFixed(5));
        const nextLng = Number(position.coords.longitude.toFixed(5));
        setGpsAccuracy(Math.round(position.coords.accuracy));

        if (typeof lat === "number" && typeof lng === "number") {
          const drift = distanceMeters(lat, lng, nextLat, nextLng);
          if (drift < 35) {
            return;
          }
        }
        setLat(nextLat);
        setLng(nextLng);
      },
      () => setError("Could not fetch current location."),
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 60000 },
    );
  }

  async function handleRecordAudio() {
    if (recorderState === "recording") {
      recorderRef.current?.stop();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Audio recording is not supported in this browser.");
      return;
    }

    try {
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: BlobPart[] = [];
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      };
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: "audio/webm" });
        const file = new File([blob], `field-report-${Date.now()}.webm`, { type: "audio/webm" });
        setAudioFile(file);
        stream.getTracks().forEach((track) => track.stop());
        setRecorderState("idle");
        recorderRef.current = null;
      };

      recorder.start();
      setRecorderState("recording");
      window.setTimeout(() => {
        if (recorder.state === "recording") {
          recorder.stop();
        }
      }, 12000);
    } catch {
      setError("Unable to start microphone recording.");
      setRecorderState("idle");
    }
  }

  async function handleSubmit() {
    if (!volunteer || !canSubmit) {
      return;
    }

    setError(null);
    setIsSubmitting(true);
    try {
      const response = await createFieldIntelReport({
        volunteer_id: volunteer.id,
        notes,
        address,
        lat,
        lng,
        imageFile,
        audioFile,
      });
      setCreatedReport(response.report);
      setAnalysisEngine(response.analysis_engine);
      setNotes("");
      setImageFile(null);
      setAudioFile(null);
      await loadReports();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not submit report.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isChecking) {
    return (
      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <Card>Loading field intelligence workspace...</Card>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
      <Card>
        <h1 className="text-3xl text-[var(--text-strong)]">Ground Report Assistant</h1>
        <p className="mt-2 text-sm text-[var(--text-muted)]">
          Upload photos, add voice notes, and generate structured crisis reports that immediately feed regional hotspot analytics.
        </p>
      </Card>

      <section className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <Card>
          <h2 className="text-xl text-[var(--text-strong)]">Ground Report Assistant</h2>
          <div className="mt-4 space-y-3">
            <label className="space-y-1 text-sm">
              <span>Ground Notes</span>
              <textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                className="h-28 w-full rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2"
                placeholder="Example: 30+ families stranded near school, children need clean water and blankets, one injured person needs first aid."
              />
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-sm">
                <span>Photo Evidence</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(event) => setImageFile(event.target.files?.[0] ?? null)}
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2 text-sm"
                />
              </label>
              <label className="space-y-1 text-sm">
                <span>Audio Evidence</span>
                <input
                  type="file"
                  accept="audio/*"
                  onChange={(event) => setAudioFile(event.target.files?.[0] ?? null)}
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2 text-sm"
                />
              </label>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={handleRecordAudio}>
                {recorderState === "recording" ? "Recording... (auto-stop in 12s)" : "Quick Voice Capture"}
              </Button>
              {audioFile ? (
                <span className="rounded-full bg-[var(--brand-soft)] px-2.5 py-1 text-xs font-semibold text-[var(--brand)]">
                  Audio attached
                </span>
              ) : null}
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <label className="space-y-1 text-sm sm:col-span-2">
                <span>Address</span>
                <input
                  value={address}
                  onChange={(event) => setAddress(event.target.value)}
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2"
                />
              </label>
              <div className="space-y-1 text-sm">
                <span>Location</span>
                <Button variant="ghost" onClick={handleUseCurrentLocation} className="w-full">
                  Use Current GPS
                </Button>
              </div>
            </div>
            {gpsAccuracy !== null ? (
              <p className="text-xs text-[var(--text-muted)]">
                GPS accuracy: ±{gpsAccuracy} m
              </p>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-sm">
                <span>Latitude</span>
                <input
                  value={lat ?? ""}
                  onChange={(event) =>
                    setLat(event.target.value.trim() ? Number(event.target.value) : undefined)
                  }
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2"
                />
              </label>
              <label className="space-y-1 text-sm">
                <span>Longitude</span>
                <input
                  value={lng ?? ""}
                  onChange={(event) =>
                    setLng(event.target.value.trim() ? Number(event.target.value) : undefined)
                  }
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2"
                />
              </label>
            </div>

            <Button onClick={handleSubmit} disabled={!canSubmit || isSubmitting}>
              {isSubmitting ? "Analyzing..." : "Submit Multimodal Report"}
            </Button>

            {error ? (
              <p className="rounded-xl border border-[var(--accent)] bg-[var(--accent-soft)] px-3 py-2 text-sm text-[var(--text-strong)]">
                {error}
              </p>
            ) : null}
          </div>
        </Card>

        <Card>
          <h2 className="text-xl text-[var(--text-strong)]">Structured Output</h2>
          {createdReport ? (
            <div className="mt-3 space-y-2">
              <p className="text-sm text-[var(--text-strong)]">{createdReport.summary}</p>
              <p className="text-xs text-[var(--text-muted)]">
                Engine: {analysisEngine || "fallback"}
              </p>
              <span
                className="inline-flex rounded-full px-2.5 py-1 text-xs font-bold text-white"
                style={{ background: severityTone(createdReport.severity) }}
              >
                Severity: {createdReport.severity.toUpperCase()}
              </span>
              <p className="text-xs text-[var(--text-muted)]">
                Estimated people affected: {createdReport.people_count_estimate}
              </p>
              <p className="text-xs text-[var(--text-muted)]">
                Suggested volunteers: {createdReport.required_volunteers_estimate}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {createdReport.categories.map((item) => (
                  <span key={item} className="rounded-full bg-[var(--surface-elevated)] px-2 py-0.5 text-[11px] text-[var(--text-muted)]">
                    {item}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <p className="mt-3 text-sm text-[var(--text-muted)]">
              Submit a report to view structured triage output.
            </p>
          )}
        </Card>
      </section>

      <Card>
        <h2 className="text-xl text-[var(--text-strong)]">Recent Field Reports</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {reports.map((report) => (
            <div key={report.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span
                  className="rounded-full px-2.5 py-0.5 text-[10px] font-bold text-white"
                  style={{ background: severityTone(report.severity) }}
                >
                  {report.severity.toUpperCase()}
                </span>
                <span className="text-[11px] text-[var(--text-muted)]">
                  {new Date(report.created_at).toLocaleString()}
                </span>
              </div>
              <p className="text-sm font-semibold text-[var(--text-strong)]">{report.summary}</p>
              <p className="mt-1 text-xs text-[var(--text-muted)]">{report.address ?? "Address unavailable"}</p>
            </div>
          ))}
        </div>
      </Card>
    </main>
  );
}
