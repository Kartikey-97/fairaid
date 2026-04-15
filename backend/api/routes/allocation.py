from fastapi import APIRouter
from pydantic import BaseModel

from backend.core.pipeline.run_allocation import run_allocation as pipeline_run_allocation

router = APIRouter()


class AllocationRequest(BaseModel):
    volunteers: list[dict]
    needs: list[dict]


@router.post("/run-allocation")
def run_allocation(request: AllocationRequest) -> dict:
    return pipeline_run_allocation(request.volunteers, request.needs)
