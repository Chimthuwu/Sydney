// ---------------------------------------------------------------------------
// road_blockers_test.mjs — nothing solid in a traffic lane, across the whole state
//
//   node --experimental-detect-module tools/qa/road_blockers_test.mjs
//
// "trees on the road again near the bayou noir sign", with a screenshot of a
// row of pines standing in a city street.
//
// There is already a tool for this: tools/qa/road_clearance.mjs. **It cannot
// find this class of bug**, for two reasons. It needs puppeteer and a real
// Chromium, which this machine does not have; and, worse, it reads `l.pts` off
// each lane while `traffic.js` builds lanes with `points` (a list of [x, z]
// pairs). `l.pts` is `undefined` on all 123 lanes, the inner loop never runs,
// and the tool reports a clean bill of health for the entire state. It has been
// reporting zero for as long as it has existed.
//
// So this is the same check, headless, against the real lane geometry — and it
// self-tests first, because a check that cannot fail is worse than no check.
//
// The bug it caught: westparish.js `clearOfTrees()` exempted a 40 m band either
// side of Parish Highway 9 from the Downtown Bayou forest keepout, on the theory
// that a highway wants a treeline. Hwy 9 runs diagonally across Metro's grid, so
// that exemption put 50 pines inside city blocks — the Bayou Noir exit, which is
// exactly where the player photographed it. The church, the rest stop and Hwy 9's
// own guardrail sit in the same ground; those predate this work and are a
// separate, smaller problem, so the budget below allows them by name.
// ---------------------------------------------------------------------------

import { installBrowserStub } from "./lib/browser_stub.mjs";
installBrowserStub();
globalThis.addEventListener = () => {};
globalThis.innerWidth = 1920;
globalThis.innerHeight = 1080;
process.on("unhandledRejection", () => {});

import * as THREE from "three";
import { surface } from "../../src/graphics.js";
import { onParishHighway } from "../../src/westparish.js";
const characters = await import("../../src/characters.js");

const noop = () => {};
const scene = new THREE.Scene();
const BLOCKERS = [];
const ctx = new Proxy({
  scene, surface, camera: new THREE.PerspectiveCamera(),
  addBlocker: (x, z, r, tag) => { const b = { x, z, r: r || 0.5, tag: tag || "" }; BLOCKERS.push(b); return b; },
  // composer.pruneTrees takes a tree back out of a lane, collision and all
  removeBlocker: (b) => { const i = BLOCKERS.indexOf(b); if (i >= 0) BLOCKERS.splice(i, 1); },
  poolLight: noop, flashObjective: noop, syncHUD: noop,
  addService: noop, makeBillboard: noop, makeFence: noop, makeBarrel: noop, makePallet: noop,
  addLitSpot: noop,
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
  makeWaterTower: noop, placeGlbLandmark: () => false, shopParts: {}, state: null,
  buildPayNSpray: noop, getPlayer: () => null, adultContent: { enabled: () => false },
  makeShed: noop, makeGasStation: noop, makePopeyes: noop,
  // ROAD_X is the boulevard's x, and orlearouge.js now refuses to build without
  // it. It was missing here until 2026-09-28, and the Proxy answered it with
  // noop(), so `x < ROAD_X` was a comparison with NaN and the grid was built
  // with NO WESTERN HALF — 20 of its 123 lanes simply did not exist, and this
  // file still said "all checks passed" over the 103 that did.
  ROAD_X: -6, ROAD_HALF: 5,
  // …and the levee opens a gate wherever Parish Highway 9 crosses it, by asking this. The Proxy answered it
  // with noop(), so here the floodwall ran unbroken across the highway, which it never does in the game.
  onParishHighway,
  // main.js hands stateWorld every other district's lanes, and builds it last so they all exist:
  // its forests are pruned off them, and a harness that passed [] here never saw that happen
  allLanes: () => [], otherLanes: () => lanes.filter((l) => l.owner !== "stateWorld"), nightIsDark: false,
}, {
  get: (t, k) => {
    if (k in t) return t[k];
    if (typeof k === "string" && /(lots|services|pois|props|occluders|blockers|lanes|people|actors|roads|areas|water|composers|regions)$/.test(k)) return [];
    return noop;
  },
  set: (t, k, v) => { t[k] = v; return true; },
});

const MODULES = [
  ["orlearouge", "../../src/orlearouge.js", "createOrleaRouge"],
  ["metro", "../../src/metro.js", "createMetro"],
  ["crownstrip", "../../src/crownstrip.js", "createCrownStrip"],
  ["chatboro", "../../src/chatboro.js", "createChatboro"],
  ["tusouxroe", "../../src/tusouxroe.js", "createTusouxroe"],
  ["shruston", "../../src/shruston.js", "createShruston"],
  ["charsoufre", "../../src/charsoufre.js", "createCharsoufre"],
  ["westparish", "../../src/westparish.js", "createWestParish"],
  ["stateWorld", "../../src/stateWorld.js", "createStateWorld"],   // last, as in main.js
];

let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : " FAIL " } ${label}${detail ? `  — ${detail}` : ""}`);
};

// Build every district, keeping each one's blockers separate so a report can
// name the district a stray object belongs to.
const lanes = [];
const perDistrict = new Map();
for (const [name, path, fn] of MODULES) {
  const before = BLOCKERS.length;
  try {
    const m = await import(path);
    if (!m[fn]) { console.log(`  -- ${name}: no ${fn}, skipped`); continue; }
    const d = m[fn](ctx);
    if (d.buildSet) d.buildSet();
    if (d.lanes) lanes.push(...d.lanes.map((l) => ({ ...l, owner: name })));
  } catch (e) {
    console.log(`  !! ${name}: ${e.message}`);
    continue;
  }
  perDistrict.set(name, BLOCKERS.slice(before));
}

const CLEAR = 1.6;   // half a car (1.0) plus a little; traffic.js drivers hug the lane centre

/** Shortest distance from a blocker to a lane's centreline, minus the blocker's radius. */
function intrusion(lane, k) {
  const P = lane.points;
  if (!P || !P.length) return Infinity;      // this is the bug road_clearance.mjs has: it reads .pts
  let best = Infinity;
  for (let i = 1; i < P.length; i++) {
    const [ax, az] = P[i - 1], [bx, bz] = P[i];
    const dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((k.x - ax) * dx + (k.z - az) * dz) / len2));
    const d = Math.hypot(k.x - (ax + t * dx), k.z - (az + t * dz)) - k.r;
    if (d < best) best = d;
  }
  return best;
}

// ---- the self-test. Without it a silently-broken harness reads as a pass.
{
  const lane = lanes.find((l) => l.points && l.points.length > 1);
  const planted = { x: 0, z: 0, r: 0.5 };
  const p = lane.points[Math.floor(lane.points.length / 2)];
  planted.x = p[0]; planted.z = p[1];
  const d = intrusion(lane, planted);
  check("the harness detects a blocker planted in a lane", d < CLEAR, `reads ${d.toFixed(2)} m on "${lane.owner}:${lane.name}"`);
}
{
  const lane = lanes.find((l) => l.points && l.points.length > 1);
  const p = lane.points[0];
  const far = { x: p[0] + 5000, z: p[1] + 5000, r: 0.5 };
  check("the harness reports a blocker far from any lane", intrusion(lane, far) > CLEAR, `${intrusion(lane, far).toFixed(0)} m`);
}

// ---- the actual gate
const hits = [];
for (const lane of lanes) {
  for (const [owner, list] of perDistrict) {
    for (const k of list) {
      const d = intrusion(lane, k);
      if (d < CLEAR) hits.push({ from: owner, lane: `${lane.owner}:${lane.name}`, d, x: k.x, z: k.z, r: k.r });
    }
  }
}

// There is no allowance list any more. The Bayou Noir church and the Hwy 9
// rest stop were on one (Metro's grid had grown over them); Metro now builds
// around both (metro.js KEEP), so every hit is a real one.
const real = hits;

// A tree is the thing the player actually reported. westparish places two
// things on the Highway 9 corridor: forest pines (r 0.56..1.12, from
// buildForest) and steel guardrail posts (r exactly 1.0, from buildHighway).
// Both belong to westparish, so "is it a tree" has to be asked of the radius
// rather than the district — a post at r 1.0 is not a pine.
const isPine = (h) => h.from === "westparish" && h.x < -140 && h.r !== 1.0;
const treeHits = real.filter(isPine);
check("no west-parish tree stands in a city lane", treeHits.length === 0,
  treeHits.length ? `${treeHits.length}, e.g. x${treeHits[0].x.toFixed(1)} z${treeHits[0].z.toFixed(1)} in ${treeHits[0].lane}` : "the Highway 9 corridor is clear");

// ---- the gate: nothing solid in a lane, anywhere
//
// This used to be a CEILING of 240 over ~222 intrusions that were written off
// as "probably deliberate". They were not. Attributed by call site (2026-09-30)
// they were: OrleaRouge's street lanes running the full width of the city
// straight through the Superdome, City Park, Loyola and the Cathedral, where the
// asphalt is cut (~150); the state composers' forests planted before I-49 and
// OrleaRouge's avenues were laid across them (63 trees); parked cars on the kerb
// line with a disc blocker wider than the car; Hwy 9's bend guardrail strung
// across a Metro street; a Red Dust motel under the I-49 deck and two mesas on
// its carriageway; BurgerPiz 49 m deep on an 18 m site across the Oyster
// Highway; and a gas station forecourt in the Port Highway. Each was fixed at
// its source, and the count was zero on repeated builds.
//
// It went back above zero once, and the way it did is the reason this is zero
// and not a ceiling. Growing the city north to z 130 (2026-10-01) laid the grid
// over ground other code already owned: blocks, streets and the gateway district
// on the river edge, the z 170 street through the plaza under the viaduct, and
// the z 130 street 2.5 m into Metro's last row. The harness, now building the
// whole city, measured 458; each was fixed where it was made (orlearouge.js
// STREET_CUTS and blocks(), metro.js ROWS[5]), and a river-edge shop strip that
// had been built back to front went with them.
//
// So: one new thing in a lane fails. `RB_REPORT=1` prints which district placed
// it on whose lane, and `RB_DUMP=1` every hit.
check("no blocker stands in a traffic lane", real.length === 0,
  real.length ? `${real.length}, e.g. ${real[0].from} at x${real[0].x.toFixed(1)} z${real[0].z.toFixed(1)} r${real[0].r.toFixed(1)} in ${real[0].lane} — RB_REPORT=1 for the breakdown` : "every lane is clear");

if (process.env.RB_REPORT) {
  const m2 = new Map();
  for (const h of real) { const k = `${h.from} -> ${h.lane.split(":")[0]}`; m2.set(k, (m2.get(k) || 0) + 1); }
  // The per-lane breakdown, so a report can be acted on. "473 intrusions" is a
  // number nobody can fix; "x -172 z 131 on OrleaRouge 130, 4.4 m in" is a
  // specific object at a specific coordinate.
  const m3 = new Map();
  for (const h of real) { const k = h.lane; m3.set(k, (m3.get(k) || 0) + 1); }
  console.log("  intrusions by lane:");
  for (const [lane, n] of [...m3].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    const ex = real.find((h) => h.lane === lane);
    console.log(`    ${String(n).padStart(4)}  ${lane}  e.g. x${ex.x.toFixed(1)} z${ex.z.toFixed(1)} depth ${ex.d.toFixed(2)} m r${ex.r.toFixed(2)}`);
  }
  console.log("  intrusions by placer -> lane owner:");
  for (const [k, v] of [...m2].sort((a, c) => c[1] - a[1]).slice(0, 15)) console.log(`   ${String(v).padStart(4)}  ${k}`);
}

// `RB_DUMP=1`: every hit, one JSON line each, for working through a list
if (process.env.RB_DUMP) for (const h of real) console.log("HIT " + JSON.stringify(h));

console.log(`\n  ${lanes.length} lanes, ${BLOCKERS.length} blockers, ${hits.length} intrusions`);
if (failures) {
  console.log(`road_blockers_test: ${failures} failure(s)`);
  process.exit(1);
}
console.log("road_blockers_test: all checks passed");
