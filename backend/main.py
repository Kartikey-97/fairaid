import sys
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Support both:
# 1) `uvicorn backend.main:app` from project root
# 2) `uvicorn main:app` from `/backend`
PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.api.routes.allocation import router as allocation_router
from backend.api.routes.platform import router as platform_router
from backend.core.db import initialize_database

app = FastAPI(title="FairAid API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(allocation_router)
app.include_router(platform_router)

@app.on_event("startup")
def on_startup() -> None:
    initialize_database()
