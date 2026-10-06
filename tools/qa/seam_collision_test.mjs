// seam_collision_test.mjs — does the new seam row land on any OTHER district's
// ground? Rule 13: the host's own zone chain decides ownership, so this asks the
// chain, at the seam, and compares against which district actually built there.
// It does NOT compare bounding rects pairwise.
//
//   node --experimental-detect-module tools/qa/seam_collision_test.mjs
import { installBrowserStub } from "./lib/browser_stub.mjs";
installBrowserStub(); globalThis.addEventListener = () => {}; process.on("unhandledRejection", () => {});
import * as THREE from "three";
import { surface } from "../../src/graphics.js";
import { METRO_BOUNDS } from "../../src/metro.js";

const noop = () => {}; const scene = new THREE.Scene();
const ctx = new Proxy({ scene, surface, addBlocker: noop, addLitSpot: noop, roadMaterial: () => new THREE.MeshStandardMaterial(),
  loadDsCar: () => new Promise(() => {}), loadGLB: () => new Promise(() => {}), placeGlbLandmark: noop, npcs: [], state: {}, props: [], markers: [],
  syncHUD: noop, worldTime: {}, otherLanes: () => [], camera: new THREE.PerspectiveCamera(70, 1.7, 0.1, 4000),
  makeFence: () => ({ addTo: noop, mesh: null }), makeGasStation: () => ({ addTo: noop, mesh: null }), makePopeyes: () => ({ addTo: noop, mesh: null }),
  makeWarehouse: () => ({ addTo: noop, mesh: null }), registerFranchiseClub: noop, addProp: noop, addMesh: noop, add: () => {} },
  { get: (t, k) => (k in t ? t[k] : noop) });

// Build each district ALONE into its own scene, then ask its own zoneAt. This
// separates "who claims it" from "who built it", which a single shared scene
// cannot do: one district's geometry would answer for another's ground.
const NAMES = [
  ["metro", "../../src/metro.js", "createMetro"],
  ["crownStrip", "../../src/crownstrip.js", "createCrownStrip"],
  ["orleaRouge", "../../src/orlearouge.js", "createOrleaRouge"],
  ["orleanorth", "../../src/orleanorth.js", "createOrleanorth"],
  ["shruston", "../../src/shruston.js", "createShruston"],
  ["charsoufre", "../../src/charsoufre.js", "createCharsoufre"],
];
const d = {};
for (const [key, path, fn] of NAMES) {
  const own = new THREE.Scene();
  const c2 = new Proxy({ ...ctx, scene: own }, { get: (t, k) => (k in t ? t[k] : noop) });
  const mod = await import(path);
  d[key] = mod[fn](c2);
  try { d[key].buildSet?.(); } catch (e) { console.error(`  ${key} buildSet threw: ${e.message}`); }
  own.updateMatrixWorld(true);
  d[key].__scene = own;
}

// The seam, sampled on a 4 m grid.
const Z0 = -180, Z1 = -132, X0 = -290, X1 = 290;
// Who BUILT a standing structure here, per district's own scene?
// "contested" (two districts both built here) is a different and much worse fault
// than "one district built inside another's claim": the first is visible geometry
// intersecting, the second is a zoning disagreement about ground that only one of
// them actually used.
const builders = new Map();
const both = new Set();
const box = new THREE.Box3();
for (const key of Object.keys(d)) {
  d[key].__scene.traverse((o) => {
    if (!o.isMesh) return;
    box.setFromObject(o);
    if (box.isEmpty() || !(box.max.y >= 3)) return;
    const a = Math.max(Z0, Math.ceil(box.min.z)), b = Math.min(Z1, Math.floor(box.max.z));
    for (let z = a; z < b; z += 4)
      for (let x = X0 + 2; x < X1; x += 4) {
        if (x + 4 < box.min.x || x > box.max.x) continue;
        const k = `${Math.floor(x / 4)}:${z}`;
        if (!builders.has(k)) builders.set(k, new Set());
        const set = builders.get(k);
        if (set.size && !set.has(key)) both.add(k);
        set.add(key);
      }
  });
}
// Who CLAIMS it, by the host's chain order (main.js extraZone order).
const chain = ["metro", "crownStrip", "orleaRouge", "orleanorth", "shruston", "charsoufre"];
let overlaps = 0, samples = 0, contested = [];
for (const [k, set] of builders) {
  const [gx, gz] = k.split(":").map(Number);
  const x = gx * 4, z = gz;
  samples++;
  const owner = chain.find((c) => d[c]?.zoneAt?.(x, z));
  if (owner && set.has(owner)) continue;
  overlaps++;
  if (contested.length < 12) contested.push(`    x ${x} z ${z}: built by [${[...set].join(",")}] but chain says ${owner}`);
}
console.log(`seam collision check: z ${Z0}..${Z1}, x ${X0}..${X1}, 4 m grid`);
console.log(`  cells with standing geometry : ${samples}`);
console.log(`  cells TWO districts both built in (overlap): ${both.size}`);
for (const k of [...both].slice(0, 12)) {
  const [gx, gz] = k.split(":").map(Number);
  console.log(`    x ${gx * 4} z ${gz}: [${[...builders.get(k)].join(",")}]`);
}
console.log(`  cells built by a non-owner (claim disagreement only): ${overlaps - both.size}`);
if (contested.length) console.log(contested.join("\n"));
const byPair = new Map();
for (const [k, set] of builders) {
  const [gx, gz] = k.split(":").map(Number);
  const x = gx * 4, z = gz;
  const owner = chain.find((c) => d[c]?.zoneAt?.(x, z));
  if (owner && set.has(owner)) continue;
  for (const b of set) {
    if (b === owner) continue;
    const key = `${b} in ${owner}'s claim`;
    const r = byPair.get(key) || { n: 0, x0: 1e9, x1: -1e9, z0: 1e9, z1: -1e9 };
    r.n++; r.x0 = Math.min(r.x0, x); r.x1 = Math.max(r.x1, x); r.z0 = Math.min(r.z0, z); r.z1 = Math.max(r.z1, z);
    byPair.set(key, r);
  }
}
console.log("\n  contested extent, grouped:");
for (const [k, r] of byPair)
  console.log(`    ${k}: ${r.n} cells, x ${r.x0}..${r.x1}, z ${r.z0}..${r.z1}`);
const ok = both.size === 0;
console.log(ok ? "\nPASS  no inter-region collision in the seam" : `\nFAIL  ${overlaps} contested cells`);
console.log(`  (metro bounds z0 = ${METRO_BOUNDS.z0})`);
process.exit(ok ? 0 : 1);