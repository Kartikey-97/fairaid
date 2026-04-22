export type Coordinate = {
  lat: number;
  lng: number;
};

export type TimeWindow = {
  start?: string | number;
  end?: string | number;
  start_time?: string | number;
  end_time?: string | number;
};

export type Volunteer = {
  id: string;
  skills?: string[];
  location?: Coordinate;
  availability?: boolean | TimeWindow | TimeWindow[];
  max_travel_km?: number;
  available?: boolean;
  [key: string]: unknown;
};

export type Need = {
  id: string;
  skills_required?: string[];
  required?: number;
  urgency?: number;
  impact?: number;
  is_critical?: boolean;
  location?: Coordinate;
  time_window?: TimeWindow;
  schedule?: TimeWindow;
  [key: string]: unknown;
};

export type FairnessMetrics = {
  fulfillment_rates: Record<string, number>;
  fairness_penalty: number;
  avg_efficiency: number;
};

export type AllocationNeedState = Need & {
  assigned_volunteers: string[];
  assigned_scores: number[];
};

export type AllocationState = {
  needs: AllocationNeedState[];
  total_assignments: number;
  total_score: number;
  returned_volunteer_ids?: string[];
  available_volunteers?: Volunteer[];
  metrics?: FairnessMetrics;
  system_score?: number;
  lambda?: number;
};

export type AllocationRequest = {
  volunteers: Volunteer[];
  needs: Need[];
};

export type AllocationResponse = {
  states: Record<string, AllocationState>;
};

export type EmergencyLevel = "emergency" | "non_emergency";
export type NeedStatus = "open" | "in_progress" | "closed";
export type UserRole = "ngo" | "volunteer";
export type VolunteerDecision = "accepted" | "pinned" | "interested" | "declined";

export type NeedVolunteerApplication = {
  app_id: string;
  volunteer_id: string;
  decision: VolunteerDecision;
  note?: string | null;
  applied_at: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  job_title?: string | null;
  profile_image_url?: string | null;
  lat: number;
  lng: number;
  license_verified: boolean;
};


export type AvailabilitySlot = {
  day: "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
  start_time: string;
  end_time: string;
};

export type VolunteerRegisterRequest = {
  id?: string;
  user_id?: string;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  profile_image_url?: string;
  job_title?: string;
  license_number?: string;
  license_verified?: boolean;
  verification_notes?: string;
  location: Coordinate;
  radius_km?: number;
  skills?: string[] | string;
  certifications?: string[] | string;
  specialist_domains?: string[] | string;
  preferred_need_types?: string[] | string;
  languages?: string[] | string;
  availability?: AvailabilitySlot[];
  can_handle_emergency?: boolean;
  notes?: string;
};

export type VolunteerProfile = {
  id: string;
  user_id?: string;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  profile_image_url?: string;
  job_title?: string;
  license_number?: string;
  license_verified?: boolean;
  verification_notes?: string;
  location: Coordinate;
  radius_km: number;
  skills: string[];
  certifications: string[];
  specialist_domains: string[];
  preferred_need_types: string[];
  languages: string[];
  availability: AvailabilitySlot[];
  can_handle_emergency: boolean;
  notes?: string;
  created_at: string;
  updated_at: string;
};

export type NeedContact = {
  name: string;
  phone?: string;
  email?: string;
};

export type NeedCreateRequest = {
  ngo_id: string;
  ngo_name: string;
  title: string;
  description: string;
  need_type: string;
  job_category?: string;
  emergency_level: EmergencyLevel;
  is_critical?: boolean;
  urgency: number;
  impact_level: number;
  required_volunteers: number;
  required_skills?: string[] | string;
  required_specialists?: string[] | string;
  language_requirements?: string[] | string;
  min_volunteer_age?: number;
  background_check_required?: boolean;
  beneficiary_count?: number;
  emergency_radius_km?: number;
  location: Coordinate;
  address?: string;
  start_time?: string;
  end_time?: string;
  contact: NeedContact;
  safety_notes?: string;
  resources_available?: string;
  logistics_notes?: string;
};

export type NeedRecord = NeedCreateRequest & {
  id: string;
  status: NeedStatus;
  assigned_volunteers: string[];
  notified_volunteer_ids: string[];
  accepted_count: number;
  interested_count: number;
  pinned_count?: number;
  declined_count: number;
  created_at: string;
  updated_at: string;
};

export type VolunteerNeedCard = {
  need_id: string;
  title: string;
  ngo_name: string;
  need_type: string;
  job_category?: string;
  emergency_level: EmergencyLevel;
  need_location?: Coordinate;
  need_address?: string;
  required_volunteers: number;
  currently_assigned: number;
  required_skills: string[];
  required_specialists: string[];
  distance_km: number;
  distance_limit_km: number;
  within_distance: boolean;
  capability_score: number;
  recommendation_score: number;
  score_breakdown: Record<string, number>;
  trust_badges: string[];
  matching_reasons: string[];
  accepted_count: number;
  interested_count: number;
  declined_count: number;
  user_decision?: VolunteerDecision | null;
  shift_start?: string;
  shift_end?: string;
};

export type VolunteerFeedRequest = {
  limit?: number;
  include_non_emergency?: boolean;
};

export type VolunteerFeedResponse = {
  volunteer_id: string;
  emergency: VolunteerNeedCard[];
  recommended: VolunteerNeedCard[];
  all: VolunteerNeedCard[];
};

export type AuthSignupRequest = {
  name: string;
  email: string;
  password: string;
  role: UserRole;
};

export type AuthLoginRequest = {
  email: string;
  password: string;
  role: UserRole;
};

export type AuthSession = {
  user_id: string;
  role: UserRole;
  name: string;
  email: string;
  volunteer_id?: string | null;
  ngo_id?: string | null;
};

export type VolunteerDecisionRequest = {
  decision: VolunteerDecision;
  note?: string;
};

export type VolunteerDecisionResponse = {
  volunteer_id: string;
  need_id: string;
  decision: VolunteerDecision;
  accepted_count: number;
  interested_count: number;
  declined_count: number;
};

export type VolunteerNotification = {
  id: string;
  volunteer_id: string;
  need_id?: string | null;
  title: string;
  message: string;
  channels: string[];
  status: string;
  is_read: boolean;
  created_at: string;
  sent_at?: string | null;
};

export type NeedAuditEntry = {
  id: string;
  need_id: string;
  actor_id?: string | null;
  actor_role?: string | null;
  action: string;
  details: Record<string, unknown>;
  created_at: string;
};

export type NeedTemplate = {
  id: string;
  name: string;
  description: string;
  defaults: Record<string, unknown>;
};

export type NeedDraftResponse = {
  template_id?: string | null;
  draft: Record<string, unknown>;
  extracted_skills: string[];
  extracted_specialists: string[];
  inferred_emergency: EmergencyLevel;
};

export type SkillCatalog = {
  skills: string[];
  jobs: string[];
  need_types: string[];
  specialists: string[];
  languages: string[];
};

export interface UrgentCategory {
  category: string;
  count: number;
  required_volunteers: number;
  accepted_volunteers: number;
}

export interface HotspotsResponse {
  total_open_needs: number;
  total_volunteers_needed: number;
  total_volunteers_assigned: number;
  urgent_categories: UrgentCategory[];
}

export type FieldIntelReport = {
  id: string;
  volunteer_id?: string | null;
  summary: string;
  severity: "low" | "medium" | "high" | "critical";
  categories: string[];
  supply_needs: string[];
  people_count_estimate: number;
  required_volunteers_estimate: number;
  location?: Coordinate | null;
  address?: string | null;
  raw_audio_text?: string | null;
  image_hint?: string | null;
  created_at: string;
};

export type FieldIntelCreateResponse = {
  status: string;
  report: FieldIntelReport;
  analysis_engine: string;
  hotspot_refresh_hint: boolean;
};

export type AutonomousDispatchResponse = {
  status: "queued" | "no_action";
  message?: string;
  need_id: string;
  remaining_slots: number;
  analyst?: {
    required_skills: string[];
    required_specialists: string[];
    job_category?: string | null;
    emergency_level: string;
    remaining_slots: number;
  };
  dispatcher?: {
    candidate_count: number;
    selected: Array<{
      id: string;
      name: string;
      distance_km: number;
      capability: number;
      dispatch_score: number;
      job_title?: string | null;
      email?: string | null;
      phone?: string | null;
    }>;
  };
  communicator?: {
    subject: string;
    briefing: string;
    engine: string;
  };
};
