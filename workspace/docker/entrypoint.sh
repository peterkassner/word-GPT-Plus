#!/bin/sh
# Start nginx (UI) and Node proxy together; stop the container if either exits.
set -eu

PROXY_PID=""
NGINX_PID=""

shutdown() {
  if [ -n "$NGINX_PID" ] && kill -0 "$NGINX_PID" 2>/dev/null; then
    kill -TERM "$NGINX_PID" 2>/dev/null || true
  fi
  if [ -n "$PROXY_PID" ] && kill -0 "$PROXY_PID" 2>/dev/null; then
    kill -TERM "$PROXY_PID" 2>/dev/null || true
  fi
  nginx -s quit 2>/dev/null || true
  wait 2>/dev/null || true
}

on_signal() {
  shutdown
  exit 0
}

trap on_signal TERM INT

require_process() {
  pid="$1"
  name="$2"
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "[entrypoint] ${name} failed to start (pid ${pid})" >&2
    shutdown
    exit 1
  fi
}

echo "[entrypoint] starting proxy on :${PORT:-3100}"
su-exec nodejs node /app/proxy/server.js &
PROXY_PID=$!
sleep 1
require_process "$PROXY_PID" "proxy"

echo "[entrypoint] starting nginx on :80"
nginx -g 'daemon off;' &
NGINX_PID=$!
sleep 1
require_process "$NGINX_PID" "nginx"

echo "[entrypoint] ui + proxy running"

while true; do
  if ! kill -0 "$PROXY_PID" 2>/dev/null; then
    wait "$PROXY_PID" 2>/dev/null || true
    echo "[entrypoint] proxy exited; stopping nginx" >&2
    shutdown
    exit 1
  fi
  if ! kill -0 "$NGINX_PID" 2>/dev/null; then
    wait "$NGINX_PID" 2>/dev/null || true
    echo "[entrypoint] nginx exited; stopping proxy" >&2
    shutdown
    exit 1
  fi
  sleep 2
done
