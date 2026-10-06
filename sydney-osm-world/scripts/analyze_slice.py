"""Does the 2400 m slice have a usable, connected road network?

Run this BEFORE generating any game code. If the largest connected component
is a tiny island, the traffic system would spawn cars on dead fragments and the
whole idea needs a different approach.

    python scripts/analyze_slice.py
"""

from __future__ import annotations

import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import (  # noqa: E402
    NORMALIZED,
    RAW,
    WORLD,
    ensure_dirs,
    load_config,
    now_iso,
    read_json,
    write_json,
)
from roadgraph import RoadGraph  # noqa: E402

# The game map is STATE_BOUNDS = ±1200 m (stateWorld.js:33).
MAP_HALF = 1200.0

DRIVABLE_CATEGORIES = {
    "freeway", "arterial_major", "arterial", "collector", "local", "service",
    "arterial_link", "collector_link", "arterial_major_link", "freeway_link",
    "pedestrian",
}


def main() -> int:
    ensure_dirs()
    config = load_config()
    roads = read_json(NORMALIZED / "roads.json")["payload"]["roads"]

    inside = []
    for road in roads:
        if road["category"] not in DRIVABLE_CATEGORIES:
            continue
        points = road["geometryLocal"]
        if not points:
            continue
        # keep a way if any vertex is inside the map square
        if any(abs(p[0]) <= MAP_HALF and abs(p[2]) <= MAP_HALF for p in points):
            inside.append(road)

    print(f"roads in slice: {len(inside)} of {len(roads)}")
    print(f"  by category: {dict(Counter(r['category'] for r in inside).most_common())}")
    named = sum(1 for r in inside if r["name"])
    print(f"  named: {named}   with lanes: {sum(1 for r in inside if r['lanes'])}")
    print(f"  bridge ways: {sum(1 for r in inside if r['bridge'])}   tunnel ways: {sum(1 for r in inside if r['tunnel'])}")
    print(f"  total length in slice: {sum(r['lengthM'] for r in inside) / 1000:.1f} km")

    for resolution in (0.3, 0.6, 1.2, 2.0):
        graph = RoadGraph(resolution=resolution)
        for road in inside:
            graph.add_way(road)
        info = graph.describe()
        print(
            f"\nsnap {resolution:>4} m: nodes {info['nodes']:>6}  edges {info['edges']:>6}  "
            f"components {info['components']:>5}  largest {info['largestComponentNodes']:>6} "
            f"({info['largestComponentShare'] * 100:.1f}% of nodes)"
        )
        print(f"          component sizes: {info['componentSizes'][:8]}")

    # Pick a resolution: enough joining to connect the network, without merging
    # parallel streets that are genuinely separate.
    best = None
    for resolution in (0.3, 0.6, 1.2, 2.0):
        graph = RoadGraph(resolution=resolution)
        for road in inside:
            graph.add_way(road)
        info = graph.describe()
        if best is None or info["largestComponentShare"] > best[1]["largestComponentShare"]:
            best = (resolution, info, graph)
    resolution, info, graph = best
    print(f"\nchosen snap resolution: {resolution} m ({info['largestComponentShare'] * 100:.1f}% connected)")

    # How much road length survives if we only keep the largest component?
    components = graph.components()
    components.sort(key=len, reverse=True)
    main_nodes = components[0] if components else set()
    kept_length = 0.0
    kept_ways = 0
    for way_index, way in enumerate(graph.ways):
        points = [(p[0], p[2]) for p in way["geometryLocal"]]
        from roadgraph import snap_key
        nodes = [snap_key(x, z, resolution) for x, z in points]
        if all(n in main_nodes for n in nodes):
            kept_length += way["lengthM"]
            kept_ways += 1
    print(f"largest component holds {kept_ways} ways / {kept_length / 1000:.1f} km of the {len(inside)} ways / {sum(r['lengthM'] for r in inside) / 1000:.1f} km")

    report = {
        "generatedAt": now_iso(),
        "mapHalfMetres": MAP_HALF,
        "roadsInSlice": len(inside),
        "byCategory": dict(Counter(r["category"] for r in inside).most_common()),
        "lengthKm": round(sum(r["lengthM"] for r in inside) / 1000, 2),
        "chosenResolution": resolution,
        "graph": info,
        "largestComponentWays": kept_ways,
        "largestComponentKm": round(kept_length / 1000, 2),
    }
    write_json(RAW / "slice-road-analysis.json", report)
    print(f"\nwritten: {RAW / 'slice-road-analysis.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
