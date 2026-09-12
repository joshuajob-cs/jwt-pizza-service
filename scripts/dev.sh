#!/usr/bin/env bash
# Run JWT Pizza locally: backend (:3000) then frontend (:5173).
set -euo pipefail

SERVICE="$(cd "$(dirname "$0")/.." && pwd)"
WEB="$(cd "$SERVICE/../jwt-pizza" && pwd)"

# Succeeds if something is listening on the given local port.
port_busy() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

# However this script ends, stop every process it started.
trap 'trap - INT TERM EXIT; echo "Stopping..."; kill 0; wait' INT TERM EXIT

(cd "$SERVICE" && npm start) &

# The frontend is useless without the backend, so give it up to 30s to open port 3000.
for _ in $(seq 1 60); do
  port_busy 3000 && break
  sleep 0.5
done
port_busy 3000 || { echo "Backend did not start on port 3000"; exit 1; }

(cd "$WEB" && npm run dev) &

wait
