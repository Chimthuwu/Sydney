# The OSM MCP Server: what it actually does

Primary repository: <https://github.com/jagan-shanmugam/open-streetmap-mcp> (cloned to `open-streetmap-mcp/`, unmodified upstream except for the patch described at the end).

Everything in this document was determined by reading the source and by running the server against Sydney. Nothing is inferred from the repository name or its README.

---

## 1. Architecture

```
our scripts ──stdio──> osm-mcp-server (FastMCP)
                            │
                            ├── Nominatim      https://nominatim.openstreetmap.org
                            ├── Overpass API  https://overpass-api.de/api/interpreter
                            ├── OSRM           http://router.project-osrm.org
                            └── OSM raster tiles (tile.openstreetmap.org, thunderforest)
```

- Single module: `src/osm_mcp_server/server.py` (~1,600 lines), entry point `osm_mcp_server:main` -> `server.mcp.run()`.
- Transport: stdio only. It is an MCP server, not an HTTP service.
- State: an `aiohttp.ClientSession` created in a lifespan hook. No database, no cache, no persistence.
- **No API keys anywhere.** Every upstream service is free and public.
- It ships a Python `cache` dict attribute that is created and never used.

## 2. Tools exposed (`tools/list` returns 12)

| Tool | Purpose | Upstream service |
| --- | --- | --- |
| `geocode_address` | text -> coordinates | Nominatim `/search` |
| `reverse_geocode` | coordinates -> address | Nominatim `/reverse` |
| `find_nearby_places` | POIs within a radius | Overpass |
| `get_route_directions` | route between two points | OSRM |
| `search_category` | category + bbox -> places | Overpass |
| `suggest_meeting_point` | venue near a centroid | Overpass |
| `explore_area` | full profile around a point | Overpass + Nominatim |
| `find_schools_nearby` | schools/colleges | Overpass |
| `analyze_commute` | multi-mode commute | Nominatim + OSRM |
| `find_ev_charging_stations` | EV chargers | Overpass |
| `analyze_neighborhood` | livability scoring | Nominatim + Overpass |
| `find_parking_facilities` | parking | Overpass |

Plus two resources: `location://place/{query}` (Nominatim) and `location://map/{style}/{z}/{x}/{y}` (raster tiles).

## 3. What it can and cannot return

### Can
- Geocoding in both directions (Nominatim place records, with a `boundingbox` array).
- POI/amenity/shop/tourism searches by bounding box, or by radius around a point.
- Routing with full GeoJSON geometry (OSRM).
- Counts and profiles of the categories listed above.

### Cannot — and this shapes the whole pipeline

1. **No roads.** Not one tool queries the `highway` tag. There is no way to ask this server for a street.
2. **No geometry for anything.** Every Overpass query in the server ends in `out body;`, not `out geom;`. Ways and relations therefore come back as tags with no coordinates at all. `search_category` and `explore_area` then *discard* any way/relation lacking a `center` field, which `out body` never produces.
3. **No buildings.** No tool queries the `building` tag.
4. **No water, parks-as-polygons, transit topology or coastline.**
5. **No intersections, and no OSM node ids** for ways - so a road graph cannot be built from its output even in principle.
6. **No raw Overpass passthrough.** There is no "run this query" tool, so arbitrary QL is impossible through the MCP interface.
7. **No batching.** One tool call per request; no bulk endpoint.
8. `find_nearby_places` only queries **nodes** (`node["amenity"](bbox);`), so any venue mapped as an area is invisible to it.

### Consequence

The MCP server is genuinely useful for **place semantics** (what is here, what is it called, is it reachable from there) and is **structurally unable** to supply the geometric skeleton an open-world game needs.

So the pipeline runs **two channels against the same OSM data**:

| Channel | Used for | Why |
| --- | --- | --- |
| `osm-mcp` | geocoding, reverse geocoding, POI search, area profiles, OSRM corridor routing | the server's actual strength |
| Overpass API (direct) | roads, buildings, water, parks, transit, landmarks - everything with geometry | the gap the server cannot express |

Both are OpenStreetMap. The split is a workaround for a documented server limitation, not a second data source.

Cross-check: for one test box, the MCP channel returned 760 venues and Overpass returned 793 for the identical query. The 33-venue gap is area-mapped venues that the MCP channel cannot represent. That difference is measured, not assumed - see `data/raw/test-results.json`, test C.

---

## 4. Defects found (all reproduced, all fixed)

These were hit while building the pipeline. Each is a real, current bug in the upstream repository, not an environment quirk.

### 4.1 The server does not import with current dependencies

`pyproject.toml` declares `mcp[cli]>=1.3.0`. That now resolves to mcp 2.x, where `mcp.server.fastmcp.FastMCP` was renamed to `MCPServer`. Result:

```
ModuleNotFoundError: No module named 'mcp.server.fastmcp'.
This is mcp 2.x, where FastMCP was renamed to MCPServer ...
```

**Fix:** pin `mcp[cli]>=1.3.0,<2` in `requirements.txt`. The server code is written against the 1.x API, so the pin is correct - the dependency spec is what drifted.

### 4.2 Overpass requests are rejected (HTTP 406)

Upstream sends a `User-Agent` to Nominatim but **not** to Overpass or OSRM. The public API refuses requests without one:

```
no-ua     -> HTTP 406
with UA   -> HTTP 200
```

Since almost every tool is Overpass-backed, the server is effectively unusable for POI search as shipped.

**Fix (patched upstream):** a module-level `HTTP_HEADERS` dict with a descriptive User-Agent, applied to every `aiohttp.ClientSession`.

### 4.3 `search_category(subcategories=[...])` always fails (HTTP 400)

The subcategory filter is compiled as:

```overpass
node[("amenity"="bar" or "amenity"="pub")](bbox);   <- invalid Overpass QL
```

which the server rejects with a parse error. Any call passing `subcategories` fails; only the bare `category` form works.

**Fix (patched upstream):** compile to a regex key match instead:

```overpass
node["amenity"~"^(bar|pub)$"](bbox);
```

Both fixes are in `patches/open-streetmap-mcp-useragent-and-subcategory.patch` and are applied to the vendored checkout. Re-apply with `git apply patches/...` from inside `open-streetmap-mcp/` after a fresh clone.

---

## 5. Environment issues (not upstream bugs)

### 5.1 Expired CA bundle

The CPython builds distributed by `uv` (python-build-standalone, OpenSSL 3.0.16) ship a CA store whose Let's Encrypt chain no longer validates. Every HTTPS call to Overpass and OSRM fails with:

```
SSLCertVerificationError: certificate has expired
```

The certificates themselves are valid (`notAfter=Dec 18 2026`); the bundled root store is the problem. `certifi` - already a transitive dependency of `mcp` - verifies correctly.

**Fix:** `scripts/mcp_client.py` sets `SSL_CERT_FILE` to the certifi bundle in the server subprocess environment, and `scripts/common.py` uses the same for direct Overpass calls. If you see certificate errors, check this first.

### 5.2 Rate limiting

`overpass-api.de` is a shared public service. Large `out geom` requests over the whole prototype bbox return **HTTP 504** regularly. Mitigations in this pipeline:

- Every Overpass query is **split per tile**, and long amenity value lists are chunked.
- All responses are **cached on disk** in `data/cache/` keyed by a hash of the query, so re-runs cost nothing.
- 429/504 are retried with quadratic backoff; HTTP 400 (a genuine bad query) fails fast.

Endpoint availability measured from the development machine:

| Endpoint | Result |
| --- | --- |
| `overpass-api.de` | reachable, full planet data - **used** |
| `overpass.osm.ch` | reachable but a regional instance, returns 0 results for Sydney |
| `overpass.kumi.systems` | connection timeout |
| `overpass.private.coffee` | connection timeout |
| `overpass.osm.jp` | TLS hostname mismatch |
| `maps.mail.ru`, `overpass.openstreetmap.ru` | timeout / refused |

If you are on a different network, re-test and extend `OVERPASS_ENDPOINTS` in `scripts/common.py`.

---

## 6. Reproducing the evidence

```bash
python scripts/test_osm.py      # Tests A-G -> data/raw/test-results.json
python scripts/mcp_client.py tools   # dump the live tool list
```

`test_osm.py` records, per test: tool, parameters, the literal Overpass QL, result counts, response structure, errors and limitations. Current status: **9/9 passing** against live Sydney data.
