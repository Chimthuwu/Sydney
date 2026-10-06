"""Collect raw Sydney data into data/raw/.

Two channels, both OpenStreetMap:

  * osm-mcp       -> the local `osm-mcp-server` MCP tools (geocode, reverse
                     geocode, search_category, explore_area, routing).
  * overpass-api  -> direct Overpass QL, used ONLY for what the MCP server
                     cannot express (the `highway` tag, and any geometry,
                     because every MCP tool ends in `out body;`).

Everything is wrapped in a provenance envelope and every response is cached on
disk, so re-running the pipeline is cheap and reproducible.

Run:  python scripts/query_sydney.py [--skip-mcp] [--skip-overpass]
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import mcp_client  # noqa: E402
from common import (  # noqa: E402
    RAW,
    LAYER_SOURCE,
    OverpassClient,
    bbox_from,
    build_query,
    build_selectors,
    ensure_dirs,
    envelope,
    load_config,
    now_iso,
    read_json,
    resolve_bbox,
    write_json,
)

LOG: list[dict] = []


def log_step(name: str, channel: str, tool: str, ok: bool, count, detail: str = "") -> None:
    entry = {
        "step": name,
        "channel": channel,
        "tool": tool,
        "status": "ok" if ok else "error",
        "count": count,
        "detail": detail,
        "at": now_iso(),
    }
    LOG.append(entry)
    print(f"[{'ok ' if ok else 'ERR'}] {name:<34} {count}" + (f"  {detail}" if detail else ""))


# ---------------------------------------------------------------- Overpass --
def collect_overpass(config: dict, overpass: OverpassClient) -> None:
    layers = config["layers"]
    core = resolve_bbox(config, "coreBbox")
    roads_cfg = layers["roads"]

    jobs: list[tuple[str, str, list[str], int]] = []

    # The arterials are fetched per tile: a single core-wide `out geom` request
    # reliably 504s on the public mirror, and tiles are small enough to succeed.
    for tile in config["scope"]["tiles"]:
        jobs.append(
            (
                f"roads-backbone-{tile['id']}",
                f"Arterials / trunk / links in tile '{tile['id']}'",
                build_selectors("way", [{"highway": roads_cfg["backbone"]["highway"]}], bbox_from(tile)),
                90,
            )
        )
    for tile_id in roads_cfg["grid"]["tiles"]:
        jobs.append(
            (
                f"roads-grid-{tile_id}",
                f"Dense street grid for tile '{tile_id}'",
                build_selectors("way", [{"highway": roads_cfg["grid"]["highway"]}], resolve_bbox(config, tile_id)),
                120,
            )
        )

    jobs.append(
        (
            "buildings-sample",
            "Building footprints inside the configured sample box only",
            build_selectors("way", [{"building": "*"}], bbox_from(config["scope"]["buildingSampleBbox"])),
            120,
        )
    )

    jobs.append(
        (
            "water-areas",
            "Harbour / bay / riverbank / reservoir polygons",
            build_selectors("way", layers["water"]["polygon"], core)
            + build_selectors("relation", layers["water"]["polygon"], core),
            120,
        )
    )
    jobs.append(
        (
            "water-lines",
            "Rivers, streams, canals, coastline",
            build_selectors("way", layers["water"]["line"], core),
            180,
        )
    )
    jobs.append(
        (
            "water-beaches",
            "Beaches",
            build_selectors("way", layers["water"]["beach"], core)
            + build_selectors("node", layers["water"]["beach"], core),
            120,
        )
    )

    jobs.append(
        (
            "parks",
            "Parks, gardens, reserves, recreation grounds, cemeteries",
            build_selectors("way", layers["parks"]["polygon"], core)
            + build_selectors("relation", layers["parks"]["polygon"], core),
            120,
        )
    )

    jobs.append(
        (
            "transit",
            "Rail stations, light rail stops, ferry terminals",
            build_selectors("node", layers["transit"]["node"], core)
            + build_selectors("way", layers["transit"]["way"], core),
            120,
        )
    )

    named_only = layers["landmarks"].get("namedOnly", False)
    jobs.append(
        (
            "landmarks-ways",
            "Bridges, tunnels, towers, museums, stadiums, universities, squares",
            build_selectors("way", layers["landmarks"]["way"], core, named_only=named_only),
            120,
        )
    )
    jobs.append(
        (
            "landmarks-nodes",
            "Named landmark points (towers, memorials, monuments, attractions)",
            build_selectors("node", layers["landmarks"]["node"], core, named_only=named_only),
            120,
        )
    )

    venue = layers["venues"]
    for tile in config["scope"]["tiles"]:
        tile_bbox = bbox_from(tile)
        # The amenity value list is long; a single huge regex reliably 504s on
        # the public mirror, so it is fetched in chunks and merged downstream.
        amenity_values = venue["amenity"]
        chunk_size = 20
        for index in range(0, len(amenity_values), chunk_size):
            chunk = amenity_values[index : index + chunk_size]
            jobs.append(
                (
                    f"venues-amenity-{tile['id']}-{index // chunk_size}",
                    f"amenity POIs in tile '{tile['id']}' (values {index}-{index + len(chunk) - 1})",
                    build_selectors("node", [{"amenity": chunk}], tile_bbox)
                    + build_selectors("way", [{"amenity": chunk}], tile_bbox),
                    90,
                )
            )
        jobs.append(
            (
                f"venues-shop-{tile['id']}",
                f"shops in tile '{tile['id']}'",
                build_selectors("node", [{"shop": "*"}], tile_bbox)
                + build_selectors("way", [{"shop": "*"}], tile_bbox),
                120,
            )
        )
        jobs.append(
            (
                f"venues-leisure-tourism-{tile['id']}",
                f"tourism + leisure POIs in tile '{tile['id']}'",
                build_selectors("node", [{"tourism": venue["tourism"]}, {"leisure": venue["leisure"]}], tile_bbox)
                + build_selectors("way", [{"tourism": venue["tourism"]}, {"leisure": venue["leisure"]}], tile_bbox),
                120,
            )
        )

    for name, description, selectors, timeout in jobs:
        ql = build_query(selectors, timeout=timeout)
        try:
            payload = overpass.query(ql, name)
        except Exception as exc:
            log_step(name, "overpass-api", "overpass", False, None, f"{type(exc).__name__}: {exc}")
            write_json(
                RAW / f"overpass-{name}.json",
                envelope(name, "overpass-api", {"elements": []}, {"error": str(exc), "query": ql, "description": description}),
            )
            continue
        elements = payload.get("elements", [])
        remark = payload.get("remark")
        write_json(
            RAW / f"overpass-{name}.json",
            envelope(
                name,
                "overpass-api",
                {"elements": elements},
                {
                    "query": ql,
                    "description": description,
                    "elementCount": len(elements),
                    "partial": bool(remark),
                    "remark": remark,
                    "evidenceLayer": LAYER_SOURCE,
                    "whyNotMcp": (
                        "No MCP tool queries this tag, and all MCP tools use `out body;` "
                        "which discards geometry."
                    ),
                },
            ),
        )
        log_step(
            name,
            "overpass-api",
            "overpass",
            True,
            len(elements),
            "PARTIAL: " + str(remark)[:80] if remark else "",
        )


# --------------------------------------------------------------------- MCP --
def collect_mcp(config: dict) -> None:
    scope = config["scope"]

    # 1. Validate the district seeds against Nominatim via the MCP server.
    seeds = []
    for seed in config["districtSeeds"]:
        try:
            payload, origin = mcp_client.call_cached(
                "reverse_geocode", {"latitude": seed["lat"], "longitude": seed["lon"]}
            )
            seeds.append(
                {
                    "seed": seed,
                    "origin": origin,
                    "reverseGeocode": {
                        "displayName": (payload or {}).get("display_name"),
                        "category": (payload or {}).get("category"),
                        "type": (payload or {}).get("type"),
                        "address": (payload or {}).get("address"),
                    },
                }
            )
        except Exception as exc:
            seeds.append({"seed": seed, "error": f"{type(exc).__name__}: {exc}"})
    ok = sum(1 for s in seeds if s.get("reverseGeocode", {}).get("displayName"))
    write_json(
        RAW / "mcp-district-seeds.json",
        envelope(
            "district-seed-validation",
            "osm-mcp",
            {"seeds": seeds},
            {
                "tool": "reverse_geocode",
                "purpose": "Confirm the hand-picked district seed points really are what the config says they are.",
                "evidenceLayer": LAYER_SOURCE,
            },
        ),
    )
    log_step("mcp-district-seeds", "osm-mcp", "reverse_geocode", ok == len(seeds), f"{ok}/{len(seeds)} resolved")

    # 2. Named anchor places.
    anchors = []
    for query in ["Sydney Harbour Bridge", "Sydney Opera House", "Central Station Sydney", "Darling Harbour Sydney"]:
        try:
            payload, origin = mcp_client.call_cached("geocode_address", {"address": query})
            anchors.append(
                {
                    "query": query,
                    "origin": origin,
                    "results": [
                        {
                            "displayName": item.get("display_name"),
                            "lat": item.get("lat"),
                            "lon": item.get("lon"),
                            "osmType": item.get("osm_type"),
                            "osmId": item.get("osm_id"),
                            "class": item.get("class"),
                            "type": item.get("type"),
                        }
                        for item in (payload or [])
                    ],
                }
            )
        except Exception as exc:
            anchors.append({"query": query, "error": f"{type(exc).__name__}: {exc}"})
    write_json(
        RAW / "mcp-anchor-places.json",
        envelope(
            "anchor-places",
            "osm-mcp",
            {"anchors": anchors},
            {"tool": "geocode_address", "purpose": "Anchor the prototype area to recognisable Sydney landmarks.",
             "evidenceLayer": LAYER_SOURCE},
        ),
    )
    log_step("mcp-anchor-places", "osm-mcp", "geocode_address", True, len(anchors))

    # 3. POIs through the MCP server, per tile.
    venue = config["layers"]["venues"]
    mcp_categories = {
        "amenity": venue["amenity"],
        "shop": ["*"],
    }
    for tile in scope["tiles"]:
        for category, subcategories in mcp_categories.items():
            name = f"mcp-poi-{category}-{tile['id']}"
            args = {
                "category": category,
                "min_latitude": tile["south"],
                "min_longitude": tile["west"],
                "max_latitude": tile["north"],
                "max_longitude": tile["east"],
            }
            if subcategories != ["*"]:
                args["subcategories"] = subcategories
            try:
                payload, origin = mcp_client.call_cached("search_category", args)
                results = (payload or {}).get("results", [])
                write_json(
                    RAW / f"{name}.json",
                    envelope(
                        name,
                        "osm-mcp",
                        {"results": results},
                        {
                            "tool": "search_category",
                            "arguments": args,
                            "origin": origin,
                            "resultCount": len(results),
                            "evidenceLayer": LAYER_SOURCE,
                            "knownGap": (
                                "MCP returns `out body` (no geometry) and drops ways/relations that have no "
                                "centre, so this channel under-reports area-mapped venues."
                            ),
                        },
                    ),
                )
                log_step(name, "osm-mcp", "search_category", True, len(results))
            except Exception as exc:
                log_step(name, "osm-mcp", "search_category", False, None, f"{type(exc).__name__}: {exc}")

    # 4. Area profiles for a few district seeds (evidence for district generation).
    for seed in config["districtSeeds"][:6]:
        name = f"mcp-explore-{seed['id']}"
        try:
            payload, origin = mcp_client.call_cached(
                "explore_area", {"latitude": seed["lat"], "longitude": seed["lon"], "radius": 500}
            )
            categories = (payload or {}).get("categories", {})
            summary = {
                category: {
                    sub: len(items) for sub, items in sorted(subs.items()) if items
                }
                for category, subs in categories.items()
            }
            write_json(
                RAW / f"{name}.json",
                envelope(
                    name,
                    "osm-mcp",
                    {"profile": summary, "address": (payload or {}).get("address")},
                    {
                        "tool": "explore_area",
                        "seed": seed,
                        "origin": origin,
                        "totalFeatures": (payload or {}).get("total_features"),
                        "evidenceLayer": LAYER_SOURCE,
                    },
                ),
            )
            log_step(name, "osm-mcp", "explore_area", True, (payload or {}).get("total_features"))
        except Exception as exc:
            log_step(name, "osm-mcp", "explore_area", False, None, f"{type(exc).__name__}: {exc}")

    # 5. Drivable corridors between districts.
    routes = []
    for corridor in config["corridorRoutes"]:
        try:
            payload, origin = mcp_client.call_cached(
                "get_route_directions",
                {
                    "from_latitude": corridor["from"]["lat"],
                    "from_longitude": corridor["from"]["lon"],
                    "to_latitude": corridor["to"]["lat"],
                    "to_longitude": corridor["to"]["lon"],
                    "mode": "car",
                    "overview": "full",
                },
            )
            geometry = (payload or {}).get("geometry") or {}
            routes.append(
                {
                    "corridor": corridor,
                    "origin": origin,
                    "summary": (payload or {}).get("summary"),
                    "geometryPoints": len(geometry.get("coordinates") or []),
                    "geometry": geometry.get("coordinates") or [],
                }
            )
        except Exception as exc:
            routes.append({"corridor": corridor, "error": f"{type(exc).__name__}: {exc}"})
    write_json(
        RAW / "mcp-corridor-routes.json",
        envelope(
            "corridor-routes",
            "osm-mcp",
            {"routes": routes},
            {
                "tool": "get_route_directions (OSRM)",
                "evidenceLayer": LAYER_SOURCE,
                "note": "Route geometry is a DERIVED road-network fact from OSRM, not an OSM tag fact.",
            },
        ),
    )
    ok = sum(1 for r in routes if r.get("summary"))
    log_step("mcp-corridor-routes", "osm-mcp", "get_route_directions", ok == len(routes), f"{ok}/{len(routes)}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Collect raw Sydney OSM data")
    parser.add_argument("--skip-mcp", action="store_true")
    parser.add_argument("--skip-overpass", action="store_true")
    args = parser.parse_args()

    ensure_dirs()
    config = load_config()

    started = time.time()
    log_file = RAW / "collection-log.json"
    previous = {}
    if log_file.exists():
        try:
            for entry in read_json(log_file).get("steps", []):
                previous[entry["step"]] = entry
        except Exception:
            previous = {}

    if not args.skip_overpass:
        print("\n--- Overpass channel (geometry) ---")
        overpass = OverpassClient(
            min_interval=config["rateLimit"]["overpassMinIntervalSeconds"], timeout=240
        )
        collect_overpass(config, overpass)
    if not args.skip_mcp:
        print("\n--- OSM MCP channel (tools) ---")
        collect_mcp(config)

    # Merge with previous runs so --skip-mcp / --skip-overpass do not erase the
    # other channel's steps from the record.
    merged = dict(previous)
    for entry in LOG:
        merged[entry["step"]] = entry
    steps = sorted(merged.values(), key=lambda e: (e["channel"], e["step"]))

    write_json(
        log_file,
        {
            "runAt": now_iso(),
            "durationSeconds": round(time.time() - started, 1),
            "configVersion": config.get("version"),
            "coreBbox": config["scope"]["coreBbox"],
            "steps": steps,
        },
    )
    failures = [entry for entry in LOG if entry["status"] != "ok"]
    print(f"\n{len(LOG) - len(failures)}/{len(LOG)} collection steps ok in {time.time() - started:.0f}s")
    print(f"log: {RAW / 'collection-log.json'}")
    return 0 if not failures else 1


if __name__ == "__main__":
    raise SystemExit(main())
