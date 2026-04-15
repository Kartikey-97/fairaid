def min_max_bounds(values: list[float]) -> tuple[float, float]:
    if not values:
        return 0.0, 0.0
    return min(values), max(values)


def normalize_value(value: float, min_value: float, max_value: float) -> float:
    if max_value <= min_value:
        return 0.0
    normalized = (value - min_value) / (max_value - min_value)
    if normalized < 0.0:
        return 0.0
    if normalized > 1.0:
        return 1.0
    return normalized


def normalize_list(values: list[float]) -> list[float]:
    min_value, max_value = min_max_bounds(values)
    return [normalize_value(value, min_value, max_value) for value in values]
