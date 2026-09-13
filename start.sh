#!/usr/bin/env bash
# BOQORE GOLD TRADE — unified self-healing launcher + watchdog.
# Public URL: https://boqore-gold.loca.lt
# Starts the web server and the public tunnel. Watches both and restarts
# either one if it dies.
cd "$(dirname "$0")"

LT="$PWD/node_modules/.bin/lt"
SUBDOMAIN=boqore-gold

# 1) Restore dependencies if lost
if [ ! -d node_modules/better-sqlite3 ] || [ ! -x "$LT" ]; then
  echo "[start] node_modules missing — restoring"
  rm -rf node_modules
  if [ -f deps/node_modules.tar.gz ]; then
    tar xzf deps/node_modules.tar.gz
  else
    npm install --no-audit --no-fund
  fi
fi

start_server() {
  nohup node server.js >> deps/server.log 2>&1 &
  echo $! > deps/server.pid
  for i in $(seq 1 20); do
    curl -s -m 2 -o /dev/null http://127.0.0.1:3000/api/ping && return 0
    sleep 0.5
  done
  echo "[start] WARNING: server did not come up"
}

start_tunnel() {
  rm -f deps/tunnel.log
  nohup "$LT" --port 3000 --subdomain "$SUBDOMAIN" >> deps/tunnel.log 2>&1 &
  echo $! > deps/tunnel.pid
  for i in $(seq 1 30); do
    if grep -q "your url is" deps/tunnel.log 2>/dev/null; then
      echo "[start] PUBLIC URL: https://$SUBDOMAIN.loca.lt"
      return 0
    fi
    sleep 1
  done
  echo "[start] WARNING: tunnel URL not captured (check deps/tunnel.log)"
}

start_server
start_tunnel

# 2) Watchdog — keep the stack alive
echo "[watchdog] watching server + tunnel (checking every 20s)"
while true; do
  sleep 20
  if ! curl -s -m 3 -o /dev/null http://127.0.0.1:3000/api/ping; then
    echo "[watchdog] $(date -u) server down — restarting"
    kill "$(cat deps/server.pid 2>/dev/null)" 2>/dev/null
    pkill -f "node [s]erver.js" 2>/dev/null
    sleep 1
    start_server
  fi
  TPID=$(cat deps/tunnel.pid 2>/dev/null)
  if [ -z "$TPID" ] || ! kill -0 "$TPID" 2>/dev/null; then
    echo "[watchdog] $(date -u) tunnel down — restarting"
    pkill -f "[.]/lt --port" 2>/dev/null
    pkill -f "localtunnel/bin/lt" 2>/dev/null
    sleep 1
    start_tunnel
  fi
done
