"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FilesetResolver, GestureRecognizer } from "@mediapipe/tasks-vision";

import { createFieldIntelReport, fetchVolunteerByUser } from "@/lib/api";
import { useAuthGuard } from "@/lib/use-auth-guard";
import type { VolunteerProfile } from "@/lib/types";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

const GESTURE_MAP: Record<string, string> = {
  Open_Palm: "HELP NEEDED",
  Closed_Fist: "PAIN OR INJURY",
  Pointing_Up: "NEED WATER",
  Thumb_Up: "YES / OK",
  Thumb_Down: "NO / UNSAFE",
  Victory: "NEED TWO PEOPLE",
};

const QUICK_PHRASES = [
  "Need clean drinking water",
  "Need medical support immediately",
  "Need food distribution support",
  "Need evacuation assistance",
  "Children or elderly need priority help",
  "Area is unsafe right now",
];

export default function AccessibilityPage() {
  const { session, isChecking } = useAuthGuard("volunteer");
  const [volunteer, setVolunteer] = useState<VolunteerProfile | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const recognizerRef = useRef<GestureRecognizer | null>(null);
  const rafRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lastEmissionRef = useRef<{ label: string; at: number }>({ label: "", at: 0 });
  const lastVideoTimeRef = useRef<number>(-1);
  const lastWarningRef = useRef<{ message: string; at: number }>({ message: "", at: 0 });

  const [isStarting, setIsStarting] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState("Idle");
  const [gesture, setGesture] = useState("--");
  const [translated, setTranslated] = useState("No gesture detected");
  const [history, setHistory] = useState<string[]>([]);
  const [manualPhrase, setManualPhrase] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [cameraFacingMode, setCameraFacingMode] = useState<'environment' | 'user'>('environment');
  const [sendStatus, setSendStatus] = useState<string | null>(null);

  const legend = useMemo(
    () => [
      ["Open Palm", "HELP NEEDED"],
      ["Closed Fist", "PAIN OR INJURY"],
      ["Pointing Up", "NEED WATER"],
      ["Thumb Up", "YES / OK"],
      ["Thumb Down", "NO / UNSAFE"],
      ["Victory", "NEED TWO PEOPLE"],
    ],
    [],
  );

  useEffect(() => {
    if (!session) {
      return;
    }
    fetchVolunteerByUser(session.user_id)
      .then((profile) => setVolunteer(profile))
      .catch(() => setVolunteer(null));
  }, [session]);

  async function ensureRecognizer(): Promise<GestureRecognizer> {
    if (recognizerRef.current) {
      return recognizerRef.current;
    }

    const fileset = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/wasm",
    );

    const recognizer = await GestureRecognizer.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task",
      },
      runningMode: "VIDEO",
      numHands: 1,
    });

    recognizerRef.current = recognizer;
    return recognizer;
  }

  function stopCamera() {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    lastVideoTimeRef.current = -1;
    setIsRunning(false);
    setStatus("Stopped");
  }

  async function startCamera() {
    try {
      setIsStarting(true);
      setStatus("Loading offline model...");
      const recognizer = await ensureRecognizer();

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 960, height: 540, facingMode: cameraFacingMode },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      setStatus("Running on-device translation");
      setIsRunning(true);

      const tick = () => {
        const video = videoRef.current;
        if (!video) {
          rafRef.current = requestAnimationFrame(tick);
          return;
        }

        const hasNewFrame = video.currentTime > lastVideoTimeRef.current;
        if (
          video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
          video.currentTime > 0 &&
          hasNewFrame
        ) {
          try {
            lastVideoTimeRef.current = video.currentTime;
            const result = recognizer.recognizeForVideo(video, performance.now());
            const top = result.gestures?.[0]?.[0];
            const category = top?.categoryName ?? "";

            if (category) {
              setGesture(category);
              const mapped = GESTURE_MAP[category] ?? "UNMAPPED GESTURE";
              setTranslated(mapped);
              if (mapped !== "UNMAPPED GESTURE") {
                const now = Date.now();
                if (
                  mapped !== lastEmissionRef.current.label
                  || now - lastEmissionRef.current.at > 1800
                ) {
                  lastEmissionRef.current = { label: mapped, at: now };
                  setHistory((prev) => {
                    const next = [`${new Date().toLocaleTimeString()} · ${mapped}`, ...prev];
                    return next.slice(0, 8);
                  });
                }
              }
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            // Ignore non-fatal MediaPipe/TFLite startup warnings in browser console.
            if (
              message.includes("XNNPACK delegate")
              || message.includes("Wait until the video")
              || message.includes("No hands detected")
            ) {
              // no-op
            } else {
              const now = Date.now();
              if (
                message !== lastWarningRef.current.message
                || now - lastWarningRef.current.at > 2500
              ) {
                lastWarningRef.current = { message, at: now };
                setStatus(`Recognizer warning: ${message}`);
              }
            }
          }
        }
        rafRef.current = requestAnimationFrame(tick);
      };

      rafRef.current = requestAnimationFrame(tick);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to start camera");
      stopCamera();
    } finally {
      setIsStarting(false);
    }
  }

  async function sendSignalToNgo() {
    if (!volunteer) {
      setSendStatus("Volunteer profile not available.");
      return;
    }

    const messageParts = [translated, manualPhrase.trim()].filter(Boolean);
    const message = messageParts.join(". ").trim();
    if (!message || message === "No gesture detected") {
      setSendStatus("Capture a gesture or choose a quick phrase first.");
      return;
    }

    setIsSending(true);
    setSendStatus(null);
    try {
      const response = await createFieldIntelReport({
        volunteer_id: volunteer.id,
        notes: `Gesture communication alert: ${message}`,
        address: volunteer.address,
        lat: volunteer.location.lat,
        lng: volunteer.location.lng,
      });
      setSendStatus(`Signal sent to NGO operations (${response.report.severity}).`);
      setManualPhrase("");
    } catch (error) {
      setSendStatus(error instanceof Error ? error.message : "Could not send signal.");
    } finally {
      setIsSending(false);
    }
  }

  useEffect(() => {
    return () => {
      stopCamera();
      recognizerRef.current?.close();
      recognizerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!isRunning) {
      return;
    }
    const restartCamera = async () => {
      stopCamera();
      await startCamera();
    };
    void restartCamera();
    // Restart stream when user taps preview to flip camera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraFacingMode]);

  if (isChecking) {
    return (
      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <Card>Loading gesture translator...</Card>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
      <Card>
        <h1 className="text-3xl text-[var(--text-strong)]">Offline Gesture Translator</h1>
        <p className="mt-2 text-sm text-[var(--text-muted)]">
          Uses on-device AI to translate key emergency gestures without internet, and can forward important signals to NGO operations.
        </p>
      </Card>

      <section className="grid gap-6 lg:grid-cols-[1.25fr_1fr]">
        <Card>
          <div className="relative overflow-hidden rounded-2xl border border-[var(--border)] bg-black/70">
            <video 
              ref={videoRef} 
              className="h-[360px] w-full object-cover cursor-pointer" 
              muted 
              playsInline 
              onClick={() => setCameraFacingMode(prev => prev === "environment" ? "user" : "environment")}
            />
            {isRunning && (
              <div className="pointer-events-none absolute bottom-4 right-4 rounded-full bg-black/50 p-2 text-white backdrop-blur-sm">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 2.1l4 4-4 4"/>
                  <path d="M3 12.2v-2a4 4 0 0 1 4-4h12.8M7 21.9l-4-4 4-4"/>
                  <path d="M21 11.8v2a4 4 0 0 1-4 4H4.2"/>
                </svg>
              </div>
            )}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {/* Camera control buttons */}
          {isRunning ? (
            <Button variant="danger" onClick={stopCamera}>Stop Translator</Button>
          ) : (
            <Button onClick={startCamera} disabled={isStarting}>
              {isStarting ? "Starting..." : "Start Translator"}
            </Button>
          )}
          {/* Send Signal button */}
          <Button variant="secondary" onClick={sendSignalToNgo} disabled={isSending || !volunteer}>
            {isSending ? "Sending..." : "Send Signal to NGO"}
          </Button>
          </div>
          <p className="mt-2 text-xs text-[var(--text-muted)]">Status: {status}</p>
          {sendStatus ? <p className="mt-2 text-xs text-[var(--text-muted)]">{sendStatus}</p> : null}
        </Card>

        <Card>
          <h2 className="text-xl text-[var(--text-strong)]">Live Translation</h2>
          <p className="mt-3 text-xs uppercase tracking-wide text-[var(--text-muted)]">Detected Gesture</p>
          <p className="text-lg font-bold text-[var(--text-strong)]">{gesture}</p>
          <p className="mt-3 text-xs uppercase tracking-wide text-[var(--text-muted)]">Translated Message</p>
          <p className="text-2xl font-black text-[var(--brand)]">{translated}</p>

          <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Emergency Gesture Dictionary</p>
            <div className="mt-2 space-y-1.5 text-sm text-[var(--text-strong)]">
              {legend.map(([left, right]) => (
                <p key={left} className="flex justify-between gap-4">
                  <span>{left}</span>
                  <span className="font-bold text-[var(--brand)]">{right}</span>
                </p>
              ))}
            </div>
          </div>
        </Card>
      </section>

      <Card>
        <h2 className="text-xl text-[var(--text-strong)]">Quick Phrase Board</h2>
        <p className="mt-1 text-xs text-[var(--text-muted)]">Tap a phrase to add it to the outgoing message.</p>
        <div className="mt-3 grid gap-2 md:grid-cols-2 lg:grid-cols-3">
          {QUICK_PHRASES.map((phrase) => (
            <button
              key={phrase}
              type="button"
              onClick={() => setManualPhrase(phrase)}
              className="rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2 text-left text-sm text-[var(--text-strong)] hover:border-[var(--brand)]"
            >
              {phrase}
            </button>
          ))}
        </div>
        <textarea
          value={manualPhrase}
          onChange={(event) => setManualPhrase(event.target.value)}
          className="mt-3 h-20 w-full rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2 text-sm"
          placeholder="Optional custom phrase..."
        />
      </Card>

      <Card>
        <h2 className="text-xl text-[var(--text-strong)]">Recent Translations</h2>
        {history.length ? (
          <div className="mt-3 space-y-2">
            {history.map((row) => (
              <div key={row} className="rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2 text-sm text-[var(--text-strong)]">
                {row}
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-[var(--text-muted)]">No translations yet. Start camera to begin.</p>
        )}
      </Card>
    </main>
  );
}
