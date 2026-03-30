#!/usr/bin/env bash
set -euo pipefail

CELERY_LOG_LEVEL="${CELERY_LOG_LEVEL:-info}"
CELERY_POOL="${CELERY_POOL:-solo}"
CELERY_CONCURRENCY="${CELERY_CONCURRENCY:-1}"
APP_HOST="${APP_HOST:-0.0.0.0}"
APP_PORT="${APP_PORT:-8000}"

celery -A FastAPI.celery_app:celery_app worker \
  --loglevel="${CELERY_LOG_LEVEL}" \
  --pool="${CELERY_POOL}" \
  --concurrency="${CELERY_CONCURRENCY}" &
CELERY_PID=$!

cleanup() {
  kill "${CELERY_PID}" 2>/dev/null || true
  wait "${CELERY_PID}" 2>/dev/null || true
}

trap cleanup EXIT INT TERM

uvicorn FastAPI.main:app --host "${APP_HOST}" --port "${APP_PORT}" &
UVICORN_PID=$!

wait -n "${UVICORN_PID}" "${CELERY_PID}"
EXIT_CODE=$?

kill "${UVICORN_PID}" "${CELERY_PID}" 2>/dev/null || true
wait "${UVICORN_PID}" "${CELERY_PID}" 2>/dev/null || true

exit "${EXIT_CODE}"
