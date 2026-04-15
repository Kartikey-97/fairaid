from backend.core.fairness.metrics import compute_metrics


def system_score(avg_efficiency: float, fairness_penalty: float, lambda_value: float) -> float:
    return avg_efficiency - lambda_value * fairness_penalty


def evaluate_state(state: dict, lambda_value: float) -> tuple[float, dict]:
    metrics = compute_metrics(state)
    score = system_score(
        metrics["avg_efficiency"],
        metrics["fairness_penalty"],
        lambda_value,
    )
    return score, metrics
