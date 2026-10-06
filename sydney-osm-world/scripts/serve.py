"""Tiny static dev server for browsing the pipeline's output.

Zero dependencies - Python's stdlib only. It exists so you can click through
the artefacts in a browser instead of hunting for file paths.

    python scripts/serve.py            # http://127.0.0.1:8848
    python scripts/serve.py --port 9000 --no-open

Nothing is rebuilt on request: run `bash scripts/run_all.sh` to regenerate the
data, then just refresh the page.
"""

from __future__ import annotations

import argparse
import http.server
import socketserver
import sys
import threading
import webbrowser
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import DOCS, ROOT, WORLD, WORLDDATA, ensure_dirs, now_iso  # noqa: E402

LINKS = [
    ("3D skeleton viewer", "/viewer/",
     "Three.js fly-cam over the real data. Water, parks, roads, buildings, venues, transit. WASD + drag."),
    ("Debug map (interactive)", "/world/debug-map.html",
     "Canvas 2D, pan + zoom, hover for names. The real data, no simplification."),
    ("Full-area preview", "/world/preview.svg",
     "Static SVG of the whole prototype area. Opens anywhere."),
    ("CBD preview (zoomed)", "/world/preview-cbd.svg",
     "The same data at street-level zoom over the central business district."),
    ("World specification", "/data/world/world-spec.json",
     "<b>The deliverable.</b> Districts, arterials, venues, water, transit, zones."),
    ("World analysis", "/data/world/world-analysis.json",
     "Interpretation layer: urban patterns, clusters, mission opportunities."),
    ("Data report", "/docs/SYDNEY-DATA-REPORT.md",
     "Human-readable counts, gaps and limitations."),
    ("World-design prompt", "/docs/WORLD-DESIGN-PROMPT.md",
     "How to hand the spec to an AI that designs the game city."),
    ("MCP server analysis", "/docs/OSM-MCP.md",
     "What the OSM MCP server can and cannot do, and the 3 defects we patched."),
    ("Data schema", "/docs/DATA-SCHEMA.md",
     "Record shapes and the coordinate system."),
    ("Test results", "/data/raw/test-results.json",
     "Capability tests A-G with counts, errors and limitations."),
    ("Collection log", "/data/raw/collection-log.json",
     "Every collection step, including the ones that failed."),
    ("Districts", "/world/districts.json", "Per-district counts, densities and zones."),
    ("Roads + crossings", "/world/roads.json", "Arterials with geometry, bridges, tunnels."),
    ("Venues", "/world/venues.json", "7,157 venues grouped by district."),
    ("Waterways", "/world/waterways.json", "Harbour, rivers, beaches."),
    ("Transit", "/world/transit.json", "Stations, light rail, ferry terminals, hubs."),
    ("Parks", "/world/parks.json", "Green space with measured areas."),
    ("Landmarks", "/world/landmarks.json", "Bridges, tunnels, attractions."),
    ("Buildings (sample)", "/world/buildings.json", "972 sampled footprints - heights mostly absent."),
]


def build_index() -> str:
    cards = "\n".join(
        f'<a class="card" href="{href}"><b>{title}</b><span>{note}</span></a>'
        for title, href, note in LINKS
    )
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sydney OSM World - artefacts</title>
<style>
  :root {{ color-scheme: dark; }}
  body {{ margin:0; background:#0d1117; color:#c9d1d9;
         font:14px/1.6 ui-monospace,Menlo,Consolas,monospace; padding:32px; }}
  h1 {{ color:#e6edf3; font-size:20px; margin:0 0 4px; }}
  .sub {{ color:#8b949e; font-size:12px; margin-bottom:28px; }}
  .grid {{ display:grid; gap:12px; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); max-width:1200px; }}
  .card {{ display:block; padding:14px 16px; background:#161b22; border:1px solid #30363d;
           border-radius:6px; text-decoration:none; color:#c9d1d9; }}
  .card:hover {{ border-color:#58a6ff; background:#1c2128; }}
  .card b {{ display:block; color:#e6edf3; margin-bottom:4px; }}
  .card span {{ color:#8b949e; font-size:12px; }}
  .card.hero {{ border-color:#2ea043; background:#12261a; }}
  footer {{ color:#6e7681; font-size:11px; margin-top:28px; max-width:1200px; }}
  code {{ color:#79c0ff; }}
</style></head><body>
<h1>Sydney OSM World</h1>
<div class="sub">pipeline artefacts &#183; generated {now_iso()} &#183; OpenStreetMap ODbL</div>
<div class="grid">
  <a class="card hero" href="/viewer/"><b>3D skeleton viewer</b><span>Start here - fly around the city in Three.js.</span></a>
  <a class="card hero" href="/world/debug-map.html"><b>Debug map (interactive)</b><span>Pan, zoom, hover for names.</span></a>
  <a class="card hero" href="/world/preview.svg"><b>Full-area preview</b><span>Whole prototype area as one image.</span></a>
  <a class="card hero" href="/world/preview-cbd.svg"><b>CBD preview (zoomed)</b><span>Street-level view of the core.</span></a>
{cards}
</div>
<footer>
Re-run the pipeline with <code>bash scripts/run_all.sh</code>, then refresh.
<br><br>
Source: geographic data &copy; OpenStreetMap contributors, licensed under the
<a href="https://www.openstreetmap.org/copyright">Open Database License (ODbL) 1.0</a>.
This project keeps real Sydney place names, so any distributed build must carry this attribution.
</footer>
</body></html>"""


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):  # noqa: N802
        if self.path in ("/", "/index.html"):
            body = build_index().encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def end_headers(self):
        # always serve the freshest data
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):  # quieter console
        if "404" in (fmt % args):
            super().log_message(fmt, *args)


def main() -> int:
    parser = argparse.ArgumentParser(description="Serve the pipeline artefacts")
    parser.add_argument("--port", type=int, default=8848)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--no-open", action="store_true", help="do not open a browser")
    args = parser.parse_args()

    ensure_dirs()
    missing = [p for p in (WORLD / "debug-map.html", WORLDDATA / "world-spec.json") if not p.exists()]
    if missing:
        print("WARNING: some artefacts are missing. Run:  bash scripts/run_all.sh")
        for path in missing:
            print(f"  missing: {path.relative_to(ROOT)}")

    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer((args.host, args.port), Handler) as httpd:
        url = f"http://{args.host}:{args.port}/"
        print(f"serving {ROOT}")
        print(f"  {url}")
        print("  ctrl-c to stop")
        if not args.no_open:
            threading.Timer(0.6, lambda: webbrowser.open(url)).start()
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nstopped")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
