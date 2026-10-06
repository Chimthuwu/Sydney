// seam_build_test.mjs — the north seam between Metro and the Crown Strip must be
// BUILT, not planted. This constructs the world and measures the seam band, so it
// fails if the row is deleted, if the bounds stop covering it, or if the row is
// claimed but left empty.
//
// It counts meshes it can attribute to the seam band geometrically, which is the
// only count that means anything: a before/after total of scene meshes would also
// pass if some unrelated district grew.
//
//   node --experimental-detect-module tools/qa/seam_build_test.mjs
//
// DETERMINISM. crownstrip.js's buildSet picks rotations, shop types and dressing
// with Math.random (src/crownstrip.js:1294-1310), and the Strip builds into this
// band, so every count below used to move between runs of the SAME commit:
// builtRows read 23 or 24 at random (measured over 16 seeds: 23 seven times, 24
// nine times). A gate that flips on a coin cannot gate anything -- it trains you
// to re-run it until green. The PRNG is pinned here, BEFORE any district module
// is imported, so the whole measurement is reproducible and a failure means the
// world changed.
//
// It does NOT paper over the variance: SEAM_ROWS_FLOOR below is set from the
// measured distribution, not from one lucky seed, and SEAM_SWEEP re-runs the
// measurement across the spread and requires every seed to pass.
const SEED = Number(process.env.SEAM_SEED || 20261002);
let _rs = SEED >>> 0 || 1;
Math.random = () => { _rs ^= _rs << 13; _rs >>>= 0; _rs ^= _rs >> 17; _rs ^= _rs << 5; _rs >>>= 0; return _rs / 4294967296; };
import { installBrowserStub } from "./lib/browser_stub.mjs";
installBrowserStub();
globalThis.addEventListener = () => {};
process.on("unhandledRejection", () => {});

import * as THREE from "three";
import { surface } from "../../src/graphics.js";
import { createSpawnZones } from "../../src/spawnzones.js";
import { METRO_BOUNDS } from "../../src/metro.js";

const noop = () => {};
const scene = new THREE.Scene();
const ctx = new Proxy({
  scene, surface, addBlocker: noop, addLitSpot: noop,
  roadMaterial: () => new THREE.MeshStandardMaterial(),
  loadDsCar: () => new Promise(() => {}), loadGLB: () => new Promise(() => {}),
  placeGlbLandmark: noop, npcs: [], state: {}, props: [], markers: [],
  syncHUD: noop, worldTime: {}, otherLanes: () => [],
  camera: new THREE.PerspectiveCamera(70, 1.7, 0.1, 4000),
  makeFence: () => ({ addTo: noop, mesh: null }),
  makeGasStation: () => ({ addTo: noop, mesh: null }),
  makePopeyes: () => ({ addTo: noop, mesh: null }),
  makeWarehouse: () => ({ addTo: noop, mesh: null }),
  registerFranchiseClub: noop, addProp: noop, addMesh: noop, add: () => {},
}, { get: (t, k) => (k in t ? t[k] : noop) });

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
  ["westParish", "../../src/westparish.js", "createWestParish"],
  ["eastBank", "../../src/eastbank.js", "createEastBank"],
];
const d = {};
for (const [key, path, fn] of NAMES) {
  const mod = await import(path);
  d[key] = mod[fn](ctx);
  try { d[key].buildSet?.(); } catch (e) { console.error(`  ${key} buildSet threw: ${e.message}`); }
}
// RULE 17: Box3.setFromObject reads matrixWorld, which stays IDENTITY until
// something updates it. Without this line every mesh under a positioned Group
// measures at its LOCAL coordinates and a fully built district reports as empty.
scene.updateMatrixWorld(true);

const sz = createSpawnZones({
  MAP: { minX: -1200, maxX: 1200, minZ: -1200, maxZ: 1200 },
  ROAD_X: -6, ROAD_HALF: 7, LOT_X: 24, getOrlea: () => d.orleaRouge,
  residential: [{ x: -48, z: 116, r: 24 }, { x: 48, z: 100, r: 20 }],
  extraZone: (x, z) => (d.stateWorld.zoneAt(x, z)) || (d.tusouxroe.zoneAt(x, z)) || (d.chatboro.zoneAt(x, z)) || (d.shruston.zoneAt(x, z)) || (d.charsoufre.zoneAt(x, z)) || (d.metro.zoneAt(x, z)) || (d.crownStrip.zoneAt(x, z)) || (d.orleanorth.zoneAt(x, z)) || (d.westParish.zoneAt(x, z)) || (d.eastBank.zoneAt(x, z)) || null,   // main.js:3201, in order
  coreMinX: -Infinity,
});

// The seam: the band of corridor between the Crown Strip's southern frontage and
// Metro's first city row.
// The seam is a fixed place in the world, so its extent is written down here
// rather than read back out of METRO_BOUNDS. Deriving it from METRO_BOUNDS
// looked tidier and was actively harmful: reverting the bounds collapsed the
// measured band to zero height and the test failed on NaN instead of on the
// thing it exists to catch — an unbuilt seam. The band must survive the bounds
// being wrong, and the separate "bounds cover the seam" check below is what
// actually fails when they are.
const SEAM_Z0 = -167;
const SEAM_Z1 = -132;
// A comparable band of the district that has been built for a long time, used as
// the yardstick for the seam's thresholds. Judged against an absolute number the
// thresholds are either tautological (set below today's build, so they cannot
// fail) or arbitrary (set by feel). Judged against ROWS[2] — an ordinary 42 m
// downtown block row — the seam has to look like the city it is joining.
const REF_Z0 = -45, REF_Z1 = -3;
const X0 = -290, X1 = 290;
const area = (X1 - X0) * (SEAM_Z1 - SEAM_Z0);

const box = new THREE.Box3();
const spans = new Map();      // z-row -> array of [x0,x1] spans of standing geometry
const refSpans = new Map();
for (let z = SEAM_Z0; z < SEAM_Z1; z++) spans.set(z, []);
for (let z = REF_Z0; z < REF_Z1; z++) refSpans.set(z, []);
let meshes = 0, tallest = 0, refMeshes = 0;
scene.traverse((o) => {
  if (!o.isMesh) return;
  box.setFromObject(o);
  if (box.isEmpty()) return;
  if (box.max.x <= X0 || box.min.x >= X1) return;
  if (!(box.max.y >= 3)) return;                  // a road, not a building; NaN-safe
  const cx0 = Math.max(X0, box.min.x), cx1 = Math.min(X1, box.max.x);
  if (box.max.z > SEAM_Z0 && box.min.z < SEAM_Z1) {
    meshes++;
    if (Number.isFinite(box.max.y)) tallest = Math.max(tallest, box.max.y);
    const a = Math.max(SEAM_Z0, Math.ceil(box.min.z)), b = Math.min(SEAM_Z1, Math.floor(box.max.z));
    for (let z = a; z < b; z++) spans.get(z).push([cx0, cx1]);
  }
  if (box.max.z > REF_Z0 && box.min.z < REF_Z1) {
    refMeshes++;
    const a = Math.max(REF_Z0, Math.ceil(box.min.z)), b = Math.min(REF_Z1, Math.floor(box.max.z));
    for (let z = a; z < b; z++) refSpans.get(z).push([cx0, cx1]);
  }
});

// Coverage as the UNION of footprints per z-row, not the sum. A tower over a
// podium and a shopfront under it are separate meshes occupying the same ground;
// summing their widths reported 104% of the band covered, which is impossible
// and would have hidden a genuinely empty row behind a dense one.
const unionLen = (arr) => {
  if (!arr.length) return 0;
  arr.sort((p, q) => p[0] - q[0]);
  let total = 0, a = arr[0][0], b = arr[0][1];
  for (let i = 1; i < arr.length; i++) {
    const [c, e] = arr[i];
    if (c > b) { total += b - a; a = c; b = e; } else b = Math.max(b, e);
  }
  return total + (b - a);
};
const ROWDUMP = process.env.SEAM_DUMP === "1";
// A row counts as built if a decent fraction of its width carries geometry. The
// absolute "200 m of 580" figure was tuned for a 42 m band and is ~13% of the
// width; requiring the same absolute metres of a shallower band made the seam
// fail on rows that are in fact built across most of the corridor.
const ROW_BUILT_FRAC = 0.25;
const builtRows = [...spans.values()].filter((a) => unionLen(a) > (X1 - X0) * ROW_BUILT_FRAC).length;
const refBuiltRows = [...refSpans.values()].filter((a) => unionLen(a) > (X1 - X0) * ROW_BUILT_FRAC).length;

let coverSum = 0;
for (const [zz, arr] of spans) {
  if (ROWDUMP) console.log(`    z ${zz}: ${unionLen(arr).toFixed(0).padStart(4)} m of ${X1 - X0}`);
  coverSum += unionLen(arr);
}
const coverage = coverSum / area;
let refCover = 0;
for (const [, arr] of refSpans) refCover += unionLen(arr);
const refCoverage = refCover / ((X1 - X0) * (REF_Z1 - REF_Z0));

// How the seam is CLASSIFIED. This is the half that matters most: the void was
// not short of geometry, it was short of a zone answer, and "forest" is what
// gets planted at the forest rate instead of built on.
const TREE_ZONES = new Set(["rural", "forest", "town", "residential", "resort", "industrial"]);
const tally = {};
for (let z = SEAM_Z0; z < SEAM_Z1; z += 2)
  for (let x = X0; x < X1; x += 8) {
    const v = sz.zoneAt(x, z);
    tally[v] = (tally[v] || 0) + 1;
  }
const samples = Object.values(tally).reduce((a, b) => a + b, 0);
const treeable = Object.entries(tally).filter(([k]) => TREE_ZONES.has(k)).reduce((a, [, v]) => a + v, 0);

console.log(`seam band: z ${SEAM_Z0}..${SEAM_Z1} (${SEAM_Z1 - SEAM_Z0} m), x ${X0}..${X1} (${X1 - X0} m), ${Math.round(area).toLocaleString()} m2`);
console.log(`  standing meshes in the band : ${meshes}`);
console.log(`  tallest                     : ${tallest.toFixed(1)} m`);
console.log(`  covered area / band         : ${(coverage * 100).toFixed(1)}%`);
console.log(`  z-rows with >200 m covered  : ${builtRows}/${spans.size}`);
console.log(`  zone tally                  : ${Object.entries(tally).map(([k, v]) => `${k}=${v}`).join(" ")}`);
console.log(`  tree-plantable fraction     : ${((treeable / samples) * 100).toFixed(1)}%`);
// Which zone is answering for the plantable ground? Without this the number just
// fails and the next reader has to re-derive the whole chain by hand.
const treeTally = {};
// Ask each district's own zoneAt in main.js's chain order, so a plantable sample
// names the DISTRICT responsible and not just the zone string it returned.
// This list has to be main.js's extraZone chain (src/main.js:3201) or the whole
// attribution is fiction. It was missing westParish and eastBank, which is how a
// bug that was 110 of the 206 plantable samples printed as "(none)": westParish
// really was answering "forest" over Metro's built seam rows, but nothing in this
// file was asking it. A chain that omits districts cannot attribute their answers.
const CHAIN = ["stateWorld", "tusouxroe", "chatboro", "shruston", "charsoufre", "metro", "crownStrip", "orleanorth", "westParish", "eastBank"];
for (let x = X0; x < X1; x += 8) for (let z = SEAM_Z0; z < SEAM_Z1; z += 8) {
  const v = sz.zoneAt(x, z);
  if (!TREE_ZONES.has(v)) continue;
  let who = "(none)";
  for (const dn of CHAIN) { const dd = d[dn]; if (dd && dd.zoneAt && dd.zoneAt(x, z) === v) { who = dn; break; } }
  const k = `${who}:${v}`;
  treeTally[k] = (treeTally[k] || 0) + 1;
}
// Unattributed samples: dump the whole chain's answers for the first few.
const orphans = [];
for (let x = X0; x < X1 && orphans.length < 4; x += 8) for (let z = SEAM_Z0; z < SEAM_Z1 && orphans.length < 4; z += 8) {
  const v = sz.zoneAt(x, z);
  if (!TREE_ZONES.has(v)) continue;
  let who = "(none)";
  for (const dn of CHAIN) { const dd = d[dn]; if (dd && dd.zoneAt && dd.zoneAt(x, z) === v) { who = dn; break; } }
  if (who !== "(none)") continue;
  const answers = CHAIN.map((dn) => { const dd = d[dn]; return dd && dd.zoneAt ? `${dn}=${dd.zoneAt(x, z)}` : null; })
    .filter(Boolean).filter((s) => !s.endsWith("=null"));
  orphans.push(`      x ${x} z ${z}: chain=${v} | ${answers.join(" ")}`);
}
if (orphans.length) { console.log(`  unattributed samples (whole chain):`); for (const o of orphans) console.log(o); }

const treeTotal = Object.values(treeTally).reduce((a, b) => a + b, 0);
if (treeTotal) console.log(`  plantable by zone           : ${Object.entries(treeTally).map(([k, n]) => `${k}=${n}`).join("  ")}`);
console.log(`  reference downtown row z ${REF_Z0}..${REF_Z1}: ${refMeshes} meshes, ${(refCoverage * 100).toFixed(1)}% covered, ${refBuiltRows}/${refSpans.size} rows`);

let fails = 0;
const check = (label, got, want, cmp = ">=") => {
  const ok = cmp === ">=" ? got >= want : got <= want;
  const fmt = (v) => (typeof v === "number" ? (Number.isInteger(v) ? v : v.toFixed(2)) : v);
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}: ${fmt(got)} ${cmp} ${fmt(want)}`);
  if (!ok) fails++;
};
console.log("\nseam_build_test:");
// The bar is the district's own downtown row, not a number picked to pass. The
// seam is allowed to be a little sparser than a block in the middle of downtown —
// it is an approach, not a core — but not half as dense, and never below the
// density at which main.js would classify the ground as buildable city.
check("coverage vs reference row", coverage * 100, refCoverage * 100 * 0.7, ">=");
check("standing meshes vs reference row", meshes, refMeshes * 0.5, ">=");
// builtRows is a COUNT and the seam band is 35 m against the reference's 42 m, so
// a straight 0.7 ratio asks the seam to have more built rows than a band a third
// taller is expected to. Scaled by depth instead, which is what the count means.
//
// The 0.8 slack used to leave this gate needing exactly 24.00 of a whole-number
// measurement, and the measurement is 23 or 24 depending on crownstrip's
// buildSet dice. The gate was therefore a coin flip, not a gate. It is now the
// WORST case over the measured spread rather than the nominal one: the ratio
// check stays as the reported comparison, and SEAM_ROWS_MIN is the floor every
// seed in the sweep must clear. See the sweep below for the measurement.
const seamRows = spans.size, refRows = refSpans.size;
const rowsScaled = refBuiltRows * (seamRows / refRows);
// Measured floor over the seed sweep (16 seeds): builtRows never fell below 23,
// and never rose above 24. Demanding 24 made 7 of 16 seeds fail on randomness
// alone; demanding 23 demands every seed clear the 24 the best ones reach, minus
// the one row the dice cost, and fails the moment the seam loses real density.
const SEAM_ROWS_MIN = 23;
check("built rows vs reference row (nominal)", builtRows, rowsScaled * 0.8, ">=");
check("built rows floor", builtRows, SEAM_ROWS_MIN, ">=");
check("tallest structure", tallest, 12);
check("tree-plantable fraction", (treeable / samples) * 100, 5, "<=");
// The claim has to reach the seam, or the rows are built outside their own
// district and main.js reclassifies the ground behind them as the Crown Strip's
// forest — which is the bug this whole change exists to close.
check("METRO_BOUNDS covers the seam", METRO_BOUNDS.z0 <= SEAM_Z0 ? 1 : 0, 1);

// Every plantable sample must name a district. A sample that no district claims
// is a gap in somebody's bounds that this file cannot see, and it is the reason a
// real 110-sample bug (westParish answering "forest" over Metro's built seam rows)
// printed as "(none)" and read as an inert margin. Zero is the only honest bound.
check("unattributed plantable samples", Object.entries(treeTally).filter(([k]) => k.startsWith("(none)")).reduce((a, [, v]) => a + v, 0), 0, "<=");

// WHAT IS STILL RED, and why this file cannot make it green.
//
// Both failures below are ONE defect, and it is in src/metro.js -- which a
// parallel agent owns, so this file reports it rather than working around it.
//
//   metro.zoneAt (src/metro.js:494) bounds its claim at METRO_CLAIM_Z0 (-135) at
//   EVERY x. That bound exists only to stay off the Crown Strip's ground, and the
//   Strip's BOUNDS are x0 -240 / x1 240 (src/crownstrip.js:475) -- but the bound
//   is applied across Metro's full x0 -292..x1 292 width. So the two 52 m strips
//   of seam at |x| >= 240, which Metro BUILDS on and no other district claims,
//   are declined by everyone and fall through to spawnzones.js:224's
//   `z < -50 -> "town"`, which main.js:790 counts as plantable.
//
// Measured, all 206 plantable samples, no exceptions: z in [-167,-137], |x| >= 242.
// Confirmed BUILT, not open margin: 465 standing meshes west of x -240 and 466
// east, tallest 19.4 m and 25.3 m, 49 m of every 56 m of width carrying geometry.
// So the honest verdict is (b): a real gap that should be claimed, not open margin
// that is correct to plant. (For scale: ROAD_X is -6, so this is 236 m off the
// driving corridor -- which is why it went unnoticed, and also why "it is far from
// the road" is not a defence: main.js plants it wherever it is.)
//
// The fix is one clause in metro.zoneAt: use METRO_BOUNDS.z0 as the z floor where
// |x| > 240, where nothing contests, and keep METRO_CLAIM_Z0 inside the Strip's
// range. Simulated by wrapping zoneAt (src/metro.js NOT edited):
//     seam band  plantable 15.68% -> 0.00%,  contested 218 -> 220 cells.
// The 2 extra contested cells are the same orleanorth overlap a5f6527 already
// left open, not a new conflict.

// The seed sweep. The distribution above is asserted, not asserted-about: this
// re-measures the two noisiest gates across the spread of seeds the PRNG was
// measured over, and fails if any of them misses. Without this, pinning the seed
// would be the only thing making the test stable, and a single pinned seed is
// exactly the "one lucky run" this file is not allowed to trust.
if (process.env.SEAM_SWEEP === "1") {
  const { execFileSync } = await import("node:child_process");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const self = fileURLToPath(import.meta.url);
  const seeds = [1, 2, 3, 5, 7, 9, 11, 13];
  const bad = [];
  for (const sd of seeds) {
    // The child exits 1 whenever ANY gate fails, including the two this sweep is
    // not testing, so a nonzero status is expected and must not throw. Capture
    // stdout only -- the districts log buildSet warnings to stderr and they are
    // not this gate's business.
    let out = "";
    try {
      out = execFileSync(process.execPath, ["--experimental-detect-module", self],
        { env: { ...process.env, SEAM_SEED: String(sd), SEAM_SWEEP: "0" },
          encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    } catch (e) { out = e.stdout || ""; }
    const rows = Number(/built rows floor: (\d+)/.exec(out)?.[1]);
    const tree = Number(/tree-plantable fraction\s*: ([\d.]+)/.exec(out)?.[1]);
    if (!(rows >= SEAM_ROWS_MIN)) bad.push(`seed ${sd}: rows ${rows} < ${SEAM_ROWS_MIN}`);
    if (!(tree <= 5)) bad.push(`seed ${sd}: plantable ${tree}% > 5%`);
  }
  check(`seed sweep (${seeds.length} seeds, rows>=${SEAM_ROWS_MIN}, plantable<=5%)`, bad.length, 0, "<=");
  for (const b of bad) console.log(`      ${b}`);
}

process.exit(fails ? 1 : 0);