// orleanorth_claim_check.mjs — who actually owns the ground Orleanorth built on?
//
//   node --experimental-detect-module tools/qa/orleanorth_claim_check.mjs
//
// The static rect test (district_overlap_test.mjs) cannot settle this. Shruston's
// BOUNDS is x -130..130 / z -300..310 and Charsoufre's is x -130..130 / z
// -150..150, so they necessarily CONTAIN most of Orleanorth's rects — but those
// are container regions, and a container is only a problem if the district
// actually builds inside it. Static comparison cannot tell the difference, and
// guessing either way is how the Chatboro burial happened.
//
// So ask the map itself. Build Orleanorth's neighbours for real, call their
// zoneAt at every Orleanorth site rect, and report who answers. main.js's
// extraZone chain puts tusouxroe, chatboro, shruston, charsoufre and metro
// BEFORE orleanorth, so anything one of them claims is ground Orleanorth is
// standing on.
//
// What this asserts: every cell of every Orleanorth site rect resolves to
// Orleanorth or to bare ground — never to another district.
import { installBrowserStub } from "./lib/browser_stub.mjs";
installBrowserStub();
globalThis.addEventListener = () => {};
process.on("unhandledRejection", () => {});

import * as THREE from "three";
import { surface } from "../../src/graphics.js";

const noop = () => {};
const scene = new THREE.Scene();
const ctx = new Proxy({
  scene, surface, addBlocker: noop, addLitSpot: noop,
  roadMaterial: () => new THREE.MeshStandardMaterial(),
  loadDsCar: () => new Promise(() => {}), loadGLB: () => new Promise(() => {}),
  placeGlbLandmark: noop, npcs: [], state: {}, props: [], markers: [],
  syncHUD: noop, worldTime: {}, otherLanes: () => [],
  camera: new THREE.PerspectiveCamera(70, 1.7, 0.1, 3000),
}, { get: (t, k) => (k in t ? t[k] : noop) });

// main.js's extraZone order, verbatim: whoever answers first wins the ground.
const NAMES = [
  ["stateWorld", "../../src/stateWorld.js", "createStateWorld"],
  ["tusouxroe", "../../src/tusouxroe.js", "createTusouxroe"],
  ["chatboro", "../../src/chatboro.js", "createChatboro"],
  ["shruston", "../../src/shruston.js", "createShruston"],
  ["charsoufre", "../../src/charsoufre.js", "createCharsoufre"],
  ["metro", "../../src/metro.js", "createMetro"],
  ["crownStrip", "../../src/crownstrip.js", "createCrownStrip"],
  ["orleanorth", "../../src/orleanorth.js", "createOrleanorth"],
];

const d = {};
for (const [key, path, fn] of NAMES) {
  const mod = await import(path);
  d[key] = mod[fn](ctx);
  try { d[key].buildSet?.(); } catch (e) { console.log(`  (${key} buildSet: ${e.message})`); }
}

// The chain, exactly as main.js:3081 writes it.
const chain = (x, z) =>
  d.stateWorld.zoneAt(x, z) || d.tusouxroe.zoneAt(x, z) || d.chatboro.zoneAt(x, z) ||
  d.shruston.zoneAt(x, z) || d.charsoufre.zoneAt(x, z) || d.metro.zoneAt(x, z) ||
  d.crownStrip.zoneAt(x, z) || d.orleanorth.zoneAt(x, z) || null;

// Orleanorth's own rects, read from its source so this cannot drift.
const src = await import("node:fs").then((m) => m.readFileSync("src/orleanorth.js", "utf8"));
const rects = [...src.matchAll(/R\((-?\d+), (-?\d+), (-?\d+), (-?\d+)\)/g)]
  .map((m) => [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])]);
const pm = src.match(/const PARK = \{ x0: (-?\d+), x1: (-?\d+), z0: (-?\d+), z1: (-?\d+) \}/);
const park = pm ? [Number(pm[1]), Number(pm[3]), Number(pm[2]), Number(pm[4])] : null;
const named = rects.map((r, i) => [`site ${i}`, r]).concat(park ? [["Memorial Green", park]] : []);

console.log("=== who owns each Orleanorth site rect, per main.js's own zone chain ===\n");
let bad = 0;
for (const [name, [x0, z0, x1, z1]] of named) {
  const tally = {};
  for (let z = z0 + 1; z < z1; z += 2)
    for (let x = x0 + 1; x < x1; x += 2) {
      const z0v = chain(x, z) ?? "open";
      tally[z0v] = (tally[z0v] || 0) + 1;
    }
  const total = Object.values(tally).reduce((a, b) => a + b, 0);
  const parts = Object.entries(tally).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${((100 * v) / total).toFixed(0)}%`);
  // A neighbour winning this ground is the Chatboro bug all over again.
  const stolen = Object.keys(tally).filter((k) => k !== "open" && k !== "urban" && k !== "town" &&
    k !== "building" && k !== "highway" && k !== "residential" && k !== "commercial" && k !== "park");
  const flag = stolen.length ? "  <-- CLAIMED BY A NEIGHBOUR" : "";
  if (stolen.length) bad++;
  console.log(`  ${name.padEnd(15)} ${parts.join("  ")}${flag}`);
}

console.log(`\n=== verdict ===`);
console.log(bad
  ? `  ${bad} rect(s) sit on ground another district claims. Not fixed.`
  : `  ${named.length} rects, none of them claimed by another district. Chatboro and the rest keep their ground.`);
process.exit(bad ? 1 : 0);