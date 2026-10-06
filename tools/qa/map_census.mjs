// map_census.mjs — what does the map actually contain, measured not assumed.
//
//   node --experimental-detect-module tools/qa/map_census.mjs
//
// Every survey of this map so far in this session has been wrong at least once:
// "NOTHING urban north of the strip" (Tusouxroe is), "294 m of empty highway at
// spawn" (OrleaRouge's own grid covers it), "Chatboro is at z -720..-500" (the
// comment in districts.js says so; chatboro.js says z -120..100). The cause is
// always the same — reading a bounds rect off one file and assuming it is the
// whole story, when a district may have a composer grid, hand-placed sites, a
// corridor, or several of those at once.
//
// So measure the built map instead. Build every district, then sample the whole
// 2400 m square on a grid and ask main.js's own zoneAt chain what each cell is.
// The result is a map drawn as ASCII, which is worth more than a table: you can
// see the shape of the problem instead of inferring it.
import { installBrowserStub } from "./lib/browser_stub.mjs";
installBrowserStub();
globalThis.addEventListener = () => {};
process.on("unhandledRejection", () => {});

import * as THREE from "three";
import { surface } from "../../src/graphics.js";
import { STATE_BOUNDS } from "../../src/stateWorld.js";

const noop = () => {};
const scene = new THREE.Scene();
const ctx = new Proxy({
  scene, surface, addBlocker: noop, addLitSpot: noop,
  roadMaterial: () => new THREE.MeshStandardMaterial(),
  loadDsCar: () => new Promise(() => {}), loadGLB: () => new Promise(() => {}),
  placeGlbLandmark: noop, npcs: [], state: {}, props: [], markers: [],
  syncHUD: noop, worldTime: {}, otherLanes: () => [],
  camera: new THREE.PerspectiveCamera(70, 1.7, 0.1, 4000),
  // townkit builds through these. A Proxy that returns a bare noop for a missing
  // key makes them return undefined, which silently unwinds the whole build —
  // that is why Orleanorth reported 0 meshes in this census and 407 standalone.
  // Each must return a real object so the caller can keep composing.
  makeFence: () => ({ addTo: noop, mesh: null }),
  makeGasStation: () => ({ addTo: noop, mesh: null }),
  makePopeyes: () => ({ addTo: noop, mesh: null }),
  makeWarehouse: () => ({ addTo: noop, mesh: null }),
  registerFranchiseClub: noop,
  addProp: noop,
  addMesh: noop,
  add: noop,
}, { get: (t, k) => (k in t ? t[k] : noop) });

// main.js's extraZone order, verbatim — order decides who wins shared ground.
const NAMES = [
  ["stateWorld", "../../src/stateWorld.js", "createStateWorld"],
  ["tusouxroe", "../../src/tusouxroe.js", "createTusouxroe"],
  ["chatboro", "../../src/chatboro.js", "createChatboro"],
  ["shruston", "../../src/shruston.js", "createShruston"],
  ["charsoufre", "../../src/charsoufre.js", "createCharsoufre"],
  ["metro", "../../src/metro.js", "createMetro"],
  ["crownStrip", "../../src/crownstrip.js", "createCrownStrip"],
  ["orleanorth", "../../src/orleanorth.js", "createOrleanorth"],
  ["orleaRouge", "../../src/orlearouge.js", "createOrleaRouge"],
];

const d = {};
const byDistrict = {};      // district -> mesh count added while it was building
let building = "none";
for (const [key, path, fn] of NAMES) {
  const mod = await import(path);
  d[key] = mod[fn](ctx);
  building = key;
  byDistrict[key] = 0;
  // count meshes as they appear: a parent's subtree counts once, at the top level
  const before = new Set();
  scene.traverse((o) => before.add(o));
  try { d[key].buildSet?.(); } catch (e) { console.error(`  ${key} buildSet threw: ${e.message}`); }
  if (key === "orleanorth") {
    console.log("  --- orleanorth diagnostics ---");
    console.log("  report:", JSON.stringify(d[key].report));
    console.log("  zoneAt(0,0)     =", d[key].zoneAt(0, 0));
    console.log("  zoneAt(-100,0)  =", d[key].zoneAt(-100, 0));
    console.log("  zoneAt(60,0)    =", d[key].zoneAt(60, 0));
    console.log("  zoneAt(-220,0)  =", d[key].zoneAt(-220, 0));
  }
  scene.traverse((o) => { if (o.isMesh && !before.has(o)) byDistrict[key]++; });
  console.log(`  built ${key}: +${byDistrict[key]} meshes`);
}
building = "none";
let meshes = 0;
scene.traverse((o) => { if (o.isMesh) meshes++; });
console.log(`\n${meshes} meshes in the scene\n`);

console.log("=== meshes actually BUILT per district (a claim is not a building) ===");
for (const [k, v] of Object.entries(byDistrict).sort((a, b) => b[1] - a[1]))
  console.log(`  ${k.padEnd(12)} ${String(v).padStart(5)} meshes`);
const totalBuilt = Object.values(byDistrict).reduce((a, b) => a + b, 0);
console.log(`  ${"".padEnd(12)} ${String(totalBuilt).padStart(5)} attributed`);

const chain = (x, z) =>
  d.stateWorld.zoneAt(x, z) || d.tusouxroe.zoneAt(x, z) || d.chatboro.zoneAt(x, z) ||
  d.shruston.zoneAt(x, z) || d.charsoufre.zoneAt(x, z) || d.metro.zoneAt(x, z) ||
  d.crownStrip.zoneAt(x, z) || d.orleanorth.zoneAt(x, z) || null;

// Which district answered, not just what it called the cell. This is the
// question that matters: "urban" from four different towns is four different
// places, and only this says which.
// OrleaRouge builds its own grid from a hardcoded STREETS array and a CITY rect
// and has NO composer, so it exports no zoneAt and the extraZone chain cannot see
// it. Testing its CITY rect directly is the only way to see it — without this the
// census calls z 130..500 unowned, which is how two earlier surveys of this band
// came out wrong.
const ORL_CITY = { x0: -292, x1: 680, z0: 130, z1: 500 };
const inOrlea = (x, z) => x >= ORL_CITY.x0 && x <= ORL_CITY.x1 && z >= ORL_CITY.z0 && z <= ORL_CITY.z1;

const owner = (x, z) => {
  if (inOrlea(x, z)) return "A";
  if (d.stateWorld.zoneAt(x, z)) return "S";
  if (d.tusouxroe.zoneAt(x, z)) return "T";
  if (d.chatboro.zoneAt(x, z)) return "C";
  if (d.shruston.zoneAt(x, z)) return "H";
  if (d.charsoufre.zoneAt(x, z)) return "K";
  if (d.metro.zoneAt(x, z)) return "M";
  if (d.crownStrip.zoneAt(x, z)) return "R";
  if (d.orleanorth.zoneAt(x, z)) return "O";
  return ".";
};

const LEGEND = {
  A: "OrleaRouge(CITY)", S: "stateWorld", T: "Tusouxroe", C: "Chatboro", H: "Shruston",
  K: "Charsoufre", M: "Metro", R: "CrownStrip", O: "Orleanorth", ".": "UNOWNED",
};

const { minX, maxX, minZ, maxZ } = STATE_BOUNDS;
const STEP = 24;
const tally = {};
const rows = [];

console.log(`=== the map, ${STEP} m cells. x across, z down (north is -z) ===\n`);
for (let z = minZ; z <= maxZ; z += STEP) {
  let row = "";
  for (let x = minX; x <= maxX; x += STEP) {
    const o = owner(x, z);
    row += o;
    tally[o] = (tally[o] || 0) + 1;
  }
  rows.push([z, row]);
}
for (const [z, row] of rows) {
  const mark = z === 130 ? "  <- SPAWN" : z === -134 ? "  <- Crown Strip south edge" : z === -440 ? "  <- Crown Strip north edge" : "";
  console.log(`${String(z).padStart(6)} ${row}${mark}`);
}
console.log(`       ${"^".repeat(1)} x=${minX}`);
console.log(`       x=${maxX} at the right edge`);

console.log("\n=== legend ===");
for (const [k, v] of Object.entries(LEGEND)) console.log(`  ${k}  ${v}`);

const total = Object.values(tally).reduce((a, b) => a + b, 0);
console.log("\n=== share of the 2400 m square ===");
for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1]))
  console.log(`  ${LEGEND[k].padEnd(12)} ${String(v).padStart(5)} cells  ${((100 * v) / total).toFixed(1)}%  ~${(v * STEP * STEP).toLocaleString()} m2`);

console.log("\n=== the spawn corridor north, in detail (x -300..300, every 12 m) ===\n");
for (let z = 160; z >= -700; z -= 12) {
  let row = "";
  for (let x = -300; x <= 300; x += 12) row += owner(x, z);
  const band = row.match(/[.]{4,}/g);
  const gaps = band ? band.length : 0;
  console.log(`${String(z).padStart(6)} ${row}${gaps ? `   ${gaps} run(s) of 4+ unowned cells` : ""}`);
}
console.log("        x=-300" + " ".repeat(46) + "x=300");
