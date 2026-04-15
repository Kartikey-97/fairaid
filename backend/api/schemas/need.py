from typing import Literal

from pydantic import BaseModel, Field, field_validator

from backend.api.schemas.volunteer import Coordinate
from backend.core.domain import (
    JOB_LIBRARY,
    LANGUAGE_LIBRARY,
    NEED_TYPE_LIBRARY,
    SKILL_LIBRARY,
    SPECIALIST_LIBRARY,
)


EmergencyLevel = Literal["emergency", "non_emergency"]
NeedStatus = Literal["open", "in_progress", "closed"]


class ContactPoint(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    phone: str | None = None
    email: str | None = None


class NeedCreateRequest(BaseModel):
    ngo_id: str
    ngo_name: str
    title: str = Field(min_length=4, max_length=160)
    description: str = Field(min_length=12, max_length=3000)
    need_type: str = Field(
        description="Examples: medical-camp, food-distribution, shelter, education"
    )
    job_category: str | None = None
    emergency_level: EmergencyLevel = "non_emergency"
    is_critical: bool = False
    urgency: int = Field(default=3, ge=1, le=5)
    impact_level: int = Field(default=3, ge=1, le=5)
    required_volunteers: int = Field(ge=1, le=5000)
    required_skills: list[str] = Field(default_factory=list)
    required_specialists: list[str] = Field(default_factory=list)
    language_requirements: list[str] = Field(default_factory=list)
    min_volunteer_age: int | None = Field(default=None, ge=16, le=100)
    background_check_required: bool = False
    beneficiary_count: int | None = Field(default=None, ge=1)
    emergency_radius_km: float = Field(
        default=25.0,
        ge=1.0,
        le=500.0,
        description="Radius for emergency volunteer notifications",
    )
    location: Coordinate
    address: str | None = None
    start_time: str | None = None
    end_time: str | None = None
    contact: ContactPoint
    safety_notes: str | None = None
    resources_available: str | None = None
    logistics_notes: str | None = None

    @field_validator(
        "required_skills",
        "required_specialists",
        "language_requirements",
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

    @field_validator("need_type")
    @classmethod
    def _validate_need_type(cls, value: str) -> str:
        normalized = value.strip().lower()
        if normalized not in NEED_TYPE_LIBRARY:
            raise ValueError(
                f"Unknown need_type '{value}'. Allowed values: {', '.join(NEED_TYPE_LIBRARY)}"
            )
        return normalized

    @field_validator("job_category")
    @classmethod
    def _validate_job_category(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip().lower()
        if not normalized:
            return None
        if normalized not in JOB_LIBRARY:
            raise ValueError(
                f"Unknown job_category '{value}'. Allowed values: {', '.join(JOB_LIBRARY)}"
            )
        return normalized

    @field_validator("required_skills")
    @classmethod
    def _validate_required_skills(cls, value: list[str]) -> list[str]:
        invalid = sorted({item for item in value if item not in SKILL_LIBRARY})
        if invalid:
            raise ValueError(
                f"Unknown required_skills: {', '.join(invalid)}. "
                "Choose from the skill library."
            )
        return value

    @field_validator("required_specialists")
    @classmethod
    def _validate_required_specialists(cls, value: list[str]) -> list[str]:
        invalid = sorted({item for item in value if item not in SPECIALIST_LIBRARY})
        if invalid:
            raise ValueError(
                f"Unknown required_specialists: {', '.join(invalid)}. "
                f"Allowed values: {', '.join(SPECIALIST_LIBRARY)}"
            )
        return value

    @field_validator("language_requirements")
    @classmethod
    def _validate_language_requirements(cls, value: list[str]) -> list[str]:
        invalid = sorted({item for item in value if item not in LANGUAGE_LIBRARY})
        if invalid:
            raise ValueError(
                f"Unknown language_requirements: {', '.join(invalid)}. "
                f"Allowed values: {', '.join(LANGUAGE_LIBRARY)}"
            )
        return value


class NeedRecord(NeedCreateRequest):
    id: str
    status: NeedStatus = "open"
    assigned_volunteers: list[str] = Field(default_factory=list)
    notified_volunteer_ids: list[str] = Field(default_factory=list)
    accepted_count: int = 0
    interested_count: int = 0
    declined_count: int = 0
    created_at: str
    updated_at: str


class NeedAuditEntry(BaseModel):
    id: str
    need_id: str
    actor_id: str | None = None
    actor_role: str | None = None
    action: str
    details: dict = Field(default_factory=dict)
    created_at: str


class NeedTemplate(BaseModel):
    id: str
    name: str
    description: str
    defaults: dict


class NeedDraftRequest(BaseModel):
    text: str = Field(min_length=8, max_length=4000)


class NeedDraftResponse(BaseModel):
    template_id: str | None = None
    draft: dict
    extracted_skills: list[str] = Field(default_factory=list)
    extracted_specialists: list[str] = Field(default_factory=list)
    inferred_emergency: EmergencyLevel = "non_emergency"
