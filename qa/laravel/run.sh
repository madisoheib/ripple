#!/usr/bin/env bash
# Real end-to-end: Laravel (in Docker, package installed) broadcasts -> ripple
# -> pusher-js subscriber (host) receives. Exit 0 only if the event arrives.
set -uo pipefail
cd "$(dirname "$0")"
ROOT=../..

cleanup() { docker compose down -v >/dev/null 2>&1; kill "${SUB:-}" 2>/dev/null; }
trap cleanup EXIT

echo "== building ripple server image =="
docker build -t ripple:qa "$ROOT" >/dev/null

echo "== building Laravel app image (this pulls Laravel + composer require) =="
docker compose build app

echo "== starting ripple =="
docker compose up -d ripple
sleep 1

echo "== starting subscriber =="
node subscribe.mjs &
SUB=$!
sleep 5   # let it connect + subscribe before we broadcast

echo "== broadcasting from Laravel =="
docker compose run --rm app

echo "== waiting for subscriber =="
wait "$SUB"
RC=$?
[ "$RC" -eq 0 ] && echo "E2E PASS" || echo "E2E FAIL (rc=$RC)"
exit "$RC"
