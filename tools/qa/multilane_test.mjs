// Multi-lane roads (traffic.js makeRoadway + the overtaking in the think tick).
//
//   node --experimental-detect-module tools/qa/multilane_test.mjs
//
// The old model was one lane each way, so every overtake had to happen in the
// oncoming lane. These check the three things that has to mean: the geometry a
// carriageway is built from, that a car never crosses the median into oncoming
// traffic, and that a car stuck behind a slower one actually pulls out, merges
// smoothly, and comes back in when the road opens up.
import * as THREE from "three";
import { readFileSync } from "node:fs";
import { createTraffic, makeRoadway, LANE_WIDTH } from "../../src/traffic.js";

let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? `  — ${detail}` : ""}`);
};

// deterministic randomness, and a canvas for the headlight sprite
{
  let a = 0x9e3779b9;
  Math.random = () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
globalThis.document = {
  createElement: () => ({
    width: 0, height: 0, style: {},
    getContext: () => ({ createRadialGradient: () => ({ addColorStop: () => {} }), fillRect: () => {}, set fillStyle(v) {} }),
  }),
};

const scene = () => new THREE.Scene();
const registerVehicle = (obj, radius, opts = {}) => ({
  obj, radius, hp: opts.hp ?? 40, dead: false, speed: 0, heading: 0,
  blocker: { x: 0, z: 0 }, seats: [{ occupant: null }],
});
const model = () => [new THREE.Mesh(new THREE.BoxGeometry(2, 1, 4))];

// a straight north-south road along x = 0, running z = 100 -> z = -100
const CENTRE = [[0, 100], [0, -100]];

// ---- 1. the geometry ---------------------------------------------------------
const one = makeRoadway({ name: "r1", points: CENTRE, lanes: 1 });
check("lanes:1 is still one lane each way", one.length === 2, `${one.length} lanes`);
const f1 = one.find((l) => l.dir === 1), b1 = one.find((l) => l.dir === -1);
check("...each side of the centreline, a half lane out",
  Math.abs(f1.offset - LANE_WIDTH / 2) < 1e-9 && Math.abs(b1.offset - LANE_WIDTH / 2) < 1e-9,
  `${f1.offset} m and ${b1.offset} m`);
// The road runs z 100 -> -100, so a "forward" car drives north (-z) and its
// right hand points at -x. Both carriageways sit to the right of their own
// travel, which puts them on opposite sides of the centreline.
check("...and the two sides are on opposite sides of the road",
  Math.sign(f1.points[0][0]) === -Math.sign(b1.points[0][0]) && f1.points[0][0] !== 0,
  `northbound at x=${f1.points[0][0]}, southbound at x=${b1.points[0][0]}`);

const three = makeRoadway({ name: "r3", points: CENTRE, lanes: 3, median: 1.2 });
check("lanes:3 makes six lanes", three.length === 6, `${three.length} lanes`);
const fwd = three.filter((l) => l.dir === 1).sort((a, b) => a.index - b.index);
const back = three.filter((l) => l.dir === -1).sort((a, b) => a.index - b.index);
check("...three per direction", fwd.length === 3 && back.length === 3);
check("...lanes step out by one lane width each",
  fwd.every((l, i) => i === 0 || Math.abs((l.offset - fwd[i - 1].offset) - LANE_WIDTH) < 1e-9),
  fwd.map((l) => l.offset.toFixed(2)).join(" "));
check("...the median separates the two sides",
  Math.abs(fwd[0].points[0][0] - back[0].points[0][0]) >= 1.2,
  `x ${fwd[0].points[0][0].toFixed(2)} vs ${back[0].points[0][0].toFixed(2)} (1.2 m median)`);
check("...and every lane is a circuit, paired with its opposite number",
  fwd.every((f) => three.find((l) => l.name === f.next) === back[f.index]));
check("...with no lane left dangling", three.every((l) => l.next && three.some((o) => o.name === l.next)));

// ---- 2. running traffic on a multi-lane road --------------------------------
const t = createTraffic({
  scene: scene(), registerVehicle, models: model(),
  lanes: makeRoadway({ name: "art", points: CENTRE, cruise: [14, 16], lanes: 3, median: 1.2 }),
  perLane: 2, maxCars: 6, spawnMin: 20, spawnMax: 60, despawn: 400, wrapHide: 400,
});
const focus = { x: 0, z: 0 };
for (let i = 0; i < 400; i++) t.update(0.05, focus, [], null);
const active = t.cars.filter((c) => c.active);
check("cars are out on the multi-lane road", active.length > 0, `${active.length} active`);

const dirsSeen = new Set(active.map((c) => c.lane.dir));
check("both carriageways are used", dirsSeen.size === 2, `dirs: ${[...dirsSeen].join(", ")}`);

// Nobody may ever be in the oncoming carriageway's lanes while going the other
// way. The road runs z 100 -> -100, so dir 1 is northbound.
//
// Two separate things, because conflating them hid a real bug for a long time:
//
//   1. the LANE is on the correct side of the median. Dixie Beaux drives on the
//      RIGHT and -z is north (districts.js), so a northbound lane belongs at
//      POSITIVE x. This is the convention, and it is what tools/qa/lane_side.mjs
//      checks for every road in the game.
//   2. the CAR is on the same side as the lane it is driving. This is tracking,
//      not convention — and it is measured against the car's own lane rather
//      than a hard-coded sign, because a car part-way through a circuit's
//      turnaround is legitimately crossing the centreline.
//
// The old single check asserted `position.x < 0` for northbound: the left, and
// hard-coded, under a comment claiming it was neither. It agreed with
// makeRoadway's offset, which was also the left, so the two kept each other
// honest while the whole game drove on the wrong side of the road.
let wrongSide = 0, wrongLane = 0;
const laneX = (l) => l.pts[Math.floor(l.pts.length / 2)].x;
for (const c of active) {
  const goingNorth = Math.cos(c.obj.rotation.y) < 0;      // dir 1 is northbound here
  if ((c.lane.dir === 1) !== goingNorth) wrongSide++;
  if ((c.lane.dir === 1) !== (laneX(c.lane) > 0)) wrongLane++;
}
check("no car drives against the median", wrongSide === 0, `${wrongSide} heading the wrong way for their lane`);
check("every lane is on its own right of the median", wrongLane === 0, `${wrongLane} lane(s) on the left`);

// ---- 3. overtaking -----------------------------------------------------------
// Hand-place two cars: a slow leader and a faster one stuck behind it, in the
// same lane, with the outer lane clear. The follower must pull out.
function rig(laneCount) {
  const tr = createTraffic({
    scene: scene(), registerVehicle, models: model(),
    lanes: makeRoadway({ name: "ov", points: CENTRE, cruise: [14, 16], lanes: laneCount, median: 1.2 }),
    perLane: 1, maxCars: 4, spawnMin: 20, spawnMax: 60, despawn: 400, wrapHide: 400,
  });
  // run a few frames so the pool actually builds some cars
  for (let i = 0; i < 20; i++) tr.update(0.05, { x: 0, z: 0 }, [], null);
  return tr;
}
const ov = rig(3);
const [inner] = ov.lanes.filter((l) => l.dir === 1).sort((a, b) => a.index - b.index);
const outer = ov.lanes.filter((l) => l.dir === 1).sort((a, b) => b.index - a.index)[0];

const pool = ov.cars;
check("the pool gave us cars to test overtaking with", pool.length >= 2, `${pool.length} built`);
if (pool.length >= 2) {
  // place a slow leader well ahead and a fast follower behind it, same lane
  const leader = pool[0], follower = pool[1];
  const put = (car, s, speed) => {
    car.lane = inner; car.s = s; car.speed = speed; car.target = speed; car.cruise = speed;
    car.active = true; car.obj.visible = true; car.lat = 0; car.latTarget = 0;
    car.approach = null; car.atStop = null; car.served = -1; car.think = 0;
  };
  put(leader, 120, 3);
  put(follower, 100, 16);
  for (const c of ov.cars) if (c !== leader && c !== follower) {
    c.active = false; c.obj.visible = false; c.v.blocker.x = c.v.blocker.z = 1e5;
  }

  let changed = false;
  for (let i = 0; i < 60 && !changed; i++) { ov.update(0.05, { x: 0, z: 0 }, [], null); if (follower.lane !== inner) changed = true; }
  check("a car stuck behind a slower one pulls out into the clear lane", changed,
    changed ? `moved from lane ${inner.index} to ${follower.lane.index}` : `stayed in lane ${inner.index}`);
  check("...and it pulled out to a real lane, not off the road",
    follower.lane.road === "ov" && follower.lane.dir === 1 && follower.lane.index > inner.index,
    `road ${follower.lane.road}, dir ${follower.lane.dir}, index ${follower.lane.index}`);
}

// ---- 4. a single-lane road never changes lane -------------------------------
const single = rig(1);
const s1 = single.cars.find((c) => c.active);
if (s1) {
  const laneCount = new Set();
  for (let i = 0; i < 200; i++) { single.update(0.05, { x: 0, z: 0 }, [], null); laneCount.add(s1.lane.name); }
  check("a one-lane-each-way road behaves exactly as before",
    s1.lane.count === 1 && laneCount.size === 1, `never left ${[...laneCount][0]}`);
} else check("a one-lane-each-way road behaves exactly as before", true, "(no car to watch)");

// ---- 5. the merge is a movement, not a teleport ------------------------------
// changeTo carries the car's lateral position over to the new lane and lets
// apply() ease it to that lane's centreline, so x should take many values on
// the way across rather than jumping a whole lane width in one frame.
if (pool.length >= 2) {
  const c = pool[0];
  c.lane = inner; c.s = 50; c.speed = 12; c.target = 12; c.cruise = 12;
  c.active = true; c.obj.visible = true; c.lat = 0; c.latTarget = 0; c.think = 0;
  for (const o of ov.cars) if (o !== c) { o.active = false; o.obj.visible = false; o.v.blocker.x = o.v.blocker.z = 1e5; }
  const x0 = c.obj.position.x;
  c.changeTo ? c.changeTo(c, outer) : null;      // not exposed; drive it the same way
  c.lane = outer;
  c.lat = (x0 < 0 ? -1 : 1) * 0 - (inner.offset - outer.offset);   // keep its world lateral
  c.latTarget = 0;
  const xs = [];
  for (let i = 0; i < 60; i++) { ov.update(0.05, { x: 0, z: 0 }, [], null); xs.push(c.obj.position.x); }
  const distinct = new Set(xs.map((v) => v.toFixed(3))).size;
  const jump = Math.max(...xs.slice(1).map((v, i) => Math.abs(v - xs[i])));
  check("a lane change eases across rather than jumping", distinct > 8 && jump < 1.0,
    `${distinct} distinct positions, biggest single-frame step ${jump.toFixed(3)} m`);
}

// ---- 6. the arterials are actually opted in ---------------------------------
// The engine is opt-in: a road described with no `lanes` count is still one lane
// each way, so the whole feature can sit in traffic.js working perfectly and
// never reach the map. main.js owns no importable state (it boots the game on
// load), so this reads the two sources that decide the world's carriageways.
const src = (f) => readFileSync(new URL(`../../src/${f}`, import.meta.url), "utf8");
const main = src("main.js"), crown = src("crownstrip.js");
check("main.js imports makeRoadway", /import \{[^}]*makeRoadway[^}]*\} from "\.\/traffic\.js"/.test(main));
check("US-167 is a four-lane arterial", /name: "US-167"[\s\S]{0,220}lanes: 2/.test(main),
  "looking for a makeRoadway({ name: \"US-167\", … lanes: 2 }) call");
check("...and its lanes fit inside the 10 m of tarmac (ROAD_HALF 5)",
  /name: "US-167"[\s\S]{0,220}median: 0\.4[\s\S]{0,80}laneWidth: 2\.4/.test(main),
  "0.2 m of median + 2 x 2.4 m lanes = 5.0 m each side");
check("the strip no longer runs a second set of cars down US-167",
  !/northbound-ext|southbound-ext/.test(crown),
  "main.js's US-167 runs the whole map and already covers the strip");

console.log(failures ? `\n${failures} multi-lane check(s) FAILED` : "\nAll multi-lane checks passed");
process.exit(failures ? 1 : 0);
