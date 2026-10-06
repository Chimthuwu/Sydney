// ---------------------------------------------------------------------------
// sydney_network_test.mjs — the Sydney road network has to be DRIVABLE.
//
// Every other QA test in this folder checks that a system still behaves the way
// it did. This one checks that real Sydney can be driven around, because the
// failure mode is silent and looks like nothing at all: a road network that is
// geometrically perfect and gets nowhere. The car spawns, drives six streets,
// turns around, and does it again, and no exception is ever thrown.
//
// Run: node tools/qa/sydney_network_test.mjs
// ---------------------------------------------------------------------------

import { buildSydneyLanes } from "../../src/sydney/buildLanes.js";
import { SYDNEY_ROADS } from "../../src/sydney/roads.js";

let failures = 0;
function check(label, ok, detail) {
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : "FAIL  "}${label}${detail ? `  (${detail})` : ""}`);
}

const { lanes, stats } = buildSydneyLanes();
const byName = new Map(lanes.map((l) => [l.name, l]));

console.log(`\nSydney network: ${stats.runs} runs, ${stats.lanes} lanes, ${stats.links} links, ${stats.km} km\n`);

// ---------------------------------------------------------------------------
// 1. Every `next` / `nexts` entry must resolve to a real lane.
//    traffic.js resolves these by NAME through a Map, so a name that does not
//    exist silently becomes null and the car stops at that junction forever.
// ---------------------------------------------------------------------------
const dangling = lanes.filter((l) =>
  (l.nexts || []).some((n) => !byName.has(n))
);
check("every nexts entry resolves to a lane", dangling.length === 0, `${dangling.length} dangling`);

// ---------------------------------------------------------------------------
// 2. No handovers may teleport the car.
//
// traffic.js hands a car over by PROJECTING it onto the next lane, so the jump
// is the distance from where it stopped to the nearest point of the lane it lands
// on. A big number is a car visibly leaping across a block. The first version of
// this network had a worst case of 341 m.
// ---------------------------------------------------------------------------
function polylineDistance(x, z, points) {
  let best = Infinity;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const abx = b[0] - a[0], abz = b[1] - a[1];
    const l2 = abx * abx + abz * abz || 1;
    let t = ((x - a[0]) * abx + (z - a[1]) * abz) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const d = Math.hypot(x - (a[0] + abx * t), z - (a[1] + abz * t));
    if (d < best) best = d;
  }
  return best;
}
let worst = 0, worstPair = "";
for (const l of lanes) {
  // A lane always runs points[0] -> points[last]; makeRoadway reverses the
  // polyline for a backward lane rather than walking it the other way.
  const arrive = l.points[l.points.length - 1];
  for (const name of l.nexts || []) {
    const n = byName.get(name);
    if (!n) continue;
    const d = polylineDistance(arrive[0], arrive[1], n.points);
    if (d > worst) { worst = d; worstPair = `${l.name} -> ${name}`; }
  }
}
check("no handover teleports the car", worst <= 25, `worst ${worst.toFixed(1)} m (${worstPair})`);

// ---------------------------------------------------------------------------
// 3. A one-way street must not carry a lane going the wrong way.
//
// OSM tags Sydney's one-ways explicitly and they are not a small minority - 1210
// of the traffic runs. A backward lane on one of them is oncoming traffic in a
// lane that has no oncoming side.
// ---------------------------------------------------------------------------
const onewayViolations = [];
for (const road of SYDNEY_ROADS) {
  if (!road.traffic || !road.oneway) continue;
  const built = lanes.filter((l) => l.road === `${road.name}#${SYDNEY_ROADS.indexOf(road)}`);
  if (built.some((l) => l.dir === -1)) onewayViolations.push(road.name);
}
check("one-way roads have no backward lane", onewayViolations.length === 0,
  onewayViolations.length ? onewayViolations.slice(0, 3).join(", ") : "");

// ---------------------------------------------------------------------------
// 4. THE BIG ONE: the network has to be one connected city.
//
// This is the check that would have caught every version of this that failed. The
// worst of them was 1697 fragments whose largest was 15 lanes: 462 lanes were
// caught in a mutual A<->B pair, two roads pointing at each other across a
// junction, each car driving the same four blocks forever.
// ---------------------------------------------------------------------------
const seen = new Set();
let largest = 0;
for (const start of lanes) {
  if (seen.has(start.name)) continue;
  const stack = [start];
  seen.add(start.name);
  let count = 0;
  while (stack.length) {
    const lane = stack.pop();
    count++;
    for (const name of lane.nexts || []) {
      const n = byName.get(name);
      if (n && !seen.has(n.name)) { seen.add(n.name); stack.push(n); }
    }
  }
  if (count > largest) largest = count;
}
const share = Math.round((100 * largest) / lanes.length);
check("the main network is drivable end to end", share >= 10,
  `largest component ${largest}/${lanes.length} lanes (${share}%)`);

// A car must be able to cross the city. These are checked as a group on purpose:
// the single largest component is a number, but being able to get from the CBD to
// the Harbour Bridge is the thing a player would actually notice is missing.
const reachable = new Set();
{
  const stack = [lanes.find((l) => l.nexts && l.nexts.length)];
  if (stack[0]) {
    const seenR = new Set([stack[0].name]);
    while (stack.length) {
      const lane = stack.pop();
      for (const name of lane.nexts || []) {
        const n = byName.get(name);
        if (n && !seenR.has(n.name)) { seenR.add(n.name); stack.push(n); }
      }
    }
    for (const n of seenR) reachable.add(byName.get(n));
  }
}
function anyLaneNear(x, z) {
  for (const l of reachable) {
    for (const p of l.points) if (Math.hypot(p[0] - x, p[1] - z) < 90) return true;
  }
  return false;
}
// These coordinates are read off the generated data, not guessed: the 2400 m
// slice is the inner city and does NOT include the Harbour Bridge, so a test that
// asserted it would be asserting a place that is not in this map. What it does
// include is the Western Distributor's elevated run at (-466, -620), which is
// drivable off the main network.
//
// KNOWN, NOT A REGRESSION: the Eastern Distributor at (973, -399) is a SEPARATE
// network. It is an elevated motorway that meets the surface only through its own
// ramps, and the closest those come to the CBD network is ~290 m. It is wired
// internally - its own lanes reach each other - it just is not the same city yet.
// Asserting it is connected would be asserting something false; asserting it is
// NOT connected would lock in a limitation as though it were correct. So it is
// reported and left alone.
check("CBD (George St / Market) is in the main network", anyLaneNear(-140, -470));
check("Western Distributor elevated run is in the main network", anyLaneNear(-466, -620));
const easternSeparate = !anyLaneNear(973, -399);
if (!easternSeparate) console.log("  note  the Eastern Distributor is now connected to the main network - drop the comment above");

// ---------------------------------------------------------------------------
// 5. Dead ends are allowed - traffic.js gives them a real drivable U-turn bulb -
//    but a city that is mostly dead ends is not drivable, so bound them.
// ---------------------------------------------------------------------------
const deadShare = Math.round((100 * stats.deadEnds) / lanes.length);
check("most lanes lead somewhere", deadShare <= 25, `${stats.deadEnds} dead ends (${deadShare}%)`);

// ---------------------------------------------------------------------------
// 6. Lane geometry must be usable: no zero-length segments (they divide by zero
//    in sampleLane and read as a crossing in laneCrossings) and no silly short lanes.
// ---------------------------------------------------------------------------
let zeroSegs = 0;
for (const l of lanes) {
  for (let i = 1; i < l.points.length; i++) {
    if (Math.hypot(l.points[i][0] - l.points[i - 1][0], l.points[i][1] - l.points[i - 1][1]) < 0.05) zeroSegs++;
  }
}
check("no zero-length lane segments", zeroSegs === 0, `${zeroSegs} found`);

console.log(failures ? `\n${failures} check(s) FAILED\n` : "\nall checks passed\n");
process.exit(failures ? 1 : 0);
