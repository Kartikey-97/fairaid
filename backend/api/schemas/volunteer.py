from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from backend.core.domain import (
    JOB_LIBRARY,
    LANGUAGE_LIBRARY,
    NEED_TYPE_LIBRARY,
    SKILL_LIBRARY,
    SPECIALIST_LIBRARY,
)

WeekDay = Literal["mon", "tue", "wed", "thu", "fri", "sat", "sun"]


UserRole = Literal["ngo", "volunteer"]
VolunteerDecision = Literal["accepted", "pinned", "interested", "declined"]

SPECIALIST_ALIAS_MAP = {
    "doctor": "medical",
    "nurse": "medical",
    "paramedic": "medical",
    "surgeon": "medical",
    "pharmacist": "medical",
    "physiotherapist": "medical",
    "public-health": "public-health",
    "educator": "education",
    "teacher": "education",
    "counselor": "counseling",
    "psychologist": "counseling",
    "mental-health": "counseling",
    "lawyer": "legal-aid",
    "legal": "legal-aid",
    "vet": "veterinary",
}


class Coordinate(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)


class AvailabilitySlot(BaseModel):
    day: WeekDay
    start_time: str = Field(description="24h format, e.g. 09:30")
    end_time: str = Field(description="24h format, e.g. 17:30")


class VolunteerRegisterRequest(BaseModel):
    id: str | None = None
    user_id: str | None = None
    name: str = Field(min_length=2, max_length=120)
    email: str | None = None
    phone: str | None = None
    address: str | None = None
    profile_image_url: str | None = None
    job_title: str | None = None
    license_number: str | None = None
    license_verified: bool = False
    verification_notes: str | None = None
    location: Coordinate
    radius_km: float = Field(default=25.0, ge=1.0, le=500.0)
    skills: list[str] = Field(default_factory=list)
    certifications: list[str] = Field(default_factory=list)
    specialist_domains: list[str] = Field(default_factory=list)
    preferred_need_types: list[str] = Field(default_factory=list)
    languages: list[str] = Field(default_factory=list)
    availability: list[AvailabilitySlot] = Field(default_factory=list)
    can_handle_emergency: bool = True
    notes: str | None = None

    @field_validator(
        "skills",
        "certifications",
        "specialist_domains",
        "preferred_need_types",
        "languages",
        mode="before",
    )
    @classmethod
    def _normalize_lists(cls, value: object) -> list[str]:
        if value is None:
            return []

        if isinstance(value, str):
            parts = [part.strip().lower() for part in value.split(",")]
            return [part for part in parts if part]

        if isinstance(value, list):
            normalized: list[str] = []
            for item in value:
                if item is None:
                    continue
                item_text = str(item).strip().lower()
                if item_text:
                    normalized.append(item_text)
            return normalized

        return []

    @field_validator("job_title")
    @classmethod
    def _normalize_job_title(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip().lower()
        if not cleaned:
            return None
        if cleaned not in JOB_LIBRARY:
            raise ValueError(f"job_title must be one of: {', '.join(JOB_LIBRARY)}")
        return cleaned

    @field_validator("skills")
    @classmethod
    def _validate_skills(cls, value: list[str]) -> list[str]:
        invalid = sorted({item for item in value if item not in SKILL_LIBRARY})
        if invalid:
            raise ValueError(
                f"Unknown skills: {', '.join(invalid)}. Choose from the skill library only."
            )
        return value

    @field_validator("preferred_need_types")
    @classmethod
    def _validate_need_types(cls, value: list[str]) -> list[str]:
        invalid = sorted({item for item in value if item not in NEED_TYPE_LIBRARY})
        if invalid:
            raise ValueError(
                f"Unknown need types: {', '.join(invalid)}. "
                f"Allowed values: {', '.join(NEED_TYPE_LIBRARY)}"
            )
        return value

    @field_validator("specialist_domains")
    @classmethod
    def _validate_specialist_domains(cls, value: list[str]) -> list[str]:
        normalized: list[str] = []
        for item in value:
            canonical = item.strip().lower().replace("_", "-").replace(" ", "-")
            canonical = SPECIALIST_ALIAS_MAP.get(canonical, canonical)
            if canonical:
                normalized.append(canonical)

        invalid = sorted({item for item in normalized if item not in SPECIALIST_LIBRARY})
        if invalid:
            raise ValueError(
                f"Unknown specialist domains: {', '.join(invalid)}. "
                f"Allowed values: {', '.join(SPECIALIST_LIBRARY)}"
            )
        deduped = list(dict.fromkeys(normalized))
        return deduped

    @field_validator("languages")
    @classmethod
    def _validate_languages(cls, value: list[str]) -> list[str]:
        invalid = sorted({item for item in value if item not in LANGUAGE_LIBRARY})
        if invalid:
            raise ValueError(
                f"Unknown languages: {', '.join(invalid)}. "
                f"Allowed values: {', '.join(LANGUAGE_LIBRARY)}"
            )
        return value

    @model_validator(mode="after")
    def _validate_medical_license(self):
        if self.job_title in {"doctor", "nurse"} and not (self.license_number or "").strip():
            raise ValueError("license_number is required for doctor/nurse profiles.")
        return self


class VolunteerProfile(VolunteerRegisterRequest):
    id: str
    created_at: str
    updated_at: str


class AuthSignupRequest(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    email: str = Field(min_length=5, max_length=255)
    password: str = Field(min_length=4, max_length=120)
    role: UserRole


class AuthLoginRequest(BaseModel):
    email: str = Field(min_length=5, max_length=255)
    password: str = Field(min_length=4, max_length=120)
    role: UserRole


class AuthSessionResponse(BaseModel):
    user_id: str
    role: UserRole
    name: str
    email: str
    volunteer_id: str | None = None
    ngo_id: str | None = None


class VolunteerFeedRequest(BaseModel):
    limit: int = Field(default=30, ge=1, le=100)
    include_non_emergency: bool = True


class VolunteerNeedCard(BaseModel):
    need_id: str
    title: str
    ngo_name: str
    need_type: str
    job_category: str | None = None
    emergency_level: str
    need_location: Coordinate | None = None
    need_address: str | None = None
    required_volunteers: int
    currently_assigned: int
    required_skills: list[str]
    required_specialists: list[str]
    distance_km: float
    distance_limit_km: float
    within_distance: bool
    capability_score: float
    recommendation_score: float
    score_breakdown: dict[str, float] = Field(default_factory=dict)
    trust_badges: list[str] = Field(default_factory=list)
    matching_reasons: list[str]
    accepted_count: int = 0
    interested_count: int = 0
    declined_count: int = 0
    user_decision: VolunteerDecision | None = None
    shift_start: str | None = None
    shift_end: str | None = None


class VolunteerFeedResponse(BaseModel):
    volunteer_id: str
    emergency: list[VolunteerNeedCard]
    recommended: list[VolunteerNeedCard]
    all: list[VolunteerNeedCard]


class VolunteerDecisionRequest(BaseModel):
    decision: VolunteerDecision
    note: str | None = None


class VolunteerDecisionResponse(BaseModel):
    volunteer_id: str
    need_id: str
    decision: VolunteerDecision
    accepted_count: int
    interested_count: int
    declined_count: int


class VolunteerNotification(BaseModel):
    id: str
    volunteer_id: str
    need_id: str | None = None
    title: str
    message: str
    channels: list[str] = Field(default_factory=list)
    status: str
    is_read: bool
    created_at: str
    sent_at: str | None = None
