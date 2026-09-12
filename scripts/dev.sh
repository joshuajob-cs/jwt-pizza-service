#!/usr/bin/env bash
# Run JWT Pizza locally: backend (:3000) then frontend (:5173).
set -euo pipefail

SERVICE="$(cd "$(dirname "$0")/.." && pwd)"
WEB="$(cd "$SERVICE/../jwt-pizza" && pwd)"

# However this script ends, stop every process it started.
trap 'trap - INT TERM EXIT; echo "Stopping..."; kill 0; wait' INT TERM EXIT

(cd "$SERVICE" && npm start) &
(cd "$WEB" && npm run dev) &

wait
