#!/bin/sh
set -eu
curl -sf "http://127.0.0.1/index.html" >/dev/null
nc -z 127.0.0.1 "${PORT:-3100}"
