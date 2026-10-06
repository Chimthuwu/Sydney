"""Build the AI-facing world specification from the normalised layers.

This is the deliverable another AI agent consumes:
    data/world/world-spec.json
    data/world/world-analysis.json

Evidence layers are kept strictly separate (mission section 25):
    sourceFact        - straight from OSM tags
    derivedGeography  - computed from OSM geometry/counts (districts, clusters)
    aiInterpretation  - labelled heuristics a world designer can accept or reject
    gameplayDesign    - the game-facing classification (SAFE/NIGHTLIFE/...)

Nothing here invents a measurement. Every number is either counted from the
data or explicitly labelled as a classification.

Run:  python scripts/build_world_spec.py
"""

from __future__ import annotations

import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import (  # noqa: E402
    LAYER_AI,
    LAYER_DERIVED,
    LAYER_DESIGN,
    LAYER_SOURCE,
    NORMALIZED,
    WORLDDATA,
    LocalProjection,
    ensure_dirs,
    haversine_m,
    load_config,
    now_iso,
    read_json,
    write_json,
)

ARTERIAL_CATEGORIES = {"freeway", "arterial_major", "arterial", "collector"}
GRID_CATEGORIES = {"local", "pedestrian", "service", "freeway_link", "arterial_link", "collector_link"}
CLUSTER_CELL_M = 400.0
CLUSTER_MIN_VENUES = 6


def load_layer(name: str) -> dict:
    return read_json(NORMALIZED / name)["payload"]


def nearest_seed(lat: float, lon: float, seeds: list[dict]) -> dict:
    best, best_distance = None, float("inf")
    for seed in seeds:
        distance = haversine_m(lat, lon, seed["lat"], seed["lon"])
        if distance < best_distance:
            best, best_distance = seed, distance
    return {"seed": best, "distanceM": round(best_distance, 1)}


def assign_district(lat: float, lon: float, seeds: list[dict]) -> tuple[str, float]:
    found = nearest_seed(lat, lon, seeds)
    return found["seed"]["id"], found["distanceM"]


def cell_key(lat: float, lon: float, projection: LocalProjection) -> str:
    east, south = projection.to_local(lat, lon)
    return f"{int(east // CLUSTER_CELL_M)},{int(south // CLUSTER_CELL_M)}"


def main() -> int:
    ensure_dirs()
    config = load_config()
    projection = LocalProjection(config["origin"], config["projection"].get("metersPerUnit", 1.0))
    seeds = config["districtSeeds"]

    print("loading normalised layers...")
    roads = load_layer("roads.json")["roads"]
    road_stats = load_layer("roads.json")["stats"]
    graph = load_layer("intersections.json")
    intersections, intersection_stats = graph["intersections"], graph["stats"]
    venues = load_layer("venues.json")["venues"]
    venue_stats = load_layer("venues.json")["stats"]
    parks = load_layer("parks.json")["parks"]
    water = load_layer("waterways.json")["water"]
    transit = load_layer("transit.json")["transit"]
    buildings = load_layer("buildings.json")["buildings"]
    landmarks = load_layer("landmarks.json")["landmarks"]

    # ---------------------------------------------------------- districts --
    print("assigning features to districts...")
    district_accumulator: dict[str, dict] = {
        seed["id"]: {
            "venues": 0, "nightlife": 0, "parks": 0, "parkAreaM2": 0.0,
            "transit": 0, "roadLengthM": 0.0, "arterialLengthM": 0.0,
            "lats": [], "lons": [], "landmarks": 0, "waterBodies": 0,
            "shopCount": 0, "civicCount": 0, "transportCount": 0, "lodgingCount": 0,
        }
        for seed in seeds
    }

    for venue in venues:
        if not venue["center"]:
            continue
        district_id, _ = assign_district(venue["center"][0], venue["center"][1], seeds)
        bucket = district_accumulator[district_id]
        bucket["venues"] += 1
        bucket[venue["group"]] = bucket.get(venue["group"], 0) + 1
        if venue["isNightlife"]:
            bucket["nightlife"] += 1
        bucket["lats"].append(venue["center"][0])
        bucket["lons"].append(venue["center"][1])

    for park in parks:
        if not park["center"]:
            continue
        district_id, _ = assign_district(park["center"][0], park["center"][1], seeds)
        bucket = district_accumulator[district_id]
        bucket["parks"] += 1
        bucket["parkAreaM2"] += park.get("areaM2") or 0.0

    for body in water:
        if not body["center"]:
            continue
        district_id, _ = assign_district(body["center"][0], body["center"][1], seeds)
        district_accumulator[district_id]["waterBodies"] += 1

    for stop in transit:
        if not stop["center"]:
            continue
        district_id, _ = assign_district(stop["center"][0], stop["center"][1], seeds)
        district_accumulator[district_id]["transit"] += 1

    for landmark in landmarks:
        if not landmark["center"]:
            continue
        district_id, _ = assign_district(landmark["center"][0], landmark["center"][1], seeds)
        district_accumulator[district_id]["landmarks"] += 1

    for road in roads:
        mid = road["geometry"][len(road["geometry"]) // 2]
        district_id, _ = assign_district(mid[0], mid[1], seeds)
        bucket = district_accumulator[district_id]
        bucket["roadLengthM"] += road["lengthM"]
        if road["category"] in ARTERIAL_CATEGORIES:
            bucket["arterialLengthM"] += road["lengthM"]

    districts = []
    for seed in seeds:
        bucket = district_accumulator[seed["id"]]
        lats, lons = bucket["lats"], bucket["lons"]
        if lats:
            south, north = min(lats), max(lats)
            west, east = min(lons), max(lons)
        else:
            south = north = west = east = None
        height_m = haversine_m(south, 0, north, 0) if lats else 0.0
        width_m = haversine_m(0, west, 0, east) if lats else 0.0
        extent_km2 = round((height_m / 1000) * (width_m / 1000), 3) if lats else 0.0
        area_for_density = extent_km2 or 1.0

        districts.append(
            {
                "id": seed["id"],
                "realName": seed["name"],
                "characterSeed": seed["character"],
                "center": [seed["lat"], seed["lon"]],
                "local": projection.to_units(seed["lat"], seed["lon"]),
                "extent": {"south": south, "west": west, "north": north, "east": east},
                "extentKm2": extent_km2,
                "counts": {
                    "venues": bucket["venues"],
                    "nightlifeVenues": bucket["nightlife"],
                    "shops": bucket.get("commerce", 0),
                    "food": bucket.get("food", 0),
                    "lodging": bucket.get("lodging", 0),
                    "civic": bucket.get("civic", 0),
                    "transport": bucket.get("transport", 0),
                    "parks": bucket["parks"],
                    "transitStops": bucket["transit"],
                    "landmarks": bucket["landmarks"],
                    "waterBodies": bucket["waterBodies"],
                },
                "measured": {
                    "arterialRoadKm": round(bucket["arterialLengthM"] / 1000, 2),
                    "allRoadKm": round(bucket["roadLengthM"] / 1000, 2),
                    "parkAreaKm2": round(bucket["parkAreaM2"] / 1e6, 3),
                    "venuesPerKm2": round(bucket["venues"] / area_for_density, 1),
                    "nightlifePerKm2": round(bucket["nightlife"] / area_for_density, 1),
                },
                "provenance": {
                    "assignment": LAYER_DERIVED,
                    "assignmentMethod": "nearest configured district seed point (Voronoi by great-circle distance)",
                    "densityCaveat": (
                        "Densities use each district's feature extent as its area, which understates "
                        "dense cores and overstates sparse ones. Use for relative comparison only."
                    ),
                },
            }
        )

    # ------------------------------------------------- nightlife clusters --
    print("clustering nightlife...")
    cells: dict[str, dict] = defaultdict(lambda: {"venues": [], "categories": Counter()})
    for venue in venues:
        if not venue["isNightlife"] or not venue["center"]:
            continue
        key = cell_key(venue["center"][0], venue["center"][1], projection)
        cells[key]["venues"].append(venue)
        cells[key]["categories"][venue.get("nightlifeRole") or venue["category"]] += 1

    clusters = []
    for key, cell in cells.items():
        if len(cell["venues"]) < CLUSTER_MIN_VENUES:
            continue
        center_lat = sum(v["center"][0] for v in cell["venues"]) / len(cell["venues"])
        center_lon = sum(v["center"][1] for v in cell["venues"]) / len(cell["venues"])
        cell_km2 = (CLUSTER_CELL_M / 1000) ** 2
        clusters.append(
            {
                "id": f"cluster/{key}",
                "center": [round(center_lat, 6), round(center_lon, 6)],
                "local": projection.to_units(center_lat, center_lon),
                "cellSizeM": CLUSTER_CELL_M,
                "venueCount": len(cell["venues"]),
                "venuesPerKm2": round(len(cell["venues"]) / cell_km2, 1),
                "byCategory": dict(cell["categories"].most_common()),
                "districtId": assign_district(center_lat, center_lon, seeds)[0],
            }
        )
    clusters.sort(key=lambda c: -c["venueCount"])

    # ------------------------------------------------------ transit hubs --
    hub_cells: dict[str, list] = defaultdict(list)
    for stop in transit:
        if not stop["center"] or not stop["name"]:
            continue
        hub_cells[cell_key(stop["center"][0], stop["center"][1], projection)].append(stop)
    transport_hubs = []
    for key, stops in hub_cells.items():
        if len(stops) < 3:
            continue
        lat = sum(s["center"][0] for s in stops) / len(stops)
        lon = sum(s["center"][1] for s in stops) / len(stops)
        transport_hubs.append(
            {
                "id": f"hub/{key}",
                "center": [round(lat, 6), round(lon, 6)],
                "local": projection.to_units(lat, lon),
                "stopCount": len(stops),
                "stopNames": sorted({s["name"] for s in stops})[:8],
                "kinds": dict(Counter(s["kind"] for s in stops).most_common()),
                "districtId": assign_district(lat, lon, seeds)[0],
            }
        )
        transport_hubs[-1]["label"] = (
            f"{transport_hubs[-1]['stopNames'][0]}"
            if transport_hubs[-1]["stopNames"]
            else key
        )
    transport_hubs.sort(key=lambda h: -h["stopCount"])

    # ------------------------------------------- interesting / hero roads --
    interesting_roads = []
    for road in roads:
        if road["category"] not in ARTERIAL_CATEGORIES:
            continue
        score = 0
        reasons = []
        if road["bridge"]:
            score += 3
            reasons.append("bridge")
        if road["tunnel"]:
            score += 3
            reasons.append("tunnel")
        if road["lengthM"] > 2000:
            score += 2
            reasons.append("long-span")
        if road["name"]:
            score += 1
            reasons.append("named")
        if road["category"] in ("freeway", "arterial_major"):
            score += 2
            reasons.append("major-route")
        if score >= 5:
            mid = road["geometry"][len(road["geometry"]) // 2]
            interesting_roads.append(
                {
                    "id": road["id"],
                    "name": road["name"],
                    "category": road["category"],
                    "lengthM": road["lengthM"],
                    "bridge": road["bridge"],
                    "tunnel": road["tunnel"],
                    "reasons": reasons,
                    "center": [round(mid[0], 6), round(mid[1], 6)],
                    "districtId": assign_district(mid[0], mid[1], seeds)[0],
                }
            )
    interesting_roads.sort(key=lambda r: -r["lengthM"])

    # ------------------------------------------------------------ bridges --
    # Structures are grouped by name: a single bridge is many OSM ways
    # (deck, ramps, cycleways), and listing them individually is noise.
    def group_structures(predicate, kind: str) -> list[dict]:
        groups: dict[str, dict] = {}
        for landmark in landmarks:
            if not landmark["name"] or not predicate(landmark):
                continue
            entry = groups.setdefault(
                landmark["name"],
                {
                    "name": landmark["name"],
                    "kind": kind,
                    "memberIds": [],
                    "vertices": 0,
                    "centers": [],
                },
            )
            entry["memberIds"].append(landmark["id"])
            entry["vertices"] += landmark["vertexCount"] or 0
            if landmark["center"]:
                entry["centers"].append(landmark["center"])
        out = []
        for entry in groups.values():
            if entry["centers"]:
                lat = sum(c[0] for c in entry["centers"]) / len(entry["centers"])
                lon = sum(c[1] for c in entry["centers"]) / len(entry["centers"])
                entry["center"] = [round(lat, 6), round(lon, 6)]
                entry["local"] = projection.to_units(lat, lon)
                entry["districtId"] = assign_district(lat, lon, seeds)[0]
            else:
                entry["center"] = None
                entry["local"] = None
            entry["memberCount"] = len(entry["memberIds"])
            out.append(entry)
        out.sort(key=lambda e: -e["vertices"])
        return out

    bridges = group_structures(lambda l: l["bridge"], "bridge")
    tunnels = group_structures(lambda l: l["tunnel"], "tunnel")

    # ---------------------------------------------- drivable road crossings --
    # Sydney Harbour Bridge itself is a relation with no geometry in OSM, so the
    # usable crossings are taken from the roads that actually cross water or
    # ground: group every bridge/tunnel-tagged road by name.
    crossing_groups: dict[tuple, dict] = {}
    for road in roads:
        if not (road["bridge"] or road["tunnel"]):
            continue
        kind = "bridge" if road["bridge"] else "tunnel"
        name = road["name"] or f"unnamed-{kind}"
        key = (kind, name.lower())
        entry = crossing_groups.setdefault(
            key,
            {"name": road["name"], "kind": kind, "roadIds": [], "lengthM": 0.0, "roads": []},
        )
        entry["roadIds"].append(road["id"])
        entry["lengthM"] += road["lengthM"]
        entry["roads"].append(road)
    crossings = []
    for entry in crossing_groups.values():
        roads_in = entry.pop("roads")
        points = [c for road in roads_in for c in road["geometry"]]
        lat = sum(p[0] for p in points) / len(points)
        lon = sum(p[1] for p in points) / len(points)
        crossings.append(
            {
                "name": entry["name"],
                "kind": entry["kind"],
                "roadCount": len(entry["roadIds"]),
                "totalLengthM": round(entry["lengthM"], 1),
                "center": [round(lat, 6), round(lon, 6)],
                "local": projection.to_units(lat, lon),
                "districtIds": sorted({assign_district(p[0], p[1], seeds)[0] for p in points}),
                "geometryLocal": [road["geometryLocal"] for road in roads_in],
                "evidenceLayer": LAYER_DERIVED,
                "derivation": "Grouped from bridge=yes / tunnel=yes road geometry, not from a bridge relation.",
            }
        )
    crossings.sort(key=lambda c: -c["totalLengthM"])

    # ---------------------------------------- population / gameplay zones --
    # These are GAMEPLAY CLASSIFICATIONS derived from measured counts.
    # They are explicitly NOT claims about real-world population.
    population_zones = []
    gameplay_zones = []
    for district in districts:
        measured = district["measured"]
        counts = district["counts"]

        nightlife_score = min(1.0, measured["nightlifePerKm2"] / 200.0)
        commerce_score = min(1.0, measured["venuesPerKm2"] / 600.0)
        park_ratio = (measured["parkAreaKm2"] / district["extentKm2"]) if district["extentKm2"] else 0.0
        transit_score = min(1.0, counts["transitStops"] / 60.0)

        day_level = "MEDIUM"
        if commerce_score > 0.6 or transit_score > 0.6:
            day_level = "HIGH"
        elif commerce_score < 0.15 and park_ratio < 0.1:
            day_level = "LOW"

        night_level = "MEDIUM"
        if nightlife_score > 0.5:
            night_level = "VERY_HIGH"
        elif nightlife_score > 0.2:
            night_level = "HIGH"
        elif nightlife_score < 0.05:
            night_level = "LOW"

        population_zones.append(
            {
                "districtId": district["id"],
                "dayActivity": day_level,
                "nightActivity": night_level,
                "inputs": {
                    "venuesPerKm2": measured["venuesPerKm2"],
                    "nightlifePerKm2": measured["nightlifePerKm2"],
                    "transitStops": counts["transitStops"],
                    "parkAreaRatio": round(park_ratio, 3),
                },
                "evidenceLayer": LAYER_DESIGN,
                "disclaimer": (
                    "Gameplay classification derived from OSM feature density. "
                    "It is not a measurement of real human population or foot traffic."
                ),
            }
        )

        roles = []
        if commerce_score > 0.5:
            roles.append("COMMERCIAL")
        if nightlife_score > 0.2:
            roles.append("NIGHTLIFE")
        if park_ratio > 0.15 or counts["parks"] > 20:
            roles.append("PARK")
        if counts["waterBodies"] > 0 or any(
            district["id"] in c["districtIds"] for c in crossings[:25]
        ):
            roles.append("WATERFRONT")
        if counts["civic"] > 20:
            roles.append("MEDICAL" if district["id"] in ("cbd-core", "east-inner") else "CIVIC")
        if counts["lodging"] > 15:
            roles.append("TOURIST")
        if district["id"] in ("cbd-core", "east-inner"):
            roles.append("RESIDENTIAL")
        roles.append("SAFE") if not roles else None
        gameplay_zones.append(
            {
                "districtId": district["id"],
                "roles": sorted(set(roles)) or ["RESIDENTIAL"],
                "evidenceLayer": LAYER_DESIGN,
                "disclaimer": "Game-design metadata. OSM does not determine these labels.",
            }
        )

    # ------------------------------------------------------------ corridors --
    corridors = []
    for route in config["corridorRoutes"]:
        corridors.append(
            {
                "id": route["id"],
                "from": route["from"],
                "to": route["to"],
                "straightLineM": round(
                    haversine_m(route["from"]["lat"], route["from"]["lon"], route["to"]["lat"], route["to"]["lon"]), 1
                ),
                "fromDistrict": assign_district(route["from"]["lat"], route["from"]["lon"], seeds)[0],
                "toDistrict": assign_district(route["to"]["lat"], route["to"]["lon"], seeds)[0],
                "drivenRoute": None,  # filled from the raw OSRM call if present
            }
        )
    routes_file = WORLDDATA.parent / "raw" / "mcp-corridor-routes.json"
    if routes_file.exists():
        try:
            raw_routes = read_json(routes_file)["payload"]["routes"]
            by_id = {r["corridor"]["id"]: r for r in raw_routes if r.get("summary")}
            for corridor in corridors:
                match = by_id.get(corridor["id"])
                if match:
                    corridor["drivenRoute"] = {
                        "distanceM": (match["summary"] or {}).get("distance"),
                        "durationS": (match["summary"] or {}).get("duration"),
                        "geometryPoints": match["geometryPoints"],
                        "source": "OSRM via osm-mcp get_route_directions",
                        "evidenceLayer": LAYER_DERIVED,
                    }
        except Exception:
            pass

    # -------------------------------------------------------- world spec --
    arterial_records = []
    for road in roads:
        if road["category"] not in ARTERIAL_CATEGORIES:
            continue
        mid = road["geometry"][len(road["geometry"]) // 2]
        arterial_records.append(
            {
                "id": road["id"],
                "name": road["name"],
                "category": road["category"],
                "highway": road["highway"],
                "lengthM": road["lengthM"],
                "bridge": road["bridge"],
                "tunnel": road["tunnel"],
                "maxspeedKmh": road["maxspeedKmh"],
                "lanes": road["lanes"],
                "oneway": road["oneway"],
                "districtId": assign_district(mid[0], mid[1], seeds)[0],
                "geometryLocal": road["geometryLocal"],
            }
        )
    arterial_records.sort(key=lambda r: -r["lengthM"])

    compact_venues = defaultdict(list)
    for venue in venues:
        if not venue["center"]:
            continue
        district_id, distance = assign_district(venue["center"][0], venue["center"][1], seeds)
        compact_venues[district_id].append(
            {
                "id": venue["id"],
                "name": venue["name"],
                "category": venue["category"],
                "group": venue["group"],
                "nightlife": venue["isNightlife"],
                "local": venue["local"],
                "distToSeedM": distance,
            }
        )

    major_intersections = sorted(intersections, key=lambda i: -i["roadCount"])[:400]

    # ---- geometry blocks, emitted in local metres so a consumer can hand them
    # straight to a geometry engine without re-projecting anything.
    def local_rings(record: dict) -> list:
        rings = record.get("rings") or {}
        out = []
        for ring in rings.get("outer", []):
            out.append(projection.to_units_polyline(ring))
        return out

    water_geometry = [
        {
            "id": w["id"],
            "name": w["name"],
            "kind": w["kind"],
            "areaM2": w.get("areaM2"),
            "rings": local_rings(w),
        }
        for w in water
        if local_rings(w)
    ]
    water_geometry.sort(key=lambda w: -(w["areaM2"] or 0))

    park_geometry = [
        {
            "id": p["id"],
            "name": p["name"],
            "kind": p["kind"],
            "areaM2": p.get("areaM2"),
            "rings": local_rings(p),
        }
        for p in parks
        if (p.get("areaM2") or 0) > 8000  # ~1 hectare and up: the visible green space
    ]
    park_geometry.sort(key=lambda p: -(p["areaM2"] or 0))

    building_sample = [
        {
            "id": b["id"],
            "name": b["name"],
            "building": b["building"],
            "levels": b["levels"],
            "heightM": b["heightM"],
            "areaM2": b["areaM2"],
            "footprint": b["footprintLocal"],
        }
        for b in buildings
    ]

    spec = {
        "schemaVersion": "0.1.0",
        "generatedAt": now_iso(),
        "world": {
            "name": config["worldName"],
            "sourceRegion": config["region"],
            "dataSource": "OpenStreetMap via the open-streetmap-mcp server + Overpass API",
            "license": "ODbL 1.0 - see ATTRIBUTION.md",
            "naming": (
                "Real Sydney place names are retained by explicit project decision. Any build or "
                "product that ships this data must carry the OpenStreetMap ODbL attribution - see "
                "ATTRIBUTION.md."
            ),
            "fictionalization": (
                "Not applied. The project owner chose to keep real names, so the top-level rule in "
                "docs/WORLD-DESIGN-PROMPT.md about renaming does not apply to this build. Topology is "
                "still the thing to preserve."
            ),
        },
        "coordinateSystem": projection.describe(),
        "evidenceLayers": {
            "sourceFact": LAYER_SOURCE,
            "derivedGeography": LAYER_DERIVED,
            "aiInterpretation": LAYER_AI,
            "gameplayDesign": LAYER_DESIGN,
            "rule": "Any field not traceable to an OSM tag is labelled with one of the layers above.",
        },
        "scope": {
            "coreBbox": config["scope"]["coreBbox"],
            "tiles": [t["id"] for t in config["scope"]["tiles"]],
            "approxSizeKm": config["scope"]["approxSizeKm"],
            "buildingSampleBbox": config["scope"]["buildingSampleBbox"],
            "note": config["scope"]["note"],
        },
        "totals": {
            "roads": road_stats["total"],
            "roadLengthKm": road_stats["totalLengthKm"],
            "intersections": intersection_stats["total"],
            "deadEnds": intersection_stats["deadEnds"],
            "venues": venue_stats["total"],
            "nightlifeVenues": venue_stats["nightlife"],
            "parks": len(parks),
            "waterFeatures": len(water),
            "transitStops": len(transit),
            "buildingsSampled": len(buildings),
            "landmarks": len(landmarks),
        },
        "districts": districts,
        "roads": {
            "summary": {
                "byCategory": road_stats["byCategory"],
                "named": road_stats["named"],
                "unnamed": road_stats["unnamed"],
                "bridges": road_stats["bridges"],
                "tunnels": road_stats["tunnels"],
                "totalLengthKm": road_stats["totalLengthKm"],
                "missingFields": road_stats["missingFields"],
            },
            "note": (
                "Arterials carry full geometry. Local/service streets ("
                f"{road_stats['byCategory'].get('service', 0) + road_stats['byCategory'].get('local', 0)} ways) "
                "are kept in world/roads.json rather than inlined here, to keep this file readable by an AI."
            ),
            "arterials": arterial_records,
        },
        "intersections": {
            "summary": intersection_stats,
            "note": "Derived by snapping shared road vertices; see evidenceLayers. Not an OSM node list.",
            "major": major_intersections,
        },
        "landmarks": {
            "bridges": bridges[:60],
            "tunnels": tunnels[:60],
            "crossings": crossings[:80],
            "namedAttractions": [
                {
                    "id": l["id"],
                    "name": l["name"],
                    "center": l["center"],
                    "local": l["local"],
                    "osmType": l["osmType"],
                    "tags": {k: v for k, v in list(l["tags"].items())[:12]},
                }
                for l in landmarks
                if l["name"] and not l["bridge"] and not l["tunnel"]
            ][:400],
        },
        "venues": {
            "summary": {
                "total": venue_stats["total"],
                "named": venue_stats["named"],
                "nightlife": venue_stats["nightlife"],
                "byGroup": venue_stats["byGroup"],
                "byCategory": venue_stats["byCategory"],
                "seenInBothChannels": venue_stats["seenInBothChannels"],
            },
            "byDistrict": dict(compact_venues),
        },
        "nature": {
            "parksTotal": len(parks),
            "parkAreaKm2": round(sum((p.get("areaM2") or 0) for p in parks) / 1e6, 3),
            "largestParks": sorted(
                [
                    {
                        "id": p["id"],
                        "name": p["name"],
                        "areaM2": p.get("areaM2"),
                        "center": p["center"],
                        "local": p["local"],
                        "kind": p["kind"],
                    }
                    for p in parks
                    if p.get("areaM2")
                ],
                key=lambda p: -p["areaM2"],
            )[:40],
            "geometry": {
                "note": "Outer rings in local metres, ready for a geometry engine. "
                        "Parks below 1 hectare are omitted; full data is in data/normalized/parks.json.",
                "count": len(park_geometry),
                "items": park_geometry,
            },
        },
        "water": {
            "bodiesTotal": len(water),
            "byKind": dict(Counter(w["kind"] for w in water).most_common()),
            "largest": sorted(
                [
                    {"id": w["id"], "name": w["name"], "kind": w["kind"], "areaM2": w.get("areaM2"),
                     "center": w["center"], "local": w["local"]}
                    for w in water
                    if w.get("areaM2")
                ],
                key=lambda w: -(w["areaM2"] or 0),
            )[:40],
            "beaches": [
                {"id": w["id"], "name": w["name"], "center": w["center"], "local": w["local"]}
                for w in water
                if w["kind"] == "beach"
            ][:40],
            "geometry": {
                "note": "ALL water polygons, outer rings in local metres. The harbour is a "
                        "multipolygon with many rings - they must be drawn together, not as "
                        "separate shapes. Full data in data/normalized/waterways.json.",
                "count": len(water_geometry),
                "items": water_geometry,
            },
        },
        "transit": {
            "total": len(transit),
            "byKind": dict(Counter(t["kind"] for t in transit).most_common()),
            "namedStops": [
                {"id": t["id"], "name": t["name"], "kind": t["kind"], "center": t["center"], "local": t["local"]}
                for t in transit
                if t["name"]
            ][:400],
            "note": "Positions only. No timetables, no route topology, no platform data.",
        },
        "buildings": {
            "sampleOnly": True,
            "stats": {
                "sampled": len(buildings),
                "named": sum(1 for b in buildings if b["name"]),
                "withLevels": sum(1 for b in buildings if b["levels"] is not None),
                "withHeightM": sum(1 for b in buildings if b["heightM"] is not None),
            },
            "rule": "OSM gives no height for most buildings. The world designer must derive heights from "
                    "district character, and must label that as invention, not data.",
            "sample": {
                "note": "Footprints in local metres. `heightM` is null where OSM has no height - "
                        "do not silently substitute a number.",
                "count": len(building_sample),
                "items": building_sample,
            },
        },
        "populationZones": population_zones,
        "gameplayZones": gameplay_zones,
        "corridors": corridors,
        "nightlifeClusters": clusters[:40],
        "transportHubs": transport_hubs[:30],
        "interestingRoads": interesting_roads[:60],
        "limitations": [
            "Prototype covers only the configured core bbox, not metropolitan Sydney.",
            "Building footprints are a small CBD sample, not a city-wide layer.",
            "The MCP server cannot return roads, buildings or any geometry; those come from direct Overpass.",
            "Heights, opening hours, floor areas and traffic volumes are absent from OSM and were not invented.",
            "District assignment is nearest-seed, not an official boundary.",
            "No bus network, no timetables, no traffic data, no population data.",
        ],
    }

    write_json(WORLDDATA / "world-spec.json", spec)
    print(f"  world-spec.json written ({len(arterial_records)} arterials, {sum(len(v) for v in compact_venues.values())} venues)")

    # ---------------------------------------------------------- analysis --
    analysis = {
        "generatedAt": now_iso(),
        "evidenceLayer": LAYER_AI,
        "warning": "Everything in this file is interpretation layered on top of the measured data. "
                   "It is a starting point for a world designer, not geographic truth.",
        "urbanPatterns": [
            {
                "pattern": "harbour-wrapped core",
                "observation": "The CBD is bounded by water on three sides; the road network funnels through "
                               "a small number of crossings.",
                "evidence": {"namedBridges": len(bridges), "largestWaterBodies": spec["water"]["byKind"]},
            },
            {
                "pattern": "radial arterials into a compressed core",
                "observation": "Arterials converge on the CBD and drop to local/service streets inside the grid.",
                "evidence": {"arterialCount": len(arterial_records),
                             "serviceAndLocalWays": road_stats["byCategory"].get("service", 0)
                             + road_stats["byCategory"].get("local", 0)},
            },
            {
                "pattern": "nightlife belt east and south of the core",
                "observation": "Nightlife clusters are concentrated in the eastern inner suburbs, not in the CBD itself.",
                "evidence": {"clusterCount": len(clusters), "topClusterVenues": clusters[0]["venueCount"] if clusters else 0},
            },
            {
                "pattern": "green anchors rather than a green network",
                "observation": "Open space is concentrated in a few large parks (Royal Botanic Garden, Hyde Park, "
                               "Centennial Park) with little connective green space between them.",
                "evidence": {"largestParks": [p["name"] for p in spec["nature"]["largestParks"][:5]]},
            },
        ],
        "districtCandidates": [
            {
                "id": d["id"],
                "realName": d["realName"],
                "measured": d["measured"],
                "counts": d["counts"],
                "suggestedRole": g["roles"],
            }
            for d, g in zip(districts, gameplay_zones)
        ],
        "nightlifeClusters": clusters[:25],
        "transportHubs": transport_hubs[:20],
        "interestingRoads": interesting_roads[:40],
        "missionOpportunities": [
            {
                "opportunity": "harbour circuit",
                "why": "Named bridges and a continuous waterfront give a natural loop with high visual value.",
                "anchors": [b["name"] for b in bridges[:5] if b["name"]],
            },
            {
                "opportunity": "nightlife-to-waterfront contrast run",
                "why": "Top nightlife cluster and the harbour are on opposite sides of the core, giving a "
                       "natural high-contrast traversal.",
                "anchors": [
                    {"cluster": c["id"], "district": c["districtId"]} for c in clusters[:3]
                ],
            },
            {
                "opportunity": "transit-hub interception",
                "why": "Transport hubs have dense stop clusters and are natural mission gateways.",
                "anchors": [{"hub": h["id"], "stops": h["stopCount"]} for h in transport_hubs[:5]],
            },
        ],
        "gameplayLoops": [
            "waterfront promenade loop (harbour -> bridge -> ferry terminal -> harbour)",
            "nightlife out-and-back (inner suburb cluster -> CBD commercial -> return via arterial)",
            "park-to-park traversal (large park anchor -> arterial -> next park anchor)",
            "tunnel/bridge shortcut loop (arterial -> crossing -> inner grid)",
        ],
    }
    write_json(WORLDDATA / "world-analysis.json", analysis)
    print("  world-analysis.json written")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
