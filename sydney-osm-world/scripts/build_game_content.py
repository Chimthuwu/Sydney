"""Turn the world spec into the CONTENT the game draws around Sydney's roads.

Output:  src/sydney/cityData.js   (in the game repo) - pure data, no Three.js.
          src/sydney/content.js is the hand-written module that turns it into
          meshes, so the two must not share a name.

`build_game_roads.py` makes the roads drivable. This makes the city around them
look like Sydney: the harbour, the parks, the buildings and the district names.
Without it the game is Sydney's road network wearing Louisiana's pine trees and
bayou towns, which is worse than useless - it looks broken rather than unfinished.

What goes in, and why each thing is here:

  water      Port Jackson and the rivers. Without it the harbour is grass, and a
             city with a grass harbour is not Sydney.
  parks      Royal Botanic Garden, Hyde Park, Centennial Park. The green between
             the buildings is most of what makes a city read as a city.
  buildings  972 real footprints from the CBD sample, extruded from their OSM
             `levels`. A street with no buildings on it is a road in a field.
  districts  the 19 real names (CBD, The Rocks, Surry Hills...), which is what
             the HUD should say.
  landmarks  named bridges and tunnels, for the same reason.

Everything is simplified before it is written. Port Jackson's ring is 15,075
points; at one triangle per segment that is 15k triangles for one body of water,
and the whole point of this is that the city costs a couple of draw calls.
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import WORLDDATA, now_iso  # noqa: E402

GAME_ROOT = Path(__file__).resolve().parent.parent.parent
OUT_DIR = GAME_ROOT / "src" / "sydney"

MAP_HALF = 1200.0

# Simplification tolerances, in metres. These are the same reasoning as the
# viewer's, at a distance the player actually drives at: the harbour's shape has
# to survive, a 4 m wiggle in a park edge does not.
WATER_TOLERANCE = 4.0
PARK_TOLERANCE = 3.0
FOOTPRINT_TOLERANCE = 1.0

# Metres per storey, when OSM gives `levels` but no `height`. Sydney's CBD is
# Victorian-to-modern and `levels` is the better number: 23 levels of levels
# means a 70 m tower, which is about right for Pitt Street.
METRES_PER_LEVEL = 3.2

# Bounds on an extruded height. OSM `levels` is a tag and tags are optimistic;
# a 60-level reading is a data error, and a 400 m box in the middle of the CBD
# is a thing the player can see from a kilometre away.
MIN_HEIGHT = 6.0
MAX_HEIGHT = 130.0


def simplify(points, tolerance):
    """Douglas-Peucker, iterative so a 15k-point ring cannot blow the stack."""
    if len(points) < 3:
        return points
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        first, last = stack.pop()
        if last <= first + 1:
            continue
        ax, az = points[first]
        bx, bz = points[last]
        dx, dz = bx - ax, bz - az
        length_sq = dx * dx + dz * dz
        best = -1.0
        index = -1
        for i in range(first + 1, last):
            px, pz = points[i]
            t = ((px - ax) * dx + (pz - az) * dz) / length_sq if length_sq else 0.0
            t = 0.0 if t < 0 else 1.0 if t > 1 else t
            dist = math.hypot(px - (ax + t * dx), pz - (az + t * dz))
            if dist > best:
                best, index = dist, i
        if best > tolerance and index > 0:
            keep[index] = True
            stack.append((first, index))
            stack.append((index, last))
    return [p for p, k in zip(points, keep) if k]


def ring_to_xy(ring):
    """world-spec rings are [x, 0, z]; the game wants [[x, z], ...]."""
    return [[p[0], p[2]] for p in ring]


def area_of(ring):
    total = 0.0
    for i in range(len(ring)):
        x1, z1 = ring[i]
        x2, z2 = ring[(i + 1) % len(ring)]
        total += x1 * z2 - x2 * z1
    return abs(total) / 2.0


def inside_map(ring):
    return all(abs(x) <= MAP_HALF and abs(z) <= MAP_HALF for x, z in ring)


def clip_to_map(ring, half=MAP_HALF):
    """Sutherland-Hodgman: clip a polygon to the map square.

    This is not an optimisation, it is the whole ball game for the harbour.
    Port Jackson is one polygon 15,075 points long that covers most of the map
    and runs off every edge of it, so a test like `all points inside?` throws the
    entire harbour away - which is exactly what happened, leaving Sydney with 62
    ponds and no harbour. Clipping keeps the part that is on the map, which is
    the part the player can see.

    The clip region is convex (a square), which is the case Sutherland-Hodgman is
    correct for. Holes are not handled and are not needed: the water data is
    outer rings.
    """
    def clip_edge(poly, normal, limit):
        """Keep the part of `poly` on the inside of one half-plane."""
        if not poly:
            return []
        out = []
        nx, ny = normal
        for i in range(len(poly)):
            cur = poly[i]
            prv = poly[i - 1]
            d_cur = cur[0] * nx + cur[1] * ny - limit
            d_prv = prv[0] * nx + prv[1] * ny - limit
            if d_cur <= 0:
                if d_prv > 0:
                    out.append(cross(prv, cur, d_prv, d_cur))
                out.append(cur)
            elif d_prv <= 0:
                out.append(cross(prv, cur, d_prv, d_cur))
        return out

    def cross(a, b, da, db):
        """Where segment a->b crosses the plane, given the two signed distances."""
        t = da / (da - db) if da != db else 0.0
        return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]

    # four half-planes: x <= half, -x <= half, z <= half, -z <= half
    for normal, limit in (((1, 0), half), ((-1, 0), half), ((0, 1), half), ((0, -1), half)):
        ring = clip_edge(ring, normal, limit)
        if not ring:
            return []
    return ring


def ring_area(ring):
    total = 0.0
    for i in range(len(ring)):
        x1, z1 = ring[i]
        x2, z2 = ring[(i + 1) % len(ring)]
        total += x1 * z2 - x2 * z1
    return abs(total) / 2.0


def main() -> int:
    spec = json.loads((WORLDDATA / "world-spec.json").read_text(encoding="utf-8"))

    # ---- water -------------------------------------------------------------
    water = []
    dropped_water = 0
    for item in spec["water"]["geometry"]["items"]:
        rings = []
        for ring in item.get("rings", []):
            ring = clip_to_map(ring_to_xy(ring))
            if len(ring) < 3:
                continue
            simplified = simplify(ring, WATER_TOLERANCE)
            if len(simplified) >= 3 and ring_area(simplified) > 400:
                rings.append([[round(x, 1), round(z, 1)] for x, z in simplified])
        if not rings:
            dropped_water += 1
            continue
        # Beaches are sand, not water: they are drawn as part of the land, at the
        # water's edge. Putting them at water level makes the harbour's edge a
        # hard line and loses the one place the city touches the sea properly.
        water.append({
            "name": item.get("name") or "Water",
            "kind": item.get("kind"),
            "beach": item.get("kind") == "beach",
            "rings": rings,
        })

    # ---- parks -------------------------------------------------------------
    parks = []
    for item in spec["nature"]["geometry"]["items"]:
        rings = []
        for ring in item.get("rings", []):
            ring = clip_to_map(ring_to_xy(ring))
            if len(ring) < 3:
                continue
            simplified = simplify(ring, PARK_TOLERANCE)
            if len(simplified) >= 3 and ring_area(simplified) > 200:
                rings.append([[round(x, 1), round(z, 1)] for x, z in simplified])
        if rings:
            parks.append({
                "name": item.get("name") or "Park",
                "kind": item.get("kind"),
                "rings": rings,
            })

    # ---- buildings ---------------------------------------------------------
    # `buildings.sample` is a SAMPLE of the CBD, not the whole city - OSM has
    # 972 footprints in the sample bbox. They are the tallest and densest part
    # of Sydney, which is exactly where a player spawns, so they carry the
    # skyline. `sampleOnly` is on the object in the spec and is not lost here.
    buildings = []
    named_buildings = 0
    for item in spec["buildings"]["sample"]["items"]:
        footprint = clip_to_map(ring_to_xy(item.get("footprint") or []))
        if len(footprint) < 3:
            continue
        footprint = simplify(footprint, FOOTPRINT_TOLERANCE)
        if len(footprint) < 3:
            continue
        levels = item.get("levels")
        height = item.get("heightM")
        if not height and levels:
            height = float(levels) * METRES_PER_LEVEL
        if not height:
            # No height data at all. A one-storey box is a shed; a 20 m guess is
            # a tower in a street that has none. Shed is the honest read.
            height = MIN_HEIGHT
        height = max(MIN_HEIGHT, min(MAX_HEIGHT, float(height)))
        if item.get("name"):
            named_buildings += 1
        buildings.append({
            "name": item.get("name"),
            "h": round(height, 1),
            "fp": [[round(x, 1), round(z, 1)] for x, z in footprint],
        })

    # ---- districts ---------------------------------------------------------
    # The HUD says where you are. In Sydney it should say "Surry Hills", not
    # "Shinston", and that is these 19 names and their centres.
    districts = []
    for d in spec["districts"]:
        local = d.get("local") or {}
        if "x" not in local:
            continue
        districts.append({
            "id": d["id"],
            "name": d["realName"],
            "x": round(local["x"], 1),
            "z": round(local["z"], 1),
        })

    # ---- landmarks ---------------------------------------------------------
    landmarks = []
    for group in ("bridges", "tunnels", "crossings"):
        for item in spec["landmarks"].get(group, []):
            local = item.get("local") or {}
            name = item.get("name")
            if not name or "x" not in local:
                continue
            landmarks.append({
                "name": name,
                "kind": item.get("kind") or group,
                "x": round(local["x"], 1),
                "z": round(local["z"], 1),
            })

    # ---- write -------------------------------------------------------------
    def js(items):
        return json.dumps(items, separators=(",", ":"))

    total_water_pts = sum(len(r) for w in water for r in w["rings"])
    total_park_pts = sum(len(r) for p in parks for r in p["rings"])
    total_fp_pts = sum(len(b["fp"]) for b in buildings)

    module = f"""// GENERATED FILE - do not edit. Source: sydney-osm-world/scripts/build_game_content.py
//
// Sydney's HARBOUR, PARKS, BUILDINGS and DISTRICT NAMES - the city around the
// roads. Roads alone are a map; this is what makes it a place.
//
// generatedAt: {now_iso()}
// {len(water)} water bodies ({total_water_pts} pts) | {len(parks)} parks ({total_park_pts} pts)
// {len(buildings)} building footprints ({total_fp_pts} pts, {named_buildings} named)
// {len(districts)} districts | {len(landmarks)} named landmarks
//
// Coordinates are the game's own convention, already (world-spec's projection
// matches world.js: north = -Z, east = +X, metres). Rings are [x, z] pairs.
//
// Buildings are a SAMPLE: OSM has 972 footprints in the CBD bbox, which is the
// densest and tallest part of the city and exactly where the player spawns. They
// carry the skyline, not the whole city.

/** The harbour, the rivers, the beaches. Rings are outlines, not triangles. */
export const SYDNEY_WATER = {js(water)};

/** Royal Botanic Garden, Hyde Park, Centennial Park and 67 more. */
export const SYDNEY_PARKS = {js(parks)};

/** Real OSM footprints with a height from `levels`. */
export const SYDNEY_BUILDINGS = {js(buildings)};

/** The 19 real Sydney neighbourhoods, for the HUD. */
export const SYDNEY_DISTRICTS = {js(districts)};

/** Named bridges, tunnels and crossings, for the map. */
export const SYDNEY_LANDMARKS = {js(landmarks)};

export const SYDNEY_CONTENT_STATS = {json.dumps({
    "water": len(water), "waterPoints": total_water_pts, "waterDroppedOutsideMap": dropped_water,
    "parks": len(parks), "parkPoints": total_park_pts,
    "buildings": len(buildings), "buildingPoints": total_fp_pts, "namedBuildings": named_buildings,
    "districts": len(districts), "landmarks": len(landmarks),
})};
"""
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / "cityData.js"
    out.write_text(module, encoding="utf-8")
    size_kb = len(module) / 1024
    print(f"water:  {len(water)} bodies, {total_water_pts} points ({dropped_water} outside the map)")
    print(f"parks:  {len(parks)}, {total_park_pts} points")
    print(f"buildings: {len(buildings)} footprints, {total_fp_pts} points, {named_buildings} named")
    print(f"districts: {len(districts)}   landmarks: {len(landmarks)}")
    print(f"\nwritten: {out} ({size_kb:.0f} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
