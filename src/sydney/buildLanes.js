// ---------------------------------------------------------------------------
// sydney/buildLanes.js — turn the generated Sydney centrelines into traffic lanes.
//
// `roads.js` is data: real OSM centrelines clipped to the map. This turns that
// into the lane defs traffic.js's createTraffic() consumes, and it is the whole
// reason Sydney drives where Louisiana's single highway did not need this file.
//
// THE PROBLEM
//
// makeRoadway() finishes every road by pairing its own forward lane with its own
// backward lane (`f:0 <-> b:0`). For one road that runs off the map and comes
// back on itself that is correct and self-contained. For a city it means every
// street in Sydney is sealed into a private loop: a car drives down George
// Street, reaches the end, turns around, and comes back past you, forever. It
// never crosses a junction, because crossing one was never possible.
//
// So every `next` makeRoadway() sets is cleared, and lanes are handed to each
// other here instead.
//
// WHY THIS FILE WIRES BY GEOMETRY, NOT BY THE JUNCTION TABLE
//
// The obvious design is to trust the generator's junction table: it says run 12
// meets run 40 at x,z, so join those lanes. That was tried, and it does not
// work, because the table has to agree with the lane geometry on THREE things at
// once - which run, which end, and which direction - and any disagreement is
// silent. Pointing a lane at the wrong end of a run is a car teleporting 200 m
// sideways; the worst measured handover was 211 m. Pointing it at the wrong
// direction is oncoming traffic. Neither throws an error.
//
// So the topology is derived HERE, from the points themselves: a lane that ends
// somewhere is connected to the nearest lane that starts near that same place.
// The generator's end indices are not consulted at all. This cannot disagree
// with where the roads are, because it is computed from where the roads are.
// The junction table is still emitted and still used, as a hint that keeps the
// spatial search cheap - but a missing or wrong hint costs a little speed, never
// correctness.
//
// NAMES ARE suffixed with the run index. traffic.js resolves `next` through a Map
// keyed by lane NAME, and Sydney has 35 separate runs called "Elizabeth Street";
// without the suffix every one resolves to whichever was built first and the
// network wires itself into nonsense without a single error.
// ---------------------------------------------------------------------------

import { makeRoadway } from "../traffic.js";
import { SYDNEY_JUNCTIONS, SYDNEY_ROADS } from "./roads.js";

/**
 * How close two carriageways have to be for a car to be able to drive from one
 * to the other.
 *
 * This is generous on purpose, and the number is measured rather than guessed. OSM
 * maps junctions by their kerb and by the tagger's idea of where the crossing is,
 * so a road that genuinely ends at a junction often stops short of the other
 * road's centreline - and after the generator has cut runs at crossings, the two
 * halves of a junction land a few metres apart. Measured over all 2907 Sydney
 * lanes: at 11 m, 71% of lane ends had a partner to hand over to; at 18 m, 85%;
 * at 25 m, 86%. Past ~20 m the curve flattens, because the remaining ends are the
 * 106 that have no road within 30 m of them at all and never will.
 *
 * The cost of a larger radius is one bad junction where two parallel streets
 * 20 m apart are joined without a road between them. That is far better than the
 * alternative, which is a city cut into 1867 pieces where a car drives six
 * streets and stops.
 */
const JOIN_RADIUS = 18;

/** Grid cell for the spatial search. Two JOIN_RADIUS neighbourhoods to a cell. */
const CELL = 32;

/** Runs shorter than this get tarmac but no lanes: not room for a car. */
const MIN_LANE_LENGTH = 12;

/**
 * Build every traffic lane for the Sydney network.
 *
 * @returns {{lanes: Array, stats: object}}
 */
export function buildSydneyLanes() {
  // ---- 1. one carriageway per traffic run, uniquely named
  const lanes = [];
  /** run index -> the lane defs built for it, in makeRoadway's order. */
  const byRun = new Map();
  let shortDropped = 0;

  for (let index = 0; index < SYDNEY_ROADS.length; index++) {
    const road = SYDNEY_ROADS[index];
    if (!road.traffic) continue;

    const defs = makeRoadway({
      name: `${road.name}#${index}`,
      points: road.points,
      lanes: road.lanes,
      median: road.median,
      cruise: road.cruise,
      laneWidth: 3.4,
    });

    // A one-way gets one direction, not two. 1210 of Sydney's runs are one-way,
    // and a lane on the wrong side of one is oncoming traffic in a lane that has
    // no oncoming side - plus a turning car crossing into it.
    const candidates = road.oneway ? defs.filter((l) => l.dir === 1) : defs;
    const kept = candidates.filter((l) => polylineLength(l.points) >= MIN_LANE_LENGTH);
    shortDropped += candidates.length - kept.length;
    if (!kept.length) continue;

    // makeRoadway's own f<->b pairing is the loop this whole file exists to
    // remove. Clear it here rather than later, so there is no window in which a
    // lane still carries it.
    for (const lane of kept) lane.next = null;

    byRun.set(index, kept);
    for (const lane of kept) lanes.push(lane);
  }
  LANES_OF_RUN = byRun;

  // ---- 2. where each lane's car arrives
  //
  // EVERY lane in traffic.js runs from points[0] to points[points.length - 1].
  // makeRoadway gives a backward lane the REVERSED polyline, so it too starts at
  // its own points[0] - `dir` only records which way along the road that is, and
  // is bookkeeping for lane changes, not for direction of travel. So a car always
  // arrives at a lane's LAST point.
  for (const lane of lanes) {
    lane._arriveAt = lane.points[lane.points.length - 1];
    lane._arriveHeading = headingAt(lane.points, 1);
  }

  // ---- 3. spatial index over every lane's polyline
  //
  // A partner is found by nearest point on its WHOLE polyline (see findPartner),
  // so every segment has to be in the grid, not just the entry point.
  const grid = new Map();
  for (const lane of lanes) {
    const p = lane.points;
    for (let i = 1; i < p.length; i++) {
      const a = p[i - 1], b = p[i];
      for (let cx = Math.floor(Math.min(a[0], b[0]) / CELL); cx <= Math.floor(Math.max(a[0], b[0]) / CELL); cx++) {
        for (let cz = Math.floor(Math.min(a[1], b[1]) / CELL); cz <= Math.floor(Math.max(a[1], b[1]) / CELL); cz++) {
          const k = `${cx},${cz}`;
          let bucket = grid.get(k);
          if (!bucket) grid.set(k, (bucket = []));
          bucket.push(lane);
        }
      }
    }
  }

  /**
   * The runs the generator says meet near (x, z), so the search can skip most of
   * the city. A hint that is wrong costs a slower search, never a wrong answer.
   */
  const hints = buildJunctionHints();

  // ---- 4. wire each lane to every road it could turn onto
  //
  // Not one, but ALL of them, in preference order. A crossroads has four roads
  // meeting and a car must be able to take any of them; a lane with a single
  // `next` can only ever offer the one that was chosen for it, so the other three
  // are unreachable. Measured on this data with a single `next`, 16% of lanes
  // formed a mutual A<->B pair - two roads pointing at each other across a
  // junction - and the city came out as 1697 disconnected fragments, largest 15
  // lanes. traffic.js now reads `nexts` and picks one at random, weighted to the
  // first, so the same junction offers every exit to every car that reaches it.
  //
  // Order is by score: how far the exit is, plus a small nudge for how straight
  // it is. A car reaching a T-junction mostly turns, sometimes goes straight on.
  let links = 0;
  for (const lane of lanes) {
    const options = findPartners(lane, lane._arriveAt, lane._arriveHeading, grid, hints);
    if (!options.length) continue;
    // Best first. `next` is kept in sync with the head of the list so anything
    // that reads only `next` - the dead-end bulb builder, the QA tools - still
    // sees a real continuation.
    lane.nexts = options.map((o) => o.lane.name);
    lane.next = lane.nexts[0];
    links += lane.nexts.length;
  }

  // ---- 5. what is left over
  //
  // A lane with no `next` is a genuine dead end, and traffic.js handles it well:
  // it appends a real drivable U-turn bulb, a circular lane tangent to both ends,
  // so the car turns around in the road instead of teleporting. So this is not a
  // failure state, but a high count means the network is too fragmented to drive,
  // and it is worth being able to see it.
  const deadEnds = lanes.filter((l) => !l.next);

  // The scratch fields above are on the defs the game holds; drop them so nothing
  // downstream iterates over a field it does not know.
  for (const lane of lanes) {
    delete lane._arriveAt; delete lane._arriveHeading;
  }

  return {
    lanes,
    stats: {
      runs: byRun.size,
      lanes: lanes.length,
      links,
      deadEnds: deadEnds.length,
      shortDropped,
      km: Math.round(lanes.reduce((s, l) => s + polylineLength(l.points), 0) / 10) / 100,
    },
  };
}

/**
 * The best lane to hand `lane`'s car to when it reaches `anchor` heading
 * `heading`, or null if nothing is close enough.
 */
/**
 * Every lane this one could hand over to when it reaches `anchor` heading
 * `heading`, best first. Returns [] if nothing is close enough.
 */
function findPartners(lane, anchor, heading, grid, hints) {
  const reach = Math.ceil(JOIN_RADIUS / CELL);
  const cx = Math.floor(anchor[0] / CELL), cz = Math.floor(anchor[1] / CELL);
  const near = hintedThenAll(hints, lane, grid, cx, cz, reach);

  /** run -> its best exit, so a multi-lane road contributes one turn, not four. */
  const bestPerRun = new Map();
  for (const other of near) {
    if (other === lane || other.road === lane.road) continue;   // never U-turn in place
    // A partner can be joined ANYWHERE along it, not only at its start, because
    // traffic.js projects the car onto the next lane when it hands over
    // (`car.s = projectLane(...)`). So the test is distance to the nearest point
    // of the partner's POLYLINE, and the heading used is the one at that point.
    //
    // Restricting this to points[0] is the single reason an earlier version came
    // out in 1751 pieces. A road whose end lands on the MIDDLE of the next road
    // (which is most of them: the generator cuts runs at crossings, so a run often
    // ends part-way along its neighbour) had no partner at all, and got a U-turn
    // bulb instead of a junction.
    const hit = nearestOnPolyline(anchor[0], anchor[1], other.points);
    if (!hit || hit.distance > JOIN_RADIUS) continue;
    // Heading is a PREFERENCE, not a filter, and it is weighted far below the
    // distance. Weighting it in metres - as `distance + gap * 5` does - lets a
    // right-angle turn (gap pi, so +15.7) lose to a slightly nearer road that
    // doubles back behind the car, which is how 857 lanes ended up with no
    // partner at all: the correct turn existed and was out-scored by a worse
    // one. A driver takes the turn they can reach; heading only breaks ties
    // between exits that are all right there.
    const turn = headingGap(heading, hit.heading);
    const score = hit.distance + turn * 0.6;
    const seen = bestPerRun.get(other.road);
    if (!seen || score < seen.score) bestPerRun.set(other.road, { lane: other, score });
  }
  return [...bestPerRun.values()].sort((a, b) => a.score - b.score);
}

/**
 * The point on `points` closest to (x, z), with the heading a car would be
 * driving there. This mirrors traffic.js's projectLane(), which is what will
 * actually place the car when the handover happens - measuring anything else
 * measures a different question than the one the game asks.
 */
function nearestOnPolyline(x, z, points) {
  let best = null;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const abx = b[0] - a[0], abz = b[1] - a[1];
    const len2 = abx * abx + abz * abz || 1;
    let t = ((x - a[0]) * abx + (z - a[1]) * abz) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = a[0] + abx * t, pz = a[1] + abz * t;
    const distance = Math.hypot(x - px, z - pz);
    if (!best || distance < best.distance) {
      best = { distance, heading: Math.atan2(abx, abz) };
    }
  }
  return best;
}

/** Runs the generator flagged as meeting near here, then everything else nearby. */
function hintedThenAll(hints, lane, grid, cx, cz, reach) {
  const seen = new Set();
  const out = [];
  const myRun = runOf(lane.road);
  const anchor = lane._arriveAt;
  for (const run of hints.get(key2(anchor)) || []) {
    if (run === myRun) continue;
    for (const l of lanesOfRun(run)) if (!seen.has(l)) { seen.add(l); out.push(l); }
  }
  for (let dx = -reach; dx <= reach; dx++) {
    for (let dz = -reach; dz <= reach; dz++) {
      for (const l of grid.get(`${cx + dx},${cz + dz}`) || []) {
        if (!seen.has(l) && runOf(l.road) !== myRun) { seen.add(l); out.push(l); }
      }
    }
  }
  return out;
}

/** The run index encoded in a road key (`Elizabeth Street#412` -> 412). */
function runOf(road) {
  const hash = String(road).lastIndexOf("#");
  return hash < 0 ? NaN : Number(String(road).slice(hash + 1));
}

/** Set by buildJunctionHints; module-level so the helpers above can reach it. */
let LANES_OF_RUN = new Map();
function lanesOfRun(run) { return LANES_OF_RUN.get(run) || []; }
function key2(pt) { return `${Math.round(pt[0] / 6)},${Math.round(pt[1] / 6)}`; }

/**
 * Index the generator's junctions by a coarse position, so `findPartner` can ask
 * "who meets here?" instead of scanning the neighbourhood every time.
 */
function buildJunctionHints() {
  const hints = new Map();
  for (const [a, , b, , node] of SYDNEY_JUNCTIONS) {
    const [x, z] = String(node).split(",").map(Number);
    if (!Number.isFinite(x)) continue;
    const k = key2({ 0: x, 1: z });
    let list = hints.get(k);
    if (!list) hints.set(k, (list = []));
    if (!list.includes(a)) list.push(a);
    if (!list.includes(b)) list.push(b);
  }
  // The generator rounds the node label to whole metres, so a run end can sit a
  // little either side of the hinted cell. Widen each hint to its 3x3 neighbours.
  const wide = new Map();
  for (const [k, list] of hints) {
    const [cx, cz] = k.split(",").map(Number);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const kk = `${cx + dx},${cz + dz}`;
        let l = wide.get(kk);
        if (!l) wide.set(kk, (l = []));
        for (const r of list) if (!l.includes(r)) l.push(r);
      }
    }
  }
  return wide;
}

/** Heading of a polyline at its start (0) or end (1), as a world angle. */
function headingAt(points, end) {
  const pts = end ? points.slice(-2) : points.slice(0, 2);
  const dx = pts[1][0] - pts[0][0], dz = pts[1][1] - pts[0][1];
  if (!dx && !dz) return 0;
  // world.js: the forward vector of heading h is (sin h, cos h), so h = atan2(dx, dz).
  return Math.atan2(dx, dz);
}

/** Smallest absolute difference between two headings, in radians. */
function headingGap(a, b) {
  const d = Math.abs(a - b) % (Math.PI * 2);
  return d > Math.PI ? Math.PI * 2 - d : d;
}

function polylineLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  }
  return total;
}
