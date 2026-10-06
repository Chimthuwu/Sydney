// ---------------------------------------------------------------------------
// traffic.js — ambient cars on US-167.
//
// The map is one long highway, so traffic is lane-following, not navigation:
// each lane is a polyline, and a car is just (lane, distance along it, speed).
// Cars keep their distance from whatever is ahead in their lane (other traffic,
// the player, NPCs crossing), are recycled from far behind the player to far
// ahead, and are never created or destroyed in steady state.
//
// A car the player jacks is released from traffic and becomes an ordinary
// vehicle; the pool quietly builds a replacement.
//
// Three things beyond "drive along the line" live here, and all three exist for
// the Crown Strip's nightlife (TASK-070):
//
//   * **Kerbside stops** — a lane may carry `stops` (world points, projected onto
//     the lane at construction). A car brakes for one like a red light, dwells
//     with `onStop(car, stop)` called exactly once, and pulls away. That is a
//     drop-off: the *caller* owns what "somebody gets out here" means.
//   * **Junctions** — where two lanes cross, the car nearer the crossing goes and
//     the other one yields. Without it, an avenue and a highway pass through each
//     other's traffic.
//   * **Wide obstacles** — an obstacle may carry a radius (`{x, z, r}`), so a
//     pedestrian in the middle of the carriageway is waited for instead of being
//     "eased past" after a few seconds. A point obstacle still behaves as before.
// ---------------------------------------------------------------------------

import * as THREE from "three";
import { reflect } from "./fx.js";

const clamp = THREE.MathUtils.clamp;

/** Metres between lane centres. Every carriageway in the game is built on this. */
export const LANE_WIDTH = 3.4;

/**
 * Build a carriageway's worth of lanes from ONE centreline.
 *
 * The point of this being additive is that nothing else has to change to keep
 * working: a road described with no `lanes` count is still exactly the single
 * lane each way it always was, and every district that already calls
 * createTraffic keeps its behaviour byte for byte. Only the roads that opt in
 * (the arterials) get more.
 *
 * Real streets are not one lane each way: a US-167 or a Parish Highway 9 carries
 * two or three lanes in a direction either side of a median, and without that
 * every overtake has to happen in the oncoming lane, which is both wrong and
 * looks it. So a road here is a *group* of parallel lanes, and cars are allowed
 * to move between the siblings of their own direction.
 *
 * Lanes are offset from the centreline along the RIGHT of travel ((-dz, dx);
 * see the note at the shift below), so `offset` is always positive for
 * a lane's own side and the sign does the bookkeeping. With `lanes: 1` this
 * reproduces the old geometry exactly: one lane 1.7 m either side of centre.
 *
 * @param {object} road
 * @param {string} road.name
 * @param {Array<[number,number]>} road.points   the centreline
 * @param {[number,number]} [road.cruise]
 * @param {Array<number>} [road.ys]              height profile (decks, ramps, bores)
 * @param {number} [road.lanes]                  lanes per direction (default 1)
 * @param {number} [road.median]                 metres of median between the two sides
 * @param {number} [road.laneWidth]              metres per lane (default LANE_WIDTH).
 *   Real lanes are ~3.5 m, but a road whose carriageway was already paved at a
 *   given width has to fit inside it: US-167 is 10 m of tarmac (ROAD_HALF 5), so
 *   two 2.4 m lanes either side of a 0.4 m median fill it exactly, with 1.2 m
 *   of shoulder left over. Widening the tarmac to take 3.3 m lanes is a separate
 *   job that has to move buildings.
 * @param {Array} [road.stops]                   kerbside stops (see makeLane)
 * @returns {Array} lane defs, chained into a circuit: forward 0 → back 0 → forward 0 …
 */
export function makeRoadway(road) {
  const n = Math.max(1, road.lanes || 1);
  const median = road.median != null ? road.median : n > 1 ? 1.2 : 0;
  const lw = road.laneWidth || LANE_WIDTH;
  const pts = road.points;
  const out = [];
  // `dir` 1 drives along the centreline, -1 against it. Both sides sit to the
  // RIGHT of their own travel, so reversing the points is all the "other way"
  // needs — the lateral sign then falls out of the direction of travel.
  for (const dir of [1, -1]) {
    const line = dir === 1 ? pts : pts.slice().reverse();
    const ys = dir === 1 ? road.ys : (road.ys ? road.ys.slice().reverse() : undefined);
    for (let i = 0; i < n; i++) {
      const offset = median / 2 + (i + 0.5) * lw;
      const shifted = line.map((p, k) => {
        const a = line[Math.max(0, k - 1)], b = line[Math.min(line.length - 1, k + 1)];
        let dx = b[0] - a[0], dz = b[1] - a[1];
        const len = Math.hypot(dx, dz) || 1; dx /= len; dz /= len;
        // Right of travel. In this world -z is NORTH (districts.js), so facing
        // east (dx=1) your right hand points +z, and facing north (dz=-1) it
        // points +x: right = (-dz, dx). It used to read (dz, -dx), which is the
        // left, and put every road this generates — US-167 included — on the
        // wrong side of the line. Louisiana drives on the right.
        return [p[0] - dz * offset, p[1] + dx * offset];
      });
      out.push({
        name: `${road.name}:${dir > 0 ? "f" : "b"}:${i}`,
        points: shifted, cruise: road.cruise, ys,
        stops: i === 0 ? road.stops : undefined,      // the kerb is the kerbside lane's business
        road: road.name, dir, index: i, count: n, offset,
      });
    }
  }
  // Chain each forward lane to the return lane opposite it, and back, so a road
  // is a circuit and no car ever runs out of road.
  for (const f of out.filter((l) => l.dir === 1)) {
    const b = out.find((l) => l.dir === -1 && l.index === f.index);
    f.next = b.name; b.next = f.name;
  }
  return out;
}

function makeLane(def) {
  const pts = def.points.map(([x, z]) => new THREE.Vector2(x, z));
  const acc = [0];
  for (let i = 1; i < pts.length; i++) acc.push(acc[i - 1] + pts[i].distanceTo(pts[i - 1]));
  // `ys` (optional): a height per point — a deck, a ramp, a tunnel floor (freeway.js). Cars set their height and pitch from it.
  const lane = {
    name: def.name, pts, acc, ys: def.ys ? Float32Array.from(def.ys) : null,
    length: acc[acc.length - 1], cruise: def.cruise || [13, 20], next: def.next || null,
    // Every lane this one can hand over to at its end, in preference order. A
    // single `next` is still valid and still works; see createTraffic().
    nexts: def.nexts || null,
    stops: [],
    // Multi-lane (makeRoadway). `road` groups the parallel lanes of one carriageway
    // so a car can see its siblings; `dir` is which way they run, `index` which
    // lane of that side, `offset` how far from the road's centreline this lane
    // sits. A lane built without makeRoadway has road === null and is alone: one
    // lane each way, exactly as before, with nothing else in the file changed.
    road: def.road || null, dir: def.dir || 0, index: def.index || 0,
    count: def.count || 1, offset: def.offset || 0,
  };
  // Stops are given as world points (a venue knows its door, not its kilometre
  // mark) and resolved onto the lane here, in order, so a car meets them in the
  // order it drives.
  if (def.stops) {
    lane.stops = def.stops
      .map((st) => ({ s: projectLane(lane, st.x, st.z), dwell: st.dwell || [2.5, 5], onStop: st.onStop || null, what: st.what || null }))
      .sort((a, b) => a.s - b.s);
  }
  return lane;
}

/** Height of `lane` at distance s (0 for a lane with no profile). */
function laneY(lane, s) {
  if (!lane.ys) return 0;
  s = clamp(s, 0, lane.length);
  let i = 1;
  while (i < lane.acc.length - 1 && lane.acc[i] < s) i++;
  const seg = lane.acc[i] - lane.acc[i - 1] || 1, t = (s - lane.acc[i - 1]) / seg;
  return lane.ys[i - 1] + (lane.ys[i] - lane.ys[i - 1]) * t;
}

/** Where two lanes cross each other, as (distance along either). */
function laneCrossings(lanes) {
  const out = [];
  // This used to be an all-pairs scan: every lane against every other lane, every
  // segment of one against every segment of the other. That is free for
  // Louisiana's single highway and unusable for a city. Sydney's network is
  // ~2100 lanes, so the all-pairs form is ~2.2M lane pairs and, with the
  // segments inside them, hundreds of millions of intersection tests - it hangs
  // the browser on load, before the first frame.
  //
  // Two lanes can only cross if their bounding boxes overlap, so bucket the
  // boxes into a uniform grid and only test lanes that share a cell. A city grid
  // still puts every lane in a cell with a few dozen neighbours, so this is not
  // free either - it is the difference between hundreds of millions of tests and
  // a few million. The result is identical: a pair whose boxes do not overlap
  // cannot produce an intersection, so nothing is lost.
  const CELL = 60;
  const grid = new Map();
  for (let i = 0; i < lanes.length; i++) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of lanes[i].pts) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minZ) minZ = p.y;
      if (p.y > maxZ) maxZ = p.y;
    }
    for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++) {
      for (let cz = Math.floor(minZ / CELL); cz <= Math.floor(maxZ / CELL); cz++) {
        const k = cx * 73856093 ^ cz * 19349663;
        let cell = grid.get(k);
        if (!cell) grid.set(k, (cell = []));
        cell.push(i);
      }
    }
  }
  const tested = new Set();
  for (const cell of grid.values()) {
    for (let i = 0; i < cell.length; i++) {
      for (let j = i + 1; j < cell.length; j++) {
        const a = cell[i], b = cell[j];
        // A pair of lanes usually shares more than one cell, so it would be
        // tested once per cell and every crossing reported twice.
        const pair = a < b ? a * lanes.length + b : b * lanes.length + a;
        if (tested.has(pair)) continue;
        tested.add(pair);
        const A = lanes[a], B = lanes[b];
        for (let s1 = 1; s1 < A.pts.length; s1++) {
          for (let s2 = 1; s2 < B.pts.length; s2++) {
            const p = A.pts[s1 - 1], q = A.pts[s1], r = B.pts[s2 - 1], s = B.pts[s2];
            const d1x = q.x - p.x, d1z = q.y - p.y, d2x = s.x - r.x, d2z = s.y - r.y;
            const den = d1x * d2z - d1z * d2x;
            if (Math.abs(den) < 1e-6) continue;              // parallel (or one lane straight on top of the other)
            const t = ((r.x - p.x) * d2z - (r.y - p.y) * d2x) / den;
            const u = ((r.x - p.x) * d1z - (r.y - p.y) * d1x) / den;
            if (t < 0 || t > 1 || u < 0 || u > 1) continue;
            const sa = A.acc[s1 - 1] + Math.hypot(d1x, d1z) * t, sb = B.acc[s2 - 1] + Math.hypot(d2x, d2z) * u;
            if (Math.abs(laneY(A, sa) - laneY(B, sb)) > 2.5) continue;         // one is over the other (a deck above a road): they do not cross
            out.push({
              x: p.x + d1x * t, z: p.y + d1z * t,
              a: { lane: A, s: sa },
              b: { lane: B, s: sb },
            });
          }
        }
      }
    }
  }
  return out;
}
/** How close a car has to be to a crossing before it starts giving way. */
const YIELD_LOOK = 14;
const YIELD_HOLD = 7;

/** Position at distance `s` along `lane` into `out` ({x, z}); returns the heading. */
function sampleLane(lane, s, out) {
  s = clamp(s, 0, lane.length);
  let i = 1;
  while (i < lane.acc.length - 1 && lane.acc[i] < s) i++;
  const a = lane.pts[i - 1], b = lane.pts[i];
  const seg = lane.acc[i] - lane.acc[i - 1] || 1;
  const t = (s - lane.acc[i - 1]) / seg;
  out.x = a.x + (b.x - a.x) * t;
  out.z = a.y + (b.y - a.y) * t;
  return Math.atan2(b.x - a.x, b.y - a.y);
}

/** Distance along `lane` of the point on it closest to (x, z). */
function projectLane(lane, x, z) {
  let best = 0, bestD = Infinity;
  for (let i = 1; i < lane.pts.length; i++) {
    const a = lane.pts[i - 1], b = lane.pts[i];
    const abx = b.x - a.x, abz = b.y - a.y;
    const len2 = abx * abx + abz * abz || 1;
    const t = clamp(((x - a.x) * abx + (z - a.y) * abz) / len2, 0, 1);
    const px = a.x + abx * t, pz = a.y + abz * t;
    const d = (px - x) ** 2 + (pz - z) ** 2;
    if (d < bestD) { bestD = d; best = lane.acc[i - 1] + Math.sqrt(len2) * t; }
  }
  return best;
}

// Night driving: every car carries head and tail lights. Sprites, not real
// lights — a dozen extra PointLights would undo the lighting budget.
let glowTex = null;
function glowTexture() {
  if (glowTex) return glowTex;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const x = c.getContext("2d");
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.15, "rgba(255,255,255,0.8)");
  g.addColorStop(0.45, "rgba(255,255,255,0.15)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}
const lampMats = {};
function lampMaterial(kind) {
  if (lampMats[kind]) return lampMats[kind];
  const color = kind === "head" ? new THREE.Color(0xfff0d0).multiplyScalar(2.2)
                                : new THREE.Color(0xff2a18).multiplyScalar(1.4);
  const m = new THREE.SpriteMaterial({
    map: glowTexture(), color, blending: THREE.AdditiveBlending,
    transparent: true, depthWrite: false, fog: false,
  });
  m.userData.gtbRealized = true;
  return (lampMats[kind] = m);
}

/**
 * @param {object}   o
 * @param {THREE.Scene} o.scene
 * @param {Array}    o.lanes            [{ name, points: [[x, z], ...], cruise: [min, max],
 *                                          next: name of the lane to run when this one
 *                                          runs out — pair a lane with its return lane and
 *                                          traffic becomes a circuit instead of vanishing
 *                                          at the lane ends }]
 * @param {Array}    o.models           loaded car Object3Ds to clone
 * @param {Function} o.registerVehicle  (obj, radius, opts) => vehicle record
 * @param {Function} o.unregisterVehicle(vehicle) — optional, for dead cars
 * @param {number}   o.perLane          active cars per lane
 */
/**
 * The point list for a dead-end turnaround: a circular bulb, then the road
 * back on the opposite side.
 *
 * Exported because the only way to test "the car turns round instead of
 * teleporting" is to measure the geometry, and a copy of this arithmetic in a
 * test is a copy that drifts from the source the first time either is edited.
 *
 * The bulb is tangent to the lane where it leaves and tangent to the return
 * line where it arrives, which is what makes the two one continuous road. That
 * tangency is why the centre is exactly `radius` to the LEFT of the lane end
 * and nothing ahead of it: a = 0 then lands on the lane's own last point, and
 * the car leaves along its own heading rather than kinking. Moving the centre a
 * radius further forward looks right, is not, and opens a gap of one radius
 * between the lane and the loop — a teleport wearing a new name.
 *
 * Handedness matches makeRoadway(): right of travel is (-dz, dx), so left is
 * (dz, -dx). This used to offset by (dz, -dx) while calling it "right", which
 * put the return lane on the opposite side from every other lane in the game.
 *
 * @param {Array<[number,number]>} pts  the dead-end lane's centreline
 * @param {number} radius  bulb radius in metres
 * @returns {Array<[number,number]>}
 */
export function deadEndLoop(pts, radius = 7, steps = 16, taper = 30) {
  const src = pts;
  const end = src[src.length - 1];
  const prev = src[src.length - 2];
  let dx = end[0] - prev[0], dz = end[1] - prev[1];
  const len = Math.hypot(dx, dz) || 1; dx /= len; dz /= len;
  const lx = dz, lz = -dx;                       // left of travel
  const cx = end[0] + lx * radius;
  const cz = end[1] + lz * radius;
  const loop = [];
  for (let i = 0; i <= steps; i++) {
    const a = Math.PI * (i / steps), ca = Math.cos(a), sa = Math.sin(a);
    loop.push([
      cx - radius * ca * lx + radius * sa * dx,
      cz - radius * ca * lz + radius * sa * dz,
    ]);
  }
  // ...then back down the road. The return runs 2·radius to the LEFT of the way
  // it came, which is the far side of the carriageway — and then TAPERS back
  // onto the original lane over the last `taper` metres.
  //
  // Without the taper the circuit is not a circuit: the return would run
  // parallel, 14 m away, all the way to the far end, and the handover back to
  // the original lane would be a 14 m sideways teleport. That is the same bug
  // as before, just moved to the other end of the loop. A taper makes the two
  // lanes genuinely meet, so the car is projected rather than moved, and a
  // road that tapers its reverse lane into the through lane at the end of a
  // bulb is what a real one does anyway.
  const rev = src.slice().reverse();
  const acc = [0];
  for (let i = 1; i < rev.length; i++) acc.push(acc[i - 1] + Math.hypot(rev[i][0] - rev[i - 1][0], rev[i][1] - rev[i - 1][1]));
  const total = acc[acc.length - 1] || 1;
  const out = rev.map((p, i) => {
    const remaining = total - acc[i];                 // metres still to the join
    const k = Math.min(1, remaining / Math.max(1, taper));
    return [p[0] + lx * radius * 2 * k, p[1] + lz * radius * 2 * k];
  });
  // drop the point that duplicates the loop's last, or the lane gets a
  // zero-length segment and sampleLane() divides by it
  if (out.length && loop.length) {
    const a = loop[loop.length - 1], b = out[0];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6) out.shift();
  }
  return loop.concat(out);
}

export function createTraffic(o) {
  const lanes = o.lanes.map(makeLane);
  // resolve "next" names into lane objects so a car can hand itself over at the end
  const byName = new Map(lanes.map((l) => [l.name, l]));
  for (const l of lanes) if (l.next) l.next = byName.get(l.next) || null;
  // `nexts`: every lane reachable from this one at the end of it, best first.
  //
  // A single `next` is enough for a road that runs off the map and comes back, and
  // it is what a highway wants. It is not enough for a city. At a crossroads four
  // roads meet, and a lane with one `next` can only ever offer the driver the
  // exit that happened to be chosen for it - so the other three are unreachable,
  // and with a whole grid of them the network shatters: measured on the Sydney
  // data, 16% of lanes ended up in a mutual A<->B pair, two roads pointing at
  // each other across a junction, each car driving the same four blocks forever.
  //
  // So a junction offers a LIST. The car picks one when it arrives, weighted
  // towards the first, and remembers nothing: it is the same decision a driver
  // makes, and it is what turns 1697 disconnected fragments into one city.
  for (const l of lanes) {
    if (!l.nexts || !l.nexts.length) { l.nexts = l.next ? [l.next] : []; continue; }
    l.nexts = l.nexts.map((n) => byName.get(n)).filter(Boolean);
    // `next` stays as the first real entry so everything that reads it (the
    // dead-end bulb builder below, the QA tools) keeps working unchanged.
    if (!l.next) l.next = l.nexts[0] || null;
  }

  // ---------------------------------------------------------------------------
  // Multi-lane. Everything below is about the lanes of a road that opted into
  // more than one per direction (makeRoadway). A road that did not has
  // `road === null`, `count === 1` and no siblings, so every one of these
  // returns empty/false and the single-lane behaviour is untouched.
  // ---------------------------------------------------------------------------

  /**
   * The other lanes of THIS carriageway that a car may move into. Only
   * same-direction siblings of the same road: the opposing carriageway is never
   * a passing option, and a different road never is.
   */
  function siblingLanes(car) {
    const l = car.lane;
    if (!l.road || l.count < 2) return [];
    return lanes.filter((o) => o !== l && o.road === l.road && o.dir === l.dir);
  }

  const sameRoadDir = (a, b) => a.road === b.road && a.dir === b.dir;

  /** Distance to the nearest car ahead on `lane`, or Infinity. */
  function gapOnLane(car, lane) {
    let gap = Infinity;
    for (const c of cars) {
      if (c === car || !c.active || c.lane !== lane) continue;
      const d = c.s - car.s;
      if (d > 0 && d < gap) gap = d;
    }
    return gap;
  }

  /** Start easing into `lane`. The lateral offset is what apply() damps across. */
  function changeTo(car, lane) {
    if (lane === car.lane) return;
    // The car is, right now, `lane.offset + lat` metres to the right of the
    // road's centreline. Switching the lane instantly would teleport it by a
    // whole lane width, so carry that lateral position over to the new lane
    // (expressed in ITS offset) and let apply() ease it to the new centreline.
    // The car therefore does not move sideways on the frame it changes lane —
    // it slides across over the next second or so, which is what a merge is.
    const lateral = car.lane.offset + car.lat;
    car.lane = lane;
    car.lat = lateral - lane.offset;
    car.latTarget = 0;
    // `changing` is what actually stops a second lane change mid-merge.
    //
    // considerLaneChange guards with `if (car.latTarget !== 0) return false`,
    // and that guard has never worked: changeTo sets latTarget to 0 on the very
    // next line, so the car looks "settled" from the instant it starts sliding.
    // changeTo also zeroes `think`, so the very next frame the car thinks again,
    // sees itself in the outer lane with nothing ahead, and merges straight back
    // in - walking two lanes in two frames, a visible sideways lurch rather than
    // a merge. It only shows on a clear road, which is exactly when a driver is
    // most entitled to look settled.
    car.changing = true;
    // Project rather than copy `s`: the sibling runs parallel but is offset, so
    // the same distance along it is not the same place in the world.
    car.s = projectLane(lane, car.obj.position.x, car.obj.position.z);
    car.approach = null;              // its kerbside stops are its own business
    car.atStop = null;
    car.served = -1;
    car.think = 0;                    // re-decide speed for the new lane at once
  }

  /**
   * The sibling lane with the most room ahead, if any of them has enough to be
   * worth changing for. `need(gap)` is how much room this lane would actually
   * gain us, so a lane that is merely *empty* but no better than where we are
   * does not get chosen.
   */
  function bestOf(sibs, car, need) {
    let best = null, bestGap = -1;
    for (const o of sibs) {
      const g = gapOnLane(car, o);
      if (g < 30) continue;                       // not enough room to sit in
      if (need(g) < 18) continue;                 // and it must gain us something
      if (g > bestGap) { bestGap = g; best = o; }
    }
    return best;
  }

  /**
   * Multi-lane: decide whether to pass, and move one lane if so.
   *
   * The rules a driver actually uses, kept deliberately small. You pull out
   * only when genuinely held up (the car in front is close and slower than
   * you), only into a lane with room, and only once at a time. You pull back in
   * when the lane ahead opens, which is what stops a road filling up with cars
   * all parked out in the outer lane.
   */
  function considerLaneChange(car) {
    const l = car.lane;
    if (!l.road || l.count < 2) return false;
    // Mid-manoeuvre: finish this one before thinking about another. A car is
    // mid-merge from the moment changeTo() is called until it is back on its new
    // lane's centreline, which is what `changing` tracks (see changeTo).
    if (car.changing || car.latTarget !== 0) return false;
    const sibs = siblingLanes(car);
    if (!sibs.length) return false;

    // the car we would be stuck behind
    let leader = null;
    for (const c of cars) {
      if (c === car || !c.active || c.lane !== l) continue;
      const d = c.s - car.s;
      if (d > 0 && (leader === null || d < leader.d)) leader = { d, speed: c.speed };
    }

    // Pulling out: held up behind someone slower, and a clear lane beside us.
    if (leader && leader.d < 22 && leader.speed < car.speed - 0.6) {
      const target = bestOf(sibs, car, (g) => g - leader.d);
      if (target) { changeTo(car, target); return true; }
    }
    // Pulling back in: nothing in front of us any more, and the inside is free.
    if (l.index > 0 && gapOnLane(car, l) > 45) {
      const inside = sibs.filter((o) => o.index === l.index - 1);
      if (inside.length && gapOnLane(car, inside[0]) > 45) { changeTo(car, inside[0]); return true; }
    }
    return false;
  }

  // Dead ends: a lane nobody continues used to get a synthetic return lane —
  // the same line run backwards, shifted one lane width — and the car was
  // MOVED onto it in a single frame at the lane end. That is not a U-turn, it
  // is a teleport: one frame the car is here facing that way, the next it is a
  // lane-width to the left facing the other way. The report was exactly that
  // ("cars reach dead ends they dont actually do U turns at all they seem to
  // just vanish respawn facing the other way", 2026-09-28), and the dead ends
  // wanted turning into roundabouts, with cars visibly going round them.
  //
  // So the turnaround is now REAL, DRIVABLE GEOMETRY. A circular bulb is
  // appended to the lane: the car leaves the carriageway, goes round the loop,
  // and comes back out onto the opposite side heading the other way. `s` just
  // keeps advancing — there is no swap, no teleport, and nothing to see.
  //
  // The bulb is tangent to the lane where it leaves and tangent to the return
  // line where it arrives, which is what makes it continuous. Both the bulb
  // and the return line use the SAME handedness as makeRoadway() above: right
  // of travel is (-dz, dx). This used to offset by (dz, -dx) while calling it
  // "right" — the exact opposite of the formula makeRoadway() documents as the
  // bug that put every road in the game on the wrong side of its line.
  const LANE_W = LANE_WIDTH;
  const TURN_R = 7;                 // bulb radius, m — a two-lane car needs ~5 to swing
  for (const l of [...lanes]) {
    // A lane with nowhere to go gets a real, drivable U-turn bulb. `nexts` counts
    // as somewhere to go, so a lane that offers several exits at a crossroads is
    // not given a bulb it would never use.
    if ((l.next || (l.nexts && l.nexts.length)) || l.length < 12) continue;
    const ret = makeLane({
      name: l.name + "~uturn",
      points: deadEndLoop(l.pts, TURN_R),
      cruise: l.cruise,
      ys: l.ys ? Array.from(l.ys).reverse() : undefined,
    });
    ret.next = l;                    // ...and round again: a circuit of its own
    lanes.push(ret);
    l.next = ret;
    // The loop is its own lane, so the only handover left is at the far end,
    // between two lanes that genuinely meet. The car is projected, not moved.
  }
  const perLane = o.perLane || 4;
  const maxCars = o.maxCars || o.lanes.length * perLane;   // pool size
  const SPAWN_MIN = o.spawnMin || 75;
  const SPAWN_MAX = o.spawnMax || 130;
  const DESPAWN = o.despawn || 235;   // past the ~240 m fog edge: a despawn is never on screen
  // How close a car must be for its head/tail lamps to be shown.
  //
  // Measured 2026-10-02 at OrleaRouge spawn: 134 vehicles inside one view, each
  // carrying 4 additive sprites = 536 sprites, against 439 transparent meshes
  // found by tools/qa/orlearouge_spawn_density.mjs. Sprites are transparent and
  // animated, so batchStatic cannot merge them: every one is its own draw call,
  // and they wreck the ~1-draw-per-mesh ratio the rest of the scene enjoys.
  //
  // 110 m is chosen to sit INSIDE the fog edge (~240 m) and just under the spawn
  // window (SPAWN_MIN 75 .. SPAWN_MAX 130), so:
  //   - a car far enough that its lamps are subpixel still has them hidden;
  //   - a car close enough to read its headlights still shows them;
  //   - cars inside the spawn window are unaffected, because they spawn at
  //     75-130 m and this gate starts at 110 m -- i.e. the moment a car becomes
  //     visible its lamps are already on. Nothing pops.
  const LAMP_RANGE = o.lampRange || 110;
  const WRAP_HIDE = o.wrapHide || 165; // a lane-end U-turn happens only beyond this (in the mist)
  const cars = [];
  const tmp = { x: 0, z: 0 };
  const crossings = laneCrossings(lanes);
  // Where a car may be spawned: a grid of the lanes within spawning range of any
  // point. Built once; see trySpawn(), which is the only reader.
  const SPAWN_CELL = 64;
  const spawnGrid = new Map();
  for (const l of lanes) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of l.pts) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minZ) minZ = p.y;
      if (p.y > maxZ) maxZ = p.y;
    }
    for (let cx = Math.floor(minX / SPAWN_CELL); cx <= Math.floor(maxX / SPAWN_CELL); cx++) {
      for (let cz = Math.floor(minZ / SPAWN_CELL); cz <= Math.floor(maxZ / SPAWN_CELL); cz++) {
        const k = `${cx},${cz}`;
        let bucket = spawnGrid.get(k);
        if (!bucket) spawnGrid.set(k, (bucket = []));
        bucket.push(l);
      }
    }
  }
  let spawnCd = 0;
  let _focus = null;          // player position, stashed from update()'s `focus` arg
  let lastDt = 1 / 60;         // the frame's dt, for apply()'s lane-change easing

  function buildCar() {
    const models = o.models.filter(Boolean);
    if (!models.length) return null;
    const src = models[(Math.random() * models.length) | 0];
    const obj = src.clone(true);
    obj.rotation.set(0, 0, 0);
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj);
    const k = 1 / (obj.scale.x || 1);          // sprites live in the model's scaled space
    const y = (box.min.y + (box.max.y - box.min.y) * 0.42 - obj.position.y) * k;
    const half = ((box.max.x - box.min.x) / 2) * 0.62 * k;
    // Lamps are kept as children (so they inherit the car's transform and stay in
    // the wet-road reflection list) but start HIDDEN, and are shown only for cars
    // near the player -- see apply(). See LAMP_RANGE for why that is invisible.
    //
    // A LOCAL array, not `car.lamps`: the `car` record is not declared until the
    // literal further down this function, so touching it here is a TDZ
    // ReferenceError on the first car built. Collected here, attached below.
    const lamps = [];
    for (const sx of [-1, 1]) {
      const head = new THREE.Sprite(lampMaterial("head"));
      head.position.set(sx * half, y, (box.max.z - obj.position.z) * k + 0.1 * k);
      head.scale.setScalar(0.9 * k);
      const tail = new THREE.Sprite(lampMaterial("tail"));
      tail.position.set(sx * half, y, (box.min.z - obj.position.z) * k - 0.1 * k);
      tail.scale.setScalar(0.55 * k);
      head.visible = false;
      tail.visible = false;
      obj.add(head, tail);
      reflect(head);                       // other cars' lights show in the wet road
      reflect(tail);
      lamps.push(head, tail);
    }
    obj.visible = false;
    o.scene.add(obj);
    const v = o.registerVehicle(obj, vDefRadius(obj), { hp: 30 });
    if (v.seats) v.seats[0].occupant = "npc";  // someone's driving; a future hijack pulls them out
    // Procedural bikes are real traffic vehicles, not empty moving props. Keep
    // the rider as a child of the pooled vehicle so it follows lane transforms
    // and costs no separate NPC simulation slot.
    let rider = null;
    if (v.def && v.def.bike && o.makeRider) {
      rider = o.makeRider();
      rider.position.set(0, v.def.seat?.y || 0.8, v.def.seat?.z || 0);
      rider.rotation.y = Math.PI;
      // matches main.js's drivingUpdate() rideHip/rideLean for the player
      rider.rideHip = v.def.seat?.y ?? 0.9;
      rider.rideLean = v.def.name === "scooter" ? 0.05 : v.def.name === "pushbike" ? 0.16 : 0.3;
      rider.play?.("ride", { force: true });
      // play() alone only sets `anim` — the seated pose (hips dropped, knees
      // bent, torso leaned) is computed by update(), which nothing else calls
      // for pooled traffic riders. Without this they stand bolt upright on the
      // seat (the rig's raw constructor pose) for as long as they're pooled.
      rider.update?.(0);
      obj.add(rider);
    }
    const car = {
      obj, v, rider, lane: null, s: 0, speed: 0, target: 0, cruise: 15, think: 0, active: false,
      approach: null, atStop: null, served: -1, dwell: 0, wait: 0,
      // Lateral position within the lane group, in metres. Zero is this lane's
      // own centreline; a lane change eases it across to the sibling's offset.
      // Damped every frame in apply(), so passing reads as a smooth merge
      // rather than a teleport sideways.
      lat: 0, latTarget: 0, latSpeed: 1.1,
      // Lamp sprites, collected during construction above. `lampsOn` caches the
      // last gated state so apply() only touches four sprite flags when a car
      // crosses LAMP_RANGE, not every frame for every car.
      lamps, lampsOn: false,
    };
    v.traffic = car;
    return car;
  }

  function vDefRadius(obj) {
    return obj.userData.vehicleDef?.bike ? 1.05 : 1.9;
  }

  function place(car, lane, s) {
    car.lane = lane;
    car.s = s;
    car.cruise = lane.cruise[0] + Math.random() * (lane.cruise[1] - lane.cruise[0]);
    car.speed = car.cruise;
    car.target = car.cruise;
    car.think = Math.random() * 0.3;           // stagger decisions across cars
    car.approach = null;
    car.atStop = null;
    car.served = -1;
    car.wait = 0;
    car.lat = 0; car.latTarget = 0;
    car.changing = false;             // a recycled car is on its lane, settled
    car.active = true;
    car.obj.visible = true;
    apply(car);
  }

  function apply(car) {
    // Per-frame lamp gate. Cars are built once from the pool and then live for a
    // long time, so gating only in buildCar() would do nothing -- this has to be
    // re-evaluated as the car moves.
    //
    // `_focus` is stashed by update(dt, focus, ...): `focus` is NOT in scope in
    // apply(), and the opts object has no playerPos (there is no `playerPos` key
    // on what main.js passes to createTraffic -- I checked). `_focus` is null only
    // before the first update(), and the guard leaves lamps hidden until then.
    if (car.lamps && car.lamps.length && _focus) {
      const dx = car.obj.position.x - _focus.x, dz = car.obj.position.z - _focus.z;
      const on = dx * dx + dz * dz < LAMP_RANGE * LAMP_RANGE;   // squared: no sqrt per car per frame
      if (on !== car.lampsOn) {
        car.lampsOn = on;
        for (let i = 0; i < car.lamps.length; i++) car.lamps[i].visible = on;
      }
    }
    const h = sampleLane(car.lane, car.s, tmp);
    // car.lane.pts is ALREADY the lane's own line, offset from the road
    // centreline by makeRoadway() at construction — so sampleLane() alone puts
    // the car on its lane's centreline. Only `lat` (nonzero mid-manoeuvre) is
    // left to add, and it has to be added in makeRoadway()'s own "right of
    // travel" direction, (-dz, dx), i.e. (-cos h, sin h) for a heading of
    // (sin h, cos h). This used to also add `car.lane.offset` again, in the
    // OPPOSITE of that direction — the same left/right bug makeRoadway's own
    // comment warns about, just never fixed here — which cancelled the lane's
    // baked-in offset back to exactly zero. Every car on every multi-lane road
    // was riding the original centreline: "the cars are all driving in the
    // middle of the road" (2026-10-01).
    const off = car.lat;
    if (off) { tmp.x -= Math.cos(h) * off; tmp.z += Math.sin(h) * off; }
    car.obj.position.x = tmp.x;
    car.obj.position.z = tmp.z;
    car.obj.rotation.y = h;
    // a lane change is a real movement: ease the offset, never snap it
    if (car.lat !== car.latTarget) car.lat = THREE.MathUtils.damp(car.lat, car.latTarget, car.latSpeed, lastDt);
    // ...and once it is home, the car is allowed to think about another one.
    if (car.changing && Math.abs(car.lat) < 0.05) car.changing = false;
    // a lane with a height profile (freeway.js): ride it, and pitch with the ramp
    const ly = laneY(car.lane, car.s);
    if (ly !== 0 || car.raised) {
      car.obj.position.y = (car.v.baseY || 0) + ly;
      car.obj.rotation.order = "YXZ";
      const ahead = laneY(car.lane, car.s + 4) - laneY(car.lane, car.s - 4);
      car.obj.rotation.x = -Math.atan2(ahead, 8);
      car.raised = ly > 0.05;
    }
    car.v.heading = h;
    car.v.speed = car.speed;
    car.v.blocker.x = tmp.x;
    car.v.blocker.z = tmp.z;
  }

  function park(car) {
    car.active = false;
    car.obj.visible = false;
    // keep the blocker far outside the map while parked
    car.v.blocker.x = car.v.blocker.z = 1e5;
    car.obj.position.set(1e5, car.obj.position.y, 1e5);
  }

  /**
   * Find a free spot out of sight on a lane that passes near `focus`. Starts
   * from the point on each lane nearest the player and steps along it, so it
   * works for north–south and east–west lanes alike; emptiest lanes first.
   */
  function trySpawn(car, focus) {
    const near = [];
    // Only lanes in the neighbourhood are candidates. This used to project EVERY
    // lane onto the focus point and sort them all, which is free for Louisiana's
    // 60 lanes and ruinous for a city: Sydney builds 2907, and this runs for
    // every parked car on every frame, so it was ~1M point projections a frame
    // before a single car moved.
    //
    // The spatial index is bucketed once at start-up, and the search radius is
    // DESPAWN * 0.6 - the same bound the original loop applied, so this is not a
    // different question, asked faster.
    const R = DESPAWN * 0.6;
    const reach = Math.ceil(R / SPAWN_CELL);
    const cx = Math.floor(focus.x / SPAWN_CELL), cz = Math.floor(focus.z / SPAWN_CELL);
    const seen = new Set();
    for (let dx = -reach; dx <= reach; dx++) {
      for (let dz = -reach; dz <= reach; dz++) {
        for (const l of spawnGrid.get(`${cx + dx},${cz + dz}`) || []) {
          if (seen.has(l)) continue;
          seen.add(l);
          const s0 = projectLane(l, focus.x, focus.z);
          sampleLane(l, s0, tmp);
          if (Math.hypot(tmp.x - focus.x, tmp.z - focus.z) > R) continue;
          let n = 0;
          for (const c of cars) if (c.active && c.lane === l) n++;
          near.push({ l, s0, n });
        }
      }
    }
    near.sort((a, b) => a.n - b.n);
    for (const { l: lane, s0 } of near) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const dir = Math.random() < 0.5 ? 1 : -1;
        const s = s0 + dir * (SPAWN_MIN + Math.random() * (SPAWN_MAX - SPAWN_MIN));
        if (s < 4 || s > lane.length - 4) continue;
        sampleLane(lane, s, tmp);
        const d = Math.hypot(tmp.x - focus.x, tmp.z - focus.z);
        if (d < SPAWN_MIN * 0.8 || d > DESPAWN * 0.9) continue;
        if (cars.some((c) => c.active && c.lane === lane && Math.abs(c.s - s) < 20)) continue;
        place(car, lane, s);
        return true;
      }
    }
    return false;
  }

  /**
   * Choose which of a junction's lanes to take.
   *
   * Weighted towards the first entry, so a lane that lists the road straight
   * ahead first still mostly goes straight ahead - a driver does not reverse out
   * of a crossroads by coin flip. Entries after the first are taken with a
   * geometrically falling chance, which spreads traffic over the side streets
   * instead of sending every car down the same one.
   */
  function pickNext(options) {
    if (options.length === 1) return options[0];
    if (Math.random() < 0.6) return options[0];
    return options[1 + ((Math.random() * (options.length - 1)) | 0)];
  }

  function release(car) {    // jacked or wrecked: it stops being traffic and is just a vehicle now
    const i = cars.indexOf(car);
    if (i >= 0) cars.splice(i, 1);
    car.v.traffic = null;
    if (car.rider) {
      // A bike's rider is a child mesh riding along with the vehicle, not a
      // real NPC (see buildCar). hijack.js already spawns and ejects a proper
      // NPC to represent whoever we jacked it from, so leaving this one
      // attached would double them up: a standing "ghost" glued to the seat
      // behind the player for the rest of the vehicle's life.
      car.obj.remove(car.rider);
      car.v.riderView = car.rider;          // main.js dismounts THIS rider (same face, same clothes) when the bike is jacked or shot
      car.rider = null;
    }
  }

  /**
   * The next kerbside stop in front of this car, or null. `car.served` keeps a
   * car from re-triggering the stop it is parked on while it dwells.
   */
  function nextStop(car) {
    const stops = car.lane.stops;
    if (!stops || !stops.length) return null;
    for (const st of stops) if (st.s > car.s + 0.4 && st.s !== car.served) return st;
    return null;
  }

  /**
   * Does `car` have to wait at a junction right now? True when a crossing is
   * within `YIELD_LOOK` of its nose and another car is in it with priority.
   * Priority is "nearer the crossing goes"; a dead heat breaks on lane index, so
   * one of the two always wins and a junction cannot deadlock.
   */
  function yieldAt(car) {
    if (!crossings.length) return false;
    for (const x of crossings) {
      const mine = x.a.lane === car.lane ? x.a.s : x.b.lane === car.lane ? x.b.s : null;
      if (mine == null) continue;
      const d = mine - car.s;
      if (d < -3 || d > YIELD_LOOK) continue;          // not this junction
      const other = x.a.lane === car.lane ? x.b : x.a;
      for (const c of cars) {
        if (c === car || !c.active || c.lane !== other.lane) continue;
        if (Math.abs(c.s - other.s) > YIELD_HOLD) continue;
        const theirD = other.s - c.s;
        if (theirD < d - 0.5) return true;             // they are closer: give way
        if (Math.abs(theirD - d) <= 0.5 && other.lane.name < car.lane.name) return true;
      }
    }
    return false;
  }

  /** How far ahead the lane is clear, looking at traffic and `obstacles`. */
  function clearance(car, obstacles) {
    let gap = Infinity;
    for (const c of cars) {
      if (c === car || !c.active) continue;
      // Same lane, or a lane beside it that the car is already committed to
      // moving into: a car mid-manoeuvre still has to clear the one it is
      // pulling alongside, or two cars merge into each other.
      const same = c.lane === car.lane;
      const merging = car.latTarget !== 0 && sameRoadDir(c.lane, car.lane) && Math.abs(c.lane.index - car.lane.index) === 1;
      if (!same && !merging) continue;
      const d = c.s - car.s;
      if (d > 0 && d < gap) gap = d;
    }
    const h = car.v.heading;
    const fx = Math.sin(h), fz = Math.cos(h);
    const px = car.obj.position.x, pz = car.obj.position.z;
    for (let i = 0; i < obstacles.length; i++) {
      const ob = obstacles[i];
      // somebody a floor above or below (a deck over a road, a tunnel under a hill) is not in the way; obstacles that carry no height count as level
      if (ob.y !== undefined && Math.abs(ob.y - car.obj.position.y) > 2.5) continue;
      const rx = ob.x - px, rz = ob.z - pz;
      const along = rx * fx + rz * fz;
      if (along <= 0 || along > 32) continue;
      const lateral = Math.abs(rx * fz - rz * fx);
      // After waiting a few seconds, only something squarely in the lane holds
      // the car up; a pedestrian on the edge of the road gets eased past
      // instead of blocking the highway forever. An obstacle that carries a
      // radius is never eased past: `{x, z, r}` is somebody in the carriageway
      // (a crossing), and the car waits for as long as they are in it.
      const tol = ob.r || (car.wait > 3 ? 1.2 : 2.4);
      if (lateral < tol && along < gap) gap = along;
    }
    // called right after `car.think` is reset, so it holds the think interval
    car.wait = gap < 7 ? (car.wait || 0) + car.think : 0;
    return gap;
  }

  return {
    get cars() { return cars; },
    /** Gunfire, an explosion: every car within `r` m of (x, z) panics for `secs` — foot down, junctions run, kerb stops abandoned. */
    scare(x, z, r = 50, secs = 8) {
      const r2 = r * r;
      for (const car of cars) {
        if (!car.active || car.v.dead) continue;
        const dx = car.obj.position.x - x, dz = car.obj.position.z - z;
        if (dx * dx + dz * dz < r2) { car.panic = secs; car.think = 0; }
      }
    },
    get lanes() { return lanes; },              // QA: tools/qa/road_clearance.mjs

    /** Stop treating `vehicle` as traffic (it's being jacked, or story-owned). */
    releaseVehicle(vehicle) {
      const car = cars.find((c) => c.v === vehicle);
      if (car) release(car);
    },

    /**
     * @param {number} dt
     * @param {{x:number, z:number}} focus       usually the player position
     * @param {Array<{x,z}>} obstacles           things cars should stop for
     * @param {object|null} playerVeh            the vehicle the player is in
     */
    update(dt, focus, obstacles, playerVeh) {
      lastDt = Math.min(0.1, Math.max(0, dt));   // apply()'s lane-change easing
      _focus = focus;                            // apply() needs it for the lamp gate
      // keep the pool topped up — one new car per call at most, so a burst of
      // cloning never lands in a single frame
      spawnCd -= dt;
      if (spawnCd <= 0 && cars.length < maxCars) {
        const car = buildCar();
        if (car) { cars.push(car); park(car); }
        spawnCd = 0.25;
      }

      for (let i = cars.length - 1; i >= 0; i--) {
        const car = cars[i];
        if (car.v.dead || car.v === playerVeh) { release(car); continue; }

        if (!car.active) {
          trySpawn(car, focus);
          continue;
        }

        const dx = car.obj.position.x - focus.x, dz = car.obj.position.z - focus.z;
        const dist = Math.hypot(dx, dz);
        if (dist > DESPAWN) { park(car); continue; }   // the pool recycles; circuits make this rare

        // Decisions at a rate that depends on distance: close cars react
        // quickly, far ones (hidden in the mist anyway) barely think.
        car.think -= dt;
        if (car.think <= 0) {
          car.think = dist < 60 ? 0.15 : dist < 110 ? 0.45 : 1.0;
          // Multi-lane: a pass is a decision like any other, made here, before
          // the speed is worked out — so the car is already in (or easing into)
          // the clear lane by the time it reads the gap.
          considerLaneChange(car);
          const gap = clearance(car, obstacles);
          car.target = gap < 7 ? 0 : gap < 24 ? car.cruise * (gap - 7) / 17 : car.cruise;
          // panicked (scare(), below): floor it — still never through whatever is in the way
          if (car.panic > 0 && gap >= 7) car.target = Math.max(car.target, Math.min(car.cruise * 1.7, gap * 1.4));
          // A kerbside stop (a venue's door): brake for it like a red light, so
          // the car comes to rest *on* the stop instead of rolling past it.
          car.approach = nextStop(car);
          if (car.approach) {
            const toStop = car.approach.s - car.s;
            if (toStop < 20) car.target = Math.min(car.target, Math.max(0, car.cruise * (toStop - 0.4) / 19.6));
          }
          // A junction: whoever is nearer goes, the other one waits. Both cars
          // compute this the same way from the same numbers, so exactly one of
          // them yields and neither can wait for the other forever.
          if (yieldAt(car) && !(car.panic > 0)) car.target = 0;    // a panicked driver runs the junction
        }
        if (car.panic > 0) { car.panic -= dt; if (car.atStop) car.dwell = 0; }

        // Dwelling at the kerb: the stop's own business (a drop-off) runs on the
        // caller's clock; the car pulls away when it is done.
        if (car.atStop) {
          car.dwell -= dt;
          if (car.dwell <= 0) { car.atStop = null; car.s += 0.5; car.think = 0; }
          apply(car);
          continue;
        }
        if (car.approach && car.s >= car.approach.s - 0.4 && car.speed < 1.4) {
          car.atStop = car.approach;
          car.served = car.approach.s;
          car.approach = null;
          car.speed = 0;
          car.target = 0;
          car.dwell = car.atStop.dwell[0] + Math.random() * (car.atStop.dwell[1] - car.atStop.dwell[0]);
          if (car.atStop.onStop) car.atStop.onStop(car, car.atStop);
          apply(car);
          continue;
        }
        // Lane end: hand over to the paired return lane (a circuit, never a
        // vanish) — but only when the swap happens in the mist. In view, the car
        // pulls up at the end and waits instead, which reads as a car paused at
        // the junction, not a glitch.
        if (car.s >= car.lane.length - 1) {
          // hidden: swap at once. In view: pull up, wait a beat (a car "pausing at the junction"), then go — never wait forever.
          car.endWait = (car.endWait || 0) + dt;
          // Which lane to hand over to. With several on offer (a crossroads) the
          // car picks one at random, weighted towards the first so a lane that
          // lists a straight-ahead road first still mostly goes straight. Without
          // this a car is a token on a single-valued graph and the city is
          // 1697 islands.
          const options = car.lane.nexts && car.lane.nexts.length
            ? car.lane.nexts
            : (car.lane.next ? [car.lane.next] : null);
          if (options && (dist > WRAP_HIDE || car.endWait > 1.6)) {
            car.endWait = 0;
            const from = car.lane;
            car.lane = pickNext(options);
            // Project the car onto the lane it is handing over to, rather than
            // assuming it starts at a fixed distance. The return lane is the
            // centreline reversed, so its s = 0 is this lane's end — and with
            // several lanes per side the pair is laterally offset too, so only
            // the projection puts the car back where it actually was.
            car.s = projectLane(car.lane, car.obj.position.x, car.obj.position.z);
            car.lat = 0; car.latTarget = 0;
            car.think = 0;                   // re-decide speed for the new lane at once
            car.approach = null;             // ...and its own stops, from the top
            car.atStop = null;
          } else {
            car.s = car.lane.length - 1;
            car.speed = 0;
            car.target = 0;
          }
          apply(car);
          continue;
        }
        // brake hard, accelerate gently
        const rate = car.target < car.speed ? 7 : car.panic > 0 ? 4 : 1.6;
        car.speed = THREE.MathUtils.damp(car.speed, car.target, rate, dt);
        car.s += car.speed * dt;
        apply(car);
      }
    },
  };
}
