from backend.core.fairness.objective import evaluate_state
from backend.core.fairness.swap import estimate_pair_score, is_underserved, transfer


def optimize_fairness(state: dict, lambda_value: float, max_iterations: int = 25) -> dict:
    current_state = dict(state)

    for _ in range(max_iterations):
        current_system_score, _ = evaluate_state(current_state, lambda_value)

        best_candidate = None
        best_candidate_score = current_system_score

        needs = current_state.get("needs", [])
        underserved_needs = [need for need in needs if is_underserved(need)]
        free_volunteers = current_state.get("available_volunteers", [])

        if not underserved_needs or not free_volunteers:
            break

        for volunteer in free_volunteers:
            for need in underserved_needs:
                candidate_pair_score = estimate_pair_score(volunteer, need, needs)
                candidate_state = transfer(
                    current_state,
                    volunteer,
                    need.get("id"),
                    candidate_pair_score,
                )
                if candidate_state is None:
                    continue

                candidate_system_score, _ = evaluate_state(candidate_state, lambda_value)

                # Accept only strict objective improvements.
                if candidate_system_score > best_candidate_score + 1e-12:
                    best_candidate_score = candidate_system_score
                    best_candidate = candidate_state

        if best_candidate is None:
            break

        current_state = best_candidate

    final_system_score, final_metrics = evaluate_state(current_state, lambda_value)

    output_state = dict(current_state)
    output_state["metrics"] = final_metrics
    output_state["system_score"] = final_system_score
    output_state["lambda"] = lambda_value

    return output_state
