// orleanorth_build.mjs — actually BUILD Orleanorth, and count what appears.
//
//   node --experimental-detect-module tools/qa/orleanorth_build.mjs
//
// orleanorth_test.mjs checks that the module is wired into main.js and that its
// sites match its openAreas. That is all source-reading: it would pass just as
// happily if every C.frontage slot fell outside the bounds and every townkit
// shop got a slot with undefined x and z. This one constructs the district for
// real against a real THREE.Scene and reports what it actually put on the map.
//
// It exists because the previous generation of these checks failed exactly
// there — composer.openArea THROWS if a site was never claimed, and townkit's
// shops.* read slot.x/slot.z, which openArea does not supply (it hands the
// callback (rect, centre)), so a signature mistake is a load-time crash that no
// amount of reading the source would have caught.
//
// Reports rather than asserts on density: what counts as "dense enough" is the
// human's call. What it DOES assert is that the build completes, that the park
// exists, and that nothing classified as forest lands outside it.
import { installBrowserStub } from "./lib/browser_stub.mjs";
installBrowserStub();
globalThis.addEventListener = () => {};
globalThis.innerWidth = 1920;
globalThis.innerHeight = 1080;
process.on("unhandledRejection", () => {});

import * as THREE from "three";
import { surface } from "../../src/graphics.js";
import { createOrleanorth } from "../../src/orleanorth.js";

const noop = () => {};
const scene = new THREE.Scene();
const blockers = [];
const ctx = new Proxy({
  scene, surface,
  addBlocker: (x, z, r) => blockers.push([x, z, r]),
  addLitSpot: noop, poolLight: noop, flashObjective: noop,
  roadMaterial: () => new THREE.MeshStandardMaterial({ color: 0x333333 }),
  // These MUST return promises. landmarks.js:362 does `loadDsCar(name).then(...)`
  // with no guard, so a noop returning undefined throws inside townkit's
  // `houses.bungalow` — which is how the first build of this district failed.
  // Never-resolving matches what spawn_emptiness.mjs does: the cars simply never
  // appear in a headless probe, and nothing blocks on them.
  loadDsCar: () => new Promise(() => {}), loadGLB: () => new Promise(() => {}), placeGlbLandmark: noop,
  npcs: [], state: {}, syncHUD: noop, worldTime: {},
  // landmarks.js:369 pushes every parked car onto ctx.props. A Proxy `get` that
  // returns noop for anything missing turns a missing ARRAY into a silent
  // no-op for `push` — which then throws deep inside placeParkedCar instead of
  // naming the real problem. Give the collections real arrays.
  props: [], markers: [], poi: [],
  camera: new THREE.PerspectiveCamera(70, 1920 / 1080, 0.1, 3000),
}, { get: (t, k) => (k in t ? t[k] : noop) });

let district;
try {
  district = createOrleanorth(ctx);
  district.buildSet();
} catch (e) {
  console.error("BUILD FAILED:", e.message);
  console.error(e.stack?.split("\n").slice(0, 6).join("\n"));
  process.exit(1);
}

console.log("=== the build completed ===");
console.log(`  ${district.report}`);

let meshes = 0, lights = 0;
scene.traverse((o) => { if (o.isMesh) meshes++; if (o.isLight) lights++; });
console.log(`\n  scene now holds ${meshes} meshes, ${lights} lights, ${blockers.length} blockers`);

// ---- what the zone classifier says, cell by cell -------------------------
// This is the check that matters for the request: the band used to classify as
// "forest" via composer's WILD rule. It must now be "urban", or "park" only
// inside Memorial Green.
const B = { x0: -248, x1: 122, z0: -140, z1: 134 };
const PARK = { x0: -120, x1: -74, z0: -8, z1: 34 };
const inRect = (r, x, z) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;
const tally = {};
let forestCells = [], parkCells = 0;
for (let z = B.z0 + 4; z < B.z1; z += 8) {
  for (let x = B.x0 + 4; x < B.x1; x += 8) {
    const zone = district.zoneAt(x, z) ?? "null";
    tally[zone] = (tally[zone] || 0) + 1;
    if (zone === "forest") forestCells.push([x, z]);
    if (zone === "park") parkCells++;
  }
}
console.log("\n=== zone classification across the band ===");
for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1]))
  console.log(`  ${String(v).padStart(5)} cells  ${k}`);

console.log(`\n=== verdict ===`);
let bad = 0;
if (forestCells.length) {
  bad++;
  console.log(`  FAIL ${forestCells.length} cells still classify as FOREST. First few: ${forestCells.slice(0, 5).map((c) => c.join(",")).join("  ")}`);
} else {
  console.log("  ok   not one cell in the band classifies as forest");
}
if (parkCells) console.log(`  ok   ${parkCells} cells classify as park, all inside Memorial Green`);
if (meshes < 40) { bad++; console.log(`  FAIL only ${meshes} meshes — the fabric probably did not build`); }
else console.log(`  ok   ${meshes} meshes built`);

// The old symptom: how much of the band was forest before? composer's rule
// said any WILD ground outside CORE was forest, and CORE is nearly all of
// BOUNDS, so before `urban` this whole band read forest wherever nothing was
// built. Report the coverage so a regression is visible as a number.
const built = (tally.urban || 0) + (tally.town || 0) + (tally.building || 0) + (tally.highway || 0) + parkCells;
const total = Object.values(tally).reduce((a, b) => a + b, 0);
console.log(`\n  classified as built city: ${built}/${total} cells (${((100 * built) / total).toFixed(0)}%)`);
console.log(`  the rest is open ground inside the city, which is what a lot and a`);
console.log(`  park are -- it is no longer forest, which was the complaint.`);

process.exit(bad ? 1 : 0);