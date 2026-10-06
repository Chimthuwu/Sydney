"""Test A-G: prove what the OSM MCP server (and the Overpass fallback) can
actually return for Sydney, and record the evidence.

Every test records, per mission section 8:
    QUERY / TOOL / PARAMETERS / RESULT COUNT / RESPONSE STRUCTURE / ERRORS / LIMITATIONS

Run:  python scripts/test_osm.py
Writes: data/raw/test-results.json
"""

from __future__ import annotations

import json
import sys
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import mcp_client  # noqa: E402
from common import (  # noqa: E402
    RAW,
    BBox,
    OverpassClient,
    build_query,
    build_selectors,
    ensure_dirs,
    load_config,
    now_iso,
    resolve_bbox,
    write_json,
)

RESULTS: list[dict] = []


def record(
    test: str,
    channel: str,
    tool: str,
    parameters: dict,
    query: str | None,
    *,
    ok: bool,
    count=None,
    structure: dict | None = None,
    errors: list[str] | None = None,
    limitations: list[str] | None = None,
    sample=None,
) -> None:
    entry = {
        "test": test,
        "channel": channel,
        "tool": tool,
        "parameters": parameters,
        "query": query,
        "status": "PASS" if ok else "FAIL",
        "resultCount": count,
        "responseStructure": structure or {},
        "errors": errors or [],
        "limitations": limitations or [],
        "sample": sample,
        "checkedAt": now_iso(),
    }
    RESULTS.append(entry)
    flag = "PASS" if ok else "FAIL"
    print(f"[{flag}] {test:<34} {tool:<42} count={count}")
    for limitation in entry["limitations"]:
        print(f"        limitation: {limitation}")


def structure_of(payload) -> dict:
    """Describe a response's shape without dumping the payload."""
    if isinstance(payload, list):
        first = payload[0] if payload else None
        return {
            "topLevel": "array",
            "length": len(payload),
            "itemKeys": sorted(first.keys()) if isinstance(first, dict) else None,
        }
    if isinstance(payload, dict):
        return {
            "topLevel": "object",
            "keys": sorted(payload.keys()),
            "elementCount": len(payload.get("elements", [])) if "elements" in payload else None,
            "elementKeys": (
                sorted(payload["elements"][0].keys()) if payload.get("elements") else None
            ),
        }
    return {"topLevel": type(payload).__name__}


def mcp_call(tool: str, arguments: dict):
    return mcp_client.call_sync(tool, arguments)


def test_a_location(config: dict) -> None:
    queries = [
        "Sydney NSW, Australia",
        "Sydney Opera House",
        "Circular Quay Station, Sydney",
    ]
    ok_count = 0
    errors: list[str] = []
    samples = []
    for query in queries:
        try:
            payload = mcp_call("geocode_address", {"address": query})
            ok_count += len(payload or [])
            if payload:
                first = payload[0]
                samples.append(
                    {
                        "query": query,
                        "display_name": first.get("display_name"),
                        "lat": first.get("lat"),
                        "lon": first.get("lon"),
                        "osm_type": first.get("osm_type"),
                        "osm_id": first.get("osm_id"),
                        "boundingbox": first.get("boundingbox"),
                    }
                )
        except Exception as exc:
            errors.append(f"{query}: {type(exc).__name__}: {exc}")
    record(
        "A. Location (geocode)",
        "osm-mcp",
        "geocode_address",
        {"address": queries},
        "Nominatim /search via MCP tool geocode_address",
        ok=ok_count > 0 and not errors,
        count=ok_count,
        structure={"topLevel": "array", "note": "list of Nominatim place objects + injected 'coordinates'"},
        errors=errors,
        limitations=[
            "Returns Nominatim place records, not an administrative boundary polygon.",
            "No boundary/geometry is returned beyond a boundingbox array.",
        ],
        sample=samples,
    )


def test_b_roads(config: dict, overpass: OverpassClient) -> None:
    core = resolve_bbox(config, "coreBbox")
    ql = build_query(
        build_selectors("way", [{"highway": config["layers"]["roads"]["backbone"]["highway"]}], core),
        timeout=120,
    )
    try:
        payload = overpass.query(ql, "test-b-roads")
        elements = payload.get("elements", [])
        sample = None
        if elements:
            sample = {
                "id": elements[0].get("id"),
                "tags": elements[0].get("tags"),
                "geometrySample": (elements[0].get("geometry") or [])[:3],
                "hasGeometry": bool(elements[0].get("geometry")),
            }
        record(
            "B. Roads",
            "overpass-direct",
            "overpass-api (MCP cannot do this)",
            {"bbox": core.as_dict(), "highway": config["layers"]["roads"]["backbone"]["highway"]},
            ql,
            ok=len(elements) > 0,
            count=len(elements),
            structure={"topLevel": "overpass.elements", "elementKeys": structure_of(payload).get("elementKeys")},
            errors=[],
            limitations=[
                "NO MCP tool can query the `highway` tag - this dataset is impossible via the MCP server alone.",
                "Used `out geom;` because every MCP tool hard-codes `out body;` and returns no geometry.",
            ],
            sample=sample,
        )
    except Exception as exc:
        record("B. Roads", "overpass-direct", "overpass-api", {"bbox": core.as_dict()}, ql, ok=False,
               errors=[f"{type(exc).__name__}: {exc}"],
               limitations=["Could not retrieve road data; see errors."])


def test_c_venues(config: dict, overpass: OverpassClient) -> None:
    core = resolve_bbox(config, "coreBbox")
    sample_box = BBox(south=-33.885, west=151.200, north=-33.870, east=151.220)
    categories = ["bar", "pub", "nightclub", "restaurant", "cafe", "fast_food", "cinema", "theatre", "casino"]
    errors: list[str] = []
    total = 0
    per_category = {}
    sample = None

    # Channel 1: the MCP server, exactly as shipped (plus our documented patch).
    # One request covers all categories: the patched subcategory filter compiles
    # to a single regex, which is far kinder to the public Overpass mirror than
    # nine separate calls.
    try:
        payload = mcp_call(
            "search_category",
            {
                "category": "amenity",
                "min_latitude": sample_box.south,
                "min_longitude": sample_box.west,
                "max_latitude": sample_box.north,
                "max_longitude": sample_box.east,
                "subcategories": categories,
            },
        )
        results = payload.get("results", []) if isinstance(payload, dict) else []
        total = len(results)
        for item in results:
            value = (item.get("tags") or {}).get("amenity", "unknown")
            per_category[value] = per_category.get(value, 0) + 1
        if results:
            first = results[0]
            sample = {
                "id": first.get("id"),
                "name": first.get("name"),
                "coordinates": first.get("coordinates"),
                "osmElementType": first.get("type"),
                "tagKeys": sorted((first.get("tags") or {}).keys()),
            }
    except Exception as exc:
        errors.append(f"mcp search_category: {type(exc).__name__}: {exc}")

    # Channel 2: Overpass, to compare what the MCP tool drops.
    ql = build_query(
        build_selectors("node", [{"amenity": categories}], sample_box)
        + build_selectors("way", [{"amenity": categories}], sample_box),
        timeout=90,
    )
    overpass_count = None
    try:
        overpass_count = len(overpass.query(ql, "test-c-venues").get("elements", []))
    except Exception as exc:
        errors.append(f"overpass venues: {type(exc).__name__}: {exc}")

    record(
        "C. Venues (nightlife/commerce)",
        "osm-mcp + overpass-direct",
        "search_category (MCP) vs overpass-api",
        {
            "bbox": sample_box.as_dict(),
            "amenityValues": categories,
            "mcpNote": "a single search_category call with all amenity values OR-ed by the patched regex filter (see docs/OSM-MCP.md)",
        },
        ql,
        ok=total > 0 and not errors,
        count={"mcpTotal": total, "mcpByCategory": per_category, "overpassSameBox": overpass_count},
        structure={"mcp": {"topLevel": "object", "keys": ["query", "results", "count"]},
                   "mcpResultItemKeys": ["id", "type", "name", "coordinates", "category", "subcategory", "tags"],
                   "overpass": "elements[] with full tags"},
        errors=errors,
        limitations=[
            "MCP search_category only returns elements that have coordinates, and `out body` means "
            "ways/relations have no centre - so area-mapped venues (pubs mapped as buildings) are dropped.",
            f"MCP returned {total} vs Overpass {overpass_count} for the same box: the MCP channel under-reports.",
            "MCP has no subcategory OR-ing: the upstream regex filter is a local patch (patches/).",
        ],
        sample=sample,
    )


def test_d_parks(config: dict, overpass: OverpassClient) -> None:
    core = resolve_bbox(config, "coreBbox")
    ql = build_query(
        build_selectors("way", config["layers"]["parks"]["polygon"], core)
        + build_selectors("relation", config["layers"]["parks"]["polygon"], core),
        timeout=120,
    )
    try:
        elements = overpass.query(ql, "test-d-parks").get("elements", [])
        with_geom = [e for e in elements if e.get("geometry")]
        sample = None
        for element in elements:
            if element.get("tags", {}).get("name"):
                sample = {
                    "id": element.get("id"),
                    "elementType": element.get("type"),
                    "name": element["tags"].get("name"),
                    "tags": element["tags"],
                    "geometryPoints": len(element.get("geometry") or []),
                }
                break
        record(
            "D. Parks / green space",
            "overpass-direct",
            "overpass-api (MCP cannot do this)",
            {"bbox": core.as_dict(), "filters": config["layers"]["parks"]["polygon"]},
            ql,
            ok=len(elements) > 0,
            count=len(elements),
            structure={"topLevel": "overpass.elements", "elementKeys": structure_of({"elements": elements}).get("elementKeys")},
            errors=[],
            limitations=[
                "MCP explore_area/search_category can list leisure=park but returns no polygon geometry.",
                f"{len(elements) - len(with_geom)} of {len(elements)} elements came back without geometry "
                "(multipart relations).",
            ],
            sample=sample,
        )
    except Exception as exc:
        record("D. Parks / green space", "overpass-direct", "overpass-api", {"bbox": core.as_dict()}, ql,
               ok=False, errors=[f"{type(exc).__name__}: {exc}"])


def test_e_water(config: dict, overpass: OverpassClient) -> None:
    core = resolve_bbox(config, "coreBbox")
    water = config["layers"]["water"]
    ql_poly = build_query(
        build_selectors("way", water["polygon"], core) + build_selectors("relation", water["polygon"], core),
        timeout=120,
    )
    ql_line = build_query(build_selectors("way", water["line"], core), timeout=120)
    ql_beach = build_query(
        build_selectors("way", water["beach"], core) + build_selectors("node", water["beach"], core),
        timeout=90,
    )
    errors: list[str] = []
    counts = {}
    samples = []
    for label, ql in (("polygons", ql_poly), ("lines", ql_line), ("beaches", ql_beach)):
        try:
            elements = overpass.query(ql, f"test-e-water-{label}").get("elements", [])
            counts[label] = len(elements)
            named = [e for e in elements if e.get("tags", {}).get("name")]
            if named:
                samples.append({"kind": label, "name": named[0]["tags"].get("name"), "tags": named[0]["tags"]})
        except Exception as exc:
            errors.append(f"{label}: {type(exc).__name__}: {exc}")
            counts[label] = None
    record(
        "E. Water (harbour, rivers, beaches)",
        "overpass-direct",
        "overpass-api (MCP cannot do this)",
        {"bbox": core.as_dict()},
        ql_poly,
        ok=bool(counts.get("polygons")),
        count=counts,
        structure={"polygons": "ways + multipolygon relations with geometry",
                   "lines": "waterway river/stream/canal + natural=coastline",
                   "beaches": "natural=beach"},
        errors=errors,
        limitations=[
            "Sydney Harbour is mapped as many separate ways/relations, not one harbour polygon - "
            "the world designer must union them.",
            "natural=coastline is a line, not an area; land polygons must be built by buffering or by "
            "using the water polygons instead.",
            "No bathymetry, depth or shoreline simplification is available from OSM.",
        ],
        sample=samples,
    )


def test_f_transit(config: dict, overpass: OverpassClient) -> None:
    core = resolve_bbox(config, "coreBbox")
    transit = config["layers"]["transit"]
    ql = build_query(
        build_selectors("node", transit["node"], core) + build_selectors("way", transit["way"], core),
        timeout=90,
    )
    try:
        elements = overpass.query(ql, "test-f-transit").get("elements", [])
        by_type: dict[str, int] = {}
        for element in elements:
            tags = element.get("tags", {})
            if tags.get("station") == "subway" or tags.get("railway") == "light_rail":
                key = "light_rail"
            elif tags.get("amenity") == "ferry_terminal" or tags.get("railway") == "ferry_terminal":
                key = "ferry_terminal"
            elif tags.get("public_transport") == "station" or tags.get("railway") in ("station", "halt"):
                key = "rail_station"
            else:
                key = "other"
            by_type[key] = by_type.get(key, 0) + 1
        named = [e for e in elements if e.get("tags", {}).get("name")]
        record(
            "F. Transit (spatial only)",
            "overpass-direct",
            "overpass-api (MCP cannot do this)",
            {"bbox": core.as_dict()},
            ql,
            ok=len(elements) > 0,
            count={"total": len(elements), "byType": by_type, "named": len(named)},
            structure={"elementKeys": structure_of({"elements": elements}).get("elementKeys")},
            errors=[],
            limitations=[
                "No timetables, no line/route topology, no platform count - OSM node positions only.",
                "Train *routes* (relation/route=subway) were not collected; only stations/stops.",
                "Bus infrastructure is barely mapped in OSM and is not collected at all.",
            ],
            sample=[{"name": e["tags"].get("name"), "type": e.get("type"), "tags": e["tags"]} for e in named[:5]],
        )
    except Exception as exc:
        record("F. Transit", "overpass-direct", "overpass-api", {"bbox": core.as_dict()}, ql,
               ok=False, errors=[f"{type(exc).__name__}: {exc}"])


def test_g_buildings(config: dict, overpass: OverpassClient) -> None:
    from common import bbox_from

    sample = bbox_from(config["scope"]["buildingSampleBbox"])
    errors: list[str] = []
    ql = build_query([build_selectors("way", [{"building": "*"}], sample)], timeout=120)
    try:
        elements = overpass.query(ql, "test-g-buildings").get("elements", [])
        total = len(elements)
        with_geom = 0
        with_name = 0
        with_levels = 0
        with_height = 0
        levels_values: dict[str, int] = {}
        heights_values: dict[str, int] = {}
        building_kinds: dict[str, int] = {}
        for element in elements:
            tags = element.get("tags", {})
            if element.get("geometry"):
                with_geom += 1
            if tags.get("name"):
                with_name += 1
            if tags.get("building:levels"):
                with_levels += 1
                levels_values[tags["building:levels"]] = levels_values.get(tags["building:levels"], 0) + 1
            if tags.get("height") or tags.get("building:height"):
                with_height += 1
                value = tags.get("height") or tags.get("building:height")
                heights_values[value] = heights_values.get(value, 0) + 1
            kind = tags.get("building", "(none)")
            building_kinds[kind] = building_kinds.get(kind, 0) + 1
        top_kinds = sorted(building_kinds.items(), key=lambda kv: -kv[1])[:6]
        record(
            "G. Buildings",
            "overpass-direct",
            "overpass-api (MCP cannot do this)",
            {"bbox": sample.as_dict()},
            ql,
            ok=total > 0 and not errors,
            count={
                "sampleAreaBuildings": total,
                "withGeometry": with_geom,
                "withName": with_name,
                "withBuildingLevels": with_levels,
                "withHeight": with_height,
            },
            structure={"elementKeys": ["type", "id", "tags", "geometry", "nodes"]},
            errors=[],
            limitations=[
                "Buildings are only sampled inside a small CBD box; metro-wide extraction is not attempted.",
                f"Only {with_levels}/{total} have building:levels and {with_height}/{total} have any height tag: "
                "heights must NOT be invented by the world designer.",
                f"Only {with_name}/{total} are named - most footprints are anonymous.",
                "No MCP tool queries the `building` tag at all.",
            ],
            sample={
                "topBuildingValues": top_kinds,
                "sampleLevels": dict(sorted(levels_values.items(), key=lambda kv: -kv[1])[:6]),
                "sampleHeights": dict(sorted(heights_values.items(), key=lambda kv: -kv[1])[:6]),
            },
        )
    except Exception as exc:
        record("G. Buildings", "overpass-direct", "overpass-api", {"bbox": sample.as_dict()}, ql,
               ok=False, errors=[f"{type(exc).__name__}: {exc}"])


def test_mcp_tool_surface() -> None:
    try:
        tools = mcp_client.list_tools_sync()
        record(
            "H. MCP tool surface",
            "osm-mcp",
            "tools/list",
            {},
            None,
            ok=len(tools) > 0,
            count=len(tools),
            structure={"tools": [t["name"] for t in tools]},
            errors=[],
            limitations=["11 tools, none of which can return `highway` or geometry (all use `out body`)."],
            sample=tools,
        )
    except Exception as exc:
        record("H. MCP tool surface", "osm-mcp", "tools/list", {}, None, ok=False,
               errors=[f"{type(exc).__name__}: {exc}"], limitations=[traceback.format_exc()[-300:]])


def test_routing(config: dict) -> None:
    results = []
    errors: list[str] = []
    for route in config["corridorRoutes"][:2]:
        try:
            payload = mcp_call(
                "get_route_directions",
                {
                    "from_latitude": route["from"]["lat"],
                    "from_longitude": route["from"]["lon"],
                    "to_latitude": route["to"]["lat"],
                    "to_longitude": route["to"]["lon"],
                    "mode": "car",
                    "overview": "full",
                },
            )
            geometry = (payload or {}).get("geometry") or {}
            results.append(
                {
                    "route": route["id"],
                    "from": route["from"]["label"],
                    "to": route["to"]["label"],
                    "distanceM": (payload.get("summary") or {}).get("distance"),
                    "durationS": (payload.get("summary") or {}).get("duration"),
                    "geometryPoints": len(geometry.get("coordinates") or []),
                }
            )
        except Exception as exc:
            errors.append(f"{route['id']}: {type(exc).__name__}: {exc}")
    record(
        "I. Routing corridors (OSRM via MCP)",
        "osm-mcp",
        "get_route_directions",
        {"routes": [r["id"] for r in config["corridorRoutes"][:2]], "mode": "car", "overview": "full"},
        "OSRM router.project-osrm.org via MCP tool get_route_directions",
        ok=bool(results) and not errors,
        count=len(results),
        structure={"keys": ["summary", "directions", "geometry", "waypoints"]},
        errors=errors,
        limitations=[
            "Routing is a *derived* road-network fact from OSRM, not an OSM tag fact.",
            "Only used here to prove the corridor between districts is drivable; not a data source for the world spec.",
        ],
        sample=results,
    )


def main() -> int:
    ensure_dirs()
    config = load_config()
    overpass = OverpassClient(
        min_interval=config["rateLimit"]["overpassMinIntervalSeconds"], timeout=180
    )

    steps = [
        ("MCP tool surface", test_mcp_tool_surface),
        ("A. Location", lambda: test_a_location(config)),
        ("B. Roads", lambda: test_b_roads(config, overpass)),
        ("C. Venues", lambda: test_c_venues(config, overpass)),
        ("D. Parks", lambda: test_d_parks(config, overpass)),
        ("E. Water", lambda: test_e_water(config, overpass)),
        ("F. Transit", lambda: test_f_transit(config, overpass)),
        ("G. Buildings", lambda: test_g_buildings(config, overpass)),
        ("I. Routing", lambda: test_routing(config)),
    ]
    for name, step in steps:
        print(f"\n=== {name} ===")
        try:
            step()
        except Exception as exc:  # never let one test kill the suite
            traceback.print_exc()
            record(name, "-", "-", {}, None, ok=False, errors=[f"UNCAUGHT {type(exc).__name__}: {exc}"])

    passed = sum(1 for r in RESULTS if r["status"] == "PASS")
    summary = {
        "runAt": now_iso(),
        "passed": passed,
        "failed": len(RESULTS) - passed,
        "total": len(RESULTS),
        "overpassCalls": overpass.call_log,
        "tests": RESULTS,
    }
    write_json(RAW / "test-results.json", summary)
    print(f"\n{passed}/{len(RESULTS)} passed -> {RAW / 'test-results.json'}")
    return 0 if passed == len(RESULTS) else 1


if __name__ == "__main__":
    raise SystemExit(main())
