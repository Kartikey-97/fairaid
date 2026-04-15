from backend.core.utils.distance import distance_between_locations
from backend.core.utils.normalization import min_max_bounds, normalize_value


def _to_float(value: object, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _skill_match_score(volunteer: dict, need: dict) -> float:
    volunteer_skills = set(volunteer.get("skills", []))
    required_skills = set(need.get("skills_required", []))

    if not required_skills:
        return 0.0

    overlap = volunteer_skills.intersection(required_skills)
    return len(overlap) / len(required_skills)


def score_pairs(pairs: list[dict]) -> list[dict]:
    if not pairs:
        return []

    urgency_values = [_to_float(pair["need"].get("urgency", 0.0)) for pair in pairs]
    impact_values = [_to_float(pair["need"].get("impact", 0.0)) for pair in pairs]
    distance_values = [
        distance_between_locations(
            pair["volunteer"].get("location"),
            pair["need"].get("location"),
        )
        for pair in pairs
    ]

    urgency_min, urgency_max = min_max_bounds(urgency_values)
    impact_min, impact_max = min_max_bounds(impact_values)
    distance_min, distance_max = min_max_bounds(distance_values)

    scored_pairs: list[dict] = []
    for pair, urgency_raw, impact_raw, distance_raw in zip(
        pairs, urgency_values, impact_values, distance_values
    ):
        skill_match = _skill_match_score(pair["volunteer"], pair["need"])
        urgency = normalize_value(urgency_raw, urgency_min, urgency_max)
        impact = normalize_value(impact_raw, impact_min, impact_max)
        distance_norm = normalize_value(distance_raw, distance_min, distance_max)

        score = (
            0.5 * skill_match
            + 0.25 * urgency
            + 0.15 * impact
            - 0.2 * distance_norm
        )

        scored_pair = dict(pair)
        scored_pair["score"] = score
        scored_pair["score_components"] = {
            "skill_match": skill_match,
            "urgency": urgency,
            "impact": impact,
            "distance_norm": distance_norm,
        }
        scored_pairs.append(scored_pair)

    return scored_pairs
