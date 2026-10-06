# Sydney OSM Data Report

- **Generated:** 2026-09-29T17:49:22+00:00
- **World spec generated:** 2026-09-29T17:49:20+00:00
- **Pipeline version:** 0.1.0-prototype

> All counts below are produced by the pipeline and stored in `data/`. Nothing here is estimated by hand.

## 1. Area queried

| Field | Value |
| --- | --- |
| Source | OpenStreetMap (ODbL 1.0) |
| Region | Sydney, New South Wales, Australia |
| Core bbox (S/W/N/E) | -33.8955, 151.186, -33.845, 151.235 |
| Approx size | 4.7 km x 5.6 km |
| Tiles | cbd, barangaroo, darling-harbour, east-inner |
| Projection origin | Sydney CBD core (near Central / Haymarket) (-33.873, 151.208) |

**Why this area:** Prototype core area only. NOT metropolitan Sydney. Chosen because it contains every relationship the world spec needs: CBD grid, harbour edge, waterfront, nightlife belt (Surry Hills / Kings Cross), park anchors, rail spine, and the bridge/tunnel crossings that define Sydney's topology.

## 2. Collection run

- Steps attempted: **51**, succeeded: **51**
- MCP capability tests: **9/9 passed**
- Wall time: 2.6 s (a re-run is near-instant: responses are cached in `data/cache/`)

| Channel | Steps | What it was used for |
| --- | --- | --- |
| osm-mcp (MCP server) | 17 | geocoding, reverse geocoding, POI search, area profiles, OSRM routing |
| Overpass API (direct) | 34 | roads, buildings, water, parks, transit, landmarks - everything needing geometry |

The split is forced by the MCP server itself: every tool it exposes ends in `out body;`, which discards geometry, and no tool queries the `highway` tag at all. See `docs/OSM-MCP.md`.

## 3. Feature counts

| Layer | Count | Notes |
| --- | --- | --- |
| Roads (ways) | 5793 | 449.21 km of mapped road centreline |
| - named / unnamed | 4163 / 1630 | |
| - bridge / tunnel ways | 195 / 216 | |
| Intersections (derived) | 5663 | 330 have 4+ roads |
| Dead ends (derived) | 1317 | |
| Venues (POIs) | 7157 | 7157 with coordinates |
| - nightlife | 749 | |
| - seen in both MCP and Overpass | 6268 | cross-channel agreement check |
| Parks / green space | 1486 | 9.956 km2 |
| Water features | 121 | {'water_body': 89, 'beach': 16, 'stream': 8, 'bay': 5, 'dock': 2, 'river': 1} |
| Transit stops | 464 | {'light_rail': 300, 'subway_entrance': 85, 'rail_station': 40, 'ferry_terminal': 39} |
| Landmarks (named) | 1397 | 1397 named |
| Buildings (SAMPLE) | 972 | small CBD sample only, see section 6 |

### Roads by class

| Class | Ways |
| --- | --- |
| service | 1856 |
| local | 1515 |
| arterial | 808 |
| collector | 565 |
| pedestrian | 409 |
| freeway_link | 232 |
| freeway | 177 |
| arterial_link | 97 |
| arterial_major | 91 |
| collector_link | 40 |
| arterial_major_link | 3 |

### Venue groups

| Group | Venues |
| --- | --- |
| other | 2335 |
| food | 1835 |
| transport | 1255 |
| nightlife | 451 |
| commerce | 435 |
| civic | 356 |
| leisure | 307 |
| lodging | 183 |

## 4. Districts (derived)

Districts are assigned by **nearest configured seed point**, not by council boundary. Areas are the extent of the features assigned to each district, so densities are useful for *relative* comparison only.

| District | km2 | Venues | Nightlife | Nightlife/km2 | Venues/km2 | Parks | Transit | Arterial km |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Sydney CBD (`cbd-core`) | 1.23 | 1062 | 164 | 133.3 | 863.4 | 33 | 52 | 7.39 |
| Barangaroo (`barangaroo`) | 0.599 | 296 | 37 | 61.8 | 494.2 | 41 | 16 | 2.84 |
| The Rocks (`the-rocks`) | 2.417 | 380 | 86 | 35.6 | 157.2 | 115 | 6 | 13.8 |
| Circular Quay (`circular-quay`) | 0.955 | 314 | 64 | 67.0 | 328.8 | 41 | 37 | 0.74 |
| Walsh Bay (`walsh-bay`) | 4.087 | 187 | 12 | 2.9 | 45.8 | 104 | 15 | 2.35 |
| Woolloomooloo (`woolloomooloo`) | 0.917 | 179 | 47 | 51.3 | 195.2 | 71 | 0 | 7.65 |
| Darling Harbour (`darling-harbour`) | 1.742 | 241 | 25 | 14.4 | 138.3 | 71 | 98 | 8.79 |
| Pyrmont (`pyrmont`) | 1.385 | 110 | 14 | 10.1 | 79.4 | 49 | 26 | 0.14 |
| Haymarket (`haymarket`) | 1.809 | 951 | 183 | 101.2 | 525.7 | 77 | 103 | 9.25 |
| Ultimo (`ultimo`) | 4.451 | 1073 | 158 | 35.5 | 241.1 | 272 | 12 | 17.97 |
| Kings Cross (`kings-cross`) | 1.955 | 574 | 93 | 47.6 | 293.6 | 70 | 5 | 5.12 |
| Potts Point (`potts-point`) | 1.061 | 21 | 4 | 3.8 | 19.8 | 59 | 6 | 1.38 |
| Surry Hills (`surry-hills`) | 2.975 | 523 | 109 | 36.6 | 175.8 | 77 | 39 | 10.59 |
| Kingsford (`kingsford`) | 2.563 | 218 | 28 | 10.9 | 85.1 | 37 | 0 | 9.01 |
| Darlinghurst (`darlinghurst`) | 1.567 | 526 | 145 | 92.5 | 335.7 | 51 | 0 | 11.9 |
| Redfern (`redfern`) | 1.879 | 108 | 10 | 5.3 | 57.5 | 47 | 41 | 7.81 |
| Hyde Park (`hyde-park`) | 0.782 | 136 | 2 | 2.6 | 173.9 | 104 | 8 | 4.26 |
| Royal Botanic Garden (`botanic-garden`) | 0.947 | 126 | 9 | 9.5 | 133.1 | 89 | 0 | 3.46 |
| Centennial Park (`centennial-park`) | 1.932 | 132 | 10 | 5.2 | 68.3 | 77 | 0 | 7.06 |

## 5. Water, crossings and transit

Water bodies by kind:

- `water_body`: 89
- `beach`: 16
- `stream`: 8
- `bay`: 5
- `dock`: 2
- `river`: 1

Largest named water bodies:

- Port Jackson - water_body, 51.193 km2
- Sydney Harbour - water_body, 26.175 km2
- Parramatta River - water_body, 9.685 km2
- Woolloomooloo Bay - bay, 0.216 km2
- Sydney Cove - bay, 0.213 km2
- Rushcutters Bay - bay, 0.176 km2
- Elizabeth Bay - bay, 0.064 km2
- Nawi Cove - bay, 0.012 km2

**Drivable crossings** (grouped from `bridge=yes` / `tunnel=yes` road geometry - this is how the actual bridges and tunnels were recovered, since the Harbour Bridge itself is a relation with no geometry in OSM):

| Kind | Name | Roads | Length m | Districts |
| --- | --- | --- | --- | --- |
| bridge | Western Distributor | 33 | 5870.8 | barangaroo, cbd-core, darling-harbour, haymarket |
| tunnel | Cross City Tunnel | 18 | 4873.2 | cbd-core, darlinghurst, haymarket, hyde-park |
| tunnel | (unnamed) | 124 | 4677.2 | barangaroo, botanic-garden, cbd-core, centennial-park |
| tunnel | Sydney Harbour Tunnel | 2 | 4613.0 | circular-quay, the-rocks, walsh-bay |
| bridge | Cahill Expressway | 26 | 4036.1 | circular-quay, the-rocks |
| tunnel | Eastern Distributor | 9 | 3598.9 | darlinghurst, kingsford, redfern, surry-hills |
| bridge | Bradfield Highway | 21 | 3374.9 | the-rocks |
| bridge | (unnamed) | 40 | 2371.9 | centennial-park, darling-harbour, haymarket, kings-cross |
| bridge | Western Distributor Onramp | 18 | 1943.0 | cbd-core, darling-harbour, haymarket |
| tunnel | Cahill Expressway | 7 | 1353.9 | botanic-garden, the-rocks, woolloomooloo |
| tunnel | Eastern Distributor Onramp | 2 | 857.0 | darlinghurst, kingsford, surry-hills, woolloomooloo |
| tunnel | Eastern Distributor Offramp | 2 | 810.1 | hyde-park, woolloomooloo |

Transit stops by kind: `{'light_rail': 300, 'subway_entrance': 85, 'rail_station': 40, 'ferry_terminal': 39}`

Top transport hubs (derived from stop clustering):

- **CBD and South East Light Rail** - 30 named stops in `haymarket` at [-33.881962, 151.20654]: CBD and South East Light Rail, Central, Central Grand Concourse, Exit 1: Grand Concourse
- **CBD and South East Light Rail** - 26 named stops in `surry-hills` at [-33.884708, 151.207068]: CBD and South East Light Rail, Central Chalmers Street, Down Sydney Metro City & Southwest, Exit 5: Chalmers Street
- **CBD and South East Light Rail** - 25 named stops in `circular-quay` at [-33.861113, 151.210038]: CBD and South East Light Rail, Circular Quay, Circular Quay 2A, Circular Quay 2B
- **Bridge Street** - 21 named stops in `cbd-core` at [-33.864586, 151.20638]: Bridge Street, CBD and South East Light Rail, Down Sydney Metro City & Southwest, MetCentre
- **CBD and South East Light Rail** - 20 named stops in `redfern` at [-33.892815, 151.221595]: CBD and South East Light Rail, Moore Park
- **CBD and South East Light Rail** - 18 named stops in `haymarket` at [-33.879573, 151.205833]: CBD and South East Light Rail, Capitol Square, Chinatown, Down Sydney Metro City & Southwest
- **CBD and South East Light Rail** - 17 named stops in `redfern` at [-33.890076, 151.218085]: CBD and South East Light Rail
- **Castlereagh Street South** - 16 named stops in `cbd-core` at [-33.867446, 151.210665]: Castlereagh Street South, Down Sydney Metro City & Southwest, Elizabath Street South, Hunter Street

## 6. Buildings: what OSM actually provides

- Sampled footprints: **972** (inside a 0.013 deg tall CBD box, not the whole city)
- With a name: **312** (32.1%)
- With `building:levels`: **782** (80.5%)
- With any height tag: **20** (2.1%)

> **Do not fabricate heights.** Only a small minority of Sydney footprints carry a height in OSM, and where they do, it is a single tagged value with no confidence. If the game needs massing, derive it from district character and label it as invention, not data.

## 7. Missing data / known gaps

| Field | Missing | Note |
| --- | --- | --- |
| road `lanes` | 3321 of 5793 | OSM simply does not tag this |
| road `maxspeedKmh` | 2844 of 5793 | OSM simply does not tag this |
| road `surface` | 1347 of 5793 | OSM simply does not tag this |
| road `name` | 1630 of 5793 | OSM simply does not tag this |
| venue coordinates | 0 of 7157 | dropped by the MCP channel |

Not collected at all, and not inferable from OSM:

- Traffic volume, congestion and road speed limits (beyond the `maxspeed` tag)
- Public transport routes, timetables, platforms and service frequency
- Bus network (sparsely mapped in OSM)
- Building interiors, floor areas, and reliable heights
- Population, footfall, crime, noise, or any socio-economic data
- Sea depth / bathymetry

## 8. Limitations of the tooling

- Prototype covers only the configured core bbox, not metropolitan Sydney.
- Building footprints are a small CBD sample, not a city-wide layer.
- The MCP server cannot return roads, buildings or any geometry; those come from direct Overpass.
- Heights, opening hours, floor areas and traffic volumes are absent from OSM and were not invented.
- District assignment is nearest-seed, not an official boundary.
- No bus network, no timetables, no traffic data, no population data.

Upstream defects found and patched (details in `docs/OSM-MCP.md`):

1. `mcp[cli]>=1.3.0` now resolves to mcp 2.x, where `FastMCP` was renamed - the server will not import. Pinned `<2`.
2. Overpass requests carried no `User-Agent`, which the public API answers with HTTP 406. Patched.
3. `search_category(subcategories=[...])` built invalid Overpass QL and always failed with HTTP 400. Patched to a regex filter.

## 9. Files

| Path | Contents |
| --- | --- |
| `data/raw/` | Unmodified responses, each wrapped in a provenance envelope |
| `data/normalized/` | Typed, projected, stable-ID records |
| `data/world/world-spec.json` | **The deliverable** - AI-facing world specification |
| `data/world/world-analysis.json` | Interpretation layer, explicitly labelled as such |
| `world/` | Human-facing per-layer exports |
| `docs/` | Setup, MCP analysis, data schema, this report, world-design prompt |
