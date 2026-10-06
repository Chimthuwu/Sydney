# Sydney OSM World

A repeatable pipeline that turns **OpenStreetMap** geographic data into a structured,
AI-friendly world specification for a fictionalised, GTA-style open-world game set in
Sydney, Australia.

This repository is the **geographic intelligence layer only**. It does not build the game.

```
REAL SYDNEY -> OPENSTREETMAP -> OSM MCP SERVER + OVERPASS -> NORMALISED GEOGRAPHY
            -> AI WORLD SPEC -> (later) FICTIONAL GAME CITY -> (later) THREE.JS
```

**The key artefact is [`data/world/world-spec.json`](data/world/world-spec.json).**
**The key explanation is [`docs/WORLD-DESIGN-PROMPT.md`](docs/WORLD-DESIGN-PROMPT.md).**

---

## Quick start

```bash
git clone <this repo>
cd sydney-osm-world
bash scripts/setup.sh      # clones the MCP server, creates a 3.13 venv, applies our patch
bash scripts/run_all.sh    # tests -> collect -> normalise -> world spec -> report -> debug map
```

`run_all.sh` prints the path of every artefact it produced.

### Looking at the result

```bash
python scripts/serve.py          # http://127.0.0.1:8848 - browsable index of every artefact
```

The index page links to:

| View | What it is |
| --- | --- |
| **`/viewer/`** | **3D skeleton viewer** - Three.js fly-cam over the real data |
| `world/debug-map.html` | interactive canvas map - pan, zoom, hover for names |
| `world/preview.svg` | whole prototype area, static, opens anywhere |
| `world/preview-cbd.svg` | the CBD at street-level zoom |
| `data/world/world-spec.json` | the deliverable |
| `docs/*.md` | the reports, served as text |

No build step and no dependencies - just Python's stdlib HTTP server.

### 3D skeleton viewer

`viewer/` is a single Three.js page that loads `data/world/world-spec.json` and renders it.
It is **not a game** - no NPCs, no physics, no assets - just the geographic skeleton in 3D,
so you can check that the data is actually right before building anything on top of it.

- **Controls:** `W A S D` move, `Q`/`E` down/up, drag to look, wheel for speed, `shift` sprint,
  `H` hide UI, `R` reset, and **fly tour** for a guided pass around the harbour crossings.
- **Layers:** water, parks, roads (bridges and tunnels highlighted), buildings, venues
  (nightlife in red), transit stops, and projected labels.
- **Sliders:** road width, building height, fly speed.
- Three.js r160 is vendored in `viewer/vendor/` - no CDN, works offline.

Because the spec keeps **real Sydney names** (a deliberate project decision), anything you
distribute from it must carry the OpenStreetMap ODbL attribution. The viewer shows it in the
corner; see [`ATTRIBUTION.md`](ATTRIBUTION.md).

### Requirements

| Requirement | Why |
| --- | --- |
| `git` | clones the MCP server |
| [`uv`](https://docs.astral.sh/uv/) | creates the venv and installs packages (no `pip install` gymnastics, and it fetches Python 3.13 automatically) |
| Python 3.13+ | the MCP server declares `requires-python >=3.13` |
| Network access to OSM services | Overpass, Nominatim, OSRM - all free, none need an API key |

No database, no Docker, no cloud, no framework, no build step.

### Running the stages individually

```bash
source .env.local          # sets SSL_CERT_FILE + PY  (written by setup.sh)

python scripts/test_osm.py            # Tests A-G: what can the MCP server actually do?
python scripts/query_sydney.py        # collect raw OSM data -> data/raw/
python scripts/normalize_osm.py       # typed + projected records -> data/normalized/
python scripts/build_world_spec.py    # the deliverable -> data/world/
python scripts/export_summary.py      # world/*.json + docs/SYDNEY-DATA-REPORT.md
python scripts/visualize.py           # world/debug-map.html
python scripts/verify_projection.py   # ASCII sanity check, no browser needed
```

Useful flags: `query_sydney.py --skip-mcp` / `--skip-overpass`, `probe_overpass_sizes.py`
to check how big each layer is *before* fetching it.

### Re-running is cheap

Every HTTP response is cached under `data/cache/`, keyed by a hash of the request.
A full re-run with a warm cache takes **seconds** instead of ~15 minutes, and does not
hammer the public OSM services. Delete `data/cache/` to force a genuinely fresh collection.

---

## What came out of it

Measured on the configured prototype area (~4.7 x 5.6 km of inner Sydney):

| Layer | Count |
| --- | --- |
| Roads (with geometry) | 5,793 ways, 449 km of centreline |
| Intersections (derived) | 5,663 (330 with 4+ roads) |
| Venues / POIs | 7,157 (749 nightlife) |
| Parks and green space | 1,486 areas, 4.4 km² |
| Water features | 121 (89 water bodies, 16 beaches, 5 bays) |
| Transit stops | 464 (rail, light rail, ferry) |
| Landmarks | 1,397 named |
| Buildings | 972 (**sample only** - see limitations) |
| Districts | 19 |

The pipeline correctly recovered Sydney's real infrastructure topology from road geometry:
the Western Distributor, Cross City Tunnel, Sydney Harbour Tunnel, Cahill Expressway and
Bradfield Highway. See `docs/SYDNEY-DATA-REPORT.md` for the full breakdown.

---

## The MCP server: the important finding

The brief asked whether the primary MCP server
([jagan-shanmugam/open-streetmap-mcp](https://github.com/jagan-shanmugam/open-streetmap-mcp))
could supply this data. After reading its source and running it against Sydney:

**It works, but it cannot supply a game world.** Specifically:

- **No roads.** No tool queries the `highway` tag at all.
- **No geometry, ever.** Every Overpass query in the server ends in `out body;`, so ways and
  relations return tags with no coordinates - and the tools then discard them.
- **No buildings, no water, no parks-as-polygons, no intersections, no node ids.**
- **No raw-query passthrough**, so arbitrary Overpass QL is impossible through it.

Three genuine upstream defects also had to be fixed to get it running at all
(a dependency that no longer resolves, a missing `User-Agent` that Overpass rejects with
HTTP 406, and an `Overpass QL` syntax error in the subcategory filter). All three are
documented, reproduced and patched in `patches/`.

So the pipeline runs **two channels over the same OSM data**: the MCP server for place
semantics (geocoding, POI search, area profiles, routing), and direct Overpass for
everything that needs geometry. Full analysis in **[`docs/OSM-MCP.md`](docs/OSM-MCP.md)**.

---

## Layout

```
sydney-osm-world/
├── README.md                     this file
├── ATTRIBUTION.md                OSM / ODbL attribution requirements
├── requirements.txt              pinned deps (mcp < 2 - see docs/OSM-MCP.md)
├── patches/                      the patch applied to the vendored MCP server
├── config/sydney.config.json     single source of geographic scope
├── scripts/                      the pipeline (setup, run_all, serve + 7 stages)
├── open-streetmap-mcp/           the MCP server (cloned by setup.sh, not committed)
├── viewer/                       Three.js 3D skeleton viewer (no build step)
├── data/
│   ├── raw/                      verbatim responses + provenance envelopes
│   ├── normalized/               typed, projected, stable-ID records
│   ├── cache/                    HTTP cache (gitignored)
│   └── world/
│       ├── world-spec.json       *** THE DELIVERABLE ***
│       └── world-analysis.json   interpretation layer, explicitly labelled
├── world/                        per-layer exports + debug-map.html
└── docs/
    ├── OSM-MCP.md                what the MCP server does, and its 3 defects
    ├── DATA-SCHEMA.md            record shapes + the coordinate system
    ├── SYDNEY-DATA-REPORT.md     the real numbers (generated, not written by hand)
    └── WORLD-DESIGN-PROMPT.md    how a future AI turns this into a game city
```

---

## Honesty rules this project follows

1. **No fabricated data.** Missing values stay `null` and are counted. Building heights,
   opening hours, traffic, population and footfall are *not* in OSM and are not invented.
2. **Fact, derivation, interpretation and design never blur.** Every record carries a
   `provenance` label: `source`, `derived`, `ai-interpretation` or `gameplay-design`.
   See [`docs/DATA-SCHEMA.md`](docs/DATA-SCHEMA.md).
3. **Failures are recorded, not hidden.** `data/raw/collection-log.json` and
   `data/raw/test-results.json` list every step, including the ones that failed.
4. **OSM only.** No Google Maps data, tiles, imagery or place database. See
   [`ATTRIBUTION.md`](ATTRIBUTION.md).

---

## Known limitations

- **Prototype area only.** ~4.7 x 5.6 km of inner Sydney, not metropolitan Sydney. The bbox,
  tiles and district seeds all live in `config/sydney.config.json` - widen them there.
- **Buildings are a sample.** 972 footprints from one small CBD box, to test the schema.
  80% have `building:levels`; almost none have a real height.
- **No transit topology.** Station *positions* only - no routes, timetables or platforms.
- **No bus network.** Badly mapped in OSM, and not collected.
- **Intersections are derived, not real OSM nodes.** They are recovered by snapping shared
  road vertices to a 3 m grid, so near-parallel roads can produce a spurious junction.
- **The Harbour Bridge is a relation** with no usable geometry, so crossings are derived
  from the bridge/tunnel roads that actually cross the water.
- **Districts are Voronoi cells around hand-placed seeds**, not real boundaries. Their
  density figures are useful for ranking districts, nothing more.
- **Public Overpass is rate-limited** and 504s on large requests. Queries are split per tile
  and cached; re-runs are cheap.
- **Network-dependent.** Only `overpass-api.de` was reachable from the development machine.
  See the endpoint table in `docs/OSM-MCP.md` if you need to add mirrors.

## Next step

Hand `data/world/world-spec.json` and `docs/WORLD-DESIGN-PROMPT.md` to a world-designing
AI agent, and evaluate the city it produces. **Do not build the Three.js game yet** - the
geographic skeleton is the point, and it is only just finished.
