"""Export the per-layer world files and the human-readable data report.

Outputs:
    world/districts.json  world/roads.json  world/landmarks.json
    world/venues.json    world/parks.json  world/waterways.json
    world/transit.json   world/buildings.json
    docs/SYDNEY-DATA-REPORT.md

Every number in the report is counted from the pipeline output - nothing is
estimated or written by hand.

Run:  python scripts/export_summary.py
"""

from __future__ import annotations

import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import (  # noqa: E402
    DOCS,
    NORMALIZED,
    RAW,
    WORLD,
    WORLDDATA,
    ensure_dirs,
    load_config,
    now_iso,
    read_json,
    write_json,
)


def load(path: Path):
    return read_json(path)


def stats_of(envelope_obj: dict) -> dict:
    """Normalised layers put their stats either inside payload or beside it."""
    return envelope_obj["payload"].get("stats") or envelope_obj.get("stats") or {}


def pct(part: int, whole: int) -> str:
    return f"{(100.0 * part / whole):.1f}%" if whole else "n/a"


def main() -> int:
    ensure_dirs()
    config = load_config()
    spec = load(WORLDDATA / "world-spec.json")
    analysis = load(WORLDDATA / "world-analysis.json")
    tests = load(RAW / "test-results.json")
    collection = load(RAW / "collection-log.json")

    roads_payload = load(NORMALIZED / "roads.json")
    venues_payload = load(NORMALIZED / "venues.json")
    parks_payload = load(NORMALIZED / "parks.json")
    water_payload = load(NORMALIZED / "waterways.json")
    transit_payload = load(NORMALIZED / "transit.json")
    buildings_payload = load(NORMALIZED / "buildings.json")
    landmarks_payload = load(NORMALIZED / "landmarks.json")
    graph_payload = load(NORMALIZED / "intersections.json")
    manifest = load(NORMALIZED / "manifest.json")

    # ------------------------------------------------------- world exports --
    write_json(
        WORLD / "districts.json",
        {
            "generatedAt": now_iso(),
            "note": "Districts are derived by nearest-seed assignment, not official boundaries. "
                    "Distances/areas are approximations - see provenance in each record.",
            "districts": spec["districts"],
            "populationZones": spec["populationZones"],
            "gameplayZones": spec["gameplayZones"],
            "corridors": spec["corridors"],
        },
    )
    write_json(
        WORLD / "roads.json",
        {
            "generatedAt": now_iso(),
            "summary": stats_of(roads_payload),
            "arterials": spec["roads"]["arterials"],
            "intersectionsMajor": spec["intersections"]["major"],
            "crossings": spec["landmarks"]["crossings"],
            "fullGeometryFile": "data/normalized/roads.json",
            "note": "All 5,793 road ways with full geometry live in data/normalized/roads.json; "
                    "this file carries arterials inline so the topology is legible without a 10 MB load.",
        },
    )
    write_json(WORLD / "landmarks.json", {
        "generatedAt": now_iso(),
        "bridges": spec["landmarks"]["bridges"],
        "tunnels": spec["landmarks"]["tunnels"],
        "crossings": spec["landmarks"]["crossings"],
        "namedAttractions": spec["landmarks"]["namedAttractions"],
    })
    write_json(WORLD / "venues.json", {
        "generatedAt": now_iso(),
        "summary": stats_of(venues_payload),
        "byDistrict": spec["venues"]["byDistrict"],
        "nightlifeClusters": spec["nightlifeClusters"],
    })
    write_json(WORLD / "parks.json", {
        "generatedAt": now_iso(),
        "stats": parks_payload["stats"],
        "largestParks": spec["nature"]["largestParks"],
    })
    write_json(WORLD / "waterways.json", {
        "generatedAt": now_iso(),
        "stats": stats_of(water_payload),
        "largest": spec["water"]["largest"],
        "beaches": spec["water"]["beaches"],
    })
    write_json(WORLD / "transit.json", {
        "generatedAt": now_iso(),
        "stats": stats_of(transit_payload),
        "namedStops": spec["transit"]["namedStops"],
        "transportHubs": spec["transportHubs"],
    })
    write_json(WORLD / "buildings.json", {
        "generatedAt": now_iso(),
        "stats": buildings_payload["payload"]["stats"],
        "note": "Sample only - see config scope.buildingSampleBbox. Most buildings have no height in OSM.",
    })
    print(f"world/ written: {len(list(WORLD.glob('*.json')))} files")

    # ----------------------------------------------------------- report --
    road_stats = stats_of(roads_payload)
    venue_stats = stats_of(venues_payload)
    graph_stats = stats_of(graph_payload)
    building_stats = stats_of(buildings_payload)
    transit_stats = stats_of(transit_payload)
    water_stats = stats_of(water_payload)

    total_steps = len(collection["steps"])
    ok_steps = sum(1 for s in collection["steps"] if s["status"] == "ok")
    passed_tests = sum(1 for t in tests["tests"] if t["status"] == "PASS")

    lines: list[str] = []
    add = lines.append

    add("# Sydney OSM Data Report")
    add("")
    add(f"- **Generated:** {now_iso()}")
    add(f"- **World spec generated:** {spec['generatedAt']}")
    add(f"- **Pipeline version:** {config['version']}")
    add("")
    add("> All counts below are produced by the pipeline and stored in `data/`. Nothing here is estimated by hand.")
    add("")

    add("## 1. Area queried")
    add("")
    add("| Field | Value |")
    add("| --- | --- |")
    add(f"| Source | OpenStreetMap (ODbL 1.0) |")
    add(f"| Region | {config['region']} |")
    add(f"| Core bbox (S/W/N/E) | {config['scope']['coreBbox']['south']}, {config['scope']['coreBbox']['west']}, "
        f"{config['scope']['coreBbox']['north']}, {config['scope']['coreBbox']['east']} |")
    add(f"| Approx size | {config['scope']['approxSizeKm']['eastWest']} km x {config['scope']['approxSizeKm']['northSouth']} km |")
    add(f"| Tiles | {', '.join(t['id'] for t in config['scope']['tiles'])} |")
    add(f"| Projection origin | {config['origin']['label']} ({config['origin']['lat']}, {config['origin']['lon']}) |")
    add("")
    add(f"**Why this area:** {config['scope']['note']}")
    add("")

    add("## 2. Collection run")
    add("")
    add(f"- Steps attempted: **{total_steps}**, succeeded: **{ok_steps}**")
    add(f"- MCP capability tests: **{passed_tests}/{tests['total']} passed**")
    add(f"- Wall time: {collection.get('durationSeconds', 'n/a')} s (a re-run is near-instant: responses are cached in `data/cache/`)")
    add("")
    add("| Channel | Steps | What it was used for |")
    add("| --- | --- | --- |")
    mcp_steps = [s for s in collection["steps"] if s["channel"] == "osm-mcp"]
    ov_steps = [s for s in collection["steps"] if s["channel"] == "overpass-api"]
    add(f"| osm-mcp (MCP server) | {len(mcp_steps)} | geocoding, reverse geocoding, POI search, area profiles, OSRM routing |")
    add(f"| Overpass API (direct) | {len(ov_steps)} | roads, buildings, water, parks, transit, landmarks - everything needing geometry |")
    add("")
    add("The split is forced by the MCP server itself: every tool it exposes ends in `out body;`, which "
        "discards geometry, and no tool queries the `highway` tag at all. See `docs/OSM-MCP.md`.")
    add("")

    add("## 3. Feature counts")
    add("")
    add("| Layer | Count | Notes |")
    add("| --- | --- | --- |")
    add(f"| Roads (ways) | {road_stats['total']} | {road_stats['totalLengthKm']} km of mapped road centreline |")
    add(f"| - named / unnamed | {road_stats['named']} / {road_stats['unnamed']} | |")
    add(f"| - bridge / tunnel ways | {road_stats['bridges']} / {road_stats['tunnels']} | |")
    add(f"| Intersections (derived) | {graph_stats['total']} | {graph_stats['fourPlusWay']} have 4+ roads |")
    add(f"| Dead ends (derived) | {graph_stats['deadEnds']} | |")
    add(f"| Venues (POIs) | {venue_stats['total']} | {venue_stats['located']} with coordinates |")
    add(f"| - nightlife | {venue_stats['nightlife']} | |")
    add(f"| - seen in both MCP and Overpass | {venue_stats['seenInBothChannels']} | cross-channel agreement check |")
    add(f"| Parks / green space | {parks_payload['stats']['total']} | {parks_payload['stats']['totalAreaKm2']} km2 |")
    add(f"| Water features | {water_stats['total']} | {water_stats['byKind']} |")
    add(f"| Transit stops | {transit_stats['total']} | {transit_stats['byKind']} |")
    add(f"| Landmarks (named) | {landmarks_payload['stats']['total']} | {landmarks_payload['stats']['named']} named |")
    add(f"| Buildings (SAMPLE) | {building_stats['total']} | small CBD sample only, see section 6 |")
    add("")

    add("### Roads by class")
    add("")
    add("| Class | Ways |")
    add("| --- | --- |")
    for category, count in road_stats["byCategory"].items():
        add(f"| {category} | {count} |")
    add("")

    add("### Venue groups")
    add("")
    add("| Group | Venues |")
    add("| --- | --- |")
    for group, count in venue_stats["byGroup"].items():
        add(f"| {group} | {count} |")
    add("")

    add("## 4. Districts (derived)")
    add("")
    add("Districts are assigned by **nearest configured seed point**, not by council boundary. "
        "Areas are the extent of the features assigned to each district, so densities are useful for "
        "*relative* comparison only.")
    add("")
    add("| District | km2 | Venues | Nightlife | Nightlife/km2 | Venues/km2 | Parks | Transit | Arterial km |")
    add("| --- | --- | --- | --- | --- | --- | --- | --- | --- |")
    for district in spec["districts"]:
        counts, measured = district["counts"], district["measured"]
        add(
            f"| {district['realName']} (`{district['id']}`) | {district['extentKm2']} | {counts['venues']} | "
            f"{counts['nightlifeVenues']} | {measured['nightlifePerKm2']} | {measured['venuesPerKm2']} | "
            f"{counts['parks']} | {counts['transitStops']} | {measured['arterialRoadKm']} |"
        )
    add("")

    add("## 5. Water, crossings and transit")
    add("")
    add("Water bodies by kind:")
    add("")
    for kind, count in water_stats["byKind"].items():
        add(f"- `{kind}`: {count}")
    add("")
    add("Largest named water bodies:")
    add("")
    for body in spec["water"]["largest"][:8]:
        add(f"- {body['name'] or '(unnamed)'} - {body['kind']}, {round((body['areaM2'] or 0) / 1e6, 3)} km2")
    add("")
    add("**Drivable crossings** (grouped from `bridge=yes` / `tunnel=yes` road geometry - this is how the "
        "actual bridges and tunnels were recovered, since the Harbour Bridge itself is a relation with no "
        "geometry in OSM):")
    add("")
    add("| Kind | Name | Roads | Length m | Districts |")
    add("| --- | --- | --- | --- | --- |")
    for crossing in spec["landmarks"]["crossings"][:12]:
        add(f"| {crossing['kind']} | {crossing['name'] or '(unnamed)'} | {crossing['roadCount']} | "
            f"{crossing['totalLengthM']} | {', '.join(crossing['districtIds'][:4])} |")
    add("")
    add(f"Transit stops by kind: `{transit_stats['byKind']}`")
    add("")
    add("Top transport hubs (derived from stop clustering):")
    add("")
    for hub in spec["transportHubs"][:8]:
        add(f"- **{hub.get('label') or hub['id']}** - {hub['stopCount']} named stops in "
            f"`{hub['districtId']}` at {hub['center']}: {', '.join(hub['stopNames'][:4])}")
    add("")

    add("## 6. Buildings: what OSM actually provides")
    add("")
    add(f"- Sampled footprints: **{building_stats['total']}** (inside a "
        f"{abs(config['scope']['buildingSampleBbox']['north'] - config['scope']['buildingSampleBbox']['south']):.3f} deg "
        "tall CBD box, not the whole city)")
    add(f"- With a name: **{building_stats['named']}** ({pct(building_stats['named'], building_stats['total'])})")
    add(f"- With `building:levels`: **{building_stats['withLevels']}** ({pct(building_stats['withLevels'], building_stats['total'])})")
    add(f"- With any height tag: **{building_stats['withHeight']}** ({pct(building_stats['withHeight'], building_stats['total'])})")
    add("")
    add("> **Do not fabricate heights.** Only a small minority of Sydney footprints carry a height in OSM, and "
        "where they do, it is a single tagged value with no confidence. If the game needs massing, derive it "
        "from district character and label it as invention, not data.")
    add("")

    add("## 7. Missing data / known gaps")
    add("")
    add("| Field | Missing | Note |")
    add("| --- | --- | --- |")
    for field, count in road_stats["missingFields"].items():
        add(f"| road `{field}` | {count} of {road_stats['total']} | OSM simply does not tag this |")
    add(f"| venue coordinates | {venue_stats['withoutLocation']} of {venue_stats['total']} | dropped by the MCP channel |")
    add("")
    add("Not collected at all, and not inferable from OSM:")
    add("")
    add("- Traffic volume, congestion and road speed limits (beyond the `maxspeed` tag)")
    add("- Public transport routes, timetables, platforms and service frequency")
    add("- Bus network (sparsely mapped in OSM)")
    add("- Building interiors, floor areas, and reliable heights")
    add("- Population, footfall, crime, noise, or any socio-economic data")
    add("- Sea depth / bathymetry")
    add("")

    add("## 8. Limitations of the tooling")
    add("")
    for limitation in spec["limitations"]:
        add(f"- {limitation}")
    add("")
    add("Upstream defects found and patched (details in `docs/OSM-MCP.md`):")
    add("")
    add("1. `mcp[cli]>=1.3.0` now resolves to mcp 2.x, where `FastMCP` was renamed - the server will not import. Pinned `<2`.")
    add("2. Overpass requests carried no `User-Agent`, which the public API answers with HTTP 406. Patched.")
    add("3. `search_category(subcategories=[...])` built invalid Overpass QL and always failed with HTTP 400. Patched to a regex filter.")
    add("")

    add("## 9. Files")
    add("")
    add("| Path | Contents |")
    add("| --- | --- |")
    add("| `data/raw/` | Unmodified responses, each wrapped in a provenance envelope |")
    add("| `data/normalized/` | Typed, projected, stable-ID records |")
    add("| `data/world/world-spec.json` | **The deliverable** - AI-facing world specification |")
    add("| `data/world/world-analysis.json` | Interpretation layer, explicitly labelled as such |")
    add("| `world/` | Human-facing per-layer exports |")
    add("| `docs/` | Setup, MCP analysis, data schema, this report, world-design prompt |")
    add("")

    report = "\n".join(lines)
    (DOCS / "SYDNEY-DATA-REPORT.md").write_text(report, encoding="utf-8")
    print(f"written: {DOCS / 'SYDNEY-DATA-REPORT.md'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
