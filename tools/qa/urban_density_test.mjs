// ---------------------------------------------------------------------------
// urban_density_test.mjs — is downtown still a city?
//
//   node --experimental-detect-module tools/qa/urban_density_test.mjs
//
// "Theres still a lot of like empty parts right in Chatboro and like the main
// city area lots of like empty space that could be filled up so the environment
// feels more urban like a concrete jungle."
//
// The survey behind this is tools/qa/landuse.mjs, which measures open ground and
// building MASS rather than counting objects — a lamp post is a building by a
// naive count and a lawn is a car park, which is how the first version of that
// tool reported a full city and contradicted the player.
//
// Metro measured 41.4% of its plot more than 30 m from a real structure, and
// the cause was not an empty grid: six of sixteen blocks were being thrown away
// whole because Parish Highway 9's exclusion was claimed at pad 30 — a 74 m
// corridor for a 14 m road — and the fallback that filled what was left cut each
// block into three columns, which a diagonal road crosses in all three. Fixed in
// src/metro.js; the numbers below are what it measures now, with headroom for
// the ~18% that is the US-167 carriageway and genuinely must stay open.
//
// These are measured values, not aspirations. If one fails, the city has lost
// density and something upstream is silently refusing to build.
// ---------------------------------------------------------------------------

import { installBrowserStub } from "./lib/browser_stub.mjs";
installBrowserStub();
globalThis.addEventListener = () => {};
globalThis.innerWidth = 1920;
globalThis.innerHeight = 1080;
process.on("unhandledRejection", () => {});

import * as THREE from "three";
import { surface } from "../../src/graphics.js";
const characters = await import("../../src/characters.js");

const noop = () => {};
const scene = new THREE.Scene();
const ctx = new Proxy({
  scene, surface, addBlocker: noop, addLitSpot: noop, poolLight: noop, flashObjective: noop,
  addService: noop, makeBillboard: noop, makeFence: noop, makeBarrel: noop, makePallet: noop,
  makeNeonSign: () => new THREE.MeshStandardMaterial({ color: 0xff4fb3 }),
  roadMaterial: () => new THREE.MeshStandardMaterial({ color: 0x2b2b30 }),
  getSheriffProto: () => ({}), lots: [], services: [], pois: [], props: [],
  makeHoodrat: (o) => characters.makeHoodrat(o),
  playerPos: new THREE.Vector3(0, 0, 300),
  worldTime: { isNight: () => false, hour: () => 12 },
  document: globalThis.document, window: globalThis,
  resolveCollision: (_c, n) => n,
  loadDsCar: () => new Promise(() => {}), loadGLB: () => new Promise(() => {}),
  loadModel: () => new Promise(() => {}), loadVehicle: () => new Promise(() => {}),
  loadCharacter: () => new Promise(() => {}), loadKit: () => new Promise(() => {}),
}, {
  get: (t, k) => {
    if (k in t) return t[k];
    if (typeof k === "string" && /(lots|services|pois|props|occluders|blockers|lanes|people|actors)$/.test(k)) return [];
    return noop;
  },
  set: (t, k, v) => { t[k] = v; return true; },
});

let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : " FAIL " } ${label}${detail ? `  — ${detail}` : ""}`);
};

// ------------------------------------------------------------- what a city is
const MIN_FOOT = 20;    // m2 — a lamp post is not a building
const MIN_H = 4;        // m
const SX = 20;          // sample pitch, m
const NEAR = 30;        // m — "open ground" means further than this from a structure

const mod = await import("../../src/metro.js");
const metro = mod.createMetro(ctx);
const blocks = metro.buildSet();
scene.updateMatrixWorld(true);

const box = new THREE.Box3();
const structures = [];
scene.traverse((o) => {
  if (!o.isMesh) return;
  box.setFromObject(o);
  if (!isFinite(box.min.y) || !isFinite(box.max.y)) return;
  const h = box.max.y - box.min.y;
  if (h < MIN_H) return;
  const w = box.max.x - box.min.x, d = box.max.z - box.min.z;
  if (w <= 0 || d <= 0 || w * d < MIN_FOOT) return;
  structures.push({ x: (box.min.x + box.max.x) / 2, z: (box.min.z + box.max.z) / 2, r: Math.hypot(w, d) / 2, h, foot: w * d });
});

const B = mod.METRO_BOUNDS;
const hectares = (B.x1 - B.x0) * (B.z1 - B.z0) / 1e4;
let mass = 0, samples = 0, open = 0, reachSum = 0;
for (let z = B.z0; z < B.z1; z += SX) for (let x = B.x0; x < B.x1; x += SX) {
  const px = x + SX / 2, pz = z + SX / 2;
  let best = Infinity;
  for (const s of structures) best = Math.min(best, Math.hypot(s.x - px, s.z - pz) - s.r);
  best = Math.max(0, best);
  samples++;
  reachSum += best;
  if (best > NEAR) open++;
}
for (const s of structures) mass += s.foot * s.h;

const overPct = (open / samples) * 100;
const massPerHa = Math.round(mass / hectares);
const meanReach = reachSum / samples;
const tallest = Math.max(0, ...structures.map((s) => s.h));

// ------------------------------------------------------------------- the gate
// 18% measured, and most of that is the US-167 carriageway plus Parish Highway 9
// — roads, which are supposed to be open. 30% is the old broken number's floor
// with room to spare; nothing about this city should be near it again.
check(`open ground stays under 30% of the plot`, overPct < 30, `${overPct.toFixed(1)}% over ${NEAR} m (${open}/${samples} samples)`);
// 35.2 m before the fix, 13.5 m after. The floor is not zero and cannot be: the
// plot is a quarter US-167 and a diagonal of Parish Highway 9, and a road is
// open by definition. 16 m leaves headroom above the measured 13.5 while still
// failing loudly on anything close to the old figure.
check("mean distance to a building stays under 16 m", meanReach < 16, `${meanReach.toFixed(1)} m`);
// 59,158 m3/ha measured, 40,207 before the fix. Mass is the "concrete jungle"
// claim: a district of two-storey houses and a district of towers can share a
// coverage figure and have completely different mass.
check("built mass per hectare stays above 50,000", massPerHa > 50000, `${massPerHa} m3/ha`);
check("there are real structures to measure", structures.length >= 150, `${structures.length} structures in ${blocks} blocks`);
// OrleaRouge, the densest district in the state, tops out at 62 m. Metro was 46 m
// before and is 69 m now; a downtown with no tower over 60 m is not downtown.
check("the skyline still has towers", tallest > 60, `tallest ${tallest.toFixed(1)} m`);

console.log(`\n  Metro: ${hectares.toFixed(1)} ha, ${blocks} blocks, ${structures.length} structures, ${massPerHa} m3/ha, mean reach ${meanReach.toFixed(1)} m`);
if (failures) {
  console.log(`urban_density_test: ${failures} failure(s)`);
  process.exit(1);
}
console.log("urban_density_test: all checks passed");
