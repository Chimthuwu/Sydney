"""Turn the normalised OSM roads into a drivable network for the game.

Output:  src/sydney/roads.js   (in the game repo)

What the game needs (traffic.js):

    makeRoadway({ name, points: [[x, z], ...], lanes, median, cruise, ys })

  - `points` is a CENTRELINE in 2D, in the game's own axis convention.
  - Our projection already is that convention (NORTH = -Z, EAST = +X, metres),
    so there is no coordinate conversion here. That is deliberate and is why
    this file contains no transform maths.

What the game does NOT do by itself: makeRoadway pairs each road's forward
lane with its own backward lane, which is correct for Louisiana's one long
highway and wrong for a city. So this script also emits `links`, and
`wire_sydney_roads.js` rewires the lanes across junctions so a car can leave
one street and continue down the next.

Nothing here is invented: names, lane counts, speed limits, bridges and
tunnels are OSM tags, and missing ones are left at the game's defaults.
"""

from __future__ import annotations

import json
import math
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import (  # noqa: E402
    NORMALIZED,
    ensure_dirs,
    load_config,
    now_iso,
    read_json,
    write_json,
)
from roadgraph import RoadGraph, snap_key  # noqa: E402

GAME_ROOT = Path(__file__).resolve().parent.parent.parent
OUT_DIR = GAME_ROOT / "src" / "sydney"

# stateWorld.js:33 - the map is a 2400 m square.
MAP_HALF = 1200.0
SNAP = 0.6

DRIVABLE = {
    "freeway", "arterial_major", "arterial", "collector", "local", "service",
    "arterial_link", "collector_link", "arterial_major_link", "freeway_link",
    "pedestrian",
}

# Speeds in m/s, used only where OSM has no maxspeed tag. Keyed by category.
FALLBACK_CRUISE = {
    "freeway": [25, 31],
    "arterial_major": [19, 25],
    "arterial": [13, 19],
    "collector": [11, 16],
    "local": [8, 13],
    "pedestrian": [4, 7],
    "service": [6, 10],
}

# Metres per lane. Matches traffic.js LANE_WIDTH, so the lanes the game builds
# sit inside the tarmac this table sizes.
LANE_WIDTH = 3.4

# Half-width of the paved carriageway, in metres, per category. This is the
# strip of tarmac the game draws and the player drives on, and it is WIDER than
# the lanes traffic uses: kerbs, parking, shoulders. A real kerbed street is
# ~10 m kerb to kerb even where it carries one lane each way.
FALLBACK_HALF = {
    "freeway": 9.0,
    "arterial_major": 11.0,
    "arterial": 9.0,
    "arterial_link": 7.0,
    "collector": 8.0,
    "collector_link": 6.0,
    "local": 6.0,
    "service": 4.5,
    "pedestrian": 4.0,
    "freeway_link": 6.0,
}

# Which runs get AMBIENT TRAFFIC. A city grid is not one highway: a car on a
# back-lane or in a pedestrianised mall is wrong, and every lane added costs a
# lane in traffic.js's O(n^2) crossing search. So traffic rides the roads that
# actually carry traffic, and the tarmac is drawn for all of them.
TRAFFIC_CATEGORIES = {
    "freeway", "arterial_major", "arterial", "arterial_link",
    "collector", "collector_link", "freeway_link",
    # `local` is in because OSM is inconsistent about it, not because back
    # streets are busy: the same street is tagged `arterial` through the CBD and
    # `local` or `service` a block later, so excluding `local` cut the traffic
    # network into 94 islands - a car could drive down King Street and stop dead
    # where the tagging changed, mid-block, with the road visibly continuing.
    # `service` stays out: that is genuinely driveways and car parks.
    "local",
}

# Runs shorter than this get tarmac but no traffic: too short for a car to be
# anything but a bollard, and makeLane()'s dead-end bulb needs 12 m of lane.
MIN_TRAFFIC_LENGTH = 30.0

# A shorter floor for the pieces a run is CUT INTO at junctions. Cutting a run at
# every crossing is what makes every junction a real end both roads can hand a car
# across, but it also produces short pieces - the 20 m between two crossings of a
# tightly packed CBD block, say. Applying the 30 m floor to those threw away the
# link between the two junctions and severed the network, taking it from 142
# connected pieces to 244. A piece this short is still a real link, and the game
# keeps anything over 12 m.
MIN_CUT_LENGTH = 12.0


def clip_to_map(points, half=MAP_HALF):
    """Cut a polyline to the map square so nothing floats off the ground plane."""
    out = []
    current = []
    for x, z in points:
        inside = abs(x) <= half and abs(z) <= half
        if inside:
            if not current and points:
                previous = points[points.index((x, z)) - 1] if points.index((x, z)) > 0 else None
                if previous is not None:
                    edge = _clip_segment(previous, (x, z), half)
                    if edge:
                        current.append(edge[0])
            current.append((x, z))
        else:
            if current:
                out.append(current)
            current = []
    if current:
        out.append(current)
    return [piece for piece in out if len(piece) >= 2]


def _clip_segment(p, q, half):
    """Liang-Barsky: return the part of segment p->q inside the square."""
    x0, z0 = p
    x1, z1 = q
    dx, dz = x1 - x0, z1 - z0
    t0, t1 = 0.0, 1.0
    for p_coord, d in ((-dx, x0 + half), (dx, half - x0), (-dz, z0 + half), (dz, half - z0)):
        if d == 0:
            if p_coord < 0:
                return None
            continue
        t = p_coord / d
        if d < 0:
            if t > t1:
                return None
            t0 = max(t0, t)
        else:
            if t < t0:
                return None
            t1 = min(t1, t)
    if t0 > t1:
        return None
    return ((x0 + t0 * dx, z0 + t0 * dz), (x0 + t1 * dx, z0 + t1 * dz))


def main() -> int:
    ensure_dirs()
    config = load_config()
    roads = read_json(NORMALIZED / "roads.json")["payload"]["roads"]

    inside = []
    for road in roads:
        if road["category"] not in DRIVABLE:
            continue
        points = [(p[0], p[2]) for p in road["geometryLocal"]]
        if len(points) < 2:
            continue
        if sum(1 for x, z in points if abs(x) <= MAP_HALF and abs(z) <= MAP_HALF) < 2:
            continue
        inside.append({"points": points, "road": road})

    print(f"candidate ways in the {int(MAP_HALF * 2)} m slice: {len(inside)}")

    # ---- graph, and keep only the largest connected component
    graph = RoadGraph(resolution=SNAP)
    for item in inside:
        graph.add_way({"geometryLocal": [[x, 0, z] for x, z in item["points"]]})
    components = graph.components()
    components.sort(key=len, reverse=True)
    main_nodes = components[0] if components else set()
    print(f"nodes {len(graph.node_xy)}, components {len(components)}, largest {len(main_nodes)}")

    usable = []
    for item in inside:
        nodes = [snap_key(x, z, SNAP) for x, z in item["points"]]
        if all(n in main_nodes for n in nodes):
            usable.append(item)
    dropped = len(inside) - len(usable)
    print(f"ways on the main network: {len(usable)}  (dropped {dropped} disconnected fragments)")

    # ---- decompose into junction-to-junction runs
    # A run continues through a node only when exactly two way-ends meet there
    # (a straight continuation). Three or more ends is a junction, so the run
    # stops there and the junction becomes a link between runs.
    ends_at: dict[tuple, list[tuple[int, int]]] = defaultdict(list)
    way_nodes: list[list[tuple]] = []
    for index, item in enumerate(usable):
        nodes = [snap_key(x, z, SNAP) for x, z in item["points"]]
        way_nodes.append(nodes)
        ends_at[nodes[0]].append((index, 0))
        ends_at[nodes[-1]].append((index, 1))

    used = [False] * len(usable)
    runs = []

    def entry_node(index, at_end):
        """The snapped node a walk would ARRIVE at if it entered this way here."""
        n = way_nodes[index]
        return n[-1] if at_end else n[0]

    def walk(start_index, start_at_end, seen):
        """Follow ways from one end of `start_index` as far as they go straight.

        `seen` is the set of snapped nodes this run already occupies. It is the
        whole reason a run cannot fold: a way is only entered if the node it
        would arrive at is unvisited. Without it the two walks below (one from
        each end of the same way) both march off down the same neighbours, and
        the run drives out and straight back again - which is what 153 of the
        runs used to do, Phillip Street among them.
        """
        node_path = []
        point_path = []
        way_ids = []
        index, at_end = start_index, start_at_end
        while True:
            points = usable[index]["points"]
            ordered = list(reversed(points)) if at_end else list(points)
            nodes = list(reversed(way_nodes[index])) if at_end else list(way_nodes[index])
            if not node_path:
                node_path.append(nodes[0])
                point_path.append(ordered[0])
            node_path.extend(nodes[1:])
            point_path.extend(ordered[1:])
            way_ids.append(index)
            used[index] = True
            seen.update(nodes)
            tip = node_path[-1]
            if tip == node_path[-2]:
                break                                  # the way loops back on itself
            touching = ends_at.get(tip, [])
            if len(touching) != 2:
                break                                  # dead end (1) or a junction (3+)
            # continue through the other way that meets here
            nxt = [entry for entry in touching if entry[0] != index and not used[entry[0]]]
            nxt = [entry for entry in nxt if entry_node(entry[0], entry[1] == 0) not in seen]
            if not nxt:
                break
            index, at_end = nxt[0][0], nxt[0][1] == 0
        return node_path, point_path, way_ids

    for index in range(len(usable)):
        if used[index]:
            continue
        # The back walk runs first and SEEDS the forward walk with the nodes it
        # covered, so the two halves grow in opposite directions and meet at
        # most at the start way rather than overlapping.
        seen = set()
        back_nodes, back_points, back_ways = walk(index, True, seen)
        fwd_nodes, fwd_points, fwd_ways = walk(index, False, seen)
        # back walks end-node -> outward-past-start; fwd walks start-node ->
        # outward-past-end. reversed(back) therefore already contains the start
        # way's own points, so the forward walk contributes only its tail.
        own = len(way_nodes[index])
        node_path = list(reversed(back_nodes)) + fwd_nodes[own:]
        point_path = list(reversed(back_points)) + fwd_points[own:]
        if len(point_path) >= 2:
            runs.append(
                {
                    "nodes": node_path,
                    "points": point_path,
                    "ways": list(reversed(back_ways)) + fwd_ways,
                }
            )

    # ---- split any run that is not a SIMPLE path
    # A run must not visit the same snapped node twice. The two walks above can
    # still hand back a path that doubles back - a one-way pair, a way that loops
    # through a neighbour and returns, or a `used[]` race between the halves -
    # and the symptom is a road that drives away from the player, U-turns 200 m
    # later and drives back past them, which reads as a broken world rather than
    # a looping street. Rather than keep chasing each cause, enforce the
    # invariant: cut the path at every repeat, and each piece is a simple path by
    # construction. The cut node is a real place on the road, so the pieces meet
    # there and the junction table wires them back together.
    #
    # The next piece starts at the REPEAT, not at the earlier occurrence: the
    # stretch between them is the closing loop, and it belongs to the piece that
    # closes. Starting at the earlier one emitted that loop twice and inflated
    # the network's total length by 47 km.
    def split_simple(run):
        seen_at = {}
        pieces = []
        start = 0
        for position, node in enumerate(run["nodes"]):
            if node in seen_at:
                pieces.append((start, position))
                start = position
            seen_at[node] = position
        pieces.append((start, len(run["nodes"]) - 1))
        return pieces

    split_runs = []
    folded = 0
    for run in runs:
        pieces = split_simple(run)
        if len(pieces) > 1:
            folded += 1
        for lo, hi in pieces:
            if hi - lo >= 1:
                split_runs.append(
                    {
                        "nodes": run["nodes"][lo : hi + 1],
                        "points": run["points"][lo : hi + 1],
                        # A run's tag set is its whole extent, so every piece
                        # keeps it: the pieces of a folded road are still the
                        # same street.
                        "ways": run["ways"],
                    }
                )
    if folded:
        print(f"  runs that doubled back, split at the repeat: {folded} -> {len(split_runs)} pieces")
    runs = split_runs

    # Rounding to 0.1 m can collapse a segment to nothing, and a zero-length
    # segment divides by zero in sampleLane() and reads as a crossing in
    # laneCrossings(). Drop them here, once, on the rounded values that are
    # actually written out.
    def dedupe(points):
        out = []
        for p in points:
            if not out or abs(p[0] - out[-1][0]) >= 0.1 or abs(p[1] - out[-1][1]) >= 0.1:
                out.append(p)
        return out

    for run in runs:
        run["points"] = dedupe(run["points"])
    before = len(runs)
    runs = [r for r in runs if len(r["points"]) >= 2]
    print(f"  runs dropped for having no length after rounding: {before - len(runs)}")

    consumed = len({w for r in runs for w in r["ways"]})
    print(f"runs after joining: {len(runs)}")
    print(f"  ways consumed: {consumed} of {len(usable)}")
    print(f"  run length: median {sorted(len(r['points']) for r in runs)[len(runs) // 2]} points")

    # ---- per-run attributes (only from OSM tags)
    def dominant(values):
        values = [v for v in values if v]
        if not values:
            return None
        return Counter(values).most_common(1)[0][0]

    records = []
    junctions = []
    for run in runs:
        way_indices = sorted(set(run["ways"]))
        roads_in = [usable[i]["road"] for i in way_indices]
        name = dominant([r["name"] for r in roads_in])
        category = dominant([r["category"] for r in roads_in])
        maxspeed = dominant([r["maxspeedKmh"] for r in roads_in])
        oneway = dominant([r["oneway"] for r in roads_in])
        osm_lanes = dominant([r["lanes"] for r in roads_in])
        bridge = any(r["bridge"] for r in roads_in)
        tunnel = any(r["tunnel"] for r in roads_in)

        pieces = clip_to_map(run["points"])
        if not pieces:
            continue

        # The game wants lanes PER DIRECTION. OSM `lanes` counts both ways.
        if osm_lanes:
            lanes = max(1, int(round(osm_lanes / 2))) if oneway is not True else max(1, int(osm_lanes))
        else:
            lanes = 1
        cruise = (
            [max(4.0, maxspeed / 3.6 * 0.8), max(5.0, maxspeed / 3.6)]
            if maxspeed
            else FALLBACK_CRUISE.get(category, [9, 14])
        )

        for piece in pieces:
            index = len(records)
            piece_km = sum(
                math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(piece, piece[1:])
            ) / 1000.0
            # The paved half-width: at least the lanes traffic will use, and the
            # category's kerb-to-kerb width when that is wider. Never less than
            # half a lane, or the tarmac would be narrower than the car on it.
            by_lanes = (1.2 if lanes > 1 else 0) / 2 + lanes * LANE_WIDTH
            half = max(3.0, min(FALLBACK_HALF.get(category, 6.0), by_lanes))
            records.append(
                {
                    "name": name or "Unnamed",
                    "points": [[round(x, 1), round(z, 1)] for x, z in piece],
                    "lanes": lanes,
                    "median": 1.2 if lanes > 1 else 0,
                    "half": round(half, 1),
                    "cruise": [round(cruise[0], 1), round(cruise[1], 1)],
                    "category": category,
                    "bridge": bridge,
                    "tunnel": tunnel,
                    "oneway": oneway is True,
                    "named": bool(name),
                    "osmLanes": osm_lanes,
                    "maxspeedKmh": maxspeed,
                    # Does this run carry ambient traffic? A car on a back-lane
                    # is wrong, and the lane is not free.
                    "traffic": (
                        category in TRAFFIC_CATEGORIES
                        and piece_km * 1000 >= MIN_TRAFFIC_LENGTH
                        # A tunnel bore with no height profile in the game would
                        # put cars on a flat road where the world is solid hill.
                        and not tunnel
                    ),
                }
            )

    # ---- junction table
    # ---- cut every run at every crossing, THEN build the junction table
    #
    # A run is the stretch between two junctions. The first pass only cut runs at
    # OSM NODES where three or more ways met, which left plenty of real
    # intersections sitting in the MIDDLE of a run - a crossing road that was
    # never a tagged node. The junction table could still describe those (end 2,
    # "passes through"), but the game cannot use them: handing a car from a lane
    # that ends mid-run to the far end of the next run teleported it 64 m sideways
    # and forwards, once per junction. A traffic car visibly jumped the street.
    #
    # So crossings are found FIRST, geometrically, and used to cut the runs; only
    # then is the junction table built, and by then every junction is a genuine
    # end of both runs, which is the only case the game can drive.
    #
    # The crossing test used to key on OSM node identity: two roads were joined
    # only if they carried the same node id. That is wrong for this data, and
    # badly so. OSM only guarantees a shared node where a mapper tagged one;
    # plenty of Sydney intersections are two centrelines that cross in space with
    # no node in common, and plenty more have a node 8 m off the other road's line
    # because the junction was mapped by its kerb. Keying on identity left the
    # traffic runs in 196 disconnected pieces whose largest was 1.5 km: a car
    # could not drive from George Street to the Harbour Bridge, because no two of
    # the streets between them were considered to meet.
    JOIN_TOLERANCE_M = 9.0

    def seg_crossing(p1, p2, q1, q2, tol):
        """Where segments p1p2 and q1q2 cross, as (t along p, u along q, gap).

        `gap` is how far they miss each other, which is 0 for a true crossing.
        Returns (None, None, None) when they are further apart than `tol`. That
        tolerance is what catches an endpoint stopping a few metres short of the
        road it meets - a kerb, a slip lane, a mapped-but-unconnected node.
        """
        px, pz = p1
        dx, dz = p2[0] - p1[0], p2[1] - p1[1]
        qx, qz = q1
        ex, ez = q2[0] - q1[0], q2[1] - q1[1]
        den = dx * ez - dz * ex
        seg_p = math.hypot(dx, dz) or 1e-9
        seg_q = math.hypot(ex, ez) or 1e-9
        rx, rz = qx - px, qz - pz
        if abs(den) > 1e-9:
            t = (rx * ez - rz * ex) / den
            u = (rx * dz - rz * dx) / den
            if 0.0 <= t <= 1.0 and 0.0 <= u <= 1.0:
                return t, u, 0.0
        t = max(0.0, min(1.0, (rx * dx + rz * dz) / (seg_p * seg_p)))
        cx, cz = px + dx * t, pz + dz * t
        u = max(0.0, min(1.0, ((cx - qx) * ex + (cz - qz) * ez) / (seg_q * seg_q)))
        gap = math.hypot(cx - (qx + ex * u), cz - (qz + ez * u))
        if gap > tol:
            return None, None, None
        return t, u, gap

    traffic_runs = [i for i, r in enumerate(records) if r["traffic"]]

    # A uniform grid over segment bounding boxes. Without it this is a quadratic
    # scan over ~10k segments, which is minutes; with it, near-linear.
    CELL = 50.0
    grid: dict[tuple[int, int], list[tuple[int, int]]] = defaultdict(list)
    for index in traffic_runs:
        points = records[index]["points"]
        for s in range(len(points) - 1):
            a, b = points[s], points[s + 1]
            for cx in range(int(min(a[0], b[0]) // CELL), int(max(a[0], b[0]) // CELL) + 1):
                for cz in range(int(min(a[1], b[1]) // CELL), int(max(a[1], b[1]) // CELL) + 1):
                    grid[(cx, cz)].append((index, s))

    all_points = {i: records[i]["points"] for i in traffic_runs}

    def polyline_len(points):
        return sum(
            math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(points, points[1:])
        )

    def find_crossings(index):
        """Every crossing on run `index`, as (my t, other run, their t, x, z)."""
        points = all_points[index]
        last = len(points) - 1
        seen_here: dict[tuple[int, int], tuple[float, float, float, float]] = {}
        for s in range(len(points) - 1):
            a, b = points[s], points[s + 1]
            for cx in range(int(min(a[0], b[0]) // CELL) - 1, int(max(a[0], b[0]) // CELL) + 2):
                for cz in range(int(min(a[1], b[1]) // CELL) - 1, int(max(a[1], b[1]) // CELL) + 2):
                    for other, t2 in grid.get((cx, cz), ()):
                        if other == index or (t2 >= s and t2 <= s + 1):
                            continue                  # same run, adjacent segment
                        o_points = all_points[other]
                        c, d = o_points[t2], o_points[t2 + 1]
                        u, v, _gap = seg_crossing(a, b, c, d, JOIN_TOLERANCE_M)
                        if u is None:
                            continue
                        my_t = (s + u) / last
                        their_t = (t2 + v) / (len(o_points) - 1)
                        # One crossing can be reported by several segment pairs
                        # (two roads meeting at a shallow angle share a couple of
                        # segments); keep the first, keyed on the pair of segments.
                        seen_here.setdefault(
                            (other, t2), (my_t, their_t, a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u)
                        )
        return [(other, my_t, their_t, x, z) for (other, _s), (my_t, their_t, x, z) in seen_here.items()]

    # ---- cut every run where another traffic run crosses it
    cuts: dict[int, set[float]] = defaultdict(set)
    for index in traffic_runs:
        for _other, my_t, _their_t, _x, _z in find_crossings(index):
            if 0.02 < my_t < 0.98:                   # not already an end
                cuts[index].add(round(my_t, 4))

    def cut_record(record, positions):
        """Cut a record's polyline at the given t values; returns new records."""
        points = record["points"]
        last = len(points) - 1
        marks = []
        for t in sorted(positions):
            at = t * last
            lo = min(int(at), last - 1)
            frac = at - lo
            ax, az = points[lo]
            bx, bz = points[lo + 1]
            marks.append((lo, [ax + (bx - ax) * frac, az + (bz - az) * frac]))

        def emit(chunk):
            # A cut landing exactly on an existing vertex produces a duplicate
            # point, and a zero-length segment divides by zero in the game's
            # sampleLane() and reads as a crossing in laneCrossings().
            chunk = dedupe(chunk)
            if len(chunk) < 2 or polyline_len(chunk) < MIN_CUT_LENGTH:
                return None
            return {**record, "points": [[round(x, 1), round(z, 1)] for x, z in chunk]}

        out = []
        cursor = 0
        for lo, mark in marks:
            head = emit(points[cursor : lo + 1] + [mark])
            if head:
                out.append(head)
            # The next piece starts AT the junction, not at the vertex before it.
            # `points[lo]` is a whole segment back from `mark`, so starting there
            # made every cut run begin up to a segment short of the junction it
            # was cut for - which is where a 208 m lane handover came from: the
            # car was handed to a lane that started two blocks earlier.
            cursor = lo + 1
            previous_mark = mark
        tail = emit([previous_mark] + points[cursor:]) if marks else emit(points)
        if tail:
            out.append(tail)
        return out or [record]

    if cuts:
        rebuilt: list[dict] = []
        for index, record in enumerate(records):
            rebuilt.extend(cut_record(record, cuts[index]) if index in cuts else [record])
        records = rebuilt
        print(f"  runs cut at a crossing: {len(cuts)}  ->  {len(records)} runs")

        # Re-derive the traffic set, the grid and the point table for the new,
        # shorter runs. Every index has moved, so all three are rebuilt.
        traffic_runs = [i for i, r in enumerate(records) if r["traffic"]]
        all_points = {i: records[i]["points"] for i in traffic_runs}
        grid.clear()
        for index in traffic_runs:
            points = all_points[index]
            for s in range(len(points) - 1):
                a, b = points[s], points[s + 1]
                for cx in range(int(min(a[0], b[0]) // CELL), int(max(a[0], b[0]) // CELL) + 1):
                    for cz in range(int(min(a[1], b[1]) // CELL), int(max(a[1], b[1]) // CELL) + 1):
                        grid[(cx, cz)].append((index, s))

    # ---- the junction table
    # Every crossing is now an END of both runs, so there is no end 2 to get
    # wrong: end 0 is the run's start, end 1 its end, and a lane that arrives at
    # one end can only be handed to a lane that leaves at the other's.
    junctions: list[list] = []
    emitted: set[tuple[int, int, int, int]] = set()
    for index in traffic_runs:
        for other, my_t, their_t, x, z in find_crossings(index):
            a_end = 0 if my_t < 0.5 else 1
            b_end = 0 if their_t < 0.5 else 1
            key = (index, a_end, other, b_end)
            if key in emitted:
                continue
            emitted.add(key)
            node = f"{round(x)},{round(z)}"
            junctions.append([index, a_end, other, b_end, node])
            # A crossing is symmetric. Emitting one direction only would make
            # "which side did the loop enumerate first" decide whether a turn
            # exists, and half the junctions in the city would be missing a way
            # out for no reason at all.
            junctions.append([other, b_end, index, a_end, node])

    for record in records:
        record.pop("_nodes", None)

    named = sum(1 for r in records if r["named"])
    total_km = sum(
        sum(((p[0][0] - p[1][0]) ** 2 + (p[0][1] - p[1][1]) ** 2) ** 0.5
            for p in zip(r["points"], r["points"][1:]))
        for r in records
    ) / 1000
    traffic_runs = [i for i, r in enumerate(records) if r["traffic"]]
    wired = {j[0] for j in junctions} | {j[2] for j in junctions}
    stranded = [i for i in traffic_runs if i not in wired]
    traffic_lanes = sum(
        records[i]["lanes"] * (1 if records[i]["oneway"] else 2) for i in traffic_runs
    )
    # How many separate networks the links leave behind. One number decides
    # whether the city is drivable end to end or a set of islands.
    parent = list(range(len(records)))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for a, _ae, b, _be, _node in junctions:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb
    groups = Counter(find(i) for i in traffic_runs)
    print(f"road runs emitted: {len(records)}  named: {named}  total: {total_km:.1f} km")
    print(f"traffic runs: {len(traffic_runs)}  traffic lanes: {traffic_lanes}")
    print(f"junctions: {len({j[4] for j in junctions})}  links: {len(junctions)}")
    print(f"traffic networks: {len(groups)}  largest {groups.most_common(1)[0][1]} runs")
    print(f"traffic runs with no junction (get a U-turn bulb): {len(stranded)}")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    payload = {
        "generatedAt": now_iso(),
        "mapHalfMetres": MAP_HALF,
        "snapResolution": SNAP,
        "roads": records,
        "junctions": junctions,
        "stats": {
            "waysInSlice": len(inside),
            "waysOnMainNetwork": len(usable),
            "runs": len(records),
            "namedRuns": named,
            "totalKm": round(total_km, 1),
            "bridges": sum(1 for r in records if r["bridge"]),
            "tunnels": sum(1 for r in records if r["tunnel"]),
            "junctions": len(junctions),
            "trafficRuns": len(traffic_runs),
            "trafficLanes": traffic_lanes,
            "trafficNetworks": len(groups),
            "largestNetworkRuns": groups.most_common(1)[0][1],
            "byCategory": dict(Counter(r["category"] for r in records).most_common()),
        },
    }
    write_json(OUT_DIR / "roads.json", payload)

    # A compact JS module the game can import directly.
    js_roads = ",\n".join(
        "  { name: %s, points: %s, lanes: %d, median: %s, half: %s, cruise: [%s, %s], category: %s, bridge: %s, tunnel: %s, oneway: %s, traffic: %s }"
        % (
            json.dumps(r["name"]),
            json.dumps(r["points"], separators=(",", ":")),
            r["lanes"],
            json.dumps(r["median"]),
            json.dumps(r["half"]),
            r["cruise"][0],
            r["cruise"][1],
            json.dumps(r["category"]),
            "true" if r["bridge"] else "false",
            "true" if r["tunnel"] else "false",
            "true" if r["oneway"] else "false",
            "true" if r["traffic"] else "false",
        )
        for r in records
    )
    js_links = ",\n".join(
        f"  [{a}, {aEnd}, {b}, {bEnd}, {json.dumps(node)}]"
        for a, aEnd, b, bEnd, node in junctions
    )
    module = f"""// GENERATED FILE - do not edit. Source: sydney-osm-world/scripts/build_game_roads.py
//
// Real Sydney road centrelines from OpenStreetMap (ODbL 1.0), sliced to the
// {int(MAP_HALF * 2)} x {int(MAP_HALF * 2)} m game map and clipped to it.
//
// Axis convention matches world.js exactly: NORTH = -Z, EAST = +X, metres.
// No coordinate conversion was needed, so none is present here.
//
// generatedAt: {now_iso()}
// ways in slice {len(inside)} | on main network {len(usable)} | runs {len(records)} | {total_km:.1f} km
// {named} named, {payload['stats']['bridges']} bridge runs, {payload['stats']['tunnels']} tunnel runs
// {len(traffic_runs)} runs carry ambient traffic ({traffic_lanes} lanes); the rest are tarmac only.
//
// `half` is the half-width of the PAVED carriageway in metres - what the game
// draws and the player drives on. It is wider than lanes x LANE_WIDTH because a
// real street is kerb to kerb, and narrower for the big roads than a naive
// lanes x width would be, so nothing paves over a whole city block.
//
// `traffic: false` means draw it, do not put cars on it: a back-lane, a service
// road, a pedestrianised mall, a tunnel bore with no height profile, or a run
// too short to hold a car.
//
// NOTE: several runs share a street name (35 separate "Elizabeth Street" runs),
// so buildSydneyLanes() suffixes the road name with the run index before
// handing it to makeRoadway - traffic.js resolves lane links BY NAME, and
// duplicate names would silently mis-wire the junctions.

export const SYDNEY_ROAD_STATS = {json.dumps(payload["stats"])};

/** Road centrelines, clipped to the map. */
export const SYDNEY_ROADS = [
{js_roads}
];

/**
 * Junctions: [fromRun, fromEnd, toRun, toEnd, at] where an end of 0 is the run's
 * start and 1 is its end, and `at` is "x,z" - where the two roads meet, in the
 * same coordinates as `points`. buildSydneyLanes() uses these to hand a car from
 * one street onto the next, instead of every road being its own loop.
 *
 * `at` is not decoration. A lane arriving at the end of its run is usually at a
 * crossroads with several roads to choose from, and the game picks the exit
 * whose carriageway is NEAREST that point - which is why these are here. Choosing
 * by iteration order instead left a fifth of all handovers jumping more than 25 m.
 *
 * Every crossing is emitted in both directions, so the game never finds a turn
 * missing because of which side of the pair was enumerated first.
 *
 * Only runs with `traffic: true` appear. {len(stranded)} traffic runs are
 * absent, which means genuinely dead-ended; the game gives those a drivable
 * U-turn bulb.
 */
export const SYDNEY_JUNCTIONS = [
{js_links}
];
"""
    (OUT_DIR / "roads.js").write_text(module, encoding="utf-8")
    size_kb = len(module) / 1024
    print(f"\nwritten: {OUT_DIR / 'roads.js'} ({size_kb:.0f} KB)")
    print(f"written: {OUT_DIR / 'roads.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
