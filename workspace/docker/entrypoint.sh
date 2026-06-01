#!/bin/sh
set -e

# Proxy (Node) — background; tini -s forwards SIGTERM to the process group.
su-exec nodejs node /app/proxy/server.js &

exec nginx -g 'daemon off;'
