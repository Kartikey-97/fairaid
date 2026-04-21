"""
Volunteer allocation engine.

Phase 1: Hungarian algorithm (scipy) for optimal assignment — falls back to
         greedy if scipy is not installed.
Phase 2: Capacity expansion — needs requiring K slots are expanded into K
         identical slot copies so the standard 1-to-1 Hungarian solver can
         handle capacity constraints.

Score components (dynamic, not arbitrary):
  - Distance priority  (weight varies by urgency/emergency level)
  - Capability score   (skill + specialist + job-category overlap)
  - Semantic similarity (optional; Jaccard / embedding cosine)
"""

from __future__ import annotations

import math
from typing import Any

from backend.core.matching.constraints import is_available, is_travel_feasible
from backend.core.matching.pair_builder import build_pairs
from backend.core.matching.scorer import score_pairs


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _required_count(need: dict) -> int:
    required = need.get("required", 1)
    try:
        return max(0, int(required))
    except (TypeError, ValueError):
        return 1


def _empty_result(needs: list[dict]) -> dict:
    needs_output = [
        {**need, "assigned_volunteers": [], "assigned_scores": []}
        for need in needs
    ]
    return {"needs": needs_output, "total_assignments": 0, "total_score": 0.0}


def _dynamic_weights(need: dict) -> tuple[float, float, float]:
    """
    Return (w_distance, w_capability, w_semantic) based on need urgency and
    emergency level.  These are principled rather than arbitrary:

    - Emergency / high-urgency → proximity matters most (get there fast).
    - Low-urgency / high-impact → specialist fit matters most.
    - Semantic similarity is a tiebreaker in all cases.

    The three weights always sum to 1.0.
    """
    urgency: int = int(need.get("urgency", 3))          # 1-5
    is_emergency: bool = need.get("emergency_level") == "emergency"
    impact: int = int(need.get("impact_level", 3))      # 1-5

    if is_emergency or urgency >= 5:
        # Speed first
        return 0.60, 0.30, 0.10
    elif urgency >= 4:
        # Balanced but still distance-leaning
        return 0.45, 0.40, 0.15
    elif impact >= 4:
        # High impact, moderate urgency → specialist fit matters
        return 0.30, 0.50, 0.20
    else:
        # Routine task → pure capability
        return 0.25, 0.55, 0.20


def _pair_score(volunteer: dict, need: dict) -> float:
    """
    Compute a scalar score [0, 1] for a volunteer–need pair using
    dynamic weights derived from the need's urgency and emergency level.
    """
    w_dist, w_cap, w_sem = _dynamic_weights(need)

    # ── Distance component ──────────────────────────────────────────────────
    from backend.core.utils.distance import distance_between_locations
    dist_km = distance_between_locations(volunteer.get("location"), need.get("location"))
    limit_km = float(volunteer.get("max_travel_km") or volunteer.get("radius_km") or 50.0)
    if need.get("emergency_level") == "emergency":
        emergency_radius = float(need.get("emergency_radius_km") or limit_km)
        limit_km = min(limit_km, emergency_radius)
    limit_km = max(limit_km, 1.0)
    distance_priority = 1.0 - min(dist_km / limit_km, 1.0)

    # ── Capability component ────────────────────────────────────────────────
    vol_skills = set(volunteer.get("skills", []))
    req_skills = set(need.get("skills_required", need.get("required_skills", [])))
    skill_score = (
        len(vol_skills & req_skills) / len(req_skills)
        if req_skills else 0.0
    )

    vol_specialists = set(
        volunteer.get("specialist_domains", [])
        + volunteer.get("certifications", [])
        + volunteer.get("skills", [])
    )
    req_specialists = set(need.get("required_specialists", []))
    specialist_score = (
        len(vol_specialists & req_specialists) / len(req_specialists)
        if req_specialists else 0.0
    )

    vol_job = str(volunteer.get("job_title") or "").strip().lower()
    req_job = str(need.get("job_category") or "").strip().lower()
    job_score = 1.0 if (vol_job and req_job and vol_job == req_job) else 0.0

    capability = max(skill_score, specialist_score, job_score)

    # ── Semantic component (lightweight Jaccard) ────────────────────────────
    def _tokens(text: str) -> set[str]:
        import re
        return {t for t in re.findall(r"[a-z0-9]+", text.lower()) if len(t) > 2}

    vol_text = " ".join([
        volunteer.get("name", ""),
        " ".join(volunteer.get("skills", [])),
        " ".join(volunteer.get("specialist_domains", [])),
        " ".join(volunteer.get("preferred_need_types", [])),
    ])
    need_text = " ".join([
        str(need.get("title", "")),
        str(need.get("description", "")),
        str(need.get("need_type", "")),
        " ".join(need.get("required_skills", [])),
    ])
    t_vol, t_need = _tokens(vol_text), _tokens(need_text)
    union = t_vol | t_need
    semantic = len(t_vol & t_need) / len(union) if union else 0.0

    score = w_dist * distance_priority + w_cap * capability + w_sem * semantic
    return max(0.0, min(1.0, score))


# ---------------------------------------------------------------------------
# Hungarian (optimal) allocation
# ---------------------------------------------------------------------------

def _allocate_hungarian(volunteers: list[dict], needs: list[dict]) -> dict:
    """
    Capacity-aware Hungarian algorithm.

    Each need requiring K volunteers is expanded into K identical slot entries.
    The resulting volunteers × expanded-slots cost matrix is solved by
    scipy.optimize.linear_sum_assignment (O(n³)).  Assignments with score ≤ 0
    or that violate feasibility constraints are discarded.
    """
    import numpy as np
    from scipy.optimize import linear_sum_assignment

    # Expand need slots
    slots: list[tuple[str, dict]] = []   # (need_id, need)
    for need in needs:
        for _ in range(_required_count(need)):
            slots.append((str(need.get("id")), need))

    n_vol = len(volunteers)
    n_slots = len(slots)
    size = max(n_vol, n_slots)

    # Build score matrix (volunteers × expanded-slots)
    score_matrix = np.zeros((size, size), dtype=np.float64)
    for i, volunteer in enumerate(volunteers):
        for j, (_, need) in enumerate(slots):
            if is_available(volunteer, need) and is_travel_feasible(volunteer, need):
                score_matrix[i, j] = _pair_score(volunteer, need)

    # Solve maximisation
    row_ind, col_ind = linear_sum_assignment(score_matrix, maximize=True)

    # Build results
    needs_state: dict[str, dict] = {
        str(need.get("id")): {**need, "assigned_volunteers": [], "assigned_scores": []}
        for need in needs
    }
    assigned_vols: set[str] = set()
    total_score = 0.0

    for r, c in zip(row_ind.tolist(), col_ind.tolist()):
        if r >= n_vol or c >= n_slots:
            continue
        score = float(score_matrix[r, c])
        if score <= 0.0:
            continue

        volunteer = volunteers[r]
        need_id, need = slots[c]
        vol_id = str(volunteer.get("id") or "")

        if not vol_id or vol_id in assigned_vols:
            continue

        ns = needs_state[need_id]
        if len(ns["assigned_volunteers"]) >= _required_count(ns):
            continue

        # Final feasibility gate (double-check after matrix computation)
        if not is_available(volunteer, need) or not is_travel_feasible(volunteer, need):
            continue

        ns["assigned_volunteers"].append(vol_id)
        ns["assigned_scores"].append(score)
        assigned_vols.add(vol_id)
        total_score += score

    needs_output = list(needs_state.values())
    total_assignments = sum(len(n["assigned_volunteers"]) for n in needs_output)
    return {
        "needs": needs_output,
        "total_assignments": total_assignments,
        "total_score": total_score,
    }


# ---------------------------------------------------------------------------
# Greedy fallback (original approach, kept as backup)
# ---------------------------------------------------------------------------

def _allocate_greedy(volunteers: list[dict], needs: list[dict]) -> dict:
    """
    Original greedy allocator — used if scipy is unavailable.
    Now uses the dynamic _pair_score instead of the scorer module's fixed
    weights so the fallback is still an improvement.
    """
    # Build and score all pairs
    pairs: list[dict] = []
    for volunteer in volunteers:
        for need in needs:
            score = 0.0
            if is_available(volunteer, need) and is_travel_feasible(volunteer, need):
                score = _pair_score(volunteer, need)
            pairs.append({
                "volunteer_id": str(volunteer.get("id") or ""),
                "need_id": str(need.get("id") or ""),
                "volunteer": volunteer,
                "score": score,
            })

    pairs.sort(key=lambda p: p["score"], reverse=True)

    needs_state: dict[str, dict] = {
        str(need.get("id")): {**need, "assigned_volunteers": [], "assigned_scores": []}
        for need in needs
    }
    assigned_vols: set[str] = set()
    total_score = 0.0

    for pair in pairs:
        vol_id = pair["volunteer_id"]
        need_id = pair["need_id"]
        if not vol_id or vol_id in assigned_vols:
            continue
        if need_id not in needs_state:
            continue
        ns = needs_state[need_id]
        if len(ns["assigned_volunteers"]) >= _required_count(ns):
            continue
        if pair["score"] <= 0.0:
            continue

        ns["assigned_volunteers"].append(vol_id)
        ns["assigned_scores"].append(pair["score"])
        assigned_vols.add(vol_id)
        total_score += pair["score"]

    needs_output = list(needs_state.values())
    total_assignments = sum(len(n["assigned_volunteers"]) for n in needs_output)
    return {
        "needs": needs_output,
        "total_assignments": total_assignments,
        "total_score": total_score,
    }


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def allocate_volunteers(volunteers: list[dict], needs: list[dict]) -> dict:
    """
    Allocate volunteers to needs using the best available algorithm.

    Tries scipy Hungarian algorithm first; gracefully falls back to greedy
    if scipy is not installed (e.g. lightweight deployment environments).
    """
    if not volunteers or not needs:
        return _empty_result(needs)

    try:
        import scipy  # noqa: F401 — just checking availability
        return _allocate_hungarian(volunteers, needs)
    except ImportError:
        # scipy not installed — use improved greedy with dynamic weights
        return _allocate_greedy(volunteers, needs)