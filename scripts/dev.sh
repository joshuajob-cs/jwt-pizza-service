#!/usr/bin/env bash
# Run JWT Pizza locally: backend (:3000) then frontend (:5173).
#   --reset   drop the local database first, so the backend creates a fresh one
set -euo pipefail

SERVICE="$(cd "$(dirname "$0")/.." && pwd)"
WEB="$(cd "$SERVICE/../jwt-pizza" && pwd)"

RESET=false
[[ "${1:-}" == "--reset" ]] && RESET=true

success() { printf '\033[32m%s\033[0m\n' "$*"; }   # green
error()   { printf '\033[31m%s\033[0m\n' "$*"; }   # red

# Succeeds if something is listening on the given local port.
port_busy() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

# Check what the backend needs before starting anything, so failures have a clear message.
if ! port_busy 3306; then
  error "MySQL is not running on port 3306. On Ubuntu: sudo systemctl start mysql"
  exit 1
fi
if [[ ! -f "$SERVICE/src/config.js" ]]; then
  error "Missing src/config.js. Create it with your database password and factory API key."
  exit 1
fi
for port in 3000 5173; do
  if port_busy "$port"; then
    error "Port $port is already in use (an old run still going?). Free it with: kill \$(lsof -ti :$port)"
    exit 1
  fi
done
for repo in "$SERVICE" "$WEB"; do
  [[ -d "$repo/node_modules" ]] || (cd "$repo" && npm install)
done

# The backend only creates its database at startup, so the drop has to happen before it starts.
if $RESET; then
  db() { node -p "require('$SERVICE/src/config.js').db.connection.$1"; }
  MYSQL_PWD="$(db password)" mysql -h "$(db host)" -u "$(db user)" -e "DROP DATABASE IF EXISTS \`$(db database)\`;"
  success "Dropped database '$(db database)'"
fi

# However this script ends, stop every process it started.
trap 'trap - INT TERM EXIT; echo "Stopping..."; kill 0; wait' INT TERM EXIT

(cd "$SERVICE" && npm start 2>&1 | sed -u 's/^/[back] /') &

# The frontend is useless without the backend, so give it up to 30s to open port 3000.
for _ in $(seq 1 60); do
  port_busy 3000 && break
  sleep 0.5
done
port_busy 3000 || { error "Backend did not start on port 3000"; exit 1; }
success "Backend up  → http://localhost:3000"

(cd "$WEB" && npm run dev 2>&1 | sed -u 's/^/[front] /') &
success "Frontend    → http://localhost:5173   (Ctrl+C stops both)"

wait
