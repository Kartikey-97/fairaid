import math


def _to_float(value: object, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _extract_point(location: dict | None) -> tuple[float, float]:
    if not isinstance(location, dict):
        return 0.0, 0.0

    if "lat" in location and "lng" in location:
        return _to_float(location.get("lat")), _to_float(location.get("lng"))

    if "x" in location and "y" in location:
        return _to_float(location.get("x")), _to_float(location.get("y"))

    return 0.0, 0.0


def _is_lat_lng(point: tuple[float, float]) -> bool:
    lat, lng = point
    return -90.0 <= lat <= 90.0 and -180.0 <= lng <= 180.0


def _haversine_km(point_a: tuple[float, float], point_b: tuple[float, float]) -> float:
    lat1, lon1 = point_a
    lat2, lon2 = point_b

    lat1_rad = math.radians(lat1)
    lat2_rad = math.radians(lat2)
    delta_lat = math.radians(lat2 - lat1)
    delta_lon = math.radians(lon2 - lon1)

    a = (
        math.sin(delta_lat / 2) ** 2
        + math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(delta_lon / 2) ** 2
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    earth_radius_km = 6371.0
    return earth_radius_km * c


def compute_distance(point_a: tuple[float, float], point_b: tuple[float, float]) -> float:
    if _is_lat_lng(point_a) and _is_lat_lng(point_b):
        return _haversine_km(point_a, point_b)

    delta_x = point_b[0] - point_a[0]
    delta_y = point_b[1] - point_a[1]
    return math.sqrt(delta_x * delta_x + delta_y * delta_y)


def distance_between_locations(location_a: dict | None, location_b: dict | None) -> float:
    point_a = _extract_point(location_a)
    point_b = _extract_point(location_b)
    return compute_distance(point_a, point_b)
