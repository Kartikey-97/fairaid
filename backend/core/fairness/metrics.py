import math


def _required_count(need: dict) -> int:
    required = need.get("required", 1)
    try:
        return max(0, int(required))
    except (TypeError, ValueError):
        return 1


def fulfillment_rate(need: dict) -> float:
    required = _required_count(need)
    assigned = len(need.get("assigned_volunteers", []))

    if required == 0:
        return 1.0

    return assigned / required


def fairness_penalty(needs: list[dict]) -> float:
    if not needs:
        return 0.0

    rates = [fulfillment_rate(need) for need in needs]
    mean_rate = sum(rates) / len(rates)
    variance = sum((rate - mean_rate) ** 2 for rate in rates) / len(rates)
    return math.sqrt(variance)


def avg_efficiency(total_score: float, total_assignments: int) -> float:
    if total_assignments <= 0:
        return 0.0
    return total_score / total_assignments


def compute_metrics(state: dict) -> dict:
    needs = state.get("needs", [])
    total_score = float(state.get("total_score", 0.0))
    total_assignments = int(state.get("total_assignments", 0))

    rates = {
        str(need.get("id")): fulfillment_rate(need)
        for need in needs
    }

    return {
        "fulfillment_rates": rates,
        "fairness_penalty": fairness_penalty(needs),
        "avg_efficiency": avg_efficiency(total_score, total_assignments),
    }
