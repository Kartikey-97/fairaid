import sys
import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Ensure project root is in path
PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

# Ensure SQLite directory exists (CRITICAL for Render)
os.makedirs("data", exist_ok=True)

from backend.api.routes.allocation import router as allocation_router
from backend.api.routes.platform import router as platform_router
from backend.core.db import initialize_database

app = FastAPI(title="FairAid API")

# CORS (temporary: allow all for development)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routes
app.include_router(allocation_router)
app.include_router(platform_router)

# Startup event
@app.on_event("startup")
def on_startup() -> None:
    initialize_database()