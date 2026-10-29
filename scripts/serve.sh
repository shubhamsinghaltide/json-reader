#!/bin/sh
# Usage: serve.sh <port> <directory>
# Reuses a server that already serves this app on <port>; otherwise starts one.
PORT="${1:-8000}"
DIR="${2:-.}"

if curl -s "http://127.0.0.1:$PORT/index.html" | grep -q "JSON Reader &amp; Diff"; then
  echo "Serving HTTP on 127.0.0.1 port $PORT (already running, reusing it)"
  exit 0
fi

exec python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$DIR"
