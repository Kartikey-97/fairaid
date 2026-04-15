def _required_count(need: dict) -> int:
    required = need.get("required", 1)
    try:
        return max(0, int(required))
    except (TypeError, ValueError):
        return 1


def handle_incomplete_critical_tasks(phase1_result: dict, volunteers: list[dict]) -> dict:
    needs = [dict(need) for need in phase1_result.get("needs", [])]
    returned_volunteers: list[object] = []
    total_score = float(phase1_result.get("total_score", 0.0))

    for need in needs:
        assigned_volunteers = list(need.get("assigned_volunteers", []))
        assigned_scores = list(need.get("assigned_scores", []))
        required = _required_count(need)
        is_critical = bool(need.get("is_critical", False))

        if not is_critical:
            continue

        if len(assigned_volunteers) >= required:
            continue

        returned_volunteers.extend(assigned_volunteers)
        total_score -= sum(float(score) for score in assigned_scores)

        need["assigned_volunteers"] = []
        need["assigned_scores"] = []

    if total_score < 0.0:
        total_score = 0.0

    assigned_after_rollback: set[object] = set()
    for need in needs:
        for volunteer_id in need.get("assigned_volunteers", []):
            assigned_after_rollback.add(volunteer_id)

    available_volunteers: list[dict] = []
    for volunteer in volunteers:
        volunteer_id = volunteer.get("id")
        if volunteer_id not in assigned_after_rollback:
            available_volunteers.append(volunteer)

    total_assignments = sum(len(need.get("assigned_volunteers", [])) for need in needs)

    return {
        "needs": needs,
        "total_assignments": total_assignments,
        "total_score": total_score,
        "returned_volunteer_ids": returned_volunteers,
        "available_volunteers": available_volunteers,
    }
