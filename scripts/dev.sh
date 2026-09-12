#!/usr/bin/env bash
# Run JWT Pizza locally: backend (:3000) then frontend (:5173).
set -euo pipefail

SERVICE="$(cd "$(dirname "$0")/.." && pwd)"
WEB="$(cd "$SERVICE/../jwt-pizza" && pwd)"

(cd "$SERVICE" && npm start) &
(cd "$WEB" && npm run dev) &

wait
