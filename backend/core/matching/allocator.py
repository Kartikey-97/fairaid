from backend.core.matching.constraints import is_available, is_travel_feasible
from backend.core.matching.pair_builder import build_pairs
from backend.core.matching.scorer import score_pairs


def _required_count(need: dict) -> int:
    required = need.get("required", 1)
    try:
        return max(0, int(required))
    except (TypeError, ValueError):
        return 1


def allocate_volunteers(volunteers: list[dict], needs: list[dict]) -> dict:
    pairs = build_pairs(volunteers, needs)
    scored_pairs = score_pairs(pairs)
    sorted_pairs = sorted(scored_pairs, key=lambda pair: pair["score"], reverse=True)

    needs_state: dict[object, dict] = {}
    for need in needs:
        need_copy = dict(need)
        need_copy["assigned_volunteers"] = []
        need_copy["assigned_scores"] = []
        needs_state[need.get("id")] = need_copy

    assigned_volunteers: set[object] = set()
    total_score = 0.0

    # Lazy validation: we do not re-score/re-sort after each assignment.
    for pair in sorted_pairs:
        volunteer = pair["volunteer"]
        need_id = pair["need_id"]
        volunteer_id = pair["volunteer_id"]

        if need_id not in needs_state:
            continue

        need_state = needs_state[need_id]

        if volunteer_id in assigned_volunteers:
            continue

        if len(need_state["assigned_volunteers"]) >= _required_count(need_state):
            continue

        if not is_available(volunteer, need_state):
            continue

        if not is_travel_feasible(volunteer, need_state):
            continue

        need_state["assigned_volunteers"].append(volunteer_id)
        need_state["assigned_scores"].append(pair["score"])
        assigned_volunteers.add(volunteer_id)
        total_score += pair["score"]

    needs_output = list(needs_state.values())
    total_assignments = sum(len(need["assigned_volunteers"]) for need in needs_output)

    return {
        "needs": needs_output,
        "total_assignments": total_assignments,
        "total_score": total_score,
    }
