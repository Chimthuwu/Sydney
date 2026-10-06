# Data schema

Everything the pipeline writes is JSON. This document describes the layers, the record shapes, and - most importantly - **how to tell a fact from a derivation from a design decision**.

---

## 1. The four evidence layers

Mission section 25 demands that these never be silently merged. Every record carries a `provenance` object, and every generated field is labelled with one of:

| Label | Means | Example |
| --- | --- | --- |
| `source` | copied straight from an OSM tag | `roads[].highway == "primary"` |
| `derived` | computed from OSM geometry or counts | `intersections[]`, `districts[]`, `nightlifeClusters[]` |
| `ai-interpretation` | a heuristic a world designer may reject | `world-analysis.json` entirely |
| `gameplay-design` | the game-facing classification | `populationZones[]`, `gameplayZones[]` |

If you cannot trace a field to an OSM tag, it is not a source fact. Do not let it become one downstream.

---

## 2. Pipeline stages

```
config/sydney.config.json          the single source of geographic scope
        │
        ▼
data/raw/*.json                    verbatim responses + provenance envelope
        │                          (osm-mcp channel and overpass-api channel)
        ▼
data/normalized/*.json             typed, projected, stable-ID records
        │                          (roads, intersections, venues, parks,
        │                           water, transit, buildings, landmarks)
        ▼
data/world/world-spec.json         THE DELIVERABLE for a world-designing AI
data/world/world-analysis.json     interpretation layer (clearly labelled)
        │
        ▼
world/*.json                       per-layer human-facing exports
docs/SYDNEY-DATA-REPORT.md         the numbers, written from the data
```

## 3. The raw envelope

Every file in `data/raw/` is wrapped:

```json
{
  "kind": "roads-backbone-cbd",
  "sourceChannel": "overpass-api",
  "collectedAt": "2026-09-29T13:05:41+00:00",
  "dataSource": "OpenStreetMap",
  "license": "ODbL 1.0",
  "query": "[out:json][timeout:90]; ( way[\"highway\"~\"^(motorway|...)$\"](...); ); out body geom;",
  "description": "Arterials / trunk / links in tile 'cbd'",
  "elementCount": 1273,
  "partial": false,
  "evidenceLayer": "source",
  "whyNotMcp": "No MCP tool queries this tag, and all MCP tools use `out body;` which discards geometry.",
  "payload": { "elements": [ ... ] }
}
```

`partial: true` means Overpass hit its own `[timeout:]` and returned incomplete data - treat that layer as suspect.

## 4. Coordinate system

Raw data is WGS84 `[lat, lon]`. Every normalised record also carries projected coordinates.

```json
"coordinateSystem": {
  "method": "local equirectangular tangent plane (WGS84 mean radius)",
  "origin": { "label": "Sydney CBD core (near Central / Haymarket)", "lat": -33.873, "lon": 151.208 },
  "metersPerDegreeLatitude": 110904.1,
  "metersPerDegreeLongitude": 92737.0,
  "units": "meters",
  "metersPerUnit": 1.0,
  "axes": { "x": "+east", "y": "+up (height)", "z": "+south (north is -Z)" }
}
```

**Why not raw lat/lon:** one degree of longitude at Sydney's latitude is about 0.836x one degree of latitude. Treating degrees as Cartesian metres squashes the map east-west by ~16%. Everything downstream uses metres.

**Why this projection is enough:** the prototype spans ~5-7 km. Over that distance the equirectangular tangent plane is accurate to well under 0.1%, far below the tolerance of a world that will be compressed anyway. A full map projection (UTM/MGRS) would add a dependency and buy nothing here. When the world is extended to metropolitan scale, revisit this - and revisit the origin.

**Three.js mapping:** the engine is Y-up, so geometry goes on the XZ plane. A road's `geometryLocal` is already `[[x, 0, z], ...]` and can be fed straight to a `BufferGeometry`. `y` is left at 0 everywhere because this pipeline has no elevation data.

**Note on extent:** roads that cross the configured bbox edge are returned whole, so the projected data spans slightly more than the bbox (measured: 5.5 x 7.0 km for a 4.4 x 5.6 km bbox).

## 5. Normalised records

### 5.1 Stable IDs

`"<osmType>/<osmId>"`, e.g. `way/12345678`, `node/987654`. Derived from the OSM element itself, so IDs are stable across re-runs and can be looked up on openstreetmap.org. Nothing in the pipeline invents an ID.

### 5.2 Road (`data/normalized/roads.json`)

```json
{
  "id": "way/1234",
  "type": "road",
  "name": "George Street",
  "highway": "primary",
  "category": "arterial",
  "surface": "asphalt",
  "maxspeedKmh": 50.0,
  "lanes": 4,
  "oneway": false,
  "bridge": false,
  "tunnel": false,
  "junction": null,
  "layer": null,
  "lengthM": 612.4,
  "named": true,
  "geometry": [[-33.87, 151.2], ...],
  "geometryLocal": [[x, 0, z], ...],
  "tags": { "...all original OSM tags..." },
  "provenance": { "source": ["overpass:roads-backbone-cbd"] }
}
```

`category` is a **derived** grouping of the raw `highway` value (`freeway`, `arterial_major`, `arterial`, `collector`, `local`, `pedestrian`, `service`, plus `*_link` variants).

Missing values are `null` and counted in `stats.missingFields`. They are never filled in.

### 5.3 Intersection (`data/normalized/intersections.json`) — DERIVED

```json
{
  "id": "x/-118,2043",
  "type": "intersection",
  "lat": -33.8712, "lon": 151.2031,
  "local": { "x": -1391.2, "y": 0.0, "z": 198.4 },
  "roadIds": ["way/1", "way/2"],
  "roadCount": 2,
  "roadNames": ["George Street", "Park Street"],
  "degree": 2
}
```

**These are not OSM nodes.** The MCP server returns no node ids for ways, so intersections are recovered by snapping shared road vertices onto a 3 m grid in the local projection. Two roads passing within 3 m of each other will produce a spurious junction. `roadCount >= 4` nodes are the most likely to be genuine crossroads; single-road endpoints are reported separately as `deadEnds`.

### 5.4 Venue (`data/normalized/venues.json`)

```json
{
  "id": "node/4455",
  "type": "venue",
  "name": "Some Bar",
  "category": "bar",
  "group": "nightlife",
  "isNightlife": true,
  "nightlifeRole": "bar",
  "hasAddress": true,
  "address": { "street": "...", "houseNumber": "...", "suburb": "...", "postcode": "..." },
  "osmType": "node",
  "center": [-33.87, 151.2],
  "local": { "x": 0, "y": 0, "z": 0 },
  "geometry": null,
  "tags": { ... },
  "provenance": { "source": ["overpass:venues-amenity-cbd-0", "osm-mcp:mcp-poi-amenity-cbd"] },
  "seenInChannels": 2
}
```

- `group` is a **derived** rollup: `nightlife`, `food`, `commerce`, `lodging`, `civic`, `transport`, `leisure`, `other`.
- `isNightlife` is **derived** from the tag values listed in `config.nightlife`. It reflects how a place is *tagged*, not when it is actually open. OSM has almost no reliable opening hours, so **no hours are inferred anywhere**.
- `seenInChannels: 2` means both the MCP server and Overpass independently returned this element - a useful confidence signal.

### 5.5 Park / water / transit / building / landmark

Same envelope pattern. Notable specifics:

- **Water** `kind` is one of `water_body`, `bay`, `strait`, `beach`, `coastline`, `river`, `stream`, `canal`, `dock`, `riverbank`, `reservoir`. The harbour is **many separate ways and relations**, not one polygon - a consumer that needs "the harbour" must union them.

#### Ring stitching - read this before drawing a polygon

Multipolygon relations store their boundary as a set of separate member ways, and those
ways are often only *fragments* of one logical ring. In the prototype area **82 of the 156
park rings arrived with a gap of up to 617 m** (Royal Botanic Garden, Barangaroo Reserve,
the Domain precincts).

`normalize_osm.py` therefore stitches fragments end-to-end into closed rings
(`stitch_rings()`) before anything is written, and **discards** any chain it cannot close
rather than guessing. Every ring in `data/normalized/parks.json` and `waterways.json` is
now verifiably closed (0 unclosed of 1,529 park rings, 0 of 160 water rings).

This is not cosmetic. Drawing an unclosed fragment as if it were a closed ring - the
obvious `triangle fan` - produces enormous triangles that spill across the entire scene.
That bug is exactly what made the 3D viewer look broken. If you consume `rings` from this
data, use a proper triangulator (ear clipping) and check closure first.
- **Transit** `kind` is `rail_station`, `light_rail`, `ferry_terminal`, `tram_stop`, `subway_entrance`, or `other`. Positions only; no routes, no timetables, no platforms.
- **Building** carries `levels` and `heightM` **only when OSM has them**, plus `heightSource: "osm-tag"` to make that explicit. In the sample area, roughly 4 in 5 footprints have `building:levels` but almost none have a real height. **Never substitute an invented height for a null one without labelling it as invention.**
- **Landmark** `tags` are the raw OSM tags; `bridge` / `tunnel` / `isStructure` are derived booleans.

## 6. The world specification

`data/world/world-spec.json` is the file a world-designing AI consumes. Top-level keys:

| Key | Contents |
| --- | --- |
| `world` | name, source region, licence, fictionalisation policy |
| `coordinateSystem` | the projection block above |
| `evidenceLayers` | the four labels, restated in-file |
| `scope` | bbox, tiles, and why this area was chosen |
| `totals` | the headline counts |
| `districts[]` | 19 districts with counts, measured densities and provenance |
| `roads` | summary + 1,641 arterials **with geometry** |
| `intersections` | summary + the 400 highest-degree junctions |
| `landmarks` | grouped bridges, tunnels, road-derived `crossings`, named attractions |
| `venues` | summary + compact venue records grouped by district |
| `nature`, `water`, `transit`, `buildings` | summaries and the most useful subsets |
| `populationZones[]` | day/night activity - **gameplay design** |
| `gameplayZones[]` | role labels - **gameplay design** |
| `corridors[]` | district-to-district links, with OSRM driven distance where available |
| `nightlifeClusters[]`, `transportHubs[]`, `interestingRoads[]` | derived clusters |
| `limitations[]` | what this data cannot tell you |

### Districts are Voronoi, not boundaries

`districts[].provenance.assignmentMethod` is `"nearest configured district seed point"`. Extents are the bounding box of the features assigned to each district, so `measured.*PerKm2` densities **understate dense cores and overstate sparse ones**. They are for ranking districts against each other, nothing more.

### Crossings, and the Harbour Bridge problem

The Sydney Harbour Bridge is a **relation** in OSM with no directly usable geometry, and its member ways are cycleways and approaches. So `landmarks.crossings[]` is derived from the road network instead - every `bridge=yes` / `tunnel=yes` road grouped by name, keeping drivable geometry:

```json
{
  "name": "Sydney Harbour Tunnel",
  "kind": "tunnel",
  "roadCount": 2,
  "totalLengthM": 4613.0,
  "districtIds": ["circular-quay", "the-rocks", "walsh-bay"],
  "geometryLocal": [[[x, 0, z], ...]],
  "evidenceLayer": "derived",
  "derivation": "Grouped from bridge=yes / tunnel=yes road geometry, not from a bridge relation."
}
```

This is how the major crossings (Western Distributor, Cross City Tunnel, Cahill Expressway, Bradfield Highway, Sydney Harbour Tunnel) are recovered. They are **derived**, and labelled as such.

## 7. Caching

`data/cache/overpass/*.json` and `data/cache/mcp/*.json` hold every HTTP response, keyed by a hash of the request. A full re-run of the whole pipeline with a warm cache takes seconds instead of ~15 minutes, and — more importantly — does not hammer the public OSM services. Delete the cache to force a genuinely fresh collection.
