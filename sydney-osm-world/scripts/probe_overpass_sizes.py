"""Size every configured Overpass layer before collecting it.

Run:  python scripts/probe_overpass_sizes.py
Writes data/raw/probe-overpass-sizes.json so the collection scope is auditable.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import (  # noqa: E402
    RAW,
    OverpassClient,
    bbox_from,
    build_query,
    build_selector,
    ensure_dirs,
    load_config,
    now_iso,
    resolve_bbox,
    write_json,
)


def count_query(op: OverpassClient, label: str, selectors: list[str], timeout: int = 90) -> dict:
    ql = build_query(selectors, timeout=timeout, out="count")
    try:
        return {"label": label, "query": ql, "count": op.count(ql, label)}
    except Exception as exc:  # surfaced, never hidden
        return {"label": label, "query": ql, "error": str(exc)}


def main() -> int:
    ensure_dirs()
    config = load_config()
    overpass = OverpassClient(min_interval=config["rateLimit"]["overpassMinIntervalSeconds"])
    layers = config["layers"]
    core = resolve_bbox(config, "coreBbox")
    probes: list[dict] = []

    roads = layers["roads"]
    probes.append(
        count_query(
            overpass,
            "roads/backbone",
            [build_selector("way", [{"highway": roads["backbone"]["highway"]}], core)],
        )
    )
    for tile_id in roads["grid"]["tiles"]:
        probes.append(
            count_query(
                overpass,
                f"roads/grid/{tile_id}",
                [
                    build_selector(
                        "way",
                        [{"highway": roads["grid"]["highway"]}],
                        resolve_bbox(config, tile_id),
                    )
                ],
            )
        )

    sample = bbox_from(config["scope"]["buildingSampleBbox"])
    probes.append(count_query(overpass, "buildings/sample", [build_selector("way", [{"building": "*"}], sample)]))

    water = layers["water"]
    probes.append(
        count_query(
            overpass,
            "water/polygons",
            [build_selector("way", water["polygon"], core), build_selector("relation", water["polygon"], core)],
        )
    )
    probes.append(
        count_query(overpass, "water/lines", [build_selector("way", water["line"], core)])
    )
    probes.append(
        count_query(
            overpass,
            "water/beaches",
            [build_selector("way", water["beach"], core), build_selector("node", water["beach"], core)],
        )
    )

    parks = layers["parks"]
    probes.append(
        count_query(
            overpass,
            "parks/areas",
            [build_selector("way", parks["polygon"], core), build_selector("relation", parks["polygon"], core)],
        )
    )

    transit = layers["transit"]
    probes.append(count_query(overpass, "transit/nodes", [build_selector("node", transit["node"], core)]))
    probes.append(count_query(overpass, "transit/ways", [build_selector("way", transit["way"], core)]))

    landmarks = layers["landmarks"]
    probes.append(
        count_query(
            overpass,
            "landmarks/ways",
            [build_selector("way", landmarks["way"], core, named_only=landmarks.get("namedOnly", False))],
        )
    )
    probes.append(
        count_query(
            overpass,
            "landmarks/nodes",
            [build_selector("node", landmarks["node"], core, named_only=landmarks.get("namedOnly", False))],
        )
    )

    venues = layers["venues"]
    probes.append(
        count_query(
            overpass,
            "venues/amenity",
            [
                build_selector("node", [{"amenity": venues["amenity"]}], core),
                build_selector("way", [{"amenity": venues["amenity"]}], core),
            ],
        )
    )
    probes.append(
        count_query(
            overpass,
            "venues/shop",
            [
                build_selector("node", [{"shop": "*"}], core),
                build_selector("way", [{"shop": "*"}], core),
            ],
        )
    )
    probes.append(
        count_query(
            overpass,
            "venues/tourism+leisure",
            [
                build_selector("node", [{"tourism": venues["tourism"]}, {"leisure": venues["leisure"]}], core),
                build_selector("way", [{"tourism": venues["tourism"]}, {"leisure": venues["leisure"]}], core),
            ],
        )
    )

    report = {
        "collectedAt": now_iso(),
        "coreBbox": core.as_dict(),
        "buildingSampleBbox": config["scope"]["buildingSampleBbox"],
        "probes": probes,
        "overpassCalls": overpass.call_log,
    }
    write_json(RAW / "probe-overpass-sizes.json", report)

    for probe in probes:
        if "error" in probe:
            print(f"{probe['label']:<28} ERROR {probe['error'][:120]}")
        else:
            total = probe["count"].get("total", 0)
            nodes = probe["count"].get("nodes", 0)
            ways = probe["count"].get("ways", 0)
            rels = probe["count"].get("relations", 0)
            print(f"{probe['label']:<28} total={total:<8} nodes={nodes:<7} ways={ways:<7} relations={rels}")
    print(f"\nwritten: {RAW / 'probe-overpass-sizes.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
