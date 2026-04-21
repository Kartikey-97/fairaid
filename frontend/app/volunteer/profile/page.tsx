"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";

import {
  fetchCatalog,
  fetchVolunteerByUser,
  geocodeSuggestions,
  markVolunteerNotificationRead,
  registerVolunteer,
  fetchVolunteerNotifications,
} from "@/lib/api";
import { DEFAULT_CATALOG } from "@/lib/catalog";
import { geocodeAddress, reverseGeocode } from "@/lib/location";
import { useAuthGuard } from "@/lib/use-auth-guard";
import type { SkillCatalog, VolunteerRegisterRequest } from "@/lib/types";
import dynamic from "next/dynamic";

// Dynamically import the map and disable SSR to prevent "window is not defined" error during build
const DraggablePinMap = dynamic(
  () => import("@/components/maps/DraggablePinMap").then((mod) => mod.DraggablePinMap),
  {
    ssr: false,
    loading: () => <div className="h-64 w-full animate-pulse bg-gray-200 rounded-md">Loading map...</div>
  }
);
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

function toggleInList(list: string[], value: string): string[] {
  if (list.includes(value)) {
    return list.filter((item) => item !== value);
  }
  return [...list, value];
}

function normalizeRegisterPayload(form: VolunteerRegisterRequest): VolunteerRegisterRequest {
  return {
    ...form,
    skills: Array.isArray(form.skills) ? form.skills : [],
    certifications: Array.isArray(form.certifications) ? form.certifications : [],
    specialist_domains: Array.isArray(form.specialist_domains) ? form.specialist_domains : [],
    preferred_need_types: Array.isArray(form.preferred_need_types) ? form.preferred_need_types : [],
    languages: Array.isArray(form.languages) ? form.languages : [],
  };
}

export default function VolunteerProfilePage() {
  const { session, isChecking, isAuthorized } = useAuthGuard("volunteer");

  const [catalog, setCatalog] = useState<SkillCatalog>(DEFAULT_CATALOG);
  const [form, setForm] = useState<VolunteerRegisterRequest | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [addressSuggestions, setAddressSuggestions] = useState<Array<{ lat: number; lng: number; display_name: string }>>([]);
  const [notifications, setNotifications] = useState<Array<{ id: string; title: string; message: string }>>([]);
  const [jobQuery, setJobQuery] = useState("");
  const [skillQuery, setSkillQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!session || !isAuthorized) {
      return;
    }

    Promise.all([
      fetchCatalog().catch(() => DEFAULT_CATALOG),
      fetchVolunteerByUser(session.user_id).catch(() => null),
    ])
      .then(([library, profile]) => {
        setCatalog(library ?? DEFAULT_CATALOG);
        if (profile) {
          setForm({
            ...profile,
            user_id: session.user_id,
          });
          setJobQuery(profile.job_title ?? "");
          return;
        }
        setForm({
          user_id: session.user_id,
          name: session.name,
          email: session.email,
          phone: "",
          address: "",
          profile_image_url: "",
          job_title: "",
          location: { lat: 28.6139, lng: 77.209 },
          radius_km: 25,
          skills: [],
          certifications: [],
          specialist_domains: [],
          preferred_need_types: [],
          languages: ["hindi"],
          availability: [],
          can_handle_emergency: true,
          notes: "",
        });
        setJobQuery("");
      })
      .catch((loadError) => {
        const message = loadError instanceof Error ? loadError.message : "Could not load profile details.";
        setError(message);
      });
  }, [isAuthorized, session]);

  useEffect(() => {
    setJobQuery(form?.job_title ?? "");
  }, [form?.job_title]);

  useEffect(() => {
    if (!session?.volunteer_id) {
      return;
    }
    fetchVolunteerNotifications(session.volunteer_id, true)
      .then(async (items) => {
        setNotifications(items.map((item) => ({ id: item.id, title: item.title, message: item.message })));
        for (const item of items) {
          await markVolunteerNotificationRead(session.volunteer_id as string, item.id);
        }
      })
      .catch(() => undefined);
  }, [session?.volunteer_id]);

  useEffect(() => {
    const query = (form?.address ?? "").trim();
    if (query.length < 3) {
      setAddressSuggestions([]);
      return;
    }
    const timer = setTimeout(() => {
      geocodeSuggestions(query)
        .then((items) => setAddressSuggestions(items))
        .catch(() => setAddressSuggestions([]));
    }, 300);
    return () => clearTimeout(timer);
  }, [form?.address]);

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
  }

  const jobSuggestions = useMemo(() => {
    const query = jobQuery.trim().toLowerCase();
    if (!query) {
      return catalog.jobs.slice(0, 8);
    }
    return catalog.jobs.filter((job) => job.includes(query)).slice(0, 8);
  }, [catalog.jobs, jobQuery]);

  const skillSuggestions = useMemo(() => {
    const selected = new Set((form?.skills as string[]) ?? []);
    const query = skillQuery.trim().toLowerCase();
    const source = query
      ? catalog.skills.filter((skill) => skill.includes(query))
      : catalog.skills;
    return source.filter((skill) => !selected.has(skill)).slice(0, 10);
  }, [catalog.skills, form?.skills, skillQuery]);

  const skillTaxonomy = useMemo(() => {
    const medical = catalog.skills.filter((skill) =>
      ["first aid", "triage", "medical", "nursing", "mental health", "wound", "ambulance"].some((token) => skill.includes(token)),
    );
    const operations = catalog.skills.filter((skill) =>
      ["logistics", "supply", "warehouse", "driving", "vehicle", "procurement", "radio", "map", "gis"].some((token) => skill.includes(token)),
    );
    const community = catalog.skills.filter((skill) =>
      ["teaching", "child", "community", "translation", "data", "fundraising", "legal", "elderly", "disability", "volunteer"].some((token) => skill.includes(token)),
    );
    return [
      { label: "Medical & Health", items: medical.slice(0, 8) },
      { label: "Operations & Relief", items: operations.slice(0, 8) },
      { label: "Community & Support", items: community.slice(0, 8) },
    ];
  }, [catalog.skills]);

  function chooseJob(job: string) {
    setForm((prev) => (prev ? { ...prev, job_title: job } : prev));
    setJobQuery(job);
  }

  function addSkill(skill: string) {
    setForm((prev) =>
      prev
        ? {
            ...prev,
            skills: toggleInList((prev.skills as string[]) ?? [], skill),
          }
        : prev,
    );
    setSkillQuery("");
  }

  async function handleLocateAddress() {
    if (!form?.address) {
      setError("Enter an address first.");
      return;
    }
    setError(null);
    setSuccess(null);
    setIsLocating(true);
    try {
      const result = await geocodeAddress(form.address);
      if (!result) {
        setError("Could not locate that address. Try a more specific address.");
        return;
      }
      setForm((prev) =>
        prev
          ? {
              ...prev,
              address: result.display_name ?? prev.address,
              location: {
                lat: result.lat,
                lng: result.lng,
              },
            }
          : prev,
      );
      setSuccess("Address mapped successfully.");
    } catch {
      setError("Could not map this address right now.");
    } finally {
      setIsLocating(false);
    }
  }

  async function handleUseCurrentLocation() {
    if (!navigator.geolocation) {
      setError("Geolocation is not supported in this browser.");
      return;
    }
    setError(null);
    setSuccess(null);
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        const resolvedAddress = await reverseGeocode(lat, lng);
        setForm((prev) =>
          prev
            ? {
                ...prev,
                address: resolvedAddress ?? prev.address,
                location: { lat, lng },
              }
            : prev,
        );
        setSuccess("Current location captured.");
        setIsLocating(false);
      },
      () => {
        setError("Could not access current location. Please allow location access.");
        setIsLocating(false);
      },
      { enableHighAccuracy: true, timeout: 12000 },
    );
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    if (!file.type.startsWith("image/")) {
      setError("Please select an image file.");
      return;
    }
    if (file.size > 1024 * 1024) {
      setError("Image size should be <= 1MB for this demo.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setForm((prev) =>
        prev
          ? {
              ...prev,
              profile_image_url: String(reader.result ?? ""),
            }
          : prev,
      );
    };
    reader.readAsDataURL(file);
  }

  async function handleSave() {
    if (!form || !session || !catalog) {
      return;
    }

    setError(null);
    setSuccess(null);
    setIsSaving(true);
    try {
      const payload = normalizeRegisterPayload(form);
      const normalizedJob = jobQuery.trim().toLowerCase();
      const resolvedJob = catalog.jobs.find((job) => job === normalizedJob) ?? payload.job_title;
      const allowedSkills = new Set(catalog.skills);
      const allowedSpecialists = new Set(catalog.specialists);
      const allowedNeedTypes = new Set(catalog.need_types);
      const allowedLanguages = new Set(catalog.languages);
      await registerVolunteer({
        ...payload,
        job_title: resolvedJob,
        skills: (payload.skills as string[]).filter((item) => allowedSkills.has(item)),
        specialist_domains: (payload.specialist_domains as string[]).filter((item) =>
          allowedSpecialists.has(item),
        ),
        preferred_need_types: (payload.preferred_need_types as string[]).filter((item) =>
          allowedNeedTypes.has(item),
        ),
        languages: (payload.languages as string[]).filter((item) => allowedLanguages.has(item)),
      });
      setSuccess("Profile updated successfully.");
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : "Could not update profile.";
      setError(message);
    } finally {
      setIsSaving(false);
    }
  }

  if (isChecking || !form) {
    return (
      <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
        <Card>Loading profile settings...</Card>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
      <Card>
        <h1 className="text-3xl text-[var(--text-strong)]">Profile & Account</h1>
        <p className="mt-2 text-sm text-[var(--text-muted)]">
          Keep your profile accurate so we can alert you for relevant nearby requests.
        </p>
      </Card>

      {notifications.length ? (
        <Card tone="emergency">
          <h2 className="text-lg text-[var(--text-strong)]">Recent Alerts</h2>
          <div className="mt-2 space-y-2">
            {notifications.slice(0, 3).map((item) => (
              <div key={item.id} className="rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2">
                <p className="text-sm font-semibold text-[var(--text-strong)]">{item.title}</p>
                <p className="text-xs text-[var(--text-muted)]">{item.message}</p>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <section className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <Card>
          <h2 className="text-xl text-[var(--text-strong)]">Basic Details</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span>Name</span>
              <input
                value={form.name}
                onChange={(event) => setForm((prev) => (prev ? { ...prev, name: event.target.value } : prev))}
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span>Email</span>
              <input
                value={form.email ?? ""}
                onChange={(event) => setForm((prev) => (prev ? { ...prev, email: event.target.value } : prev))}
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span>Phone</span>
              <input
                value={form.phone ?? ""}
                onChange={(event) => setForm((prev) => (prev ? { ...prev, phone: event.target.value } : prev))}
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span>Job Role</span>
              <div className="relative">
                <input
                  value={jobQuery}
                  onChange={(event) => setJobQuery(event.target.value)}
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2"
                  placeholder="Type to search job taxonomy"
                />
                {jobSuggestions.length ? (
                  <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-20 max-h-44 overflow-auto rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-[0_14px_34px_rgba(9,26,41,0.12)]">
                    {jobSuggestions.map((job) => (
                      <button
                        key={job}
                        type="button"
                        onMouseDown={(event) => {
                          event.preventDefault();
                          chooseJob(job);
                        }}
                        className="block w-full border-b border-[var(--border)] px-3 py-2 text-left text-xs text-[var(--text-muted)] hover:bg-[var(--surface-elevated)]"
                      >
                        {job}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <p className="text-xs text-[var(--text-muted)]">
                Selected: <span className="font-semibold text-[var(--text-strong)]">{form.job_title ?? "none"}</span>
              </p>
            </label>
            <label className="space-y-1 text-sm sm:col-span-2">
              <span>Address</span>
              <input
                value={form.address ?? ""}
                onChange={(event) => applyAddressInput(event.target.value)}
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2"
                placeholder="Street, area, city"
              />
            </label>
            {(form.job_title === "doctor" || form.job_title === "nurse") ? (
              <label className="space-y-1 text-sm">
                <span>License Number</span>
                <input
                  value={form.license_number ?? ""}
                  onChange={(event) =>
                    setForm((prev) => (prev ? { ...prev, license_number: event.target.value } : prev))
                  }
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2"
                  placeholder="Medical registration number"
                />
              </label>
            ) : null}
          </div>
          {form.license_verified ? (
            <p className="mt-3 inline-flex rounded-full border border-[#7ca386] bg-[#e7f4e8] px-3 py-1 text-xs font-semibold text-[#2f6d3c]">
              Verified medical license
            </p>
          ) : null}
        </Card>

        <Card>
          <h2 className="text-xl text-[var(--text-strong)]">Profile Photo</h2>
          <div className="mt-4 flex items-center gap-4">
            <div className="h-20 w-20 overflow-hidden rounded-full border border-[var(--border)] bg-[var(--surface-elevated)]">
              {form.profile_image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={form.profile_image_url} alt="Profile" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xs text-[var(--text-muted)]">No image</div>
              )}
            </div>
            <div className="flex-1">
              <input type="file" accept="image/*" onChange={handleFileChange} className="text-xs" />
              <p className="mt-2 text-xs text-[var(--text-muted)]">You can also paste a direct image URL below.</p>
            </div>
          </div>
          <label className="mt-3 block space-y-1 text-sm">
            <span>Image URL</span>
            <input
              value={form.profile_image_url ?? ""}
              onChange={(event) =>
                setForm((prev) => (prev ? { ...prev, profile_image_url: event.target.value } : prev))
              }
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2"
            />
          </label>
        </Card>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="text-xl text-[var(--text-strong)]">Location & Response Radius</h2>
          <div className="mt-4 grid gap-3">
            <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
              <div className="relative">
                <input
                  value={form.address ?? ""}
                  onChange={(event) => applyAddressInput(event.target.value)}
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2 text-sm"
                  placeholder="Search your address"
                  list="volunteer-address-suggestions"
                />
                <datalist id="volunteer-address-suggestions">
                  {addressSuggestions.map((item) => (
                    <option key={`${item.lat}-${item.lng}`} value={item.display_name} />
                  ))}
                </datalist>
                {addressSuggestions.length > 0 ? (
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
            <p className="text-xs text-[var(--text-muted)]">
              Coordinates: {form.location.lat.toFixed(5)}, {form.location.lng.toFixed(5)}
            </p>
            <label className="space-y-1 text-sm">
              <span>Radius (km)</span>
              <input
                type="number"
                min={1}
                value={form.radius_km ?? 25}
                onChange={(event) =>
                  setForm((prev) =>
                    prev
                      ? {
                          ...prev,
                          radius_km: Number(event.target.value || 25),
                        }
                      : prev,
                  )
                }
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2"
              />
            </label>
          </div>
        </Card>

        <Card>
          <h2 className="text-xl text-[var(--text-strong)]">Preferences</h2>
          <div className="mt-4 space-y-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={Boolean(form.can_handle_emergency)}
                onChange={(event) =>
                  setForm((prev) =>
                    prev ? { ...prev, can_handle_emergency: event.target.checked } : prev,
                  )
                }
              />
              Available for emergency requests
            </label>
            <label className="space-y-1 text-sm">
              <span>Notes</span>
              <textarea
                value={form.notes ?? ""}
                onChange={(event) => setForm((prev) => (prev ? { ...prev, notes: event.target.value } : prev))}
                className="h-24 w-full rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2"
                placeholder="Any constraints or useful context"
              />
            </label>
          </div>
        </Card>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="text-xl text-[var(--text-strong)]">Skills Taxonomy</h2>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Type to discover skills, then add them to your profile.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
            <input
              value={skillQuery}
              onChange={(event) => setSkillQuery(event.target.value)}
              placeholder="Search skills (e.g., triage, logistics, counseling)"
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2"
            />
            <Button
              variant="secondary"
              onClick={() => {
                if (!skillSuggestions.length) {
                  return;
                }
                addSkill(skillSuggestions[0]);
              }}
            >
              Add Top Match
            </Button>
          </div>
          {skillSuggestions.length ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {skillSuggestions.map((skill) => (
                <button
                  key={skill}
                  type="button"
                  onClick={() => addSkill(skill)}
                  className="rounded-full border border-[var(--border)] bg-[var(--surface-elevated)] px-2.5 py-1 text-xs font-semibold text-[var(--text-muted)] hover:border-[var(--brand)] hover:text-[var(--brand)]"
                >
                  + {skill}
                </button>
              ))}
            </div>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            {((form.skills as string[]) ?? []).map((skill) => (
              <button
                key={skill}
                type="button"
                onClick={() => addSkill(skill)}
                className="rounded-full border border-[var(--brand)] bg-[var(--brand-soft)] px-2.5 py-1 text-xs font-semibold text-[var(--brand)]"
              >
                {skill} ×
              </button>
            ))}
          </div>
          <div className="mt-4 space-y-3">
            {skillTaxonomy.map((group) => (
              <div key={group.label}>
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">{group.label}</p>
                <div className="mt-1 flex flex-wrap gap-2">
                  {group.items.map((skill) => (
                    <button
                      key={skill}
                      type="button"
                      onClick={() => addSkill(skill)}
                      className="rounded-full border border-[var(--border)] bg-[var(--surface-elevated)] px-2.5 py-1 text-xs text-[var(--text-muted)] hover:border-[var(--brand)] hover:text-[var(--brand)]"
                    >
                      {skill}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <h2 className="text-xl text-[var(--text-strong)]">Task Preferences</h2>
          <p className="mt-1 text-sm text-[var(--text-muted)]">Choose the categories you want to be matched for.</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {catalog.need_types.map((needType) => {
              const selected = (form.preferred_need_types ?? []).includes(needType);
              return (
                <label
                  key={needType}
                  className={`cursor-pointer rounded-xl border px-3 py-2 text-sm ${
                    selected
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
                              preferred_need_types: toggleInList(
                                (prev.preferred_need_types as string[]) ?? [],
                                needType,
                              ),
                            }
                          : prev,
                      )
                    }
                  />
                  {needType}
                </label>
              );
            })}
          </div>
        </Card>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="text-xl text-[var(--text-strong)]">Specialist Domains</h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {catalog.specialists.map((specialist) => {
              const selected = (form.specialist_domains ?? []).includes(specialist);
              return (
                <label
                  key={specialist}
                  className={`cursor-pointer rounded-xl border px-3 py-2 text-sm ${
                    selected
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
                              specialist_domains: toggleInList(
                                (prev.specialist_domains as string[]) ?? [],
                                specialist,
                              ),
                            }
                          : prev,
                      )
                    }
                  />
                  {specialist}
                </label>
              );
            })}
          </div>
        </Card>

        <Card>
          <h2 className="text-xl text-[var(--text-strong)]">Languages</h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {catalog.languages.map((language) => {
              const selected = (form.languages ?? []).includes(language);
              return (
                <label
                  key={language}
                  className={`cursor-pointer rounded-xl border px-3 py-2 text-sm ${
                    selected
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
                              languages: toggleInList((prev.languages as string[]) ?? [], language),
                            }
                          : prev,
                      )
                    }
                  />
                  {language}
                </label>
              );
            })}
          </div>
        </Card>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={handleSave} disabled={isSaving}>
          {isSaving ? "Saving..." : "Save Profile"}
        </Button>
        {error ? <p className="text-sm text-[#b63a32]">{error}</p> : null}
        {success ? <p className="text-sm text-[#2f7a56]">{success}</p> : null}
      </div>
    </main>
  );
}
