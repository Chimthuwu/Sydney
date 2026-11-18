# Sydney OSM World

A repeatable pipeline that turns **OpenStreetMap** geographic data into a structured,
AI-friendly world specification for a fictionalised, GTA-style open-world game set in
Sydney, Australia.

This repository is the **geographic intelligence layer only**. It does not build the game.

```
REAL SYDNEY -> OPENSTREETMAP -> OSM MCP SERVER + OVERPASS -> NORMALISED GEOGRAPHY
            -> AI WORLD SPEC -> (later) FICTIONAL GAME CITY -> (later) THREE.JS
```

## What's in this repo

All Sydney mapping content lives under [`sydney-osm-world/`](sydney-osm-world/):

| Path | What it is |
|------|------------|
| `sydney-osm-world/README.md` | Full project documentation |
| `sydney-osm-world/config/sydney.config.json` | Geographic scope (Sydney bbox, tiles, district seeds) |
| `sydney-osm-world/scripts/` | Pipeline: setup, collect, normalise, build, export, visualise |
| `sydney-osm-world/data/raw/` | Verbatim Overpass / MCP responses |
| `sydney-osm-world/data/normalized/` | Typed, projected records (roads, venues, parks, buildings, ...) |
| `sydney-osm-world/data/world/world-spec.json` | **The deliverable** — AI-friendly world spec |
| `sydney-osm-world/viewer/` | Three.js 3D skeleton viewer (no build step) |
| `sydney-osm-world/world/` | Per-layer exports + debug map |
| `sydney-osm-world/docs/` | Reports: OSM-MCP, DATA-SCHEMA, SYDNEY-DATA-REPORT, WORLD-DESIGN-PROMPT |
| `sydney-osm-world/ATTRIBUTION.md` | OpenStreetMap ODbL attribution requirements |

## Quick start

```bash
cd sydney-osm-world
bash scripts/setup.sh      # clones the MCP server, creates a venv, applies the patch
bash scripts/run_all.sh    # collect -> normalise -> world spec -> report -> debug map
python scripts/serve.py    # http://127.0.0.1:8848 - browsable index of every artefact
```

See [`sydney-osm-world/README.md`](sydney-osm-world/README.md) for the full guide.

## OpenStreetMap attribution

This project uses OpenStreetMap data under the ODbL license. Anything distributed from it
must carry OSM attribution — see [`sydney-osm-world/ATTRIBUTION.md`](sydney-osm-world/ATTRIBUTION.md).
