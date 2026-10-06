"""Sanity-check the projected debug data without a browser.

Verifies that the local-metre coordinates in world/debug-data.json land in the
range the config's core bbox implies, and prints a quick ASCII sketch of the
water/road/venue distribution so the area can be eyeballed in a terminal.

Run:  python scripts/verify_projection.py
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import WORLD, load_config, read_json  # noqa: E402


def main() -> int:
    config = load_config()
    data = read_json(WORLD / "debug-data.json")

    xs, zs = [], []
    for road in data["roads"]:
        for point in road["p"]:
            xs.append(point[0])
            zs.append(point[2])
    for venue in data["venues"]:
        xs.append(venue["x"])
        zs.append(venue["y"])

    min_x, max_x = min(xs), max(xs)
    min_z, max_z = min(zs), max(zs)
    bbox = config["scope"]["coreBbox"]

    print("projected extent (metres, origin = config.origin):")
    print(f"  x (east) : {min_x:9.1f} .. {max_x:9.1f}   ({(max_x - min_x) / 1000:.2f} km)")
    print(f"  z (south): {min_z:9.1f} .. {max_z:9.1f}   ({(max_z - min_z) / 1000:.2f} km)")
    print()
    print("expected from config bbox (lon 151.186..151.235, lat -33.8955..-33.845):")
    print("  roughly 4.4 km east-west and 5.6 km north-south around the origin")
    print()

    width, height = 78, 34
    cols = ["."] * (width * height)

    def put(col: int, row: int, char: str, priority: int):
        if 0 <= col < width and 0 <= row < height:
            index = row * width + col
            if cols[index] == "." or priority > 0:
                cols[index] = char

    def to_cell(x: float, z: float):
        col = int((x - min_x) / (max_x - min_x) * (width - 1))
        row = int((z - min_z) / (max_z - min_z) * (height - 1))
        return col, row

    for water in data["water"]:
        for ring in water.get("outer", []):
            for point in ring:
                put(*to_cell(point[0], point[2]), "~", 1)
    for park in data["parks"]:
        for ring in park.get("outer", []):
            for point in ring:
                put(*to_cell(point[0], point[2]), ",", 0)
    for road in data["roads"]:
        if road["c"] in ("local", "service", "pedestrian"):
            continue
        for point in road["p"]:
            put(*to_cell(point[0], point[2]), "-", 2)
    for venue in data["venues"]:
        put(*to_cell(venue["x"], venue["y"]), "*" if venue["nl"] else "o", 3)
    for stop in data["transit"]:
        put(*to_cell(stop["x"], stop["y"]), "+", 4)

    print("ASCII sketch (north is UP, ~ water, , park, - arterial, + transit, * nightlife, o venue):")
    for row in range(height - 1, -1, -1):
        print("  " + "".join(cols[row * width : (row + 1) * width]))
    print()
    print(f"  water polygons: {len(data['water'])}   parks: {len(data['parks'])}   "
          f"roads: {len(data['roads'])}   venues: {len(data['venues'])}   transit: {len(data['transit'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
