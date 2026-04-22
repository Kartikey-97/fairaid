import json
import math
import time
from datetime import datetime, timezone
import re
from urllib.error import URLError
from urllib.parse import quote_plus
from urllib.request import Request, urlopen

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile

from backend.api.schemas.need import (
    NeedAuditEntry,
    NeedCreateRequest,
    NeedDraftRequest,
    NeedDraftResponse,
    NeedRecord,
    NeedTemplate,
)
from backend.api.schemas.volunteer import (
    AuthLoginRequest,
    AuthSessionResponse,
    AuthSignupRequest,
    VolunteerDecisionRequest,
    VolunteerDecisionResponse,
    VolunteerFeedRequest,
    VolunteerFeedResponse,
    VolunteerNeedCard,
    VolunteerNotification,
    VolunteerProfile,
    VolunteerRegisterRequest,
)
from backend.core.db import storage
from backend.core.domain import (
    JOB_LIBRARY,
    LANGUAGE_LIBRARY,
    NEED_TYPE_LIBRARY,
    SKILL_LIBRARY,
    SPECIALIST_LIBRARY,
)
from backend.core.ai import analyze_crisis_multimodal, build_dispatch_briefing
from backend.models.need_prediction import SemanticMatcher

from backend.core.matching.allocator import _pair_score        # dynamic score
from backend.core.fairness.optimizer import optimize_fairness  # fairness pass
from backend.core.fairness.objective import evaluate_state     # metrics

router = APIRouter(prefix="/platform", tags=["platform"])
SEMANTIC_MATCHER = SemanticMatcher()
ROUTING_DISABLED_UNTIL = 0.0
ROUTE_CACHE: dict[tuple[float, float, float, float], tuple[float, float | None]] = {}

NEED_TEMPLATES: list[NeedTemplate] = [
    NeedTemplate(
        id="flood-response",
        name="Flood Response",
        description="Emergency response with rescue and medical support needs.",
        defaults={
            "title": "Flood Emergency Response Team",
            "need_type": "rescue-support",
            "job_category": "operations volunteer",
            "emergency_level": "emergency",
            "required_skills": ["disaster response", "first aid", "logistics"],
            "required_specialists": ["disaster-management", "medical"],
            "urgency": 5,
            "impact_level": 5,
            "required_volunteers": 40,
            "emergency_radius_km": 40,
        },
    ),
    NeedTemplate(
        id="medical-camp",
        name="Medical Camp",
        description="General medical camp setup for community support.",
        defaults={
            "title": "Community Medical Camp",
            "need_type": "medical-camp",
            "job_category": "doctor",
            "emergency_level": "non_emergency",
            "required_skills": ["first aid", "medical support", "triage"],
            "required_specialists": ["medical", "public-health"],
            "urgency": 4,
            "impact_level": 5,
            "required_volunteers": 20,
            "emergency_radius_km": 20,
        },
    ),
    NeedTemplate(
        id="food-distribution",
        name="Food Distribution",
        description="Queue management and last-mile meal distribution.",
        defaults={
            "title": "Food Distribution Drive",
            "need_type": "food-distribution",
            "job_category": "operations volunteer",
            "emergency_level": "non_emergency",
            "required_skills": ["food distribution", "crowd management", "logistics"],
            "required_specialists": ["logistics"],
            "urgency": 3,
            "impact_level": 4,
            "required_volunteers": 25,
            "emergency_radius_km": 25,
        },
    ),
    NeedTemplate(
        id="shelter-setup",
        name="Shelter Setup",
        description="Temporary shelter setup and on-ground support.",
        defaults={
            "title": "Shelter Setup and Registration",
            "need_type": "shelter",
            "job_category": "operations volunteer",
            "emergency_level": "non_emergency",
            "required_skills": ["shelter operations", "logistics", "community outreach"],
            "required_specialists": ["logistics"],
            "urgency": 4,
            "impact_level": 4,
            "required_volunteers": 18,
            "emergency_radius_km": 25,
        },
    ),
]

SEVERITY_PRIORITY = {"low": 0, "medium": 1, "high": 2, "critical": 3}


def _clamp01(value: float) -> float:
    if value < 0.0:
        return 0.0
    if value > 1.0:
        return 1.0
    return value


def _skill_overlap(volunteer_terms: list[str], required_terms: list[str]) -> float:
    if not required_terms:
        return 0.0
    volunteer_set = set(volunteer_terms)
    required_set = set(required_terms)
    if not required_set:
        return 0.0
    return len(volunteer_set.intersection(required_set)) / len(required_set)


def _job_match(volunteer: dict, need: dict) -> float:
    volunteer_job = str(volunteer.get("job_title") or "").strip().lower()
    need_job = str(need.get("job_category") or "").strip().lower()
    if not need_job:
        return 0.0
    if volunteer_job and volunteer_job == need_job:
        return 1.0
    return 0.0


def _capability_score(volunteer: dict, need: dict) -> float:
    skill_score = _skill_overlap(volunteer.get("skills", []), need.get("required_skills", []))
    specialist_pool = (
        volunteer.get("specialist_domains", [])
        + volunteer.get("certifications", [])
        + volunteer.get("skills", [])
    )
    specialist_score = _skill_overlap(specialist_pool, need.get("required_specialists", []))
    job_score = _job_match(volunteer, need)
    return max(skill_score, specialist_score, job_score)


def _needs_semantic_text(need: dict) -> str:
    specialist_text = " ".join(need.get("required_specialists", []))
    skills_text = " ".join(need.get("required_skills", []))
    return f"{need['title']} {need['description']} {need['need_type']} {skills_text} {specialist_text}".strip()


def _volunteer_semantic_text(volunteer: dict) -> str:
    return " ".join(
        [
            volunteer.get("name", ""),
            " ".join(volunteer.get("skills", [])),
            " ".join(volunteer.get("specialist_domains", [])),
            " ".join(volunteer.get("certifications", [])),
            " ".join(volunteer.get("preferred_need_types", [])),
        ]
    ).strip()


def _haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371.0  # Earth radius in kilometers
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c


def _route_info(volunteer: dict, need: dict) -> tuple[float, float | None]:
    global ROUTING_DISABLED_UNTIL
    v_loc = volunteer.get("location") or {}
    n_loc = need.get("location") or {}
    
    v_lat, v_lng = v_loc.get("lat"), v_loc.get("lng")
    n_lat, n_lng = n_loc.get("lat"), n_loc.get("lng")
    
    if v_lat is None or v_lng is None or n_lat is None or n_lng is None:
        return 9999.0, None

    cache_key = (
        round(float(v_lat), 4),
        round(float(v_lng), 4),
        round(float(n_lat), 4),
        round(float(n_lng), 4),
    )
    cached = ROUTE_CACHE.get(cache_key)
    if cached is not None:
        return cached

    if time.time() < ROUTING_DISABLED_UNTIL:
        fallback = _haversine(float(v_lat), float(v_lng), float(n_lat), float(n_lng)), None
        ROUTE_CACHE[cache_key] = fallback
        return fallback
        
    try:
        # Fetch actual driving distance using free OSRM API
        url = f"http://router.project-osrm.org/route/v1/driving/{v_lng},{v_lat};{n_lng},{n_lat}?overview=false"
        req = Request(url, headers={"User-Agent": "FairAid/1.0"})
        with urlopen(req, timeout=0.9) as response:
            data = json.loads(response.read().decode("utf-8"))
            if data.get("code") == "Ok" and len(data.get("routes", [])) > 0:
                route = data["routes"][0]
                resolved = float(route["distance"]) / 1000.0, float(route["duration"]) / 60.0
                ROUTE_CACHE[cache_key] = resolved
                return resolved
    except Exception:
        ROUTING_DISABLED_UNTIL = time.time() + 120

    fallback = _haversine(float(v_lat), float(v_lng), float(n_lat), float(n_lng)), None
    ROUTE_CACHE[cache_key] = fallback
    return fallback


def _distance_km(volunteer: dict, need: dict) -> float:
    return _route_info(volunteer, need)[0]


def _distance_limit_km(volunteer: dict, need: dict) -> float:
    volunteer_limit = float(volunteer.get("radius_km", 25.0))
    if need.get("emergency_level") == "emergency":
        return max(1.0, min(volunteer_limit, float(need.get("emergency_radius_km", 25.0))))
    return max(1.0, volunteer_limit)


def _within_emergency_radius(volunteer: dict, need: dict) -> bool:
    distance_km = _distance_km(volunteer, need)
    radius_limit = min(
        float(volunteer.get("radius_km", 25.0)),
        float(need.get("emergency_radius_km", 25.0)),
    )
    return distance_km <= radius_limit


def _parse_iso_time(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _needs_time_conflict(need_a: dict, need_b: dict) -> bool:
    start_a = _parse_iso_time(need_a.get("start_time"))
    end_a = _parse_iso_time(need_a.get("end_time"))
    start_b = _parse_iso_time(need_b.get("start_time"))
    end_b = _parse_iso_time(need_b.get("end_time"))
    if not start_a or not end_a or not start_b or not end_b:
        return False
    return start_a < end_b and start_b < end_a


def _accepted_needs_for_volunteer(volunteer_id: str) -> list[dict]:
    accepted: list[dict] = []
    for need in storage.list_needs(status=None):
        if storage.get_volunteer_decision(need["id"], volunteer_id) == "accepted":
            accepted.append(need)
    return accepted


def _geocode_address(address: str) -> dict | None:
    fallback_cities = {
        "ghaziabad": (28.6692, 77.4538),
        "noida": (28.5355, 77.3910),
        "new delhi": (28.6139, 77.2090),
        "delhi": (28.6139, 77.2090),
        "gurugram": (28.4595, 77.0266),
        "gurgaon": (28.4595, 77.0266),
        "faridabad": (28.4089, 77.3178),
    }
    normalized = address.strip().lower()
    for city, point in fallback_cities.items():
        if city in normalized:
            lat, lng = point
            return {"lat": lat, "lng": lng, "display_name": city.title()}

    encoded = quote_plus(address)
    url = (
        "https://nominatim.openstreetmap.org/search"
        f"?format=json&limit=1&q={encoded}"
    )
    request = Request(
        url,
        headers={
            "User-Agent": "FairAid/1.0 (contact: local-dev)",
            "Accept": "application/json",
        },
    )
    try:
        with urlopen(request, timeout=6) as response:
            payload = response.read().decode("utf-8")
    except (URLError, TimeoutError, ValueError):
        return None

    try:
        parsed = json.loads(payload)
    except json.JSONDecodeError:
        return None
    if not isinstance(parsed, list) or not parsed:
        return None
    top = parsed[0]
    try:
        lat = float(top.get("lat"))
        lng = float(top.get("lon"))
    except (TypeError, ValueError):
        return None
    return {
        "lat": lat,
        "lng": lng,
        "display_name": top.get("display_name"),
    }


def _reverse_geocode(lat: float, lng: float) -> dict | None:
    url = (
        "https://nominatim.openstreetmap.org/reverse"
        f"?format=jsonv2&lat={lat}&lon={lng}"
    )
    request = Request(
        url,
        headers={
            "User-Agent": "FairAid/1.0 (contact: local-dev)",
            "Accept": "application/json",
        },
    )
    try:
        with urlopen(request, timeout=6) as response:
            payload = response.read().decode("utf-8")
    except (URLError, TimeoutError, ValueError):
        return None

    try:
        parsed = json.loads(payload)
    except json.JSONDecodeError:
        return None
    if not isinstance(parsed, dict):
        return None
    return {"display_name": parsed.get("display_name")}


def _suggest_geocode(query: str, limit: int = 5) -> list[dict]:
    fallback = [
        {"lat": 28.6692, "lng": 77.4538, "display_name": "Ghaziabad"},
        {"lat": 28.5355, "lng": 77.3910, "display_name": "Noida"},
        {"lat": 28.6139, "lng": 77.2090, "display_name": "New Delhi"},
        {"lat": 28.4595, "lng": 77.0266, "display_name": "Gurugram"},
    ]
    normalized = query.strip().lower()
    if not normalized:
        return []

    url = (
        "https://nominatim.openstreetmap.org/search"
        f"?format=json&limit={limit}&q={quote_plus(query)}"
    )
    request = Request(
        url,
        headers={
            "User-Agent": "FairAid/1.0 (contact: local-dev)",
            "Accept": "application/json",
        },
    )
    try:
        with urlopen(request, timeout=6) as response:
            payload = response.read().decode("utf-8")
        parsed = json.loads(payload)
        if isinstance(parsed, list):
            suggestions: list[dict] = []
            for item in parsed[:limit]:
                try:
                    suggestions.append(
                        {
                            "lat": float(item.get("lat")),
                            "lng": float(item.get("lon")),
                            "display_name": str(item.get("display_name") or ""),
                        }
                    )
                except (TypeError, ValueError):
                    continue
            if suggestions:
                return suggestions
    except (URLError, TimeoutError, ValueError, json.JSONDecodeError):
        pass

    return [item for item in fallback if normalized in item["display_name"].lower()][:limit]


def _extract_keywords(text: str, choices: list[str]) -> list[str]:
    lowered = text.lower()
    hits: list[str] = []
    for choice in choices:
        token = choice.lower()
        if token in lowered:
            hits.append(choice)
    return hits


def _normalize_severity(value: str) -> str:
    lowered = (value or "").strip().lower()
    if lowered in {"low", "medium", "high", "critical"}:
        return lowered
    return "medium"


def _dispatch_score(volunteer: dict, need: dict) -> float:
    """
    Replace the old fixed-weight score (0.5 distance + 0.35 capability + 0.15
    semantic) with a principled, urgency-aware version.
 
    Weights are derived from the need's urgency level and emergency status
    rather than being hardcoded constants:
 
      Emergency / urgency=5  →  60% distance, 30% capability, 10% semantic
      Urgency=4              →  45% distance, 40% capability, 15% semantic
      High impact            →  30% distance, 50% capability, 20% semantic
      Routine                →  25% distance, 55% capability, 20% semantic
 
    Uses the same _pair_score helper as the allocator so both code paths are
    consistent.
    """
    # Import here to avoid circular import; in production move to module top.
    from backend.core.matching.allocator import _pair_score as _compute_pair_score
    return _compute_pair_score(volunteer, need)
 


def _draft_need_from_text(text: str) -> NeedDraftResponse:
    lowered = text.lower()
    template_id = None
    inferred_emergency = "non_emergency"
    draft = {}

    # 1. Attempt to use local Ollama LLM for smart extraction
    try:
        prompt = (
            "You are an AI for disaster response. Analyze the following text and extract needs into JSON format.\n"
            "Valid template_id values: 'flood-response', 'medical-camp', 'food-distribution', 'shelter-setup'. If none fit perfectly, use null.\n"
            "Valid emergency_level: 'emergency', 'non_emergency'.\n"
            f"Text: {text}"
        )
        req = Request(
            "http://localhost:11434/api/generate",
            data=json.dumps({
                "model": "llama3", # Change this to whatever model you have pulled in Ollama (e.g., mistral, phi3)
                "prompt": prompt,
                "format": "json",
                "stream": False
            }).encode("utf-8"),
            headers={"Content-Type": "application/json"}
        )
        with urlopen(req, timeout=10) as response:
            payload = json.loads(response.read().decode("utf-8"))
            llm_data = json.loads(payload.get("response", "{}"))

        template_id = llm_data.get("template_id")
        if template_id not in ["flood-response", "medical-camp", "food-distribution", "shelter-setup"]:
            template_id = None
        
        inferred_emergency = llm_data.get("emergency_level", "non_emergency")
        if llm_data.get("job_category"):
            draft["job_category"] = llm_data.get("job_category")
        if llm_data.get("required_volunteers"):
            try:
                draft["required_volunteers"] = int(llm_data.get("required_volunteers"))
            except (ValueError, TypeError):
                pass
    except Exception as e:
        # 2. Fallback to keyword matching if Ollama is not running
        if any(word in lowered for word in ["flood", "evacuation", "rescue", "boat"]):
            template_id = "flood-response"
        elif any(word in lowered for word in ["medical", "doctor", "clinic", "triage"]):
            template_id = "medical-camp"
        elif any(word in lowered for word in ["food", "ration", "meal", "kitchen"]):
            template_id = "food-distribution"
        elif any(word in lowered for word in ["shelter", "camp", "tent"]):
            template_id = "shelter-setup"

        inferred_emergency = "emergency" if any(
            word in lowered for word in ["urgent", "emergency", "critical", "flood", "earthquake"]
        ) else "non_emergency"

        if "doctor" in lowered and "job_category" not in draft:
            draft["job_category"] = "doctor"
        elif "nurse" in lowered and "job_category" not in draft:
            draft["job_category"] = "nurse"

        match = re.search(r"(\d{1,4})\s+(volunteer|volunteers|people|helpers)", lowered)
        if match:
            try:
                draft["required_volunteers"] = max(1, int(match.group(1)))
            except ValueError:
                pass

    # Merge inferred draft with template defaults
    selected_template = next((item for item in NEED_TEMPLATES if item.id == template_id), None)
    base_draft = dict(selected_template.defaults if selected_template else {})
    base_draft.update(draft)
    base_draft["emergency_level"] = inferred_emergency

    # Extract exact keywords from libraries
    extracted_skills = _extract_keywords(text, SKILL_LIBRARY)
    extracted_specialists = _extract_keywords(text, SPECIALIST_LIBRARY)
    if extracted_skills:
        base_draft["required_skills"] = extracted_skills[:6]
    if extracted_specialists:
        base_draft["required_specialists"] = extracted_specialists[:4]

    return NeedDraftResponse(
        template_id=template_id,
        draft=base_draft,
        extracted_skills=extracted_skills,
        extracted_specialists=extracted_specialists,
        inferred_emergency=inferred_emergency,
    )


def _embedding_for(entity_type: str, entity_id: str, text: str) -> list[float]:
    cached = storage.get_embedding(entity_type, entity_id)
    if cached is not None:
        return cached

    vector = SEMANTIC_MATCHER.embed(text)
    storage.upsert_embedding(entity_type, entity_id, vector)
    return vector


def _build_recommendation_card(volunteer: dict, need: dict) -> VolunteerNeedCard:
    distance_km, duration_mins = _route_info(volunteer, need)
    distance_limit = _distance_limit_km(volunteer, need)
    distance_norm = _clamp01(distance_km / distance_limit)
    distance_priority = 1.0 - distance_norm
    within_distance = distance_km <= distance_limit

    skill_score = _skill_overlap(volunteer.get("skills", []), need.get("required_skills", []))
    specialist_pool = (
        volunteer.get("specialist_domains", [])
        + volunteer.get("certifications", [])
        + volunteer.get("skills", [])
    )
    specialist_score = _skill_overlap(specialist_pool, need.get("required_specialists", []))
    job_score = _job_match(volunteer, need)
    capability_score = _capability_score(volunteer, need)

    volunteer_vector = _embedding_for(
        "volunteer",
        volunteer["id"],
        _volunteer_semantic_text(volunteer),
    )
    need_vector = _embedding_for(
        "need",
        need["id"],
        _needs_semantic_text(need),
    )
    semantic_score = SEMANTIC_MATCHER.cosine_similarity(volunteer_vector, need_vector)

    recommendation_score = 0.0
    if within_distance:
        recommendation_score = (
            0.55 * distance_priority
            + 0.25 * max(skill_score, specialist_score)
            + 0.15 * job_score
            + 0.05 * semantic_score
        )
    recommendation_score = _clamp01(recommendation_score)

    reasons: list[str] = []
    if duration_mins is not None:
        reasons.append(f"{int(duration_mins)} min drive ETA")
    if within_distance:
        reasons.append("Within your response radius")
    else:
        reasons.append("Outside your response radius")
    if skill_score >= 0.5:
        reasons.append("Strong skill overlap")
    if specialist_score >= 0.5:
        reasons.append("Specialist fit")
    if job_score >= 1.0:
        reasons.append("Job category match")
    if distance_norm <= 0.4:
        reasons.append("Nearby and feasible")
    if need.get("emergency_level") == "emergency":
        reasons.append("Emergency priority")
    if semantic_score >= 0.35:
        reasons.append("Semantic profile match")
    if not reasons:
        reasons.append("General availability fit")

    decision = storage.get_volunteer_decision(need["id"], volunteer["id"])
    trust_badges: list[str] = []
    if volunteer.get("license_verified") and volunteer.get("job_title") in {"doctor", "nurse", "paramedic"}:
        trust_badges.append("Verified medical license")
    if volunteer.get("job_title") in {"doctor", "nurse"}:
        trust_badges.append("Medical specialist")

    return VolunteerNeedCard(
        need_id=need["id"],
        title=need["title"],
        ngo_name=need["ngo_name"],
        need_type=need["need_type"],
        job_category=need.get("job_category"),
        emergency_level=need["emergency_level"],
        need_location=need.get("location"),
        need_address=need.get("address"),
        required_volunteers=int(need.get("required_volunteers", 0)),
        currently_assigned=int(need.get("accepted_count", 0)),
        required_skills=need.get("required_skills", []),
        required_specialists=need.get("required_specialists", []),
        distance_km=round(distance_km, 2),
        distance_limit_km=round(distance_limit, 2),
        within_distance=within_distance,
        capability_score=round(capability_score, 4),
        recommendation_score=round(recommendation_score, 4),
        score_breakdown={
            "semantic": round(semantic_score, 4),
            "skill": round(skill_score, 4),
            "specialist": round(specialist_score, 4),
            "job_match": round(job_score, 4),
            "distance_priority": round(distance_priority, 4),
        },
        trust_badges=trust_badges,
        matching_reasons=reasons,
        accepted_count=int(need.get("accepted_count", 0)),
        interested_count=int(need.get("interested_count", 0)),
        declined_count=int(need.get("declined_count", 0)),
        user_decision=decision,
        shift_start=need.get("start_time"),
        shift_end=need.get("end_time"),
    )


def _compute_emergency_notifications(need: dict) -> list[str]:
    candidates: list[tuple[float, float, float, str]] = []
    for volunteer in storage.list_volunteers():
        if not volunteer.get("can_handle_emergency", False):
            continue
        if not _within_emergency_radius(volunteer, need):
            continue

        distance_km = _distance_km(volunteer, need)
        specialist_score = _skill_overlap(
            volunteer.get("specialist_domains", [])
            + volunteer.get("certifications", [])
            + volunteer.get("skills", []),
            need.get("required_specialists", []),
        )
        skill_score = _skill_overlap(
            volunteer.get("skills", []),
            need.get("required_skills", []),
        )

        candidates.append((-specialist_score, -skill_score, distance_km, volunteer["id"]))

    candidates.sort()
    return [candidate[3] for candidate in candidates[:100]]


def _dispatch_emergency_notifications(need: dict, volunteer_ids: list[str]) -> None:
    for volunteer_id in volunteer_ids:
        volunteer = storage.get_volunteer(volunteer_id)
        if volunteer is None:
            continue
        channels = ["web"]
        if volunteer.get("phone"):
            channels.append("sms")
        if volunteer.get("email"):
            channels.append("email")
        storage.create_notification(
            volunteer_id=volunteer_id,
            need_id=need["id"],
            title=f"Emergency alert: {need['title']}",
            message=(
                f"{need['ngo_name']} requested immediate help near {need.get('address') or 'your area'}."
            ),
            channels=channels,
            status="sent",
        )


@router.post("/auth/signup", response_model=AuthSessionResponse)
def signup(payload: AuthSignupRequest) -> AuthSessionResponse:
    try:
        user = storage.create_user(
            name=payload.name,
            email=payload.email,
            password=payload.password,
            role=payload.role,
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    return AuthSessionResponse(
        user_id=user["id"],
        role=user["role"],
        name=user["name"],
        email=user["email"],
        volunteer_id=None,
        ngo_id=user["id"] if user["role"] == "ngo" else None,
    )


@router.post("/auth/login", response_model=AuthSessionResponse)
def login(payload: AuthLoginRequest) -> AuthSessionResponse:
    user = storage.authenticate_user(payload.email, payload.password, payload.role)
    if user is None:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    volunteer_profile = storage.get_volunteer_by_user(user["id"])

    return AuthSessionResponse(
        user_id=user["id"],
        role=user["role"],
        name=user["name"],
        email=user["email"],
        volunteer_id=volunteer_profile["id"] if volunteer_profile else None,
        ngo_id=user["id"] if user["role"] == "ngo" else None,
    )


@router.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "service": "fairaid-platform",
        "db": storage.database_runtime_info(),
    }


@router.post("/volunteers/register", response_model=VolunteerProfile)
def register_volunteer(payload: VolunteerRegisterRequest) -> VolunteerProfile:
    existing_profile = None
    if payload.user_id:
        user = storage.get_user(payload.user_id)
        if user is None or user.get("role") != "volunteer":
            raise HTTPException(status_code=400, detail="Invalid volunteer user")
        existing_profile = storage.get_volunteer_by_user(payload.user_id)

    normalized_payload = payload.model_dump()
    if normalized_payload.get("license_verified") and not (
        existing_profile and existing_profile.get("license_verified")
    ):
        # Volunteers cannot self-mark verification; keep unverified until admin flow is added.
        normalized_payload["license_verified"] = False

    profile = storage.upsert_volunteer(normalized_payload)
    _embedding_for("volunteer", profile["id"], _volunteer_semantic_text(profile))
    return VolunteerProfile(**profile)


@router.get("/volunteers/by-user/{user_id}", response_model=VolunteerProfile)
def get_volunteer_by_user(user_id: str) -> VolunteerProfile:
    profile = storage.get_volunteer_by_user(user_id)
    if profile is None:
        raise HTTPException(status_code=404, detail="Volunteer profile not found")
    return VolunteerProfile(**profile)


@router.get("/volunteers", response_model=list[VolunteerProfile])
def list_volunteers() -> list[VolunteerProfile]:
    return [VolunteerProfile(**item) for item in storage.list_volunteers()]


@router.post("/ngo/needs", response_model=NeedRecord)
def create_need(payload: NeedCreateRequest) -> NeedRecord:
    ngo_user = storage.get_user(payload.ngo_id)
    if ngo_user is None or ngo_user.get("role") != "ngo":
        raise HTTPException(status_code=400, detail="Invalid NGO account")

    record = storage.create_need(payload.model_dump())
    _embedding_for("need", record["id"], _needs_semantic_text(record))
    storage.add_need_audit_log(
        need_id=record["id"],
        action="need_created",
        actor_id=payload.ngo_id,
        actor_role="ngo",
        details={
            "title": record["title"],
            "need_type": record["need_type"],
            "emergency_level": record["emergency_level"],
            "required_volunteers": record["required_volunteers"],
        },
    )

    if record.get("emergency_level") == "emergency":
        notified_ids = _compute_emergency_notifications(record)
        storage.update_need_notifications(record["id"], notified_ids)
        _dispatch_emergency_notifications(record, notified_ids)
        storage.add_need_audit_log(
            need_id=record["id"],
            action="emergency_notifications_sent",
            actor_id=payload.ngo_id,
            actor_role="ngo",
            details={"notified_volunteers": len(notified_ids)},
        )
        updated_record = storage.get_need(record["id"])
        if updated_record is not None:
            record = updated_record

    return NeedRecord(**record)


@router.delete("/ngo/{ngo_id}/needs/{need_id}")
def delete_need(ngo_id: str, need_id: str) -> dict:
    removed = storage.delete_need(ngo_id=ngo_id, need_id=need_id)
    if not removed:
        raise HTTPException(status_code=404, detail="Need not found for this NGO")
    storage.add_need_audit_log(
        need_id=need_id,
        action="need_closed",
        actor_id=ngo_id,
        actor_role="ngo",
        details={"status": "closed"},
    )
    return {"status": "deleted", "need_id": need_id}


@router.get("/ngo/{ngo_id}/needs", response_model=list[NeedRecord])
def list_ngo_needs(ngo_id: str) -> list[NeedRecord]:
    return [NeedRecord(**item) for item in storage.list_ngo_needs(ngo_id)]


@router.get("/needs", response_model=list[NeedRecord])
def list_needs(
    emergency_only: bool = Query(default=False),
    status: str | None = Query(default="open"),
) -> list[NeedRecord]:
    return [
        NeedRecord(**item)
        for item in storage.list_needs(status=status, emergency_only=emergency_only)
    ]


@router.get("/catalog")
def get_catalog() -> dict:
    return {
        "skills": SKILL_LIBRARY,
        "jobs": JOB_LIBRARY,
        "need_types": NEED_TYPE_LIBRARY,
        "specialists": SPECIALIST_LIBRARY,
        "languages": LANGUAGE_LIBRARY,
    }


@router.get("/ngo/templates", response_model=list[NeedTemplate])
def list_need_templates() -> list[NeedTemplate]:
    return NEED_TEMPLATES


@router.post("/ngo/draft-from-text", response_model=NeedDraftResponse)
def draft_need(payload: NeedDraftRequest) -> NeedDraftResponse:
    return _draft_need_from_text(payload.text)


@router.get("/geocode")
def geocode(address: str = Query(min_length=2, max_length=300)) -> dict:
    result = _geocode_address(address)
    if result is None:
        raise HTTPException(status_code=404, detail="Could not locate this address")
    return result


@router.get("/geocode-suggest")
def geocode_suggest(query: str = Query(min_length=2, max_length=200)) -> list[dict]:
    return _suggest_geocode(query=query, limit=6)


@router.get("/reverse-geocode")
def reverse_geocode(lat: float, lng: float) -> dict:
    result = _reverse_geocode(lat, lng)
    if result is None:
        raise HTTPException(status_code=404, detail="Could not resolve this location")
    return result


@router.get("/needs/{need_id}/audit", response_model=list[NeedAuditEntry])
def get_need_audit(need_id: str) -> list[NeedAuditEntry]:
    need = storage.get_need(need_id)
    if need is None:
        raise HTTPException(status_code=404, detail="Need not found")
    return [NeedAuditEntry(**item) for item in storage.list_need_audit_logs(need_id)]


@router.post(
    "/volunteers/{volunteer_id}/needs/{need_id}/decision",
    response_model=VolunteerDecisionResponse,
)
def set_volunteer_decision(
    volunteer_id: str,
    need_id: str,
    payload: VolunteerDecisionRequest,
) -> VolunteerDecisionResponse:
    volunteer = storage.get_volunteer(volunteer_id)
    if volunteer is None:
        raise HTTPException(status_code=404, detail="Volunteer not found")

    need = storage.get_need(need_id)
    if need is None:
        raise HTTPException(status_code=404, detail="Need not found")

    current_decision = storage.get_volunteer_decision(need_id, volunteer_id)
    if payload.decision == "accepted":
        distance_km = _distance_km(volunteer, need)
        distance_limit_km = _distance_limit_km(volunteer, need)
        if distance_km > distance_limit_km:
            raise HTTPException(
                status_code=400,
                detail=f"Task is outside your response radius ({distance_km:.1f} km > {distance_limit_km:.1f} km).",
            )

        has_constraints = bool(
            need.get("required_skills")
            or need.get("required_specialists")
            or need.get("job_category")
        )
        capability = _capability_score(volunteer, need)
        if has_constraints and capability <= 0.0:
            raise HTTPException(
                status_code=400,
                detail="Your profile does not match the required skills/specialization for this task.",
            )

        if current_decision != "accepted":
            current_accepted = int(need.get("accepted_count", 0))
            required = int(need.get("required_volunteers", 0))
            if current_accepted >= required:
                raise HTTPException(status_code=409, detail="This task is already full.")

        for accepted_need in _accepted_needs_for_volunteer(volunteer_id):
            if accepted_need["id"] == need_id:
                continue
            if _needs_time_conflict(need, accepted_need):
                raise HTTPException(
                    status_code=409,
                    detail=(
                        "This shift overlaps with another task you already committed to: "
                        f"{accepted_need.get('title', accepted_need['id'])}."
                    ),
                )

    counts = storage.upsert_application(
        need_id=need_id,
        volunteer_id=volunteer_id,
        decision=payload.decision,
        note=payload.note,
    )
    storage.add_need_audit_log(
        need_id=need_id,
        action="volunteer_decision_updated",
        actor_id=volunteer_id,
        actor_role="volunteer",
        details={
            "decision": payload.decision,
            "accepted_count": int(counts.get("accepted_count", 0)),
            "interested_count": int(counts.get("interested_count", 0)),
            "declined_count": int(counts.get("declined_count", 0)),
        },
    )

    return VolunteerDecisionResponse(
        volunteer_id=volunteer_id,
        need_id=need_id,
        decision=payload.decision,
        accepted_count=int(counts.get("accepted_count", 0)),
        interested_count=int(counts.get("interested_count", 0)),
        declined_count=int(counts.get("declined_count", 0)),
    )


@router.get(
    "/volunteers/{volunteer_id}/notifications",
    response_model=list[VolunteerNotification],
)
def get_volunteer_notifications(
    volunteer_id: str,
    unread_only: bool = Query(default=True),
) -> list[VolunteerNotification]:
    volunteer = storage.get_volunteer(volunteer_id)
    if volunteer is None:
        raise HTTPException(status_code=404, detail="Volunteer not found")
    return [
        VolunteerNotification(**item)
        for item in storage.list_volunteer_notifications(volunteer_id, unread_only=unread_only)
    ]


@router.post("/volunteers/{volunteer_id}/notifications/{notification_id}/read")
def mark_notification_read(volunteer_id: str, notification_id: str) -> dict:
    updated = storage.mark_notification_read(notification_id, volunteer_id)
    if not updated:
        raise HTTPException(status_code=404, detail="Notification not found")
    return {"status": "read", "notification_id": notification_id}


@router.post("/volunteers/{volunteer_id}/feed", response_model=VolunteerFeedResponse)
def get_volunteer_feed(
    volunteer_id: str,
    payload: VolunteerFeedRequest,
) -> VolunteerFeedResponse:
    volunteer = storage.get_volunteer(volunteer_id)
    if volunteer is None:
        raise HTTPException(status_code=404, detail="Volunteer not found")

    open_needs = storage.list_needs(status="open")
    cards = [_build_recommendation_card(volunteer, need) for need in open_needs]

    cards.sort(
        key=lambda card: (
            1 if card.within_distance else 0,
            card.capability_score,
            1 if card.emergency_level == "emergency" else 0,
            card.recommendation_score,
            -card.distance_km if card.within_distance else 0.0,
        ),
        reverse=True,
    )

    emergency_cards: list[VolunteerNeedCard] = []
    for card in cards:
        if card.emergency_level != "emergency":
            continue
        need_record = storage.get_need(card.need_id)
        if need_record is None:
            continue
        if not _within_emergency_radius(volunteer, need_record):
            continue
        emergency_cards.append(card)
        if len(emergency_cards) >= payload.limit:
            break

    recommended_cards = cards[: payload.limit]
    recommended_cards = [
        card
        for card in cards
        if card.within_distance and (card.capability_score > 0.0 or card.recommendation_score >= 0.5)
    ][: payload.limit]
    all_cards = (
        cards[: payload.limit]
        if payload.include_non_emergency
        else emergency_cards
    )
    
    # Hackathon Fix: Always show all tasks in the feed regardless of strict API flags
    all_cards = cards[: payload.limit]

    return VolunteerFeedResponse(
        volunteer_id=volunteer_id,
        emergency=emergency_cards,
        recommended=recommended_cards,
        all=all_cards,
    )

#ADDED by gemini 
@router.get("/insights/hotspots")
def get_hotspots() -> dict:
    """
    Aggregates open needs to clearly show the most urgent problems, 
    directly addressing the 'see the biggest problems clearly' objective.
    """
    open_needs = storage.list_needs(status="open")
    category_counts: dict[str, dict] = {}
    total_needed = 0
    total_assigned = 0

    for need in open_needs:
        cat = str(need.get("need_type", "unknown"))
        if cat not in category_counts:
            category_counts[cat] = {"count": 0, "required_volunteers": 0, "accepted_volunteers": 0}
        
        category_counts[cat]["count"] += 1
        req = int(need.get("required_volunteers", 0))
        acc = int(need.get("accepted_count", 0))
        
        category_counts[cat]["required_volunteers"] += req
        category_counts[cat]["accepted_volunteers"] += acc
        total_needed += req
        total_assigned += acc

    # Include multimodal field intelligence signals so urgent zones appear quickly
    # even before NGO operators complete manual request entries.
    for report in storage.list_field_reports(limit=80):
        categories = report.get("categories") or []
        if not categories:
            categories = ["community-support"]
        report_required = int(report.get("required_volunteers_estimate", 0) or 0)
        for category in categories[:3]:
            cat = str(category or "community-support")
            if cat not in category_counts:
                category_counts[cat] = {"count": 0, "required_volunteers": 0, "accepted_volunteers": 0}
            category_counts[cat]["count"] += 1
            category_counts[cat]["required_volunteers"] += report_required
            total_needed += report_required

    urgent_categories = sorted(
        [{"category": k, **v} for k, v in category_counts.items()],
        key=lambda x: int(x["required_volunteers"]) - int(x["accepted_volunteers"]),
        reverse=True
    )

    return {
        "total_open_needs": len(open_needs),
        "total_volunteers_needed": total_needed,
        "total_volunteers_assigned": total_assigned,
        "urgent_categories": urgent_categories,
    }


@router.post("/field-intel/report")
async def create_field_intel_report(
    volunteer_id: str = Form(...),
    notes: str = Form(default=""),
    address: str | None = Form(default=None),
    lat: float | None = Form(default=None),
    lng: float | None = Form(default=None),
    image_file: UploadFile | None = File(default=None),
    audio_file: UploadFile | None = File(default=None),
) -> dict:
    volunteer = storage.get_volunteer(volunteer_id)
    if volunteer is None:
        raise HTTPException(status_code=404, detail="Volunteer not found")

    image_bytes = await image_file.read() if image_file else None
    audio_bytes = await audio_file.read() if audio_file else None
    image_mime = image_file.content_type if image_file else None
    audio_mime = audio_file.content_type if audio_file else None

    analysis = analyze_crisis_multimodal(
        notes=notes or "No text notes provided.",
        image_bytes=image_bytes,
        image_mime=image_mime,
        audio_bytes=audio_bytes,
        audio_mime=audio_mime,
    )

    location = None
    if lat is not None and lng is not None:
        location = {"lat": float(lat), "lng": float(lng)}

    report = storage.create_field_report(
        {
            "volunteer_id": volunteer_id,
            "summary": analysis.get("summary", ""),
            "severity": _normalize_severity(str(analysis.get("severity", "medium"))),
            "categories": analysis.get("categories", []),
            "supply_needs": analysis.get("supply_needs", []),
            "people_count_estimate": analysis.get("people_count_estimate", 0),
            "required_volunteers_estimate": analysis.get("required_volunteers_estimate", 0),
            "location": location,
            "address": address or volunteer.get("address"),
            "raw_audio_text": notes,
            "image_hint": analysis.get("image_hint"),
        }
    )

    return {
        "status": "created",
        "report": report,
        "analysis_engine": analysis.get("analysis_engine", "keyword-fallback"),
        "hotspot_refresh_hint": True,
    }


@router.get("/field-intel/reports")
def list_field_intel_reports(limit: int = Query(default=25, ge=1, le=100)) -> dict:
    reports = storage.list_field_reports(limit=limit)
    return {"reports": reports}


@router.post("/ngo/{ngo_id}/needs/{need_id}/autonomous-dispatch")
def autonomous_dispatch_improved(ngo_id: str, need_id: str) -> dict:
    """
    Drop-in replacement for the autonomous_dispatch endpoint handler.
 
    Wire it up in platform.py like this:
 
        @router.post("/ngo/{ngo_id}/needs/{need_id}/autonomous-dispatch")
        def autonomous_dispatch(ngo_id: str, need_id: str) -> dict:
            return autonomous_dispatch_improved(ngo_id, need_id)
    """
    from fastapi import HTTPException
    from backend.core.pipeline.run_allocation import run_allocation as pipeline_run
    from backend.core.ai import build_dispatch_briefing
 
    need = storage.get_need(need_id)
    if need is None or need.get("ngo_id") != ngo_id:
        raise HTTPException(status_code=404, detail="Need not found or access denied.")
 
    required = int(need.get("required_volunteers", 0))
    accepted = int(need.get("accepted_count", 0))
    remaining_slots = max(0, required - accepted)
 
    if remaining_slots <= 0:
        return {
            "status": "no_action",
            "message": "Need is already fully staffed.",
            "need_id": need_id,
            "remaining_slots": 0,
        }
 
    # ── Analyst: profile the need ────────────────────────────────────────────
    analyst_profile = {
        "required_skills": need.get("required_skills", []),
        "required_specialists": need.get("required_specialists", []),
        "job_category": need.get("job_category"),
        "emergency_level": need.get("emergency_level"),
        "remaining_slots": remaining_slots,
    }
 
    # ── Collect candidate volunteers ─────────────────────────────────────────
    raw_volunteers: list[dict] = []
    for volunteer in storage.list_volunteers():
        if need.get("emergency_level") == "emergency" and not volunteer.get("can_handle_emergency", True):
            continue
 
        distance_km = _distance_km(volunteer, need)
        distance_limit = _distance_limit_km(volunteer, need)
        if distance_km > distance_limit:
            continue
 
        capability = _capability_score(volunteer, need)
        has_constraints = bool(
            need.get("required_skills") or need.get("required_specialists") or need.get("job_category")
        )
        if has_constraints and capability <= 0.0:
            continue
 
        has_conflict = any(
            _needs_time_conflict(need, an)
            for an in _accepted_needs_for_volunteer(volunteer["id"])
            if an["id"] != need_id
        )
        if has_conflict:
            continue
 
        raw_volunteers.append(volunteer)
 
    if not raw_volunteers:
        return {
            "status": "no_action",
            "message": "No eligible volunteers found within constraints.",
            "need_id": need_id,
            "remaining_slots": remaining_slots,
            "analyst": analyst_profile,
        }
 
    # ── Run Hungarian allocation on the target need + all other open needs ───
    # This ensures the fairness pass has the full picture, not just one need.
    all_open_needs = storage.list_needs(status="open")
 
    # Shape needs for the allocator (it expects "required" and "skills_required")
    def _shape_need(n: dict) -> dict:
        return {
            **n,
            "required": int(n.get("required_volunteers", 1)) - int(n.get("accepted_count", 0)),
            "skills_required": n.get("required_skills", []),
            "is_critical": bool(n.get("is_critical", False)),
        }
 
    shaped_needs = [_shape_need(n) for n in all_open_needs if int(n.get("required_volunteers", 1)) - int(n.get("accepted_count", 0)) > 0]
    shaped_volunteers = [
        {
            **v,
            "availability": True,
            "max_travel_km": float(v.get("radius_km", 25)),
        }
        for v in raw_volunteers
    ]
 
    # Use the full pipeline (Hungarian + fairness optimizer at lambda=0.5)
    pipeline_result = pipeline_run(shaped_volunteers, shaped_needs)
    # lambda=0.5 balances efficiency and fairness
    best_state = pipeline_result["states"].get("0.5") or pipeline_result["states"].get("0")
 
    # ── Extract volunteers assigned to THIS need ──────────────────────────────
    target_state_need = next(
        (n for n in (best_state.get("needs") or []) if str(n.get("id")) == need_id),
        None,
    )
    assigned_vol_ids: list[str] = list(target_state_need.get("assigned_volunteers", [])) if target_state_need else []
 
    # Build the selected candidate list with metadata for the communicator
    selected: list[dict] = []
    for vol_id in assigned_vol_ids[:remaining_slots]:
        vol = storage.get_volunteer(vol_id)
        if vol is None:
            continue
        score = _dispatch_score(vol, need)
        selected.append({
            "id": vol_id,
            "name": vol.get("name"),
            "distance_km": round(_distance_km(vol, need), 2),
            "capability": round(_capability_score(vol, need), 4),
            "dispatch_score": round(score, 4),
            "job_title": vol.get("job_title"),
            "email": vol.get("email"),
            "phone": vol.get("phone"),
        })
 
    # Fallback: if pipeline assigned nothing, fall back to greedy top-K
    if not selected:
        scored_candidates = sorted(
            [
                {
                    "id": v["id"],
                    "name": v.get("name"),
                    "distance_km": round(_distance_km(v, need), 2),
                    "capability": round(_capability_score(v, need), 4),
                    "dispatch_score": round(_dispatch_score(v, need), 4),
                    "job_title": v.get("job_title"),
                    "email": v.get("email"),
                    "phone": v.get("phone"),
                }
                for v in raw_volunteers
            ],
            key=lambda c: (c["dispatch_score"], c["capability"], -c["distance_km"]),
            reverse=True,
        )
        selected = scored_candidates[:max(remaining_slots, 1)]
 
    # ── Communicator: AI briefing ─────────────────────────────────────────────
    briefing = build_dispatch_briefing(
        need_title=str(need.get("title", "NGO Request")),
        ngo_name=str(need.get("ngo_name", "NGO")),
        address=need.get("address"),
        start_time=need.get("start_time"),
        selected_volunteers=selected,
        emergency_level=str(need.get("emergency_level", "non_emergency")),
    )
 
    # ── Notify selected volunteers ────────────────────────────────────────────
    for vol in selected:
        volunteer = storage.get_volunteer(vol["id"])
        if volunteer is None:
            continue
        channels = ["web"]
        if volunteer.get("phone"):
            channels.append("sms")
        if volunteer.get("email"):
            channels.append("email")
        storage.create_notification(
            volunteer_id=vol["id"],
            need_id=need_id,
            title=briefing["subject"],
            message=briefing["briefing"],
            channels=channels,
            status="queued",
        )
 
    # ── Fairness metrics from the pipeline ────────────────────────────────────
    fairness_metrics = best_state.get("metrics") if best_state else None
 
    storage.add_need_audit_log(
        need_id=need_id,
        action="autonomous_dispatch_queued",
        actor_id=ngo_id,
        actor_role="ngo",
        details={
            "selected_count": len(selected),
            "analysis_profile": analyst_profile,
            "top_candidates": [item["id"] for item in selected[:10]],
            "engine": briefing.get("engine", "template-fallback"),
            "algorithm": "hungarian" if len(shaped_volunteers) > 1 else "greedy-fallback",
            "fairness_lambda": 0.5,
            "fairness_metrics": fairness_metrics,
        },
    )
 
    return {
        "status": "queued",
        "need_id": need_id,
        "remaining_slots": remaining_slots,
        "analyst": analyst_profile,
        "dispatcher": {
            "algorithm": "hungarian+fairness",
            "candidate_count": len(raw_volunteers),
            "selected": selected,
        },
        "communicator": briefing,
        "fairness": fairness_metrics,
    }

@router.get("/ngo/{ngo_id}/needs/{need_id}/volunteers")
def get_need_volunteer_roster(ngo_id: str, need_id: str):
    """Return all volunteer applications for a specific need (NGO roster view)."""
    need = storage.get_need(need_id)
    if need is None or need.get("ngo_id") != ngo_id:
        raise HTTPException(status_code=404, detail="Need not found or access denied.")
    applications = storage.list_need_applications(need_id)
    return {"need_id": need_id, "applications": applications}


@router.delete("/ngo/{ngo_id}/needs/{need_id}/volunteers/{volunteer_id}")
def remove_volunteer_from_need(ngo_id: str, need_id: str, volunteer_id: str):
    """NGO removes a volunteer from a need (sets decision to declined)."""
    need = storage.get_need(need_id)
    if need is None or need.get("ngo_id") != ngo_id:
        raise HTTPException(status_code=404, detail="Need not found or access denied.")
    current_decision = storage.get_volunteer_decision(need_id, volunteer_id)
    if current_decision is None:
        raise HTTPException(status_code=404, detail="No application found for this volunteer.")
    counts = storage.upsert_application(need_id, volunteer_id, "declined", "Removed by NGO coordinator.")
    storage.add_need_audit_log(
        need_id=need_id,
        action="volunteer_removed",
        actor_id=ngo_id,
        actor_role="ngo",
        details={"volunteer_id": volunteer_id, "previous_decision": current_decision},
    )
    return {"status": "removed", "volunteer_id": volunteer_id, "need_id": need_id, **counts}
