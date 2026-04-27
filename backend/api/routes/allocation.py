from fastapi import APIRouter
from pydantic import BaseModel

from backend.core.pipeline.run_allocation import run_allocation as pipeline_run_allocation
from backend.core.db import storage

router = APIRouter()


class AllocationRequest(BaseModel):
    volunteers: list[dict]
    needs: list[dict]


@router.post("/run-allocation")
def run_allocation(request: AllocationRequest) -> dict:
    return pipeline_run_allocation(request.volunteers, request.needs)

@router.get("/allocation-data")
def get_allocation_data() -> dict:
    volunteers = storage.list_volunteers()
    needs = storage.list_needs(status="open")
    
    # We need to map the full volunteer/need models to the simplified format used by the allocator frontend
    mapped_vols = []
    for v in volunteers:
        mapped_vols.append({
            "id": v["id"],
            "skills": v.get("skills", []),
            "availability": True,
            "max_travel_km": v.get("radius_km", 25),
            "location": v.get("location", {"lat": 0, "lng": 0})
        })
        
    mapped_needs = []
    for n in needs:
        mapped_needs.append({
            "id": n["id"],
            "skills_required": n.get("required_skills", []),
            "required": n.get("required_volunteers", 1),
            "is_critical": n.get("is_critical", False),
            "urgency": n.get("urgency", 5),
            "impact": n.get("impact_level", 5),
            "location": n.get("location", {"lat": 0, "lng": 0})
        })
        
    return {
        "volunteers": mapped_vols,
        "needs": mapped_needs
    }
