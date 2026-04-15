import json
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

try:
    import psycopg
    from psycopg.rows import dict_row
except ImportError:  # pragma: no cover - optional dependency
    psycopg = None
    dict_row = None

DB_PATH = Path(__file__).resolve().parents[3] / "data" / "fairaid.db"


def _resolve_database_url() -> str:
    env_value = os.getenv("FAIRAID_DATABASE_URL", "").strip()
    if env_value:
        return env_value

    env_file = Path(__file__).resolve().parents[3] / ".env"
    if not env_file.exists():
        return ""

    try:
        lines = env_file.read_text(encoding="utf-8").splitlines()
    except OSError:
        return ""

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

        # Lightweight migrations for existing DBs.
        _ensure_column(cursor, "volunteers", "address", "TEXT")
        _ensure_column(cursor, "volunteers", "profile_image_url", "TEXT")
        _ensure_column(cursor, "volunteers", "job_title", "TEXT")
        _ensure_column(cursor, "volunteers", "license_number", "TEXT")
        _ensure_column(cursor, "volunteers", "license_verified", "INTEGER NOT NULL DEFAULT 0")
        _ensure_column(cursor, "volunteers", "verification_notes", "TEXT")
        _ensure_column(cursor, "needs", "job_category", "TEXT")

        connection.commit()

    _seed_dummy_data_if_empty()
    _seed_supplemental_demo_data()


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
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            (user_id, role, name, email, password, timestamp),
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
            SELECT id, role, name, email
            FROM users
            WHERE lower(email) = lower(?) AND password = ?
            """,
            (email, password),
        ).fetchone()
        if row is None:
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
    return {
        "id": _row_get(row, "id"),
        "user_id": _row_get(row, "user_id"),
        "name": _row_get(row, "name"),
        "email": _row_get(row, "email"),
        "phone": _row_get(row, "phone"),
        "address": _row_get(row, "address"),
        "profile_image_url": _row_get(row, "profile_image_url"),
        "job_title": _row_get(row, "job_title"),
        "license_number": _row_get(row, "license_number"),
        "license_verified": bool(_row_get(row, "license_verified")),
        "verification_notes": _row_get(row, "verification_notes"),
        "location": {"lat": _row_get(row, "lat"), "lng": _row_get(row, "lng")},
        "radius_km": _row_get(row, "radius_km"),
        "skills": _from_json_list(_row_get(row, "skills_json")),
        "certifications": _from_json_list(_row_get(row, "certifications_json")),
        "specialist_domains": _from_json_list(_row_get(row, "specialist_domains_json")),
        "preferred_need_types": _from_json_list(_row_get(row, "preferred_need_types_json")),
        "languages": _from_json_list(_row_get(row, "languages_json")),
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
        elif decision == "interested":
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
    return {
        "id": _row_get(row, "id"),
        "ngo_id": _row_get(row, "ngo_id"),
        "ngo_name": _row_get(row, "ngo_name"),
        "title": _row_get(row, "title"),
        "description": _row_get(row, "description"),
        "need_type": _row_get(row, "need_type"),
        "job_category": _row_get(row, "job_category"),
        "emergency_level": _row_get(row, "emergency_level"),
        "is_critical": bool(_row_get(row, "is_critical")),
        "urgency": _row_get(row, "urgency"),
        "impact_level": _row_get(row, "impact_level"),
        "required_volunteers": _row_get(row, "required_volunteers"),
        "required_skills": _from_json_list(_row_get(row, "required_skills_json")),
        "required_specialists": _from_json_list(_row_get(row, "required_specialists_json")),
        "language_requirements": _from_json_list(_row_get(row, "language_requirements_json")),
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
