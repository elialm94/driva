#!/usr/bin/env bash
# Local Next.js on port 3123 with auto-restart.
#
# Agents MUST NOT kill next (or this wrapper) on 3123 if the port already
# serves HTTP 200. If GET http://127.0.0.1:3123/ returns 200, leave it
# alone — do not lsof-kill, pkill, or restart a healthy server.
# Run `npm run dev`; if 3123 is already up it prints "already up" and
# exits 0. Only start Next when nothing listens. The watchdog detaches
# so aborting an agent terminal does not SIGTERM a Ready server.
#
# Usage: npm run dev

set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
PORT=3123
LOG="$ROOT/.data/dev-3123.log"
PIDFILE="$ROOT/.data/dev-3123.pid"

# Any HTTP response means Next is bound (200, 500 compile error, …).
# Do not treat a 500 as "down" — that would spawn a second server (EADDRINUSE).
http_code() {
  curl -s -o /dev/null -w '%{http_code}' --max-time 2 "http://127.0.0.1:${PORT}/" || true
}

port_ok() {
  local code
  code="$(http_code)"
  [[ "$code" != "000" && -n "$code" ]]
}

watchdog_alive() {
  local pid
  [[ -f "$PIDFILE" ]] || return 1
  pid="$(cat "$PIDFILE" 2>/dev/null || true)"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

# Detached monitor+restart loop (new session: Cursor abort must not kill Next).
if [[ "${DEV_3123_WATCHDOG:-}" == "1" ]]; then
  echo $$ > "$PIDFILE"
  echo "$(date '+%Y-%m-%d %H:%M:%S') watchdog pid $$ on :${PORT}"
  while true; do
    if port_ok; then
      sleep 2
      continue
    fi
    echo "$(date '+%Y-%m-%d %H:%M:%S') starting next on :${PORT}"
    PORT="$PORT" npx next dev -p "$PORT" || true
    echo "$(date '+%Y-%m-%d %H:%M:%S') next exited — restarting in 1s"
    sleep 1
  done
  exit 0
fi

mkdir -p "$(dirname "$LOG")"

if watchdog_alive && port_ok; then
  echo "already up on http://localhost:${PORT} (HTTP $(http_code)) — not starting a second server"
  exit 0
fi

if ! watchdog_alive; then
  export DEV_3123_WATCHDOG=1
  # New session so Cursor agent abort does not SIGTERM Next. argv after -c is
  # the script path (python3 -c puts that in sys.argv[1], not behind --).
  if command -v python3 >/dev/null 2>&1; then
    python3 -c 'import os, sys; os.setsid(); os.execv("/bin/bash", ["bash", sys.argv[1]])' \
      "$0" </dev/null >>"$LOG" 2>&1 &
  else
    nohup /bin/bash "$0" </dev/null >>"$LOG" 2>&1 &
  fi
  echo $! > "$PIDFILE"
  echo "dev-3123 watchdog starting (pid $!) → http://localhost:${PORT}"
fi

for _ in $(seq 1 40); do
  if port_ok; then
    echo "already up on http://localhost:${PORT} (HTTP $(http_code))"
    exit 0
  fi
  sleep 0.25
done

echo "watchdog launched; Next not listening yet — see $LOG"
exit 0
