def build_pairs(volunteers: list[dict], needs: list[dict]) -> list[dict]:
    pairs: list[dict] = []

    for volunteer in volunteers:
        volunteer_id = volunteer.get("id")
        for need in needs:
            pairs.append(
                {
                    "volunteer_id": volunteer_id,
                    "need_id": need.get("id"),
                    "volunteer": volunteer,
                    "need": need,
                }
            )

    return pairs
