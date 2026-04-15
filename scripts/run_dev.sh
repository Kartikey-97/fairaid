#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

cleanup() {
  if [[ -n "${BACK_PID:-}" ]]; then
    kill "${BACK_PID}" >/dev/null 2>&1 || true
  fi
  if [[ -n "${FRONT_PID:-}" ]]; then
    kill "${FRONT_PID}" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT INT TERM

cd "${ROOT_DIR}"

backend/venv/bin/uvicorn backend.main:app --reload --port 8000 &
BACK_PID=$!

(
  cd "${ROOT_DIR}/frontend"
  npm run dev
) &
FRONT_PID=$!

wait "${BACK_PID}" "${FRONT_PID}"
