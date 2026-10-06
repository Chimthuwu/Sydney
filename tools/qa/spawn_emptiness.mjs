// ---------------------------------------------------------------------------
// spawn_emptiness.mjs — probe the ground the player actually stands on.
//
//   node --experimental-detect-module tools/qa/spawn_emptiness.mjs
//
// A human report (2026-10-01): "there's still parts of it that are just kind of
// empty and it doesn't actually feel like a city, it needs to feel like a city"
// — and specifically NEAR THE SPAWN.
//
// Every existing density tool passes. urban_density_test.mjs measures the Metro
// grid, block_interiors_test.mjs measures block interiors, city_scale_test.mjs
// measures block COUNT. All three are happy, and the human is still standing in
// a field. The reason is that they all measure OrleaRouge — and the player does
// not spawn in OrleaRouge. main.js puts the player at (ROAD_X, SPAWN_Z) = (-6,
// 130), which is SOUTH of the city grid, on the approach road. So the question
// that matters was never asked: what is between the spawn point and the first
// block?
//
// This walks a grid over a radius around the spawn and reports, per cell, how
// far the nearest real structure is (landuse.mjs's own "reach" definition:
// >= 20 m2 footprint, >= 4 m tall) and the mean height of what is there. It is a
// READ-ONLY probe — it reports, it does not assert, because the thresholds are
// the human's call and not mine to invent.
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
  // main.js's road constants. orlearouge.js throws without them (its own guard:
  // a Proxy fallback would make ROAD_X a function and the western half of the
  // grid would silently vanish), and landuse.mjs passes the same numbers.
  ROAD_X: -6, ROAD_HALF: 5, LOT_X: 24,
  getSheriffProto: () => ({}), lots: [], services: [], pois: [], props: [],
  makeHoodrat: (o) => characters.makeHoodrat(o),
  playerPos: new THREE.Vector3(0, 0, 300),
  worldTime: { isNight: () => false, hour: () => 12 },
  document: globalThis.document, window: globalThis,
  resolveCollision: (_c, n) => n,
  loadDsCar: () => new Promise(() => {}), loadGLB: () => new Promise(() => {}),
  loadModel: () => new Promise(() => {}), loadVehicle: () => new Promise(() => {}),
}, {
  get: (t, k) => {
    if (k in t) return t[k];
    if (typeof k === "string" && /(lots|services|pois|props|occluders|blockers|lanes|people|actors)$/.test(k)) return [];
    return noop;
  },
  set: (t, k, v) => { t[k] = v; return true; },
});

// Build the world exactly as main.js does, in the same order.
const SPAWN = { x: -6, z: 130 };          // main.js: ROAD_X, SPAWN_Z
const D = [
  ["orlea", "../../src/orlearouge.js", "createOrleaRouge"],
  ["metro", "../../src/metro.js", "createMetro"],
  ["crown", "../../src/crownstrip.js", "createCrownStrip"],
  ["west", "../../src/westparish.js", "createWestParish"],
  ["east", "../../src/eastbank.js", "createEastBank"],
  ["tus", "../../src/tusouxroe.js", "createTusouxroe"],
  ["chat", "../../src/chatboro.js", "createChatboro"],
  ["shruston", "../../src/shruston.js", "createShruston"],
  ["chars", "../../src/charsoufre.js", "createCharsoufre"],
  ["orleanorth", "../../src/orleanorth.js", "createOrleanorth"],
  ["state", "../../src/stateWorld.js", "createStateWorld"],
];
const d = {};
// before ANY buildSet(): stateWorld.js's terrain pass calls ctx.otherLanes()
// while building, and the Proxy would hand it a noop() function (not iterable).
ctx.otherLanes = () => [];
for (const [k, p, fn] of D) {
  d[k] = (await import(p))[fn](ctx);
  // buildSet() on EVERY district, exactly as landuse.mjs does it — without
  // this only the state wilderness is built and the city never exists, which
  // is how the first version of this probe reported "130 m to the nearest
  // building" AT the spawn point.
  if (d[k].buildSet) d[k].buildSet();
}

// world matrices must be current before anything reads a position out of one
scene.updateMatrixWorld(true);

// ---------------------------------------------------------------- the census
// One pass over the scene: every mesh big and tall enough to be a structure.
// Measure the WORLD-SPACE box (setFromObject), not the local geometry box: a
// mesh parented into a district group sits at its local origin until the world
// matrices are resolved, and the geometry box has no idea where that is.
const structures = [];
scene.traverse((o) => {
  if (!o.isMesh || !o.geometry) return;
  const bb = new THREE.Box3().setFromObject(o);
  if (!isFinite(bb.min.y) || !isFinite(bb.max.y)) return;
  const h = bb.max.y - bb.min.y;
  if (h < 4) return;                                  // landuse.mjs's MIN_H
  const w = bb.max.x - bb.min.x, dp = bb.max.z - bb.min.z;
  if (w <= 0 || dp <= 0) return;
  const area = w * dp;
  if (area < 20) return;                              // MIN_FOOT
  structures.push({
    x: (bb.min.x + bb.max.x) / 2, z: (bb.min.z + bb.max.z) / 2,
    h, area,
    // the box half-extents, so "reach" is measured to a WALL. Using the centre
    // would count up to 25 m of open ground beside a long building as covered —
    // the mistake landuse.mjs documents at length.
    hx: w / 2, hz: dp / 2,
  });
});

// distance from (x,z) to the nearest structure, measured to its WALL
function distTo(s, x, z) {
  const dx = Math.max(0, Math.abs(x - s.x) - s.hx);
  const dz = Math.max(0, Math.abs(z - s.z) - s.hz);
  return Math.hypot(dx, dz);
}
function reach(x, z, maxR = 120) {
  let best = Infinity, sum = 0, n = 0, tallest = 0;
  for (const s of structures) {
    const d = distTo(s, x, z);
    if (d < best) best = d;
    if (d <= maxR) { sum += s.h; n++; if (s.h > tallest) tallest = s.h; }
  }
  return { reach: best, meanH: n ? sum / n : 0, near: n, tallest };
}

const STEP = 20, RINGS = [60, 120, 200, 300];
console.log(`spawn is (${SPAWN.x}, ${SPAWN.z}); ${structures.length} structures in the scene\n`);

for (const R of RINGS) {
  const cells = [];
  for (let z = SPAWN.z - R; z <= SPAWN.z + R; z += STEP) {
    for (let x = SPAWN.x - R; x <= SPAWN.x + R; x += STEP) {
      const m = reach(x, z, R);
      if (m.reach > 30) cells.push({ x, z, ...m });
    }
  }
  const pct = (cells.length / ((2 * R / STEP + 1) ** 2)) * 100;
  console.log(`--- within ${R} m of spawn: ${cells.length} cells over 30 m from a structure (${pct.toFixed(1)}%)`);
  // the emptiest cells, worst first
  cells.sort((a, b) => b.reach - a.reach);
  for (const c of cells.slice(0, 8)) {
    console.log(`    (${String(c.x).padStart(5)}, ${String(c.z).padStart(5)})  ${c.reach.toFixed(0)} m to a building, tallest nearby ${c.tallest.toFixed(0)} m`);
  }
  if (!cells.length) console.log("    (nothing empty out here)");
  console.log();
}

// how far is the walk from spawn into the city?
console.log("=== the approach: reach to the nearest structure, walking north (+z)");
for (let z = SPAWN.z; z <= SPAWN.z + 320; z += 20) {
  const m = reach(SPAWN.x, z, 90);
  const bar = "#".repeat(Math.min(40, Math.round(m.reach / 3)));
  console.log(`  z=${String(z).padStart(4)}  ${String(Math.round(m.reach)).padStart(3)} m  ${bar}`);
}

console.log("\n(spawn_emptiness is a read-only probe — thresholds are the human's call)");
// ---------------------------------------------------------------- the map
// A text map of the ground around spawn: "#" = a structure within reach, "." =
// open ground. This is the picture the report is actually about.
console.log("\n=== ground around spawn (x across, z down; O = open > 30 m, # = built)");
{
  const XS = [], ZS = [];
  for (let x = SPAWN.x - 220; x <= SPAWN.x + 220; x += 20) XS.push(x);
  for (let z = SPAWN.z - 200; z <= SPAWN.z + 220; z += 20) ZS.push(z);
  console.log("        " + XS.map((x) => String(Math.round(x / 10) % 100).padStart(3)).join(""));
  for (const z of ZS) {
    let row = String(Math.round(z)).padStart(5) + "  ";
    for (const x of XS) row += reach(x, z, 1e9).reach > 30 ? "  O" : "  #";
    console.log(row);
  }
}

// what does the world CALL that open band?
{
  console.log("\n=== zone classification around spawn (urban=has a crowd, highway/water=deliberately empty)");
  const { createSpawnZones } = await import("../../src/spawnzones.js");
  const { STATE_BOUNDS } = await import("../../src/stateWorld.js");
  const extraZone = (x, z) =>
    d.state.zoneAt(x, z) || d.tus.zoneAt(x, z) || d.chat.zoneAt(x, z) ||
    d.shruston.zoneAt(x, z) || d.chars.zoneAt(x, z) || d.metro.zoneAt(x, z) ||
    d.crown.zoneAt(x, z) ||
    // orleanorth sits AFTER crownStrip in main.js's chain, so the strip keeps
    // its own ground. Order matters: it is a seam filler, not an overrider.
    d.orleanorth.zoneAt(x, z) ||
    d.west.zoneAt(x, z) || d.east.zoneAt(x, z) || null;
  const zs = createSpawnZones({ MAP: STATE_BOUNDS, ROAD_X: -6, ROAD_HALF: 5, LOT_X: 24,
    getOrlea: () => d.orlea, residential: [{x:-48,z:116,r:24},{x:48,z:100,r:20}],
    extraZone, coreMinX: -STATE_BOUNDS.maxX - 4, gatherPois: [], worldTime: {isNight:()=>false, dusk:0} });
  for (const z of [90, 110, 130, 150]) {
    let row = `  z=${String(z).padStart(4)} `;
    for (const x of [-100,-70,-50,-30,-14,-6,0,14,30,50,70,100]) {
      const zz = zs.zoneAt(x, z);
      row += String(zz).padEnd(13).slice(0,12) + " ";
    }
    console.log(row);
  }
  console.log("          x=-100     -70      -50      -30      -14       -6        0       14       30       50       70      100");
}
