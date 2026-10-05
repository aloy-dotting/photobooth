#!/bin/sh
# Local test server for the photobooth (Mac/Linux). Opens http://localhost:8000
cd "$(dirname "$0")"
(sleep 1; open http://localhost:8000 2>/dev/null || xdg-open http://localhost:8000 2>/dev/null) &
if command -v python3 >/dev/null; then python3 -m http.server 8000
elif command -v npx >/dev/null; then npx --yes serve -l 8000 .
else echo "Need Python or Node.js installed to run a local server."; fi
