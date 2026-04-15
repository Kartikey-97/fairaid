from copy import deepcopy

from backend.core.critical.handler import handle_incomplete_critical_tasks
from backend.core.fairness.optimizer import optimize_fairness
from backend.core.matching.allocator import allocate_volunteers


def run_allocation(volunteers: list[dict], needs: list[dict]) -> dict:
    phase1_result = allocate_volunteers(volunteers, needs)
    phase1_5_result = handle_incomplete_critical_tasks(phase1_result, volunteers)
    lambda_values = [0.0, 0.25, 0.5, 0.75, 1.0]
    states: dict[str, dict] = {}

    for lambda_value in lambda_values:
        lambda_key = f"{lambda_value:g}"
        base_state = deepcopy(phase1_5_result)
        states[lambda_key] = optimize_fairness(base_state, lambda_value=lambda_value)

    return {
        "states": states
    }
