from copy import deepcopy

from backend.core.matching.constraints import is_available, is_travel_feasible
from backend.core.matching.pair_builder import build_pairs
from backend.core.matching.scorer import score_pairs


def _required_count(need: dict) -> int:
    required = need.get("required", 1)
    try:
        return max(0, int(required))
    except (TypeError, ValueError):
        return 1


def is_underserved(need: dict) -> bool:
    return len(need.get("assigned_volunteers", [])) < _required_count(need)


def estimate_pair_score(volunteer: dict, target_need: dict, all_needs: list[dict]) -> float:
    pairs = build_pairs([volunteer], all_needs)
    scored_pairs = score_pairs(pairs)
    target_need_id = target_need.get("id")

    for pair in scored_pairs:
        if pair.get("need_id") == target_need_id:
            return float(pair.get("score", 0.0))

    return 0.0


def can_transfer(volunteer: dict, target_need: dict) -> bool:
    if not is_underserved(target_need):
        return False

    if not is_available(volunteer, target_need):
        return False

    if not is_travel_feasible(volunteer, target_need):
        return False

    return True


def transfer(state: dict, volunteer: dict, target_need_id: object, transfer_score: float) -> dict | None:
    volunteer_id = volunteer.get("id")
    if volunteer_id is None:
        return None

    target_need = None
    for need in state.get("needs", []):
        if need.get("id") == target_need_id:
            target_need = need
            break

    if target_need is None or not can_transfer(volunteer, target_need):
        return None

    next_state = deepcopy(state)

    next_needs = next_state.get("needs", [])
    next_need = None
    for need in next_needs:
        if need.get("id") == target_need_id:
            next_need = need
            break

    if next_need is None:
        return None

    next_available_volunteers = next_state.get("available_volunteers", [])
    remaining_volunteers = [
        free_volunteer
        for free_volunteer in next_available_volunteers
        if free_volunteer.get("id") != volunteer_id
    ]

    if len(remaining_volunteers) == len(next_available_volunteers):
        return None

    next_need.setdefault("assigned_volunteers", []).append(volunteer_id)
    next_need.setdefault("assigned_scores", []).append(float(transfer_score))

    next_state["available_volunteers"] = remaining_volunteers
    next_state["total_assignments"] = int(next_state.get("total_assignments", 0)) + 1
    next_state["total_score"] = float(next_state.get("total_score", 0.0)) + float(transfer_score)

    return next_state


def swap(
    state: dict,
    need_a_id: object,
    volunteer_a: dict,
    need_b_id: object,
    volunteer_b: dict,
    new_score_a: float,
    new_score_b: float,
) -> dict | None:
    volunteer_a_id = volunteer_a.get("id")
    volunteer_b_id = volunteer_b.get("id")
    if volunteer_a_id is None or volunteer_b_id is None:
        return None
    if volunteer_a_id == volunteer_b_id:
        return None

    need_a = None
    need_b = None
    for need in state.get("needs", []):
        if need.get("id") == need_a_id:
            need_a = need
        elif need.get("id") == need_b_id:
            need_b = need

    if need_a is None or need_b is None:
        return None

    if not is_available(volunteer_a, need_b) or not is_travel_feasible(volunteer_a, need_b):
        return None
    if not is_available(volunteer_b, need_a) or not is_travel_feasible(volunteer_b, need_a):
        return None

    assigned_a = need_a.get("assigned_volunteers", [])
    assigned_b = need_b.get("assigned_volunteers", [])
    if volunteer_a_id not in assigned_a or volunteer_b_id not in assigned_b:
        return None

    next_state = deepcopy(state)

    next_need_a = None
    next_need_b = None
    for need in next_state.get("needs", []):
        if need.get("id") == need_a_id:
            next_need_a = need
        elif need.get("id") == need_b_id:
            next_need_b = need

    if next_need_a is None or next_need_b is None:
        return None

    idx_a = next_need_a.get("assigned_volunteers", []).index(volunteer_a_id)
    idx_b = next_need_b.get("assigned_volunteers", []).index(volunteer_b_id)

    old_score_a = float(next_need_a.get("assigned_scores", [0.0])[idx_a])
    old_score_b = float(next_need_b.get("assigned_scores", [0.0])[idx_b])

    next_need_a["assigned_volunteers"][idx_a] = volunteer_b_id
    next_need_b["assigned_volunteers"][idx_b] = volunteer_a_id

    next_need_a["assigned_scores"][idx_a] = float(new_score_a)
    next_need_b["assigned_scores"][idx_b] = float(new_score_b)

    next_state["total_score"] = float(next_state.get("total_score", 0.0)) - old_score_a - old_score_b + float(new_score_a) + float(new_score_b)
    if next_state["total_score"] < 0.0:
        next_state["total_score"] = 0.0

    return next_state
