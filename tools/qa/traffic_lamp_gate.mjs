// traffic_lamp_gate.mjs — drives the REAL traffic system and proves the lamp gate
// works, rather than only matching its source text.
//
//   node --experimental-detect-module tools/qa/traffic_lamp_gate.mjs
//
// Why this exists: the traffic lamp gate was verified twice by reading the source
// and once by `node --check`, and both passed on code that could not run --
// `car.lamps = []` was written before `const car` was declared, a TDZ
// ReferenceError thrown the moment a car was built. Source-text assertions and
// `--check` cannot see that class of bug. This test EXECUTES buildCar().
//
// It builds a real THREE scene, a real lane, and real car models, runs the real
// createTraffic(), and asserts on real Sprite.visible values:
//   1. a car near the focus has its lamps visible;
//   2. a car far from the focus does not;
//   3. the pool builds without throwing (the TDZ check);
//   4. every lamp belongs to a car and every car has exactly 4;
//   5. moving the focus re-gates without rebuilding the car (identity preserved).

import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
// The ESM entry, not require() -- three's UMD build is deprecated past r150 and
// loading it via require gives a default export with no named classes, so
// `new THREE.Scene()` throws "not a constructor".
const THREE = await import(pathToFileURL(join(here, "../../node_modules/three/build/three.module.js")).href);

// pathToFileURL, not a bare absolute path: on Windows "Z:\..." parses as a URL
// with scheme "z:" and the ESM loader rejects it with ERR_UNSUPPORTED_ESM_URL_SCHEME.
const { createTraffic, makeRoadway } = await import(pathToFileURL(join(here, "../../src/traffic.js")).href);

let fails = 0;
const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m) => { console.log(`  FAIL ${m}`); fails++; };
const check = (c, m) => (c ? ok(m) : bad(m));

// --- a minimal stand-in for the game's car models: one mesh plus its scale ---
function makeModel(name, scale = 1) {
  const g = new THREE.Group();
  g.name = name;
  g.scale.setScalar(scale);
  const body = new THREE.Mesh(new THREE.BoxGeometry(2, 1.2, 4), new THREE.MeshBasicMaterial());
  body.name = "body";
  g.add(body);
  return g;
}

// --- minimal DOM stub -------------------------------------------------
// buildCar() -> lampMaterial() -> glowTexture() paints the lamp glow onto a
// canvas, so it needs a document. A 2x2 stub is enough: this test asserts
// Sprite visibility and parenting, never the texture's pixels.
globalThis.document = {
  createElement(tag) {
    if (tag !== 'canvas') return {};
    return { width: 2, height: 2, getContext: () => ({
      createRadialGradient: () => ({ addColorStop() {} }),
      createLinearGradient: () => ({ addColorStop() {} }),
      fillStyle: '', fillRect() {}, clearRect() {}, drawImage() {},
      getImageData: () => ({ data: new Uint8ClampedArray(4) }),
      putImageData() {}, beginPath() {}, arc() {}, fill() {},
    }) };
  },
};
// ----------------------------------------------------------------------
const scene = new THREE.Scene();
const registered = [];
// A straight 400 m north-south roadway, built by the REAL makeRoadway() so the
// lane has whatever shape makeLane() expects (`def.points`, `def.road`, `def.dir`).
// A hand-rolled lane object threw "Cannot read properties of undefined (reading
// 'map')" inside createTraffic -- the lanes are roadway definitions, not lanes.
const lanes = makeRoadway({ lanes: 1, points: [[0, 0], [0, 400]] });

let traffic;
try {
  traffic = createTraffic({
    scene,
    // `blocker` is a real Vector2 the vehicle system owns (park() moves it to
    // 1e5 to keep a parked car out of the way); main.js's registerVehicle
    // provides it. Omitting it made park() throw on `.z`, not my code.
    registerVehicle: (obj) => {
      const v = { obj, blocker: new THREE.Vector2(0, 0), seats: [{ occupant: null }], dead: false };
      registered.push(v);
      return v;
    },
    unregisterVehicle: () => {},
    models: [makeModel("carA"), makeModel("carB", 1.1)],
    lanes,
    perLane: 3,
    maxCars: 6,
    spawnMin: 5, spawnMax: 20,
    despawn: 390,
    wrapHide: 350,
    lampRange: 110,
  });
  ok("createTraffic() built without throwing (the car.lamps TDZ check)");
} catch (e) {
  bad(`createTraffic() threw: ${e.message}`);
  console.log(`\n${fails} FAILURE(S)`);
  process.exit(1);
}

// run enough updates to fill the pool and place cars
const focus = { x: 0, z: 10 };
let placed = null;
try {
  for (let i = 0; i < 240; i++) traffic.update(1 / 60, focus, [], null);
  ok("240 update() calls ran without throwing");
} catch (e) {
  bad(`update() threw: ${e.message} — ${e.stack.split("\n")[1] || ""}`);
}

const all = [];
// walk the pool: createTraffic returns a public surface; reach the cars via the
// registered vehicles, which is the same list buildCar() feeds
const cars = registered.map((v) => v.traffic).filter(Boolean);

console.log(`\n=== pool: ${cars.length} cars built, ${cars.reduce((n, c) => n + (c.lamps ? c.lamps.length : 0), 0)} lamp sprites ===`);
check(cars.length > 0, "at least one car was built");
check(cars.every((c) => c.lamps && c.lamps.length === 4),
  "every car has exactly 4 lamps (2 head + 2 tail), matching buildCar's per-side loop");
check(cars.every((c) => c.lamps.every((l) => l.isSprite === true)),
  "every lamp really is a THREE.Sprite (so the cost being removed is sprite draws)");
check(cars.every((c) => c.lamps.every((l) => l.parent === c.obj)),
  "lamps are children of their car, so they inherit the car's transform and stay in the reflection list");

console.log("\n=== the gate actually toggles ===");
// place one car near the focus and one far, then step one frame
if (cars.length) {
  const near = cars[0], far = cars[Math.min(1, cars.length - 1)];
  // snap them to known distances from `focus` (focus is at z=10)
  near.obj.position.set(0, 0, 15);      // 5 m away  -> lamps on
  far.obj.position.set(0, 0, 380);      // 370 m away -> lamps off
  traffic.update(1 / 60, focus, [], null);

  check(near.lampsOn === true, `a car 5 m from the focus shows its lamps (lampsOn=${near.lampsOn})`);
  check(far.lampsOn === false, `a car 370 m away hides its lamps (lampsOn=${far.lampsOn})`);
  check(near.lamps.every((l) => l.visible === true), "the near car's 4 sprites are visible");
  check(far.lamps.every((l) => l.visible === false), "the far car's 4 sprites are hidden");

  // and it re-gates as the car moves, without rebuilding
  const before = near.lamps[0];
  near.obj.position.set(0, 0, 380);
  traffic.update(1 / 60, focus, [], null);
  check(near.lampsOn === false, "moving the car away turns its lamps off on the next frame");
  check(near.lamps[0] === before, "the same Sprite objects were toggled, not rebuilt or replaced");
  check(near.obj.children.includes(before), "and they are still parented to the car");
}

console.log("\n=== active cars far from the focus are all dark ===");
// NOT "move the cars far away": a car outside its lane despawns before apply()
// runs, so it is never re-gated and the assertion would be testing the despawn
// path. Instead walk the still-active cars, force each one far from the focus,
// and re-gate -- which is the condition that actually matters in game: cars that
// exist and are active, but are not near you, draw no lamps.
{
  const active = cars.filter((c) => c.active);
  if (!active.length) {
    // the pool parks cars until they are needed; run more frames to activate some
    for (let i = 0; i < 600; i++) traffic.update(1 / 60, focus, [], null);
  }
  const live = cars.filter((c) => c.active);
  check(live.length > 0, "at least one car is active (not parked)");
  // keep each car ON its lane but far along it, so it stays active and reaches apply()
  const L = 400;
  for (const c of live) {
    c.obj.position.set(0, 0, 395);          // far end of the 400 m lane
    c.lampsOn = true;                       // force a change so the gate must act
  }
  traffic.update(1 / 60, { x: 0, z: 5 }, [], null);   // player at the near end
  check(live.every((c) => c.lampsOn === false),
    `all ${live.length} active cars 390 m from the player have their lamps off`);
  check(live.every((c) => c.lamps.every((l) => l.visible === false)),
    "and all of their lamp sprites are hidden");

  // and walking one back to the player turns them on again
  live[0].obj.position.set(0, 0, 10);
  traffic.update(1 / 60, { x: 0, z: 5 }, [], null);
  check(live[0].lampsOn === true, "a car brought within range lights up again on the next frame");
}

console.log(`\n${fails ? fails + " FAILURES" : "the lamp gate works at runtime: near cars lit, far cars dark, toggled in place"}`);
process.exit(fails ? 1 : 0);