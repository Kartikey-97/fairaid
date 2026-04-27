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
from backend.api.routes.surveys import router as surveys_router
from backend.core.db import initialize_database

app = FastAPI(title="FairAid API")

# CORS configuration (cookie-compatible; supports local dev + Vercel previews).
cors_origins_env = os.getenv("FAIRAID_CORS_ORIGINS", "").strip()
if cors_origins_env:
    cors_origins = [item.strip() for item in cors_origins_env.split(",") if item.strip()]
else:
    cors_origins = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]

frontend_url = os.getenv("FAIRAID_FRONTEND_URL", "").strip()
if frontend_url and frontend_url not in cors_origins:
    cors_origins.append(frontend_url)

cors_origin_regex = os.getenv("FAIRAID_CORS_ORIGIN_REGEX", r"https://.*\.vercel\.app")

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_origin_regex=cors_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routes
app.include_router(allocation_router)
app.include_router(platform_router)
app.include_router(surveys_router, prefix="/api/surveys")

# Startup event
@app.on_event("startup")
def on_startup() -> None:
    initialize_database()
