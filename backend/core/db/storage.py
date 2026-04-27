import json
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
import re
from uuid import uuid4

try:
    import psycopg
    from psycopg.rows import dict_row
except ImportError:  # pragma: no cover - optional dependency
    psycopg = None
    dict_row = None

from backend.core.domain import (
    JOB_LIBRARY,
    LANGUAGE_LIBRARY,
    NEED_TYPE_LIBRARY,
    SKILL_LIBRARY,
    SPECIALIST_LIBRARY,
)

DB_PATH = Path(__file__).resolve().parents[3] / "data" / "fairaid.db"


def _resolve_database_url() -> str:
    env_value = os.getenv("FAIRAID_DATABASE_URL", "").strip()
    if env_value:
        return env_value

    project_root = Path(__file__).resolve().parents[3]
    backend_root = project_root / "backend"
    env_candidates = [backend_root / ".env", project_root / ".env"]

    for env_file in env_candidates:
        if not env_file.exists():
            continue
        try:
            lines = env_file.read_text(encoding="utf-8").splitlines()
        except OSError:
            continue

        for raw_line in lines:
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            if key.strip() == "FAIRAID_DATABASE_URL":
                return value.strip().strip("'").strip('"')
    return ""


DATABASE_URL = _resolve_database_url()
USE_POSTGRES = DATABASE_URL.startswith("postgres://") or DATABASE_URL.startswith(
    "postgresql://"
)
ACTIVE_BACKEND = "postgres" if USE_POSTGRES else "sqlite"
LAST_POSTGRES_ERROR: str | None = None


def _now_iso() -> str:
    return datetime.now(tz=timezone.utc).isoformat()


def _to_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=True)


def _from_json_list(value: str | None) -> list:
    if not value:
        return []
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return []
    if not isinstance(parsed, list):
        return []
    return parsed


def _from_json_dict(value: str | None) -> dict:
    if not value:
        return {}
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return {}
    if not isinstance(parsed, dict):
        return {}
    return parsed


def _normalize_choice(value: object, allowed: list[str]) -> str | None:
    text = str(value).strip().lower()
    if not text:
        return None

    compact = re.sub(r"\s+", " ", text)
    candidates = [
        compact,
        compact.replace("_", " "),
        compact.replace("-", " "),
        compact.replace(" ", "-"),
        compact.replace("_", "-"),
    ]
    for candidate in candidates:
        if candidate in allowed:
            return candidate
    return None


def _normalize_skill(value: object) -> str | None:
    return _normalize_choice(value, SKILL_LIBRARY)


def _normalize_need_type(value: object) -> str | None:
    return _normalize_choice(value, NEED_TYPE_LIBRARY)


def _normalize_job(value: object) -> str | None:
    return _normalize_choice(value, JOB_LIBRARY)


def _normalize_language(value: object) -> str | None:
    return _normalize_choice(value, LANGUAGE_LIBRARY)


def _normalize_specialist(value: object) -> str | None:
    text = str(value).strip().lower()
    if not text:
        return None

    normalized = re.sub(r"\s+", "-", text.replace("_", "-"))
    specialist_aliases = {
        "doctor": "medical",
        "nurse": "medical",
        "paramedic": "medical",
        "surgeon": "medical",
        "pharmacist": "medical",
        "physiotherapist": "medical",
        "public-health-officer": "public-health",
        "public-health-worker": "public-health",
        "public-health": "public-health",
        "teacher": "education",
        "educator": "education",
        "counselor": "counseling",
        "psychologist": "counseling",
        "mental-health": "counseling",
        "lawyer": "legal-aid",
        "legal": "legal-aid",
        "it": "it-support",
        "it-support-engineer": "it-support",
        "vet": "veterinary",
    }
    mapped = specialist_aliases.get(normalized, normalized)
    if mapped in SPECIALIST_LIBRARY:
        return mapped
    return _normalize_choice(mapped, SPECIALIST_LIBRARY)


def _normalize_list(values: list[object], normalizer) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    for value in values:
        item = normalizer(value)
        if not item or item in seen:
            continue
        normalized.append(item)
        seen.add(item)
    return normalized


def _adapt_query(query: str) -> str:
    if not USE_POSTGRES:
        return query
    return query.replace("?", "%s")


def _row_get(row: sqlite3.Row | dict, key: str):
    if isinstance(row, dict):
        return row.get(key)
    return row[key]


@contextmanager
def get_connection():
    global ACTIVE_BACKEND, LAST_POSTGRES_ERROR
    if USE_POSTGRES:
        if psycopg is None:
            raise RuntimeError(
                "PostgreSQL is configured via FAIRAID_DATABASE_URL, but psycopg is not installed. "
                "Install with: pip install 'psycopg[binary]'"
            )
        try:
            connection = psycopg.connect(DATABASE_URL, row_factory=dict_row)
            ACTIVE_BACKEND = "postgres"
            LAST_POSTGRES_ERROR = None
        except Exception as error:  # pragma: no cover - runtime resilience path
            # Keep the system usable in hackathon/demo mode if Postgres is unavailable.
            LAST_POSTGRES_ERROR = str(error)
            ACTIVE_BACKEND = "sqlite-fallback"
            DB_PATH.parent.mkdir(parents=True, exist_ok=True)
            connection = sqlite3.connect(DB_PATH)
            connection.row_factory = sqlite3.Row
    else:
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(DB_PATH)
        connection.row_factory = sqlite3.Row
        ACTIVE_BACKEND = "sqlite"

    try:
        yield connection
    finally:
        connection.close()


def _execute(cursor, query: str, params: tuple | list | None = None):
    if params is None:
        params = []
    return cursor.execute(_adapt_query(query), tuple(params))


def _executemany(cursor, query: str, params: list[tuple]):
    return cursor.executemany(_adapt_query(query), params)


def _table_count(cursor, table: str) -> int:
    row = _execute(cursor, f"SELECT COUNT(*) AS count FROM {table}").fetchone()
    if row is None:
        return 0
    return int(_row_get(row, "count") or 0)


def _column_exists(cursor, table: str, column: str) -> bool:
    if USE_POSTGRES:
        row = _execute(
            cursor,
            """
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = ? AND column_name = ?
            LIMIT 1
            """,
            (table, column),
        ).fetchone()
        return row is not None

    rows = _execute(cursor, f"PRAGMA table_info({table})").fetchall()
    for row in rows:
        name = _row_get(row, "name")
        if name == column:
            return True
    return False


def _ensure_column(cursor, table: str, column: str, column_def: str) -> None:
    if _column_exists(cursor, table, column):
        return
    if USE_POSTGRES:
        _execute(
            cursor,
            f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {column} {column_def}",
        )
    else:
        _execute(cursor, f"ALTER TABLE {table} ADD COLUMN {column} {column_def}")


import bcrypt

def initialize_database() -> None:
    with get_connection() as connection:
        cursor = connection.cursor()
        _execute(
            cursor,
            """
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                role TEXT NOT NULL,
                name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE,
                password TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """,
        )
        _execute(
            cursor,
            """
            CREATE TABLE IF NOT EXISTS volunteers (
                id TEXT PRIMARY KEY,
                user_id TEXT UNIQUE,
                name TEXT NOT NULL,
                email TEXT,
                phone TEXT,
                address TEXT,
                profile_image_url TEXT,
                job_title TEXT,
                license_number TEXT,
                license_verified INTEGER NOT NULL DEFAULT 0,
                verification_notes TEXT,
                lat REAL NOT NULL,
                lng REAL NOT NULL,
                radius_km REAL NOT NULL,
                skills_json TEXT NOT NULL,
                certifications_json TEXT NOT NULL,
                specialist_domains_json TEXT NOT NULL,
                preferred_need_types_json TEXT NOT NULL,
                languages_json TEXT NOT NULL,
                availability_json TEXT NOT NULL,
                can_handle_emergency INTEGER NOT NULL,
                notes TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """,
        )
        _execute(
            cursor,
            """
            CREATE TABLE IF NOT EXISTS needs (
                id TEXT PRIMARY KEY,
                ngo_id TEXT NOT NULL,
                ngo_name TEXT NOT NULL,
                title TEXT NOT NULL,
                description TEXT NOT NULL,
                need_type TEXT NOT NULL,
                job_category TEXT,
                emergency_level TEXT NOT NULL,
                is_critical INTEGER NOT NULL,
                urgency INTEGER NOT NULL,
                impact_level INTEGER NOT NULL,
                required_volunteers INTEGER NOT NULL,
                required_skills_json TEXT NOT NULL,
                required_specialists_json TEXT NOT NULL,
                language_requirements_json TEXT NOT NULL,
                min_volunteer_age INTEGER,
                background_check_required INTEGER NOT NULL,
                beneficiary_count INTEGER,
                emergency_radius_km REAL NOT NULL,
                lat REAL NOT NULL,
                lng REAL NOT NULL,
                address TEXT,
                start_time TEXT,
                end_time TEXT,
                contact_json TEXT NOT NULL,
                safety_notes TEXT,
                resources_available TEXT,
                logistics_notes TEXT,
                status TEXT NOT NULL,
                notified_volunteer_ids_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """,
        )
        _execute(
            cursor,
            """
            CREATE TABLE IF NOT EXISTS applications (
                id TEXT PRIMARY KEY,
                need_id TEXT NOT NULL,
                volunteer_id TEXT NOT NULL,
                decision TEXT NOT NULL,
                note TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(need_id, volunteer_id)
            )
            """,
        )
        _execute(
            cursor,
            """
            CREATE TABLE IF NOT EXISTS embeddings (
                entity_type TEXT NOT NULL,
                entity_id TEXT NOT NULL,
                vector_json TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY(entity_type, entity_id)
            )
            """,
        )
        _execute(
            cursor,
            """
            CREATE TABLE IF NOT EXISTS need_audit_logs (
                id TEXT PRIMARY KEY,
                need_id TEXT NOT NULL,
                actor_id TEXT,
                actor_role TEXT,
                action TEXT NOT NULL,
                details_json TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """,
        )
        _execute(
            cursor,
            """
            CREATE TABLE IF NOT EXISTS notifications (
                id TEXT PRIMARY KEY,
                volunteer_id TEXT NOT NULL,
                need_id TEXT,
                title TEXT NOT NULL,
                message TEXT NOT NULL,
                channels_json TEXT NOT NULL,
                status TEXT NOT NULL,
                is_read INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                sent_at TEXT
            )
            """,
        )
        _execute(
            cursor,
            """
            CREATE TABLE IF NOT EXISTS notification_events (
                id TEXT PRIMARY KEY,
                notification_id TEXT NOT NULL,
                channel TEXT NOT NULL,
                delivery_status TEXT NOT NULL,
                detail TEXT,
                created_at TEXT NOT NULL
            )
            """,
        )
        _execute(
            cursor,
            """
            CREATE TABLE IF NOT EXISTS field_reports (
                id TEXT PRIMARY KEY,
                volunteer_id TEXT,
                summary TEXT NOT NULL,
                severity TEXT NOT NULL,
                categories_json TEXT NOT NULL,
                supply_needs_json TEXT NOT NULL,
                people_count_estimate INTEGER NOT NULL DEFAULT 0,
                required_volunteers_estimate INTEGER NOT NULL DEFAULT 0,
                location_lat REAL,
                location_lng REAL,
                address TEXT,
                raw_audio_text TEXT,
                image_hint TEXT,
                created_at TEXT NOT NULL
            )
            """,
        )

        # Lightweight migrations for existing DBs.
        _ensure_column(cursor, "volunteers", "address", "TEXT")
        _ensure_column(cursor, "volunteers", "profile_image_url", "TEXT")
        _ensure_column(cursor, "volunteers", "job_title", "TEXT")
        _ensure_column(cursor, "volunteers", "license_number", "TEXT")
        _ensure_column(cursor, "volunteers", "license_verified", "INTEGER NOT NULL DEFAULT 0")
        _ensure_column(cursor, "volunteers", "verification_notes", "TEXT")
        _ensure_column(cursor, "needs", "job_category", "TEXT")

        # Migrate legacy 'interested' decision -> 'pinned'
        _execute(
            cursor,
            "UPDATE applications SET decision = 'pinned' WHERE decision = 'interested'",
        )
        _execute(
            cursor,
            """
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                token TEXT NOT NULL UNIQUE,
                expires_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users (id)
            )
            """,
        )

        # Migrate existing plain-text passwords to bcrypt hashes
        try:
            users_query = _execute(cursor, "SELECT id, password FROM users").fetchall()
            for row in users_query:
                uid = _row_get(row, "id")
                pwd = _row_get(row, "password")
                if pwd and not pwd.startswith("$2"):
                    hashed = bcrypt.hashpw(pwd.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
                    _execute(cursor, "UPDATE users SET password = ? WHERE id = ?", (hashed, uid))
        except Exception as e:
            print(f"Password migration note: {e}")

        connection.commit()

    _seed_dummy_data_if_empty()
    _seed_supplemental_demo_data()
    _seed_extra_demo_volunteers()


def _seed_dummy_data_if_empty() -> None:
    with get_connection() as connection:
        cursor = connection.cursor()
        if _table_count(cursor, "users") > 0:
            return

        now = _now_iso()
        ngo_user_id = "user_ngo_demo"
        volunteer_user_id = "user_vol_demo"
        volunteer_user_two_id = "user_vol_demo_2"
        volunteer_user_three_id = "user_vol_demo_3"

        users = [
            (ngo_user_id, "ngo", "Sahara Community Relief", "ngo@fairaid.org", "demo123", now),
            (volunteer_user_id, "volunteer", "Rahul Verma", "volunteer@fairaid.org", "demo123", now),
            (volunteer_user_two_id, "volunteer", "Neha Sharma", "neha@fairaid.org", "demo123", now),
            (volunteer_user_three_id, "volunteer", "Dr. Arjun Singh", "arjun@fairaid.org", "demo123", now),
        ]
        _executemany(
            cursor,
            "INSERT INTO users (id, role, name, email, password, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            users,
        )

        volunteers = [
            (
                "vol_demo_001",
                volunteer_user_id,
                "Rahul Verma",
                "volunteer@fairaid.org",
                "+91-9988776655",
                "Laxmi Nagar, New Delhi",
                "https://i.pravatar.cc/160?img=12",
                "paramedic",
                "PMD-2024-0044",
                1,
                "Verified by NGO admin on onboarding.",
                28.6139,
                77.2090,
                35.0,
                _to_json(["first aid", "logistics", "medical support", "disaster response"]),
                _to_json(["bcls"]),
                _to_json(["medical", "disaster-management"]),
                _to_json(["medical-camp", "shelter", "rescue-support"]),
                _to_json(["hindi", "english"]),
                _to_json([]),
                1,
                "Available evenings and emergency weekends.",
                now,
                now,
            ),
            (
                "vol_demo_002",
                volunteer_user_two_id,
                "Neha Sharma",
                "neha@fairaid.org",
                "+91-9988771122",
                "Model Town, New Delhi",
                "https://i.pravatar.cc/160?img=32",
                "teacher",
                "",
                0,
                "",
                28.7041,
                77.1025,
                25.0,
                _to_json(["teaching", "community outreach", "child safety"]),
                _to_json(["child safety"]),
                _to_json(["education"]),
                _to_json(["education", "food-distribution"]),
                _to_json(["hindi", "english"]),
                _to_json([]),
                1,
                "Can support on weekdays.",
                now,
                now,
            ),
            (
                "vol_demo_003",
                volunteer_user_three_id,
                "Dr. Arjun Singh",
                "arjun@fairaid.org",
                "+91-9911223344",
                "Indirapuram, Ghaziabad",
                "https://i.pravatar.cc/160?img=51",
                "doctor",
                "DOC-UP-998812",
                1,
                "Medical license manually verified.",
                28.6499,
                77.3688,
                45.0,
                _to_json(["doctor", "first aid", "triage", "medical support"]),
                _to_json(["mbbs", "acls"]),
                _to_json(["medical", "public-health"]),
                _to_json(["medical-camp", "rescue-support"]),
                _to_json(["hindi", "english"]),
                _to_json([]),
                1,
                "On-call for emergency deployments.",
                now,
                now,
            ),
        ]
        _executemany(
            cursor,
            """
            INSERT INTO volunteers (
                id, user_id, name, email, phone, address, profile_image_url, job_title,
                license_number, license_verified, verification_notes, lat, lng, radius_km,
                skills_json, certifications_json, specialist_domains_json,
                preferred_need_types_json, languages_json, availability_json,
                can_handle_emergency, notes, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            volunteers,
        )

        needs = [
            (
                "need_demo_001",
                ngo_user_id,
                "Sahara Community Relief",
                "Flood Medical Response Unit",
                "Immediate response team needed for flood-hit families. Need triage and first-aid support.",
                "medical-camp",
                "doctor",
                "emergency",
                1,
                5,
                5,
                30,
                _to_json(["first aid", "triage", "medical support"]),
                _to_json(["medical"]),
                _to_json(["hindi"]),
                None,
                0,
                1200,
                40.0,
                28.6200,
                77.2300,
                "Sector 11 Relief Ground",
                "2026-04-06T09:00:00+05:30",
                "2026-04-06T20:00:00+05:30",
                _to_json({"name": "Aditi Malhotra", "phone": "+91-9999999999"}),
                "PPE and hydration breaks every 45 minutes.",
                "Medical kits, ORS, tents",
                "Report at Gate B.",
                "open",
                _to_json(["vol_demo_001"]),
                now,
                now,
            ),
            (
                "need_demo_002",
                ngo_user_id,
                "Sahara Community Relief",
                "Children Learning Camp Volunteers",
                "Support after-school literacy and activity sessions for displaced children.",
                "education",
                "teacher",
                "non_emergency",
                0,
                3,
                4,
                15,
                _to_json(["teaching", "community outreach"]),
                _to_json(["education", "child-protection"]),
                _to_json(["hindi"]),
                None,
                1,
                150,
                20.0,
                28.7010,
                77.1100,
                "Temporary Learning Hub, Block C",
                "2026-04-08T14:00:00+05:30",
                "2026-04-08T18:00:00+05:30",
                _to_json({"name": "Ritika Sethi", "phone": "+91-9898989898"}),
                "Children-sensitive communication guidelines required.",
                "Study kits and snacks provided.",
                "Arrive 30 minutes before session.",
                "open",
                _to_json([]),
                now,
                now,
            ),
            (
                "need_demo_003",
                ngo_user_id,
                "Sahara Community Relief",
                "Food Distribution Queue Management",
                "Need volunteers to manage queue flow and help elderly beneficiaries.",
                "food-distribution",
                "operations volunteer",
                "non_emergency",
                0,
                4,
                4,
                20,
                _to_json(["logistics", "crowd management", "food distribution"]),
                _to_json(["logistics"]),
                _to_json(["hindi"]),
                None,
                0,
                600,
                30.0,
                28.6400,
                77.1800,
                "Central Community Kitchen",
                "2026-04-07T10:00:00+05:30",
                "2026-04-07T16:00:00+05:30",
                _to_json({"name": "Dev Rao", "phone": "+91-9777777777"}),
                "Maintain hydration and shaded waiting zones.",
                "Packed meals and water stock available.",
                "Team briefing at 09:30.",
                "open",
                _to_json([]),
                now,
                now,
            ),
        ]
        _executemany(
            cursor,
            """
            INSERT INTO needs (
                id, ngo_id, ngo_name, title, description, need_type, job_category, emergency_level, is_critical,
                urgency, impact_level, required_volunteers, required_skills_json, required_specialists_json,
                language_requirements_json, min_volunteer_age, background_check_required, beneficiary_count,
                emergency_radius_km, lat, lng, address, start_time, end_time, contact_json, safety_notes,
                resources_available, logistics_notes, status, notified_volunteer_ids_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            needs,
        )

        applications = [
            (
                "app_demo_001",
                "need_demo_001",
                "vol_demo_001",
                "accepted",
                "Can join with medical response kit.",
                now,
                now,
            ),
            (
                "app_demo_002",
                "need_demo_002",
                "vol_demo_002",
                "interested",
                "Can confirm after 4pm.",
                now,
                now,
            ),
            (
                "app_demo_003",
                "need_demo_003",
                "vol_demo_002",
                "declined",
                "Unavailable that day.",
                now,
                now,
            ),
            (
                "app_demo_004",
                "need_demo_003",
                "vol_demo_001",
                "accepted",
                "Can help with queue operations and triage line.",
                now,
                now,
            ),
            (
                "app_demo_005",
                "need_demo_001",
                "vol_demo_003",
                "accepted",
                "Doctor on emergency rotation.",
                now,
                now,
            ),
        ]
        _executemany(
            cursor,
            """
            INSERT INTO applications
            (id, need_id, volunteer_id, decision, note, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            applications,
        )
        connection.commit()


def _seed_supplemental_demo_data() -> None:
    with get_connection() as connection:
        cursor = connection.cursor()
        now = _now_iso()

        existing_user = _execute(
            cursor,
            "SELECT id FROM users WHERE id = ?",
            ("user_vol_demo_3",),
        ).fetchone()
        if existing_user is None:
            _execute(
                cursor,
                """
                INSERT INTO users (id, role, name, email, password, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                ("user_vol_demo_3", "volunteer", "Dr. Arjun Singh", "arjun@fairaid.org", "demo123", now),
            )

        existing_volunteer = _execute(
            cursor,
            "SELECT id FROM volunteers WHERE id = ?",
            ("vol_demo_003",),
        ).fetchone()
        if existing_volunteer is None:
            _execute(
                cursor,
                """
                INSERT INTO volunteers (
                    id, user_id, name, email, phone, address, profile_image_url, job_title,
                    license_number, license_verified, verification_notes, lat, lng, radius_km,
                    skills_json, certifications_json, specialist_domains_json,
                    preferred_need_types_json, languages_json, availability_json,
                    can_handle_emergency, notes, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    "vol_demo_003",
                    "user_vol_demo_3",
                    "Dr. Arjun Singh",
                    "arjun@fairaid.org",
                    "+91-9911223344",
                    "Indirapuram, Ghaziabad",
                    "https://i.pravatar.cc/160?img=51",
                    "doctor",
                    "DOC-UP-998812",
                    1,
                    "Medical license manually verified.",
                    28.6499,
                    77.3688,
                    45.0,
                    _to_json(["doctor", "first aid", "triage", "medical support"]),
                    _to_json(["mbbs", "acls"]),
                    _to_json(["medical", "public-health"]),
                    _to_json(["medical-camp", "rescue-support"]),
                    _to_json(["hindi", "english"]),
                    _to_json([]),
                    1,
                    "On-call for emergency deployments.",
                    now,
                    now,
                ),
            )

        demo_applications = [
            (
                "app_demo_004",
                "need_demo_003",
                "vol_demo_001",
                "accepted",
                "Can help with queue operations and triage line.",
            ),
            (
                "app_demo_005",
                "need_demo_001",
                "vol_demo_003",
                "accepted",
                "Doctor on emergency rotation.",
            ),
        ]
        for app_id, need_id, volunteer_id, decision, note in demo_applications:
            existing_app = _execute(
                cursor,
                """
                SELECT id
                FROM applications
                WHERE id = ? OR (need_id = ? AND volunteer_id = ?)
                LIMIT 1
                """,
                (app_id, need_id, volunteer_id),
            ).fetchone()
            if existing_app is None:
                _execute(
                    cursor,
                    """
                    INSERT INTO applications
                    (id, need_id, volunteer_id, decision, note, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (app_id, need_id, volunteer_id, decision, note, now, now),
                )

        connection.commit()


def create_user(name: str, email: str, password: str, role: str) -> dict:
    user_id = f"user_{uuid4().hex[:12]}"
    timestamp = _now_iso()
    
    # Hash password using bcrypt
    password_hash = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
    
    with get_connection() as connection:
        cursor = connection.cursor()
        existing = _execute(
            cursor,
            "SELECT id FROM users WHERE lower(email) = lower(?)",
            (email,),
        ).fetchone()
        if existing is not None:
            raise ValueError("An account with this email already exists.")

        _execute(
            cursor,
            """
            INSERT INTO users (id, role, name, email, password, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (user_id, role, name, email, password_hash, timestamp),
        )
        connection.commit()
    return {
        "id": user_id,
        "role": role,
        "name": name,
        "email": email,
    }


def authenticate_user(email: str, password: str, role: str | None = None) -> dict | None:
    with get_connection() as connection:
        cursor = connection.cursor()
        row = _execute(
            cursor,
            """
            SELECT id, role, name, email, password
            FROM users
            WHERE lower(email) = lower(?)
            """,
            (email,),
        ).fetchone()
        
        if row is None:
            return None
            
        stored_password = _row_get(row, "password")
        
        # Verify bcrypt hash. Note: fallback to plain text if the user hasn't been migrated yet (for hackathon smooth transition)
        is_valid = False
        try:
            is_valid = bcrypt.checkpw(password.encode('utf-8'), stored_password.encode('utf-8'))
        except ValueError:
            # If stored password is not a valid bcrypt hash, compare plain text
            is_valid = (password == stored_password)
            
        if not is_valid:
            return None
            
        if role and _row_get(row, "role") != role:
            return None
            
        return {
            "id": _row_get(row, "id"),
            "role": _row_get(row, "role"),
            "name": _row_get(row, "name"),
            "email": _row_get(row, "email"),
        }


def get_user(user_id: str) -> dict | None:
    with get_connection() as connection:
        cursor = connection.cursor()
        row = _execute(
            cursor,
            "SELECT id, role, name, email FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()
        if row is None:
            return None
        return {
            "id": _row_get(row, "id"),
            "role": _row_get(row, "role"),
            "name": _row_get(row, "name"),
            "email": _row_get(row, "email"),
        }


def upsert_volunteer(payload: dict) -> dict:
    timestamp = _now_iso()
    volunteer_id = payload.get("id")
    user_id = payload.get("user_id")

    with get_connection() as connection:
        cursor = connection.cursor()
        existing = None
        if volunteer_id:
            existing = _execute(
                cursor,
                "SELECT id, created_at FROM volunteers WHERE id = ?",
                (volunteer_id,),
            ).fetchone()
        elif user_id:
            existing = _execute(
                cursor,
                "SELECT id, created_at FROM volunteers WHERE user_id = ?",
                (user_id,),
            ).fetchone()
            if existing is not None:
                volunteer_id = _row_get(existing, "id")

        if existing is None:
            volunteer_id = volunteer_id or f"vol_{uuid4().hex[:10]}"
            created_at = timestamp
            _execute(
                cursor,
                """
                INSERT INTO volunteers (
                    id, user_id, name, email, phone, address, profile_image_url, job_title,
                    license_number, license_verified, verification_notes, lat, lng, radius_km,
                    skills_json, certifications_json, specialist_domains_json,
                    preferred_need_types_json, languages_json, availability_json,
                    can_handle_emergency, notes, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    volunteer_id,
                    user_id,
                    payload["name"],
                    payload.get("email"),
                    payload.get("phone"),
                    payload.get("address"),
                    payload.get("profile_image_url"),
                    payload.get("job_title"),
                    payload.get("license_number"),
                    1 if payload.get("license_verified", False) else 0,
                    payload.get("verification_notes"),
                    payload["location"]["lat"],
                    payload["location"]["lng"],
                    payload.get("radius_km", 25.0),
                    _to_json(payload.get("skills", [])),
                    _to_json(payload.get("certifications", [])),
                    _to_json(payload.get("specialist_domains", [])),
                    _to_json(payload.get("preferred_need_types", [])),
                    _to_json(payload.get("languages", [])),
                    _to_json(payload.get("availability", [])),
                    1 if payload.get("can_handle_emergency", True) else 0,
                    payload.get("notes"),
                    created_at,
                    timestamp,
                ),
            )
        else:
            _execute(
                cursor,
                """
                UPDATE volunteers
                SET user_id = ?, name = ?, email = ?, phone = ?, address = ?, profile_image_url = ?, job_title = ?,
                    license_number = ?, license_verified = ?, verification_notes = ?, lat = ?, lng = ?, radius_km = ?,
                    skills_json = ?, certifications_json = ?, specialist_domains_json = ?,
                    preferred_need_types_json = ?, languages_json = ?, availability_json = ?,
                    can_handle_emergency = ?, notes = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    user_id,
                    payload["name"],
                    payload.get("email"),
                    payload.get("phone"),
                    payload.get("address"),
                    payload.get("profile_image_url"),
                    payload.get("job_title"),
                    payload.get("license_number"),
                    1 if payload.get("license_verified", False) else 0,
                    payload.get("verification_notes"),
                    payload["location"]["lat"],
                    payload["location"]["lng"],
                    payload.get("radius_km", 25.0),
                    _to_json(payload.get("skills", [])),
                    _to_json(payload.get("certifications", [])),
                    _to_json(payload.get("specialist_domains", [])),
                    _to_json(payload.get("preferred_need_types", [])),
                    _to_json(payload.get("languages", [])),
                    _to_json(payload.get("availability", [])),
                    1 if payload.get("can_handle_emergency", True) else 0,
                    payload.get("notes"),
                    timestamp,
                    volunteer_id,
                ),
            )

        if user_id:
            _execute(
                cursor,
                "UPDATE users SET name = ?, email = ? WHERE id = ?",
                (payload["name"], payload.get("email"), user_id),
            )
        connection.commit()

    return get_volunteer(volunteer_id)  # type: ignore[arg-type]


def _volunteer_from_row(row: sqlite3.Row | dict) -> dict:
    job_title = _normalize_job(_row_get(row, "job_title"))
    skills = _normalize_list(_from_json_list(_row_get(row, "skills_json")), _normalize_skill)
    specialist_domains = _normalize_list(
        _from_json_list(_row_get(row, "specialist_domains_json")),
        _normalize_specialist,
    )
    preferred_need_types = _normalize_list(
        _from_json_list(_row_get(row, "preferred_need_types_json")),
        _normalize_need_type,
    )
    languages = _normalize_list(
        _from_json_list(_row_get(row, "languages_json")),
        _normalize_language,
    )

    return {
        "id": _row_get(row, "id"),
        "user_id": _row_get(row, "user_id"),
        "name": _row_get(row, "name"),
        "email": _row_get(row, "email"),
        "phone": _row_get(row, "phone"),
        "address": _row_get(row, "address"),
        "profile_image_url": _row_get(row, "profile_image_url"),
        "job_title": job_title,
        "license_number": _row_get(row, "license_number"),
        "license_verified": bool(_row_get(row, "license_verified")),
        "verification_notes": _row_get(row, "verification_notes"),
        "location": {"lat": _row_get(row, "lat"), "lng": _row_get(row, "lng")},
        "radius_km": _row_get(row, "radius_km"),
        "skills": skills,
        "certifications": _from_json_list(_row_get(row, "certifications_json")),
        "specialist_domains": specialist_domains,
        "preferred_need_types": preferred_need_types,
        "languages": languages,
        "availability": _from_json_list(_row_get(row, "availability_json")),
        "can_handle_emergency": bool(_row_get(row, "can_handle_emergency")),
        "notes": _row_get(row, "notes"),
        "created_at": _row_get(row, "created_at"),
        "updated_at": _row_get(row, "updated_at"),
    }


def get_volunteer(volunteer_id: str) -> dict | None:
    with get_connection() as connection:
        cursor = connection.cursor()
        row = _execute(
            cursor,
            "SELECT * FROM volunteers WHERE id = ?",
            (volunteer_id,),
        ).fetchone()
        if row is None:
            return None
        return _volunteer_from_row(row)


def get_volunteer_by_user(user_id: str) -> dict | None:
    with get_connection() as connection:
        cursor = connection.cursor()
        row = _execute(
            cursor,
            "SELECT * FROM volunteers WHERE user_id = ?",
            (user_id,),
        ).fetchone()
        if row is None:
            return None
        return _volunteer_from_row(row)


def list_volunteers() -> list[dict]:
    with get_connection() as connection:
        cursor = connection.cursor()
        rows = _execute(
            cursor,
            "SELECT * FROM volunteers ORDER BY created_at DESC",
        ).fetchall()
    return [_volunteer_from_row(row) for row in rows]


def create_need(payload: dict) -> dict:
    need_id = f"need_{uuid4().hex[:10]}"
    timestamp = _now_iso()
    with get_connection() as connection:
        cursor = connection.cursor()
        _execute(
            cursor,
            """
            INSERT INTO needs (
                id, ngo_id, ngo_name, title, description, need_type, job_category, emergency_level, is_critical,
                urgency, impact_level, required_volunteers, required_skills_json, required_specialists_json,
                language_requirements_json, min_volunteer_age, background_check_required, beneficiary_count,
                emergency_radius_km, lat, lng, address, start_time, end_time, contact_json, safety_notes,
                resources_available, logistics_notes, status, notified_volunteer_ids_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                need_id,
                payload["ngo_id"],
                payload["ngo_name"],
                payload["title"],
                payload["description"],
                payload["need_type"],
                payload.get("job_category"),
                payload.get("emergency_level", "non_emergency"),
                1 if payload.get("is_critical", False) else 0,
                payload.get("urgency", 3),
                payload.get("impact_level", 3),
                payload["required_volunteers"],
                _to_json(payload.get("required_skills", [])),
                _to_json(payload.get("required_specialists", [])),
                _to_json(payload.get("language_requirements", [])),
                payload.get("min_volunteer_age"),
                1 if payload.get("background_check_required", False) else 0,
                payload.get("beneficiary_count"),
                payload.get("emergency_radius_km", 25.0),
                payload["location"]["lat"],
                payload["location"]["lng"],
                payload.get("address"),
                payload.get("start_time"),
                payload.get("end_time"),
                _to_json(payload.get("contact", {})),
                payload.get("safety_notes"),
                payload.get("resources_available"),
                payload.get("logistics_notes"),
                "open",
                _to_json([]),
                timestamp,
                timestamp,
            ),
        )
        connection.commit()
    return get_need(need_id)  # type: ignore[arg-type]


def update_need_notifications(need_id: str, volunteer_ids: list[str]) -> None:
    with get_connection() as connection:
        cursor = connection.cursor()
        _execute(
            cursor,
            "UPDATE needs SET notified_volunteer_ids_json = ?, updated_at = ? WHERE id = ?",
            (_to_json(volunteer_ids), _now_iso(), need_id),
        )
        connection.commit()


def delete_need(ngo_id: str, need_id: str) -> bool:
    with get_connection() as connection:
        cursor = connection.cursor()
        existing = _execute(
            cursor,
            "SELECT id FROM needs WHERE id = ? AND ngo_id = ?",
            (need_id, ngo_id),
        ).fetchone()
        if existing is None:
            return False

        _execute(
            cursor,
            "UPDATE needs SET status = 'closed', updated_at = ? WHERE id = ? AND ngo_id = ?",
            (_now_iso(), need_id, ngo_id),
        )
        connection.commit()
        return True


def add_need_audit_log(
    need_id: str,
    action: str,
    actor_id: str | None = None,
    actor_role: str | None = None,
    details: dict | None = None,
) -> None:
    with get_connection() as connection:
        cursor = connection.cursor()
        _execute(
            cursor,
            """
            INSERT INTO need_audit_logs (id, need_id, actor_id, actor_role, action, details_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                f"audit_{uuid4().hex[:12]}",
                need_id,
                actor_id,
                actor_role,
                action,
                _to_json(details or {}),
                _now_iso(),
            ),
        )
        connection.commit()


def list_need_audit_logs(need_id: str) -> list[dict]:
    with get_connection() as connection:
        cursor = connection.cursor()
        rows = _execute(
            cursor,
            "SELECT * FROM need_audit_logs WHERE need_id = ? ORDER BY created_at DESC",
            (need_id,),
        ).fetchall()

    logs: list[dict] = []
    for row in rows:
        logs.append(
            {
                "id": _row_get(row, "id"),
                "need_id": _row_get(row, "need_id"),
                "actor_id": _row_get(row, "actor_id"),
                "actor_role": _row_get(row, "actor_role"),
                "action": _row_get(row, "action"),
                "details": _from_json_dict(_row_get(row, "details_json")),
                "created_at": _row_get(row, "created_at"),
            }
        )
    return logs


def create_notification(
    volunteer_id: str,
    title: str,
    message: str,
    channels: list[str],
    need_id: str | None = None,
    status: str = "sent",
) -> str:
    notification_id = f"note_{uuid4().hex[:12]}"
    created_at = _now_iso()
    with get_connection() as connection:
        cursor = connection.cursor()
        _execute(
            cursor,
            """
            INSERT INTO notifications
            (id, volunteer_id, need_id, title, message, channels_json, status, is_read, created_at, sent_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                notification_id,
                volunteer_id,
                need_id,
                title,
                message,
                _to_json(channels),
                status,
                0,
                created_at,
                created_at if status == "sent" else None,
            ),
        )
        for channel in channels:
            _execute(
                cursor,
                """
                INSERT INTO notification_events
                (id, notification_id, channel, delivery_status, detail, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    f"noteevt_{uuid4().hex[:12]}",
                    notification_id,
                    channel,
                    "simulated_sent",
                    "Delivery simulated in local environment.",
                    created_at,
                ),
            )
        connection.commit()
    return notification_id


def list_volunteer_notifications(volunteer_id: str, unread_only: bool = False) -> list[dict]:
    with get_connection() as connection:
        cursor = connection.cursor()
        query = "SELECT * FROM notifications WHERE volunteer_id = ?"
        params: list[object] = [volunteer_id]
        if unread_only:
            query += " AND is_read = 0"
        query += " ORDER BY created_at DESC"
        rows = _execute(cursor, query, params).fetchall()

    items: list[dict] = []
    for row in rows:
        items.append(
            {
                "id": _row_get(row, "id"),
                "volunteer_id": _row_get(row, "volunteer_id"),
                "need_id": _row_get(row, "need_id"),
                "title": _row_get(row, "title"),
                "message": _row_get(row, "message"),
                "channels": _from_json_list(_row_get(row, "channels_json")),
                "status": _row_get(row, "status"),
                "is_read": bool(_row_get(row, "is_read")),
                "created_at": _row_get(row, "created_at"),
                "sent_at": _row_get(row, "sent_at"),
            }
        )
    return items


def mark_notification_read(notification_id: str, volunteer_id: str) -> bool:
    with get_connection() as connection:
        cursor = connection.cursor()
        existing = _execute(
            cursor,
            "SELECT id FROM notifications WHERE id = ? AND volunteer_id = ?",
            (notification_id, volunteer_id),
        ).fetchone()
        if existing is None:
            return False
        _execute(
            cursor,
            "UPDATE notifications SET is_read = 1 WHERE id = ? AND volunteer_id = ?",
            (notification_id, volunteer_id),
        )
        connection.commit()
        return True


def create_field_report(payload: dict) -> dict:
    report_id = f"fr_{uuid4().hex[:12]}"
    timestamp = _now_iso()
    categories = payload.get("categories", [])
    supply_needs = payload.get("supply_needs", [])
    location = payload.get("location") or {}

    with get_connection() as connection:
        cursor = connection.cursor()
        _execute(
            cursor,
            """
            CREATE TABLE IF NOT EXISTS field_reports (
                id TEXT PRIMARY KEY,
                volunteer_id TEXT,
                summary TEXT NOT NULL,
                severity TEXT NOT NULL,
                categories_json TEXT NOT NULL,
                supply_needs_json TEXT NOT NULL,
                people_count_estimate INTEGER NOT NULL DEFAULT 0,
                required_volunteers_estimate INTEGER NOT NULL DEFAULT 0,
                location_lat REAL,
                location_lng REAL,
                address TEXT,
                raw_audio_text TEXT,
                image_hint TEXT,
                created_at TEXT NOT NULL
            )
            """,
        )
        _execute(
            cursor,
            """
            INSERT INTO field_reports (
                id, volunteer_id, summary, severity, categories_json, supply_needs_json,
                people_count_estimate, required_volunteers_estimate, location_lat, location_lng,
                address, raw_audio_text, image_hint, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                report_id,
                payload.get("volunteer_id"),
                payload.get("summary", ""),
                payload.get("severity", "medium"),
                _to_json(categories if isinstance(categories, list) else []),
                _to_json(supply_needs if isinstance(supply_needs, list) else []),
                int(payload.get("people_count_estimate", 0) or 0),
                int(payload.get("required_volunteers_estimate", 0) or 0),
                location.get("lat"),
                location.get("lng"),
                payload.get("address"),
                payload.get("raw_audio_text"),
                payload.get("image_hint"),
                timestamp,
            ),
        )
        connection.commit()

    created = get_field_report(report_id)
    if created is None:
        raise RuntimeError("Field report could not be created.")
    return created


def _field_report_from_row(row: sqlite3.Row | dict) -> dict:
    return {
        "id": _row_get(row, "id"),
        "volunteer_id": _row_get(row, "volunteer_id"),
        "summary": _row_get(row, "summary"),
        "severity": _row_get(row, "severity"),
        "categories": _from_json_list(_row_get(row, "categories_json")),
        "supply_needs": _from_json_list(_row_get(row, "supply_needs_json")),
        "people_count_estimate": int(_row_get(row, "people_count_estimate") or 0),
        "required_volunteers_estimate": int(
            _row_get(row, "required_volunteers_estimate") or 0
        ),
        "location": (
            {
                "lat": _row_get(row, "location_lat"),
                "lng": _row_get(row, "location_lng"),
            }
            if _row_get(row, "location_lat") is not None
            and _row_get(row, "location_lng") is not None
            else None
        ),
        "address": _row_get(row, "address"),
        "raw_audio_text": _row_get(row, "raw_audio_text"),
        "image_hint": _row_get(row, "image_hint"),
        "created_at": _row_get(row, "created_at"),
    }


def get_field_report(report_id: str) -> dict | None:
    with get_connection() as connection:
        cursor = connection.cursor()
        _execute(
            cursor,
            """
            CREATE TABLE IF NOT EXISTS field_reports (
                id TEXT PRIMARY KEY,
                volunteer_id TEXT,
                summary TEXT NOT NULL,
                severity TEXT NOT NULL,
                categories_json TEXT NOT NULL,
                supply_needs_json TEXT NOT NULL,
                people_count_estimate INTEGER NOT NULL DEFAULT 0,
                required_volunteers_estimate INTEGER NOT NULL DEFAULT 0,
                location_lat REAL,
                location_lng REAL,
                address TEXT,
                raw_audio_text TEXT,
                image_hint TEXT,
                created_at TEXT NOT NULL
            )
            """,
        )
        row = _execute(
            cursor,
            "SELECT * FROM field_reports WHERE id = ?",
            (report_id,),
        ).fetchone()
        if row is None:
            return None
        return _field_report_from_row(row)


def list_field_reports(limit: int = 50) -> list[dict]:
    safe_limit = max(1, min(int(limit), 200))
    with get_connection() as connection:
        cursor = connection.cursor()
        _execute(
            cursor,
            """
            CREATE TABLE IF NOT EXISTS field_reports (
                id TEXT PRIMARY KEY,
                volunteer_id TEXT,
                summary TEXT NOT NULL,
                severity TEXT NOT NULL,
                categories_json TEXT NOT NULL,
                supply_needs_json TEXT NOT NULL,
                people_count_estimate INTEGER NOT NULL DEFAULT 0,
                required_volunteers_estimate INTEGER NOT NULL DEFAULT 0,
                location_lat REAL,
                location_lng REAL,
                address TEXT,
                raw_audio_text TEXT,
                image_hint TEXT,
                created_at TEXT NOT NULL
            )
            """,
        )
        rows = _execute(
            cursor,
            "SELECT * FROM field_reports ORDER BY created_at DESC LIMIT ?",
            (safe_limit,),
        ).fetchall()
    return [_field_report_from_row(row) for row in rows]


def delete_field_report(report_id: str) -> bool:
    with get_connection() as connection:
        cursor = connection.cursor()
        existing = _execute(
            cursor,
            "SELECT id FROM field_reports WHERE id = ?",
            (report_id,),
        ).fetchone()
        if existing is None:
            return False
        _execute(
            cursor,
            "DELETE FROM field_reports WHERE id = ?",
            (report_id,),
        )
        connection.commit()
        return True


def _application_counts(need_id: str) -> dict:
    with get_connection() as connection:
        cursor = connection.cursor()
        rows = _execute(
            cursor,
            "SELECT decision, volunteer_id FROM applications WHERE need_id = ?",
            (need_id,),
        ).fetchall()

    accepted = 0
    interested = 0
    declined = 0
    assigned_volunteers: list[str] = []

    for row in rows:
        decision = _row_get(row, "decision")
        volunteer_id = _row_get(row, "volunteer_id")
        if decision == "accepted":
            accepted += 1
            assigned_volunteers.append(volunteer_id)
        elif decision in {"interested", "pinned"}:
            interested += 1
        elif decision == "declined":
            declined += 1

    return {
        "accepted_count": accepted,
        "interested_count": interested,
        "declined_count": declined,
        "assigned_volunteers": assigned_volunteers,
    }


def _need_from_row(row: sqlite3.Row | dict) -> dict:
    counts = _application_counts(_row_get(row, "id"))
    need_type = _normalize_need_type(_row_get(row, "need_type")) or "community-support"
    job_category = _normalize_job(_row_get(row, "job_category"))
    required_skills = _normalize_list(
        _from_json_list(_row_get(row, "required_skills_json")),
        _normalize_skill,
    )
    required_specialists = _normalize_list(
        _from_json_list(_row_get(row, "required_specialists_json")),
        _normalize_specialist,
    )
    language_requirements = _normalize_list(
        _from_json_list(_row_get(row, "language_requirements_json")),
        _normalize_language,
    )

    return {
        "id": _row_get(row, "id"),
        "ngo_id": _row_get(row, "ngo_id"),
        "ngo_name": _row_get(row, "ngo_name"),
        "title": _row_get(row, "title"),
        "description": _row_get(row, "description"),
        "need_type": need_type,
        "job_category": job_category,
        "emergency_level": _row_get(row, "emergency_level"),
        "is_critical": bool(_row_get(row, "is_critical")),
        "urgency": _row_get(row, "urgency"),
        "impact_level": _row_get(row, "impact_level"),
        "required_volunteers": _row_get(row, "required_volunteers"),
        "required_skills": required_skills,
        "required_specialists": required_specialists,
        "language_requirements": language_requirements,
        "min_volunteer_age": _row_get(row, "min_volunteer_age"),
        "background_check_required": bool(_row_get(row, "background_check_required")),
        "beneficiary_count": _row_get(row, "beneficiary_count"),
        "emergency_radius_km": _row_get(row, "emergency_radius_km"),
        "location": {"lat": _row_get(row, "lat"), "lng": _row_get(row, "lng")},
        "address": _row_get(row, "address"),
        "start_time": _row_get(row, "start_time"),
        "end_time": _row_get(row, "end_time"),
        "contact": _from_json_dict(_row_get(row, "contact_json")),
        "safety_notes": _row_get(row, "safety_notes"),
        "resources_available": _row_get(row, "resources_available"),
        "logistics_notes": _row_get(row, "logistics_notes"),
        "status": _row_get(row, "status"),
        "notified_volunteer_ids": _from_json_list(_row_get(row, "notified_volunteer_ids_json")),
        "assigned_volunteers": counts["assigned_volunteers"],
        "accepted_count": counts["accepted_count"],
        "interested_count": counts["interested_count"],
        "declined_count": counts["declined_count"],
        "created_at": _row_get(row, "created_at"),
        "updated_at": _row_get(row, "updated_at"),
    }


def get_need(need_id: str) -> dict | None:
    with get_connection() as connection:
        cursor = connection.cursor()
        row = _execute(cursor, "SELECT * FROM needs WHERE id = ?", (need_id,)).fetchone()
        if row is None:
            return None
    return _need_from_row(row)


def list_needs(status: str | None = "open", emergency_only: bool = False) -> list[dict]:
    with get_connection() as connection:
        cursor = connection.cursor()
        query = "SELECT * FROM needs WHERE 1=1"
        params: list[object] = []
        if status:
            query += " AND status = ?"
            params.append(status)
        if emergency_only:
            query += " AND emergency_level = 'emergency'"
        query += " ORDER BY CASE WHEN emergency_level = 'emergency' THEN 1 ELSE 0 END DESC, created_at DESC"
        rows = _execute(cursor, query, params).fetchall()

    return [_need_from_row(row) for row in rows]


def list_ngo_needs(ngo_id: str) -> list[dict]:
    with get_connection() as connection:
        cursor = connection.cursor()
        rows = _execute(
            cursor,
            "SELECT * FROM needs WHERE ngo_id = ? ORDER BY created_at DESC",
            (ngo_id,),
        ).fetchall()
    return [_need_from_row(row) for row in rows]


def upsert_application(
    need_id: str,
    volunteer_id: str,
    decision: str,
    note: str | None = None,
) -> dict:
    with get_connection() as connection:
        cursor = connection.cursor()
        now = _now_iso()
        existing = _execute(
            cursor,
            "SELECT id FROM applications WHERE need_id = ? AND volunteer_id = ?",
            (need_id, volunteer_id),
        ).fetchone()
        if existing is None:
            _execute(
                cursor,
                """
                INSERT INTO applications (id, need_id, volunteer_id, decision, note, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (f"app_{uuid4().hex[:10]}", need_id, volunteer_id, decision, note, now, now),
            )
        else:
            _execute(
                cursor,
                """
                UPDATE applications
                SET decision = ?, note = ?, updated_at = ?
                WHERE need_id = ? AND volunteer_id = ?
                """,
                (decision, note, now, need_id, volunteer_id),
            )
        connection.commit()
    return get_application_counts(need_id)


def get_application_counts(need_id: str) -> dict:
    return _application_counts(need_id)


def get_volunteer_decision(need_id: str, volunteer_id: str) -> str | None:
    with get_connection() as connection:
        cursor = connection.cursor()
        row = _execute(
            cursor,
            "SELECT decision FROM applications WHERE need_id = ? AND volunteer_id = ?",
            (need_id, volunteer_id),
        ).fetchone()
        if row is None:
            return None
        return _row_get(row, "decision")


def upsert_embedding(entity_type: str, entity_id: str, vector: list[float]) -> None:
    with get_connection() as connection:
        cursor = connection.cursor()
        _execute(
            cursor,
            """
            INSERT INTO embeddings (entity_type, entity_id, vector_json, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(entity_type, entity_id)
            DO UPDATE SET vector_json = excluded.vector_json, updated_at = excluded.updated_at
            """,
            (entity_type, entity_id, _to_json(vector), _now_iso()),
        )
        connection.commit()


def get_embedding(entity_type: str, entity_id: str) -> list[float] | None:
    with get_connection() as connection:
        cursor = connection.cursor()
        row = _execute(
            cursor,
            "SELECT vector_json FROM embeddings WHERE entity_type = ? AND entity_id = ?",
            (entity_type, entity_id),
        ).fetchone()
        if row is None:
            return None
    try:
        parsed = json.loads(_row_get(row, "vector_json"))
    except json.JSONDecodeError:
        return None
    if not isinstance(parsed, list):
        return None

    vector: list[float] = []
    for item in parsed:
        try:
            vector.append(float(item))
        except (TypeError, ValueError):
            return None
    return vector


def database_runtime_info() -> dict:
    return {
        "configured_backend": "postgres" if USE_POSTGRES else "sqlite",
        "active_backend": ACTIVE_BACKEND,
        "postgres_configured": USE_POSTGRES,
        "postgres_error": LAST_POSTGRES_ERROR,
        "sqlite_path": str(DB_PATH),
    }


def list_need_applications(need_id: str) -> list[dict]:
    """Return all applications for a need with volunteer profile details (for NGO roster view)."""
    with get_connection() as connection:
        cursor = connection.cursor()
        rows = _execute(
            cursor,
            """
            SELECT
                a.id          AS app_id,
                a.volunteer_id,
                a.decision,
                a.note,
                a.created_at  AS applied_at,
                v.name,
                v.email,
                v.phone,
                v.job_title,
                v.profile_image_url,
                v.lat,
                v.lng,
                v.license_verified
            FROM applications a
            JOIN volunteers v ON v.id = a.volunteer_id
            WHERE a.need_id = ?
            ORDER BY
                CASE a.decision
                    WHEN 'accepted' THEN 0
                    WHEN 'pinned'   THEN 1
                    ELSE 2
                END,
                a.created_at ASC
            """,
            (need_id,),
        ).fetchall()

    result: list[dict] = []
    for row in rows:
        result.append({
            "app_id":            _row_get(row, "app_id"),
            "volunteer_id":      _row_get(row, "volunteer_id"),
            "decision":          _row_get(row, "decision"),
            "note":              _row_get(row, "note"),
            "applied_at":        _row_get(row, "applied_at"),
            "name":              _row_get(row, "name"),
            "email":             _row_get(row, "email"),
            "phone":             _row_get(row, "phone"),
            "job_title":         _row_get(row, "job_title"),
            "profile_image_url": _row_get(row, "profile_image_url"),
            "lat":               _row_get(row, "lat"),
            "lng":               _row_get(row, "lng"),
            "license_verified":  bool(_row_get(row, "license_verified")),
        })
    return result


def _seed_extra_demo_volunteers() -> None:
    """Add 7 diverse demo volunteers + 3 extra needs if not already seeded."""
    with get_connection() as connection:
        cursor = connection.cursor()
        now = _now_iso()

        extra_users = [
            ("user_vol_demo_4",  "volunteer", "Priya Kapoor",     "priya@fairaid.org",  "demo123"),
            ("user_vol_demo_5",  "volunteer", "Rohan Joshi",      "rohan@fairaid.org",  "demo123"),
            ("user_vol_demo_6",  "volunteer", "Meera Iyer",       "meera@fairaid.org",  "demo123"),
            ("user_vol_demo_7",  "volunteer", "Aman Khan",        "aman@fairaid.org",   "demo123"),
            ("user_vol_demo_8",  "volunteer", "Dr. Sunita Rao",   "sunita@fairaid.org", "demo123"),
            ("user_vol_demo_9",  "volunteer", "Kabir Malhotra",   "kabir@fairaid.org",  "demo123"),
            ("user_vol_demo_10", "volunteer", "Farida Sheikh",    "farida@fairaid.org", "demo123"),
        ]
        for uid, role, name, email, pwd in extra_users:
            if _execute(cursor, "SELECT id FROM users WHERE id = ?", (uid,)).fetchone() is None:
                _execute(
                    cursor,
                    "INSERT INTO users (id, role, name, email, password, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                    (uid, role, name, email, pwd, now),
                )

        vol_sql = """
        INSERT INTO volunteers (
            id, user_id, name, email, phone, address, profile_image_url, job_title,
            license_number, license_verified, verification_notes,
            lat, lng, radius_km,
            skills_json, certifications_json, specialist_domains_json,
            preferred_need_types_json, languages_json, availability_json,
            can_handle_emergency, notes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """
        extra_vols = [
            ("vol_demo_004", "user_vol_demo_4",  "Priya Kapoor",   "priya@fairaid.org",
             "+91-9811001100", "Saket, New Delhi",          "https://i.pravatar.cc/160?img=47",
             "nurse",                "NRS-DL-20230088", 1, "Registered nurse, license verified.",
             28.5270, 77.2131, 30.0,
             _to_json(["first aid","nursing care","medical support","triage"]),
             _to_json(["bcls","acls"]),
             _to_json(["medical","public-health"]),
             _to_json(["medical-camp","shelter"]),
             _to_json(["hindi","english"]),
             _to_json([]), 1, "Available for night shifts."),
            ("vol_demo_005", "user_vol_demo_5",  "Rohan Joshi",    "rohan@fairaid.org",
             "+91-9871234567", "Sector 62, Noida",           "https://i.pravatar.cc/160?img=15",
             "operations volunteer", "",                0, "",
             28.6271, 77.3708, 40.0,
             _to_json(["logistics","supply chain","crowd management"]),
             _to_json(["logistics"]),
             _to_json(["disaster-management"]),
             _to_json(["food-distribution","shelter"]),
             _to_json(["hindi","english"]),
             _to_json([]), 1, "Logistics coordinator."),
            ("vol_demo_006", "user_vol_demo_6",  "Meera Iyer",     "meera@fairaid.org",
             "+91-9845678901", "DLF Phase 2, Gurugram",      "https://i.pravatar.cc/160?img=25",
             "counselor",           "PSY-H-2021-004",  1, "Licensed psychologist.",
             28.4813, 77.0879, 35.0,
             _to_json(["counseling","mental health support","child safety"]),
             _to_json(["mental-health-first-aid"]),
             _to_json(["counseling"]),
             _to_json(["mental-health","education"]),
             _to_json(["hindi","tamil","english"]),
             _to_json([]), 0, "Trauma and PTSD specialist."),
            ("vol_demo_007", "user_vol_demo_7",  "Aman Khan",      "aman@fairaid.org",
             "+91-9315577890", "Old Faridabad",               "https://i.pravatar.cc/160?img=57",
             "operations volunteer", "",                0, "",
             28.4089, 77.3178, 50.0,
             _to_json(["driving","logistics","heavy equipment"]),
             _to_json(["hgv-license"]),
             _to_json(["disaster-management"]),
             _to_json(["shelter","rescue-support"]),
             _to_json(["hindi","urdu"]),
             _to_json([]), 1, "HGV driver, can transport supplies."),
            ("vol_demo_008", "user_vol_demo_8",  "Dr. Sunita Rao", "sunita@fairaid.org",
             "+91-9712233445", "Vaishali, Ghaziabad",         "https://i.pravatar.cc/160?img=44",
             "doctor",              "DOC-UP-776612",  1, "Senior physician, verified.",
             28.6426, 77.3487, 45.0,
             _to_json(["doctor","triage","public health","vaccination"]),
             _to_json(["mbbs","md-community-medicine"]),
             _to_json(["medical","public-health"]),
             _to_json(["medical-camp","sanitation"]),
             _to_json(["hindi","telugu","english"]),
             _to_json([]), 1, "Public health specialist."),
            ("vol_demo_009", "user_vol_demo_9",  "Kabir Malhotra", "kabir@fairaid.org",
             "+91-9891234000", "Rohini Sector 11, Delhi",    "https://i.pravatar.cc/160?img=61",
             "teacher",             "",                0, "",
             28.7041, 77.1025, 25.0,
             _to_json(["teaching","child safety","literacy"]),
             _to_json(["child-protection"]),
             _to_json(["education"]),
             _to_json(["education","food-distribution"]),
             _to_json(["hindi","punjabi","english"]),
             _to_json([]), 1, "Primary school teacher."),
            ("vol_demo_010", "user_vol_demo_10", "Farida Sheikh",  "farida@fairaid.org",
             "+91-9988001122", "Sector 45, Noida",            "https://i.pravatar.cc/160?img=38",
             "operations volunteer", "",                0, "",
             28.5612, 77.3742, 30.0,
             _to_json(["translation","community outreach","sign language"]),
             _to_json(["interpreter-certification"]),
             _to_json(["legal-aid"]),
             _to_json(["education","shelter","mental-health"]),
             _to_json(["hindi","bengali","urdu","english"]),
             _to_json([]), 1, "Multilingual coordinator."),
        ]
        for v in extra_vols:
            if _execute(cursor, "SELECT id FROM volunteers WHERE id = ?", (v[0],)).fetchone() is None:
                _execute(cursor, vol_sql, (*v, now, now))

        need_sql = """
        INSERT INTO needs (
            id, ngo_id, ngo_name, title, description,
            need_type, job_category, emergency_level, is_critical,
            urgency, impact_level, required_volunteers,
            required_skills_json, required_specialists_json, language_requirements_json,
            min_volunteer_age, background_check_required, beneficiary_count,
            emergency_radius_km, lat, lng, address,
            start_time, end_time, contact_json,
            safety_notes, resources_available, logistics_notes,
            status, notified_volunteer_ids_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """
        extra_needs = [
            ("need_demo_004", "user_ngo_demo", "Sahara Community Relief",
             "Trauma Counselling for Displaced Families",
             "Families in Noida relief camps showing acute trauma. Need qualified counselors.",
             "mental-health", "counselor", "non_emergency", 0, 4, 4, 12,
             _to_json(["counseling","mental health support"]),
             _to_json(["counseling"]),
             _to_json(["hindi","english"]),
             None, 0, 80, 25.0, 28.5350, 77.3910,
             "Relief Camp B, Sector 45, Noida",
             "2026-04-10T10:00:00+05:30", "2026-04-10T17:00:00+05:30",
             _to_json({"name": "Dr. Priya Sinha", "phone": "+91-9555566677"}),
             "Use trauma-informed language.", "Quiet tents provided.",
             "Briefing at 09:30.", "open", _to_json([])),
            ("need_demo_005", "user_ngo_demo", "Sahara Community Relief",
             "Emergency Shelter Setup — Faridabad South",
             "Assemble 40 temporary shelters. Physical fitness essential.",
             "shelter", "operations volunteer", "emergency", 1, 5, 5, 25,
             _to_json(["logistics","heavy equipment","crowd management"]),
             _to_json(["disaster-management"]),
             _to_json(["hindi"]),
             18, 0, 200, 35.0, 28.4200, 77.3050,
             "Site C, NH-19 Service Road, Faridabad",
             "2026-04-09T07:00:00+05:30", "2026-04-09T19:00:00+05:30",
             _to_json({"name": "Suresh Nair", "phone": "+91-9111222333"}),
             "Wear closed shoes. Hard hats provided.", "Tools and tarpaulins available.",
             "Report to Gate 2.", "open", _to_json([])),
            ("need_demo_006", "user_ngo_demo", "Sahara Community Relief",
             "Water Sanitation Drive — Ghaziabad East",
             "Distribute water purification tablets. Queue management + health guidance.",
             "sanitation", "operations volunteer", "non_emergency", 0, 3, 4, 18,
             _to_json(["logistics","public health","crowd management"]),
             _to_json(["public-health"]),
             _to_json(["hindi"]),
             None, 0, 500, 20.0, 28.6692, 77.4538,
             "Community Centre, Vasundhara, Ghaziabad",
             "2026-04-11T09:00:00+05:30", "2026-04-11T15:00:00+05:30",
             _to_json({"name": "Anika Singh", "phone": "+91-9876543210"}),
             "Ensure water is chlorinated.", "Tablets and hygiene kits provided.",
             "Meet at main entrance 08:45.", "open", _to_json([])),
            ("need_demo_007", "user_ngo_demo", "Sahara Community Relief",
             "Yamuna Flood Evacuation Support — ITO Belt",
             "Rapid evacuation support required for families stuck near low-lying riverbank clusters.",
             "evacuation", "operations volunteer", "emergency", 1, 5, 5, 30,
             _to_json(["disaster response","crowd management","driving"]),
             _to_json(["disaster-management","communications"]),
             _to_json(["hindi","english"]),
             18, 0, 260, 45.0, 28.6289, 77.2426,
             "Temporary Transit Camp, ITO, New Delhi",
             "2026-04-28T06:00:00+05:30", "2026-04-28T18:30:00+05:30",
             _to_json({"name": "Rahul Anand", "phone": "+91-9001122334"}),
             "Life jackets mandatory near flood zone.", "Boats, buses and first aid van available.",
             "Batch briefing every 45 minutes.", "open", _to_json([])),
            ("need_demo_008", "user_ngo_demo", "Sahara Community Relief",
             "Animal Rescue and Vet Support — Noida Extension",
             "Companion animals and livestock displaced after heavy rains. Need rescue and veterinary triage.",
             "animal-rescue", "veterinarian", "non_emergency", 0, 4, 4, 10,
             _to_json(["animal rescue","veterinary support","community outreach"]),
             _to_json(["veterinary"]),
             _to_json(["hindi"]),
             None, 0, 95, 22.0, 28.5709, 77.3665,
             "Gaushala Transit Point, Noida Extension",
             "2026-04-29T08:30:00+05:30", "2026-04-29T16:00:00+05:30",
             _to_json({"name": "Farah Khan", "phone": "+91-9223344556"}),
             "Use gloves while handling injured animals.", "Vet kits and cages arranged on site.",
             "Register each rescued animal at entry desk.", "open", _to_json([])),
            ("need_demo_009", "user_ngo_demo", "Sahara Community Relief",
             "Night Community Kitchen — Seemapuri",
             "Set up and run a nightly kitchen for migrant families impacted by disruption in wage work.",
             "food-distribution", "operations volunteer", "non_emergency", 0, 3, 4, 20,
             _to_json(["food distribution","logistics","beneficiary registration"]),
             _to_json(["logistics"]),
             _to_json(["hindi","urdu"]),
             None, 0, 420, 18.0, 28.6844, 77.3270,
             "Ward Community Hall, Seemapuri",
             "2026-04-28T18:00:00+05:30", "2026-04-29T00:30:00+05:30",
             _to_json({"name": "Jatin Batra", "phone": "+91-9445566778"}),
             "Food hygiene and queue protocol required.", "Dry ration and cookware available.",
             "Shift handover at 21:00.", "open", _to_json([])),
            ("need_demo_010", "user_ngo_demo", "Sahara Community Relief",
             "Mobile Medical Transport Coordination — East Delhi",
             "Need drivers and dispatch support for transporting patients to partner hospitals.",
             "medical-transport", "ambulance driver", "emergency", 0, 5, 5, 14,
             _to_json(["driving","ambulance coordination","communications"]),
             _to_json(["medical","communications"]),
             _to_json(["hindi","english"]),
             21, 1, 70, 35.0, 28.6519, 77.3075,
             "Dispatch Base, Laxmi Nagar",
             "2026-04-28T07:00:00+05:30", "2026-04-28T22:00:00+05:30",
             _to_json({"name": "Neeraj Sethi", "phone": "+91-9778899001"}),
             "Drive only on assigned route; maintain patient logs.", "Fuel cards and stretcher support available.",
             "Dispatch desk inside base office.", "open", _to_json([])),
        ]
        for n in extra_needs:
            if _execute(cursor, "SELECT id FROM needs WHERE id = ?", (n[0],)).fetchone() is None:
                _execute(cursor, need_sql, (*n, now, now))

        app_sql = """
        INSERT INTO applications (id, need_id, volunteer_id, decision, note, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """
        extra_apps = [
            ("app_demo_010", "need_demo_001", "vol_demo_004", "accepted", "Nurse joining medical team."),
            ("app_demo_011", "need_demo_002", "vol_demo_009", "accepted", "Teacher confirming attendance."),
            ("app_demo_012", "need_demo_003", "vol_demo_005", "accepted", "Logistics coordinator ready."),
            ("app_demo_013", "need_demo_004", "vol_demo_006", "accepted", "Counselor available all day."),
            ("app_demo_014", "need_demo_004", "vol_demo_010", "pinned",   "Can translate for Bengali families."),
            ("app_demo_015", "need_demo_005", "vol_demo_007", "accepted", "HGV driver ready."),
            ("app_demo_016", "need_demo_005", "vol_demo_005", "accepted", "Logistics support."),
            ("app_demo_017", "need_demo_006", "vol_demo_008", "accepted", "Public health doctor."),
            ("app_demo_018", "need_demo_006", "vol_demo_001", "pinned",   "Available if backup needed."),
            ("app_demo_019", "need_demo_007", "vol_demo_007", "accepted", "Can manage evacuation buses."),
            ("app_demo_020", "need_demo_007", "vol_demo_005", "accepted", "Logistics + crowd routing."),
            ("app_demo_021", "need_demo_007", "vol_demo_010", "pinned",   "Can assist with translation if needed."),
            ("app_demo_022", "need_demo_008", "vol_demo_010", "accepted", "Can coordinate local handlers."),
            ("app_demo_023", "need_demo_009", "vol_demo_009", "accepted", "Can manage registration desk."),
            ("app_demo_024", "need_demo_009", "vol_demo_004", "pinned",   "Can join after hospital shift."),
            ("app_demo_025", "need_demo_010", "vol_demo_001", "accepted", "Available for patient transport."),
            ("app_demo_026", "need_demo_010", "vol_demo_007", "accepted", "Driver with night-shift availability."),
        ]
        for app_id, need_id, vol_id, decision, note in extra_apps:
            existing = _execute(
                cursor,
                "SELECT id FROM applications WHERE id = ? OR (need_id = ? AND volunteer_id = ?)",
                (app_id, need_id, vol_id),
            ).fetchone()
            if existing is None:
                _execute(cursor, app_sql, (app_id, need_id, vol_id, decision, note, now, now))

        field_reports = [
            (
                "fr_demo_001",
                "vol_demo_001",
                "Floodwater entered 2 lanes near Yamuna bank. Families requesting dry rations and clean water.",
                "high",
                _to_json(["flood-response", "food-distribution"]),
                _to_json(["water", "dry ration", "blankets"]),
                86,
                18,
                28.6324,
                77.2450,
                "Yamuna Bank Cluster, Delhi",
                "Voice note from volunteer on site.",
                "Waterlogged street and stranded families",
                now,
            ),
            (
                "fr_demo_002",
                "vol_demo_008",
                "Temporary camp has increasing fever cases. Need doctor triage desk and medicine stock check.",
                "critical",
                _to_json(["medical-camp", "sanitation"]),
                _to_json(["antibiotics", "oral rehydration salts", "first aid"]),
                54,
                12,
                28.6650,
                77.3502,
                "Relief Camp B, Ghaziabad",
                "Audio + image input from clinic tent.",
                "Crowded camp clinic queue",
                now,
            ),
            (
                "fr_demo_003",
                "vol_demo_010",
                "Community requested child-safe shelter corner and women support desk for night shift.",
                "medium",
                _to_json(["shelter", "community-support"]),
                _to_json(["hygiene kits", "mats"]),
                37,
                8,
                28.5710,
                77.3662,
                "Noida Extension Shelter Point",
                "Gesture translator assisted message.",
                "Inside shelter registration area",
                now,
            ),
        ]
        for report in field_reports:
            exists = _execute(cursor, "SELECT id FROM field_reports WHERE id = ?", (report[0],)).fetchone()
            if exists is None:
                _execute(
                    cursor,
                    """
                    INSERT INTO field_reports (
                        id, volunteer_id, summary, severity, categories_json, supply_needs_json,
                        people_count_estimate, required_volunteers_estimate, location_lat, location_lng,
                        address, raw_audio_text, image_hint, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    report,
                )

        connection.commit()

def create_session(user_id: str) -> str:
    session_id = f"sess_{uuid4().hex}"
    token = uuid4().hex + uuid4().hex
    
    # 24 hours expiry
    from datetime import datetime, timedelta
    expires_at = (datetime.utcnow() + timedelta(hours=24)).isoformat()
    
    with get_connection() as connection:
        cursor = connection.cursor()
        _execute(
            cursor,
            "INSERT INTO sessions (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)",
            (session_id, user_id, token, expires_at),
        )
        connection.commit()
    return token

def get_session(token: str) -> dict | None:
    from datetime import datetime
    with get_connection() as connection:
        cursor = connection.cursor()
        row = _execute(
            cursor,
            "SELECT user_id, expires_at FROM sessions WHERE token = ?",
            (token,),
        ).fetchone()
        
        if not row:
            return None
            
        expires_at = _row_get(row, "expires_at")
        if expires_at < datetime.utcnow().isoformat():
            return None
            
        return {"user_id": _row_get(row, "user_id")}
