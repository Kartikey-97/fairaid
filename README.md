# FairAid

## Run both backend and frontend together

```bash
./scripts/run_dev.sh
```

Backend: `http://127.0.0.1:8000`  
Frontend: `http://localhost:3000`

## Database

Default storage is SQLite at `data/fairaid.db`.

To use PostgreSQL, set:

```bash
export FAIRAID_DATABASE_URL="postgresql://<user>:<password>@<host>:<port>/<db_name>"
```

Then start backend normally:

```bash
backend/venv/bin/uvicorn backend.main:app --reload --port 8000
```

## Demo credentials

- NGO: `ngo@fairaid.org` / `demo123`
- Volunteer: `volunteer@fairaid.org` / `demo123`
