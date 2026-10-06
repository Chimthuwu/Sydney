"""Normalise raw OSM + MCP responses into stable, typed records.

RAW OSM -> NORMALISED GEOGRAPHY -> (world designer)

Design rules:
  * stable IDs: "way/12345", "node/678" - derived from the OSM element itself,
    so they survive re-runs and can be joined back to OSM.
  * nothing is invented: missing lanes/height/levels stay null and are counted.
  * every record keeps its original `tags` and its channel provenance.
  * every record carries both WGS84 coordinates and local-metre / Three.js
    coordinates produced by the documented projection in common.LocalProjection.

Run:  python scripts/normalize_osm.py
Writes: data/normalized/*.json
"""

from __future__ import annotations

import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import (  # noqa: E402
    LAYER_DERIVED,
    LAYER_SOURCE,
    NORMALIZED,
    RAW,
    LocalProjection,
    centroid,
    ensure_dirs,
    envelope,
    load_config,
    now_iso,
    polyline_length_m,
    read_json,
    write_json,
)

# ---------------------------------------------------------------- taxonomy --
ROAD_CATEGORY = {
    "motorway": "freeway",
    "motorway_link": "freeway_link",
    "trunk": "arterial_major",
    "trunk_link": "arterial_major_link",
    "primary": "arterial",
    "primary_link": "arterial_link",
    "secondary": "arterial",
    "secondary_link": "arterial_link",
    "tertiary": "collector",
    "tertiary_link": "collector_link",
    "living_street": "local",
    "residential": "local",
    "unclassified": "local",
    "pedestrian": "pedestrian",
    "service": "service",
}

VENUE_GROUPS = {
    "nightlife": {
        "bar", "pub", "nightclub", "casino", "gambling", "beverages", "dancing",
        "stripclub", "music", "theatre", "cinema", "event_venue", "nightclub",
        "sauna", "amusement_arcade", "bowling_alley", "adult_centre",
    },
    "food": {"restaurant", "fast_food", "cafe", "ice_cream", "food_court", "biergarten", "bbq"},
    "commerce": {
        "shop", "mall", "department_store", "supermarket", "convenience",
        "alcohol", "wine", "brewing", "liquor", "bank", "atm", "marketplace", "books",
    },
    "lodging": {"hotel", "hostel", "motel", "guest_house", "chalet", "apartment"},
    "civic": {
        "police", "fire_station", "hospital", "clinic", "doctors", "pharmacy",
        "school", "university", "college", "kindergarten", "library", "townhall",
        "courthouse", "place_of_worship", "post_office", "community_centre",
        "social_facility", "arts_centre", "studio",
    },
    "transport": {
        "fuel", "charging_station", "parking", "bicycle_parking", "taxi",
        "ferry_terminal", "bus_station",
    },
    "leisure": {
        "sports_centre", "stadium", "fitness_centre", "swimming_pool", "golf_course",
        "marina", "fishing", "dance", "sports_hall",
    },
}

TRANSIT_KIND = {
    "rail_station": ["station", "halt"],
    "light_rail": ["light_rail", "subway"],
    "ferry_terminal": ["ferry_terminal"],
    "tram_stop": ["tram_stop"],
    "subway_entrance": ["subway_entrance"],
}

WATER_KIND = {
    "natural=water": "water_body",
    "natural=bay": "bay",
    "natural=strait": "strait",
    "natural=beach": "beach",
    "natural=coastline": "coastline",
    "landuse=reservoir": "reservoir",
    "waterway=riverbank": "riverbank",
    "waterway=river": "river",
    "waterway=stream": "stream",
    "waterway=canal": "canal",
    "waterway=dock": "dock",
}


def osm_id(element: dict) -> str:
    return f"{element.get('type')}/{element.get('id')}"


def element_coords(element: dict) -> list[list[float]]:
    """[lat, lon] pairs for a node, way, or relation."""
    if element.get("type") == "node":
        if element.get("lat") is None:
            return []
        return [[float(element["lat"]), float(element["lon"])]]
    if element.get("type") == "relation":
        # Multipolygons (Sydney Harbour is a 207-member one) carry their
        # geometry on the member ways, not on a top-level `geometry` field.
        coords: list[list[float]] = []
        for ring in element_rings(element).values():
            for points in ring:
                coords.extend(points)
        return coords
    return [
        [float(point["lat"]), float(point["lon"])]
        for point in (element.get("geometry") or [])
        if point.get("lat") is not None
    ]


# Two coordinates are "the same point" within about 2 m at Sydney's latitude.
# 2e-5 degrees of latitude is ~2.2 m.
JOIN_TOLERANCE_DEG = 2e-5


def _same_point(a: list[float], b: list[float], tol: float = JOIN_TOLERANCE_DEG) -> bool:
    return abs(a[0] - b[0]) <= tol and abs(a[1] - b[1]) <= tol


def stitch_rings(fragments: list[list[list[float]]]) -> list[list[list[float]]]:
    """Join way fragments end-to-end into closed rings.

    Multipolygon relations store their boundary as a set of separate member
    ways. Those ways are often *fragments* of one logical ring - 82 of the 156
    park rings in the prototype area arrive with a gap of up to 617 m. Drawing
    each fragment as if it were a closed ring is what makes polygons explode
    across the scene, so they are chained here, in the data, where every
    consumer benefits.

    Fragments that cannot be closed into a ring are dropped rather than guessed.
    """
    remaining = [list(fragment) for fragment in fragments if len(fragment) >= 2]
    rings: list[list[list[float]]] = []

    while remaining:
        current = remaining.pop(0)
        progress = True
        while progress:
            if _same_point(current[0], current[-1]):
                if len(current) >= 4:
                    rings.append(current)
                current = []
                break
            progress = False
            for index, fragment in enumerate(remaining):
                if _same_point(current[-1], fragment[0]):
                    current.extend(fragment[1:])
                elif _same_point(current[-1], fragment[-1]):
                    current.extend(reversed(fragment[:-1]))
                else:
                    continue
                remaining.pop(index)
                progress = True
                break
        # an unterminated chain is discarded: a partial ring is worse than none
    return rings


def element_rings(element: dict) -> dict:
    """Return {"outer": [ring, ...], "inner": [ring, ...]} of [lat, lon] points.

    A closed multipolygon relation keeps all of its area; without this the
    harbour - the single most important water feature in the world - vanishes.
    """
    outer_fragments: list[list[list[float]]] = []
    inner_fragments: list[list[list[float]]] = []
    if element.get("type") == "relation":
        for member in element.get("members") or []:
            if member.get("type") != "way":
                continue
            points = [
                [float(point["lat"]), float(point["lon"])]
                for point in (member.get("geometry") or [])
                if point.get("lat") is not None
            ]
            if len(points) < 2:
                continue
            (inner_fragments if member.get("role") == "inner" else outer_fragments).append(points)
    elif element.get("type") == "way":
        points = element_coords(element)
        if len(points) >= 3:
            outer_fragments.append(points)
    return {
        "outer": stitch_rings(outer_fragments),
        "inner": stitch_rings(inner_fragments),
    }


def parse_lanes(value: str | None):
    if not value:
        return None
    parts = [p.strip() for p in str(value).split(";") if p.strip().isdigit()]
    if not parts:
        return None
    return max(int(p) for p in parts)


def parse_number(value: str | None):
    if value is None:
        return None
    text = str(value).strip().lower().split(";")[0]
    digits = "".join(ch for ch in text if ch.isdigit() or ch == ".")
    try:
        return float(digits) if digits else None
    except ValueError:
        return None


def load_raw(prefix: str) -> list[tuple[dict, dict]]:
    """Return (envelope, file) pairs for every raw file starting with prefix."""
    out = []
    for path in sorted(RAW.glob(f"{prefix}*.json")):
        try:
            out.append((read_json(path), path))
        except Exception as exc:  # surfaced in the manifest
            print(f"  ! could not read {path.name}: {exc}")
    return out


# ------------------------------------------------------------------- roads --
def normalize_roads(config: dict, projection: LocalProjection) -> dict:
    roads: dict[str, dict] = {}
    provenance: dict[str, set] = defaultdict(set)
    missing = Counter()

    for envelope_, path in load_raw("overpass-roads-"):
        for element in envelope_["payload"].get("elements", []):
            tags = element.get("tags") or {}
            coords = element_coords(element)
            if len(coords) < 2:
                missing["geometry"] += 1
                continue
            key = osm_id(element)
            provenance[key].add(f"overpass:{envelope_['kind']}")
            if key in roads:
                continue
            highway = tags.get("highway")
            oneway = tags.get("oneway")
            bridge = tags.get("bridge")
            tunnel = tags.get("tunnel")
            levels = tags.get("building:levels")
            roads[key] = {
                "id": key,
                "osmType": "way",
                "type": "road",
                "name": tags.get("name"),
                "highway": highway,
                "category": ROAD_CATEGORY.get(highway, "other"),
                "surface": tags.get("surface"),
                "maxspeedKmh": parse_number(tags.get("maxspeed")),
                "lanes": parse_lanes(tags.get("lanes")),
                "oneway": None if oneway is None else (oneway in ("yes", "1", "-1")),
                "bridge": bridge in ("yes", "viaduct"),
                "tunnel": tunnel in ("yes", "building_passage"),
                "junction": tags.get("junction"),
                "layer": parse_number(tags.get("layer")),
                "lengthM": round(polyline_length_m(coords), 1),
                "named": bool(tags.get("name")),
                "geometry": [[round(c[0], 6), round(c[1], 6)] for c in coords],
                "geometryLocal": projection.to_units_polyline(coords),
                "tags": tags,
                "provenance": {LAYER_SOURCE: sorted(provenance[key])},
            }
            for field in ("lanes", "maxspeedKmh", "surface", "name"):
                if roads[key][field] is None:
                    missing[field] += 1

    by_category = Counter(r["category"] for r in roads.values())
    named = sum(1 for r in roads.values() if r["named"])
    bridges = [r for r in roads.values() if r["bridge"]]
    tunnels = [r for r in roads.values() if r["tunnel"]]

    return {
        "roads": list(roads.values()),
        "stats": {
            "total": len(roads),
            "named": named,
            "unnamed": len(roads) - named,
            "byCategory": dict(by_category.most_common()),
            "byHighway": dict(Counter(r["highway"] for r in roads.values()).most_common()),
            "bridges": len(bridges),
            "tunnels": len(tunnels),
            "totalLengthKm": round(sum(r["lengthM"] for r in roads.values()) / 1000, 2),
            "missingFields": dict(missing),
        },
    }


# ----------------------------------------------------------- intersections --
def derive_intersections(roads: list[dict], projection: LocalProjection, snap_m: float = 3.0) -> dict:
    """Derive a road graph from way geometry.

    The MCP server cannot return intersections and no OSM node ids are
    available in `out geom` mode, so shared vertices are found by snapping
    consecutive coordinates onto a local-metre grid. This is a DERIVED layer,
    not an OSM fact.
    """
    def key_for(lat: float, lon: float) -> str:
        east, south = projection.to_local(lat, lon)
        return f"{round(east / snap_m)},{round(south / snap_m)}"

    node_roads: dict[str, set] = defaultdict(set)
    node_point: dict[str, tuple[float, float]] = {}
    node_degree: Counter = Counter()
    endpoints: Counter = Counter()

    for road in roads:
        coords = road["geometry"]
        key = road["id"]
        for index, (lat, lon) in enumerate(coords):
            node_key = key_for(lat, lon)
            node_roads[node_key].add(key)
            node_point.setdefault(node_key, (lat, lon))
            if index in (0, len(coords) - 1):
                endpoints[node_key] += 1

    intersections = []
    dead_ends = []
    for node_key, road_ids in node_roads.items():
        lat, lon = node_point[node_key]
        record = {
            "id": f"x/{node_key}",
            "type": "intersection",
            "lat": round(lat, 6),
            "lon": round(lon, 6),
            "local": projection.to_units(lat, lon),
            "roadIds": sorted(road_ids),
            "roadCount": len(road_ids),
            "roadNames": sorted({r["name"] for r in roads if r["id"] in road_ids and r["name"]}),
        }
        if len(road_ids) >= 2:
            record["degree"] = len(road_ids)
            intersections.append(record)
        elif endpoints[node_key]:
            dead_ends.append(record)

    degrees = Counter(i["roadCount"] for i in intersections)
    return {
        "intersections": intersections,
        "deadEnds": dead_ends,
        "stats": {
            "total": len(intersections),
            "byRoadCount": {str(k): v for k, v in sorted(degrees.items())},
            "fourPlusWay": degrees.get(4, 0) + degrees.get(5, 0) + degrees.get(6, 0),
            "deadEnds": len(dead_ends),
            "snapResolutionM": snap_m,
            "derivation": (
                "Shared road vertices snapped to a "
                f"{snap_m} m grid in the local projection. Derived, not an OSM tag."
            ),
        },
    }


# ----------------------------------------------------------------- venues --
def venue_group(tags: dict) -> str:
    for key in ("amenity", "shop", "tourism", "leisure"):
        value = tags.get(key)
        if not value:
            continue
        if value in VENUE_GROUPS["nightlife"]:
            return "nightlife"
        for group, values in VENUE_GROUPS.items():
            if value in values:
                return group
    return "other"


def normalize_venues(config: dict, projection: LocalProjection) -> dict:
    nightlife_tags = config["nightlife"]
    venues: dict[str, dict] = {}
    seen_in: dict[str, set] = defaultdict(set)

    def ingest(element: dict, channel: str, category_hint: str | None = None):
        tags = element.get("tags") or {}
        coords = element_coords(element)
        center = None
        if coords:
            center = centroid(coords) if len(coords) > 2 else (coords[0][0], coords[0][1])
        key = osm_id(element)
        seen_in[key].add(channel)
        if key in venues:
            # Keep the record that actually has geometry, and remember the other channel.
            if not venues[key]["geometry"] and coords:
                venues[key] = build_venue(element, coords, center, key, projection, category_hint)
            return
        venues[key] = build_venue(element, coords, center, key, projection, category_hint)

    def build_venue(element, coords, center, key, projection, category_hint):
        tags = element.get("tags") or {}
        category = (
            tags.get("amenity")
            or tags.get("shop")
            or tags.get("tourism")
            or tags.get("leisure")
            or category_hint
        )
        group = venue_group(tags)
        is_nightlife = any(
            tags.get(tag_key) is not None and tags.get(tag_key) in values
            for tag_key, values in nightlife_tags.items()
        )
        address = {
            "street": tags.get("addr:street"),
            "houseNumber": tags.get("addr:housenumber"),
            "suburb": tags.get("addr:suburb"),
            "postcode": tags.get("addr:postcode"),
        }
        record = {
            "id": key,
            "type": "venue",
            "name": tags.get("name"),
            "category": category,
            "group": group,
            "isNightlife": bool(is_nightlife),
            "hasAddress": any(address.values()),
            "address": address,
            "osmType": element.get("type"),
            "center": [round(center[0], 6), round(center[1], 6)] if center else None,
            "local": projection.to_units(*center) if center else None,
            "geometry": [[round(c[0], 6), round(c[1], 6)] for c in coords] if len(coords) > 2 else None,
            "tags": tags,
        }
        if record["group"] == "nightlife" and is_nightlife:
            record["nightlifeRole"] = tags.get("amenity") or tags.get("shop") or tags.get("leisure") or tags.get("tourism")
        return record

    for envelope_, _ in load_raw("overpass-venues-"):
        for element in envelope_["payload"].get("elements", []):
            ingest(element, f"overpass:{envelope_['kind']}")

    for envelope_, _ in load_raw("mcp-poi-"):
        for result in envelope_["payload"].get("results", []):
            element = {
                "type": result.get("type"),
                "id": result.get("id"),
                "tags": result.get("tags") or {},
            }
            coords = result.get("coordinates") or {}
            if coords.get("latitude") is not None:
                element["lat"] = coords["latitude"]
                element["lon"] = coords["longitude"]
            ingest(element, f"osm-mcp:{envelope_['kind']}", result.get("subcategory"))

    for record in venues.values():
        record["provenance"] = {LAYER_SOURCE: sorted(seen_in[record["id"]])}
        record["seenInChannels"] = len(seen_in[record["id"]])

    located = [v for v in venues.values() if v["center"]]
    groups = Counter(v["group"] for v in venues.values())
    categories = Counter(v["category"] for v in venues.values())
    nightlife = [v for v in venues.values() if v["isNightlife"]]
    both_channels = sum(1 for v in venues.values() if v["seenInChannels"] > 1)

    return {
        "venues": list(venues.values()),
        "stats": {
            "total": len(venues),
            "located": len(located),
            "withoutLocation": len(venues) - len(located),
            "named": sum(1 for v in venues.values() if v["name"]),
            "nightlife": len(nightlife),
            "seenInBothChannels": both_channels,
            "byGroup": dict(groups.most_common()),
            "byCategory": dict(categories.most_common(25)),
        },
    }


# ----------------------------------------------------- generic area layers --
def normalize_areas(
    config: dict,
    projection: LocalProjection,
    raw_prefixes: list[str],
    record_type: str,
    kind_map: dict | None = None,
) -> dict:
    records: dict[str, dict] = {}
    for prefix in raw_prefixes:
        for envelope_, path in load_raw(prefix):
            for element in envelope_["payload"].get("elements", []):
                key = osm_id(element)
                if key in records:
                    continue
                tags = element.get("tags") or {}
                rings = element_rings(element)
                coords = [point for ring in rings["outer"] for point in ring]
                open_gaps = sum(
                    1
                    for group in rings.values()
                    for ring in group
                    if not _same_point(ring[0], ring[-1], 1e-4)
                )
                kind = None
                if kind_map:
                    for tag_key, tag_value in tags.items():
                        if f"{tag_key}={tag_value}" in kind_map:
                            kind = kind_map[f"{tag_key}={tag_value}"]
                            break
                if kind is None:
                    kind = "water" if record_type == "water" else envelope_["kind"]
                records[key] = {
                    "id": key,
                    "type": record_type,
                    "kind": kind or envelope_["kind"],
                    "name": tags.get("name"),
                    "osmType": element.get("type"),
                    "hasGeometry": bool(coords),
                    "center": [round(v, 6) for v in centroid(coords)] if coords else None,
                    "local": projection.to_units(*centroid(coords)) if coords else None,
                    "rings": {
                        role: [[[round(c[0], 6), round(c[1], 6)] for c in ring] for ring in group]
                        for role, group in rings.items()
                        if group
                    },
                    "ringCount": len(rings["outer"]) + len(rings["inner"]),
                    "unclosedRings": open_gaps,
                    "vertexCount": len(coords),
                    "areaM2": None,  # filled below where a closed ring exists
                    "tags": tags,
                    "provenance": {LAYER_SOURCE: [f"overpass:{envelope_['kind']}"]},
                }
    return records


def planar_area_m2(ring: list[list[float]], projection: LocalProjection) -> float | None:
    if not ring or len(ring) < 3:
        return None
    points = [projection.to_local(lat, lon) for lat, lon in ring]
    total = 0.0
    for index in range(len(points)):
        x1, y1 = points[index]
        x2, y2 = points[(index + 1) % len(points)]
        total += x1 * y2 - x2 * y1
    return round(abs(total) / 2.0, 1)


def rings_area_m2(record: dict, projection: LocalProjection) -> float | None:
    """Outer rings minus inner rings - correct for multipolygons with islands."""
    rings = record.get("rings") or {}
    outer = sum(
        planar_area_m2(ring, projection) or 0.0 for ring in rings.get("outer", [])
    )
    inner = sum(
        planar_area_m2(ring, projection) or 0.0 for ring in rings.get("inner", [])
    )
    if outer == 0.0:
        return None
    return round(outer - inner, 1)


def normalize_transit(config: dict, projection: LocalProjection) -> dict:
    records: dict[str, dict] = {}
    for envelope_, _ in load_raw("overpass-transit"):
        for element in envelope_["payload"].get("elements", []):
            tags = element.get("tags") or {}
            coords = element_coords(element)
            kind = "other"
            for kind_name, values in TRANSIT_KIND.items():
                if tags.get("railway") in values or tags.get("station") in values or tags.get("amenity") in values:
                    kind = kind_name
                    break
            if tags.get("public_transport") == "station" and kind == "other":
                kind = "rail_station"
            center = centroid(coords) if coords else None
            key = osm_id(element)
            records[key] = {
                "id": key,
                "type": "transit_stop",
                "kind": kind,
                "name": tags.get("name"),
                "osmType": element.get("type"),
                "center": [round(center[0], 6), round(center[1], 6)] if center else None,
                "local": projection.to_units(*center) if center else None,
                "geometry": [[round(c[0], 6), round(c[1], 6)] for c in coords] if len(coords) > 2 else None,
                "tags": tags,
                "provenance": {LAYER_SOURCE: ["overpass:transit"]},
            }
    kinds = Counter(r["kind"] for r in records.values())
    return {
        "transit": list(records.values()),
        "stats": {
            "total": len(records),
            "named": sum(1 for r in records.values() if r["name"]),
            "byKind": dict(kinds.most_common()),
        },
    }


def normalize_buildings(config: dict, projection: LocalProjection) -> dict:
    records: dict[str, dict] = {}
    for envelope_, _ in load_raw("overpass-buildings"):
        for element in envelope_["payload"].get("elements", []):
            tags = element.get("tags") or {}
            coords = element_coords(element)
            if len(coords) < 4:
                continue
            key = osm_id(element)
            center = centroid(coords)
            levels = parse_number(tags.get("building:levels"))
            height = parse_number(tags.get("height") or tags.get("building:height"))
            records[key] = {
                "id": key,
                "type": "building",
                "building": tags.get("building"),
                "name": tags.get("name"),
                "levels": levels,
                "heightM": height,
                # Explicit: OSM usually has no height. The world designer must
                # not silently invent one - see docs/WORLD-DESIGN-PROMPT.md.
                "heightSource": "osm-tag" if height is not None else None,
                "center": [round(center[0], 6), round(center[1], 6)],
                "local": projection.to_units(*center),
                "footprint": [[round(c[0], 6), round(c[1], 6)] for c in coords],
                "footprintLocal": projection.to_units_polyline(coords),
                "areaM2": planar_area_m2(coords, projection),
                "tags": tags,
                "provenance": {LAYER_SOURCE: ["overpass:buildings-sample"]},
            }
    total = len(records)
    return {
        "buildings": list(records.values()),
        "stats": {
            "total": total,
            "named": sum(1 for r in records.values() if r["name"]),
            "withLevels": sum(1 for r in records.values() if r["levels"] is not None),
            "withHeight": sum(1 for r in records.values() if r["heightM"] is not None),
            "withFootprint": total,
            "sampleBbox": config["scope"]["buildingSampleBbox"],
            "warning": (
                "Sample only. Heights are absent for the vast majority of footprints; "
                "no height is inferred anywhere in this pipeline."
            ),
        },
    }


def main() -> int:
    ensure_dirs()
    config = load_config()
    projection = LocalProjection(config["origin"], config["projection"].get("metersPerUnit", 1.0))
    print("normalising...")

    roads_out = normalize_roads(config, projection)
    write_json(
        NORMALIZED / "roads.json",
        envelope("roads", "overpass-api", roads_out, {"projection": projection.describe()}),
    )
    print(f"  roads: {roads_out['stats']['total']}")

    graph_out = derive_intersections(roads_out["roads"], projection)
    write_json(
        NORMALIZED / "intersections.json",
        envelope(
            "intersections",
            "derived",
            graph_out,
            {
                "projection": projection.describe(),
                "evidenceLayer": LAYER_DERIVED,
                "note": "Derived from road geometry - no OSM node ids were available.",
            },
        ),
    )
    print(f"  intersections: {graph_out['stats']['total']}")

    venues_out = normalize_venues(config, projection)
    write_json(
        NORMALIZED / "venues.json",
        envelope("venues", "osm-mcp + overpass-api", venues_out, {"projection": projection.describe()}),
    )
    print(f"  venues: {venues_out['stats']['total']} ({venues_out['stats']['nightlife']} nightlife)")

    parks = normalize_areas(config, projection, ["overpass-parks"], "park")
    for record in parks.values():
        record["areaM2"] = rings_area_m2(record, projection)
    write_json(
        NORMALIZED / "parks.json",
        envelope(
            "parks",
            "overpass-api",
            {"parks": list(parks.values())},
            {
                "projection": projection.describe(),
                "stats": {
                    "total": len(parks),
                    "named": sum(1 for r in parks.values() if r["name"]),
                    "withGeometry": sum(1 for r in parks.values() if r["hasGeometry"]),
                    "totalAreaKm2": round(sum((r["areaM2"] or 0) for r in parks.values()) / 1e6, 3),
                },
            },
        ),
    )
    print(f"  parks: {len(parks)}")

    water_records: dict[str, dict] = {}
    for prefix in ("overpass-water-areas", "overpass-water-lines", "overpass-water-beaches"):
        water_records.update(normalize_areas(config, projection, [prefix], "water", WATER_KIND))
    for record in water_records.values():
        if record["kind"] in ("water_body", "bay", "strait", "reservoir", "riverbank", "beach"):
            record["areaM2"] = rings_area_m2(record, projection)
    write_json(
        NORMALIZED / "waterways.json",
        envelope(
            "waterways",
            "overpass-api",
            {"water": list(water_records.values())},
            {
                "projection": projection.describe(),
                "stats": {
                    "total": len(water_records),
                    "byKind": dict(Counter(r["kind"] for r in water_records.values()).most_common()),
                    "named": sum(1 for r in water_records.values() if r["name"]),
                    "totalAreaKm2": round(sum((r["areaM2"] or 0) for r in water_records.values()) / 1e6, 3),
                },
            },
        ),
    )
    print(f"  water: {len(water_records)}")

    transit_out = normalize_transit(config, projection)
    write_json(
        NORMALIZED / "transit.json",
        envelope("transit", "overpass-api", transit_out, {"projection": projection.describe()}),
    )
    print(f"  transit: {transit_out['stats']['total']}")

    buildings_out = normalize_buildings(config, projection)
    write_json(
        NORMALIZED / "buildings.json",
        envelope("buildings", "overpass-api", buildings_out, {"projection": projection.describe()}),
    )
    print(f"  buildings: {buildings_out['stats']['total']}")

    landmarks = normalize_areas(config, projection, ["overpass-landmarks"], "landmark")
    for record in landmarks.values():
        record["bridge"] = record["tags"].get("bridge") in ("yes", "viaduct")
        record["tunnel"] = record["tags"].get("tunnel") in ("yes", "building_passage")
        record["isStructure"] = record["bridge"] or record["tunnel"] or record["tags"].get("man_made") in (
            "tower", "pier", "breakwater", "lighthouse",
        )
    write_json(
        NORMALIZED / "landmarks.json",
        envelope(
            "landmarks",
            "overpass-api",
            {"landmarks": list(landmarks.values())},
            {
                "projection": projection.describe(),
                "stats": {
                    "total": len(landmarks),
                    "named": sum(1 for r in landmarks.values() if r["name"]),
                    "bridges": sum(1 for r in landmarks.values() if r["bridge"]),
                    "tunnels": sum(1 for r in landmarks.values() if r["tunnel"]),
                },
            },
        ),
    )
    print(f"  landmarks: {len(landmarks)}")

    write_json(
        NORMALIZED / "manifest.json",
        {
            "generatedAt": now_iso(),
            "inputs": sorted(p.name for p in RAW.glob("*.json")),
            "outputs": sorted(p.name for p in NORMALIZED.glob("*.json")),
            "projection": projection.describe(),
            "counts": {
                "roads": roads_out["stats"]["total"],
                "intersections": graph_out["stats"]["total"],
                "venues": venues_out["stats"]["total"],
                "parks": len(parks),
                "water": len(water_records),
                "transit": transit_out["stats"]["total"],
                "buildings": buildings_out["stats"]["total"],
                "landmarks": len(landmarks),
            },
        },
    )
    print(f"\nwritten -> {NORMALIZED}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
