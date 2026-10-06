#!/usr/bin/env bash
# End-to-end pipeline: OSM -> raw -> normalised -> world-spec -> report -> debug map.
#
#   bash scripts/run_all.sh
#
# Assumes scripts/setup.sh has been run (or that .venv exists and SSL_CERT_FILE
# is set - scripts/setup.sh writes both to .env.local).
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"

[ -f .env.local ] && { echo "==> sourcing .env.local"; set -a; . ./.env.local; set +a; }
if [ -z "${PY:-}" ]; then
  if [ -x .venv/bin/python ]; then PY=".venv/bin/python"; else PY=".venv/Scripts/python.exe"; fi
fi
if [ -z "${SSL_CERT_FILE:-}" ]; then
  SSL_CERT_FILE="$("$PY" -c 'import certifi; print(certifi.where())' 2>/dev/null || true)"
  [ -n "$SSL_CERT_FILE" ] && export SSL_CERT_FILE
fi

step() { echo; echo "=================== $* ==================="; }

step "0/6  capability tests (A-G)"
# Diagnostics, not a pipeline gate: a flaky public mirror must not stop the run.
# The result is recorded in data/raw/test-results.json either way.
if ! "$PY" scripts/test_osm.py; then
  echo
  echo "!!! capability tests reported failures - see data/raw/test-results.json"
  echo "!!! continuing with the pipeline anyway"
fi

step "1/6  collect raw data (MCP + Overpass)"
"$PY" scripts/query_sydney.py

step "2/6  normalise"
"$PY" scripts/normalize_osm.py

step "3/6  build world specification"
"$PY" scripts/build_world_spec.py

step "4/6  export world files + data report"
"$PY" scripts/export_summary.py

step "5/6  debug map + projection check"
"$PY" scripts/visualize.py
"$PY" scripts/verify_projection.py | head -12

step "done"
echo "key artefacts:"
echo "  data/world/world-spec.json      <- the deliverable"
echo "  data/world/world-analysis.json"
echo "  world/*.json                    per-layer exports"
echo "  docs/SYDNEY-DATA-REPORT.md      the numbers"
echo "  world/preview.svg               whole area, opens anywhere"
echo "  world/preview-cbd.svg           CBD at street zoom"
echo "  world/debug-map.html            interactive map (pan/zoom/hover)"
echo
echo "want to browse it?  python scripts/serve.py    ->  http://127.0.0.1:8848/"
