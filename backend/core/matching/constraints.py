from backend.core.utils.distance import distance_between_locations
from backend.core.utils.time import windows_overlap


def is_available(volunteer: dict, need: dict) -> bool:
    explicit_availability = volunteer.get("available")
    if isinstance(explicit_availability, bool) and not explicit_availability:
        return False

    availability = volunteer.get("availability")
    if isinstance(availability, bool):
        return availability

    need_window = need.get("time_window")
    if need_window is None:
        need_window = need.get("schedule")

    if not need_window:
        return True

    if isinstance(availability, dict):
        return windows_overlap(availability, need_window)

    if isinstance(availability, list):
        for slot in availability:
            if windows_overlap(slot, need_window):
                return True
        return False

    return True


def is_travel_feasible(volunteer: dict, need: dict, default_limit_km: float = 50.0) -> bool:
    volunteer_location = volunteer.get("location")
    need_location = need.get("location")

    if not volunteer_location or not need_location:
        return True

    volunteer_limit = volunteer.get("max_travel_km")
    need_limit = need.get("max_travel_km")
    if volunteer_limit is None:
        volunteer_limit = default_limit_km
    if need_limit is None:
        need_limit = default_limit_km

    travel_limit = min(float(volunteer_limit), float(need_limit))
    travel_distance = distance_between_locations(volunteer_location, need_location)
    return travel_distance <= travel_limit
