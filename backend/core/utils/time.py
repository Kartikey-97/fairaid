def _to_minutes(value: object) -> int | None:
    if isinstance(value, (int, float)):
        return int(value)

    if isinstance(value, str) and ":" in value:
        parts = value.split(":")
        if len(parts) != 2:
            return None
        try:
            hour = int(parts[0])
            minute = int(parts[1])
        except ValueError:
            return None
        return hour * 60 + minute

    return None


def _extract_window(window: dict | None) -> tuple[int, int] | None:
    if not isinstance(window, dict):
        return None

    start = window.get("start")
    end = window.get("end")
    if start is None:
        start = window.get("start_time")
    if end is None:
        end = window.get("end_time")

    start_minutes = _to_minutes(start)
    end_minutes = _to_minutes(end)
    if start_minutes is None or end_minutes is None:
        return None
    if end_minutes <= start_minutes:
        return None
    return start_minutes, end_minutes


def windows_overlap(window_a: dict | None, window_b: dict | None) -> bool:
    parsed_a = _extract_window(window_a)
    parsed_b = _extract_window(window_b)

    if parsed_a is None or parsed_b is None:
        return True

    start_a, end_a = parsed_a
    start_b, end_b = parsed_b
    return start_a < end_b and start_b < end_a
