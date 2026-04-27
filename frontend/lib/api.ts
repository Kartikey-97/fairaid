import type {
  AllocationRequest,
  AllocationResponse,
  AutonomousDispatchResponse,
  AuthLoginRequest,
  AuthSession,
  AuthSignupRequest,
  FieldIntelCreateResponse,
  FieldIntelReport,
  NeedCreateRequest,
  NeedDraftResponse,
  NeedRecord,
  NeedTemplate,
  NeedAuditEntry,
  NeedVolunteerApplication,
  SkillCatalog,
  VolunteerNotification,
  VolunteerDecisionRequest,
  VolunteerDecisionResponse,
  VolunteerFeedRequest,
  VolunteerFeedResponse,
  VolunteerProfile,
  VolunteerRegisterRequest,
} from "@/lib/types";

export interface HotspotsResponse {
  total_open_needs: number;
  total_volunteers_needed: number;
  total_volunteers_assigned: number;
  urgent_categories: Array<{
    category: string;
    count: number;
    required_volunteers: number;
    accepted_volunteers: number;
  }>;
}

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function fetchJson<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    credentials: "include",
    ...options,
  });
  if (!response.ok) {
    const raw = await response.text();
    let message = raw || `Request failed with status ${response.status}`;
    try {
      const parsed = JSON.parse(raw) as { detail?: string };
      if (parsed?.detail) {
        message = parsed.detail;
      }
    } catch {
      // Keep fallback raw text.
    }
    throw new ApiError(message, response.status);
  }
  return (await response.json()) as T;
}

export async function runAllocation(
  payload: AllocationRequest,
): Promise<AllocationResponse> {
  return fetchJson<AllocationResponse>("/run-allocation", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export async function fetchAllocationData(): Promise<AllocationRequest> {
  return fetchJson<AllocationRequest>("/allocation-data");
}

export async function registerVolunteer(
  payload: VolunteerRegisterRequest
): Promise<VolunteerProfile> {
  return fetchJson<VolunteerProfile>("/platform/volunteers/register", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export async function fetchVolunteerByUser(userId: string): Promise<VolunteerProfile> {
  return fetchJson<VolunteerProfile>(`/platform/volunteers/by-user/${userId}`);
}

export async function createNeed(payload: NeedCreateRequest): Promise<NeedRecord> {
  return fetchJson<NeedRecord>("/platform/ngo/needs", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export async function fetchNgoNeeds(ngoId: string): Promise<NeedRecord[]> {
  return fetchJson<NeedRecord[]>(`/platform/ngo/${ngoId}/needs`);
}

export async function deleteNgoNeed(ngoId: string, needId: string): Promise<{ status: string; need_id: string }> {
  return fetchJson<{ status: string; need_id: string }>(`/platform/ngo/${ngoId}/needs/${needId}`, {
    method: "DELETE",
  });
}

export async function fetchVolunteerFeed(
  volunteerId: string,
  payload: VolunteerFeedRequest = {},
): Promise<VolunteerFeedResponse> {
  return fetchJson<VolunteerFeedResponse>(`/platform/volunteers/${volunteerId}/feed`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export async function fetchNeeds(params?: {
  emergencyOnly?: boolean;
  status?: string;
}): Promise<NeedRecord[]> {
  const searchParams = new URLSearchParams();
  if (params?.emergencyOnly) {
    searchParams.set("emergency_only", "true");
  }
  if (params?.status) {
    searchParams.set("status", params.status);
  }
  const query = searchParams.toString();
  const path = query ? `/platform/needs?${query}` : "/platform/needs";
  return fetchJson<NeedRecord[]>(path);
}

export async function fetchActiveNeeds(): Promise<Array<{
  id: string;
  title: string;
  ngo_name: string;
  need_type: string;
  emergency_level: string;
  urgency: number;
  required_volunteers: number;
  accepted_count: number;
  address?: string | null;
  location: { lat: number; lng: number };
  status: string;
}>> {
  return fetchJson("/platform/needs/active");
}

export async function fetchCatalog(): Promise<SkillCatalog> {
  return fetchJson<SkillCatalog>("/platform/catalog");
}

export async function fetchNeedTemplates(): Promise<NeedTemplate[]> {
  return fetchJson<NeedTemplate[]>("/platform/ngo/templates");
}

export async function draftNeedFromText(text: string): Promise<NeedDraftResponse> {
  return fetchJson<NeedDraftResponse>("/platform/ngo/draft-from-text", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
  });
}

export async function fetchNeedAudit(needId: string): Promise<NeedAuditEntry[]> {
  return fetchJson<NeedAuditEntry[]>(`/platform/needs/${needId}/audit`);
}

export async function signup(payload: AuthSignupRequest): Promise<AuthSession> {
  return fetchJson<AuthSession>("/platform/auth/signup", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export async function login(payload: AuthLoginRequest): Promise<AuthSession> {
  return fetchJson<AuthSession>("/platform/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export async function setVolunteerDecision(
  volunteerId: string,
  needId: string,
  payload: VolunteerDecisionRequest,
): Promise<VolunteerDecisionResponse> {
  return fetchJson<VolunteerDecisionResponse>(
    `/platform/volunteers/${volunteerId}/needs/${needId}/decision`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );
}

export async function fetchVolunteerNotifications(
  volunteerId: string,
  unreadOnly = true,
): Promise<VolunteerNotification[]> {
  const query = unreadOnly ? "?unread_only=true" : "";
  return fetchJson<VolunteerNotification[]>(
    `/platform/volunteers/${volunteerId}/notifications${query}`,
  );
}

export async function markVolunteerNotificationRead(
  volunteerId: string,
  notificationId: string,
): Promise<{ status: string; notification_id: string }> {
  return fetchJson<{ status: string; notification_id: string }>(
    `/platform/volunteers/${volunteerId}/notifications/${notificationId}/read`,
    { method: "POST" },
  );
}

export async function geocodeSuggestions(query: string): Promise<Array<{ lat: number; lng: number; display_name: string }>> {
  const response = await fetchJson<Array<{ lat: number; lng: number; display_name: string }>>(
    `/platform/geocode-suggest?query=${encodeURIComponent(query)}`,
  );
  return response;
}

export async function fetchHotspots(): Promise<HotspotsResponse> {
  return fetchJson<HotspotsResponse>("/platform/insights/hotspots");
}

export async function fetchHealth(): Promise<{
  status: string;
  service: string;
  db: {
    configured_backend: string;
    active_backend: string;
    postgres_configured: boolean;
    postgres_error?: string | null;
    sqlite_path: string;
  };
}> {
  return fetchJson("/platform/health");
}

export async function fetchNeedVolunteers(
  ngoId: string,
  needId: string,
): Promise<{ need_id: string; applications: NeedVolunteerApplication[] }> {
  return fetchJson(`/platform/ngo/${ngoId}/needs/${needId}/volunteers`);
}

export async function removeVolunteerFromNeed(
  ngoId: string,
  needId: string,
  volunteerId: string,
): Promise<{ status: string; volunteer_id: string; need_id: string }> {
  return fetchJson(`/platform/ngo/${ngoId}/needs/${needId}/volunteers/${volunteerId}`, {
    method: "DELETE",
  });
}

export async function createFieldIntelReport(payload: {
  volunteer_id: string;
  notes?: string;
  address?: string;
  lat?: number;
  lng?: number;
  imageFile?: File | null;
  audioFile?: File | null;
}): Promise<FieldIntelCreateResponse> {
  const formData = new FormData();
  formData.append("volunteer_id", payload.volunteer_id);
  formData.append("notes", payload.notes ?? "");
  if (payload.address) {
    formData.append("address", payload.address);
  }
  if (typeof payload.lat === "number") {
    formData.append("lat", String(payload.lat));
  }
  if (typeof payload.lng === "number") {
    formData.append("lng", String(payload.lng));
  }
  if (payload.imageFile) {
    formData.append("image_file", payload.imageFile);
  }
  if (payload.audioFile) {
    formData.append("audio_file", payload.audioFile);
  }

  return fetchJson<FieldIntelCreateResponse>("/platform/field-intel/report", {
    method: "POST",
    body: formData,
  });
}

export async function fetchFieldIntelReports(limit = 25): Promise<FieldIntelReport[]> {
  const response = await fetchJson<{ reports: FieldIntelReport[] }>(
    `/platform/field-intel/reports?limit=${encodeURIComponent(String(limit))}`,
  );
  return response.reports;
}

export async function deleteFieldIntelReport(reportId: string, ngoId: string): Promise<{ status: string; report_id: string }> {
  return fetchJson<{ status: string; report_id: string }>(`/platform/field-intel/reports/${reportId}?ngo_id=${encodeURIComponent(ngoId)}`, {
    method: "DELETE",
  });
}

export async function runAutonomousDispatch(
  ngoId: string,
  needId: string,
): Promise<AutonomousDispatchResponse> {
  return fetchJson<AutonomousDispatchResponse>(
    `/platform/ngo/${ngoId}/needs/${needId}/autonomous-dispatch`,
    { method: "POST" },
  );
}

export async function uploadSurveyCsv(file: File): Promise<{ status: string; processed_count: number }> {
  const formData = new FormData();
  formData.append("file", file);
  return fetchJson<{ status: string; processed_count: number }>("/api/surveys/upload", {
    method: "POST",
    body: formData,
  });
}
