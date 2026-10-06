// ---------------------------------------------------------------------------
// landuse.mjs — is the city a city?
//
//   node --experimental-detect-module tools/qa/landuse.mjs [--json]
//
// "There's a lot of empty space in Chatboro and the main city area that could be
// filled up so the environment feels more urban, like a concrete jungle."
//
// The first version of this measured the wrong thing: a cell counted as "built"
// if ANY mesh over 1.2 m stood on it and "paved" if anything flat did. A lamp
// post is a building by that measure and a lawn is a car park, so every district
// came back 0% empty and the tool said everything the user said was not there.
// Counting objects is not the same as measuring space between them.
//
// What is actually being asked is about OPEN GROUND and HEIGHT:
//
//   reach     how far you can stand from a real structure — footprint >= 20 m2,
//             at least 4 m tall — before hitting one. A street with buildings
//             only at the kerb is open; a street walled on both sides is not.
//   height    the mean height of the structures near a point. A concrete jungle
//             is a HEIGHT claim, not a coverage claim, and nothing else in the
//             codebase measures it.
//   mass      footprint area x height, per hectare: how much city there is.
//
// Composed towns declare their plot in LOCAL coordinates and offset it by
// DISTRICTS[name] (chatboro's "z0 -120" is world z -720). Using the local
// numbers as world ones put the first survey 600 m south of the town and
// reported it 100% empty — the same local/world trap as the back-room frame bug.
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
  // US-167's position. orlearouge.js splits its grid on this, and the Proxy
  // answers anything it does not hold with noop() — so a survey run without it
  // compares every avenue against a function, gets false for all of them, and
  // measures a city that has lost its entire western half. It reported OrleaRouge
  // as 18 buildings and 30% open that way, which is a survey of nothing.
  ROAD_X: -6, ROAD_HALF: 5,
}, {
  get: (t, k) => {
    if (k in t) return t[k];
    if (typeof k === "string" && /(lots|services|pois|props|occluders|blockers|lanes|people|actors)$/.test(k)) return [];
    return noop;
  },
  set: (t, k, v) => { t[k] = v; return true; },
});

const CELL = 20;
const { DISTRICTS } = await import("../../src/districts.js");
const town = (key, b) => {
  const o = DISTRICTS[key];
  return { x0: o.x + b.x0, x1: o.x + b.x1, z0: o.z + b.z0, z1: o.z + b.z1 };
};
const LIST = [
  ["Chatboro", "../../src/chatboro.js", "createChatboro", town("chatboro", { x0: -96, x1: 48, z0: -120, z1: 100 })],
  ["Tusouxroe", "../../src/tusouxroe.js", "createTusouxroe", town("tusouxroe", { x0: -130, x1: 172, z0: -572, z1: -12 })],
  ["Shruston", "../../src/shruston.js", "createShruston", town("shruston", { x0: -130, x1: 130, z0: -300, z1: 310 })],
  ["Charsoufre", "../../src/charsoufre.js", "createCharsoufre", town("charsoufre", { x0: -130, x1: 130, z0: -150, z1: 150 })],
  ["OrleaRouge", "../../src/orlearouge.js", "createOrleaRouge", { x0: -292, x1: 680, z0: 196, z1: 500 }],
  ["Metro", "../../src/metro.js", "createMetro", { x0: -292, x1: 292, z0: -132, z1: 128 }],
];

// A structure worth calling a structure: big enough to be a building, tall
// enough to be one. A lamp post (0.3 m2) and a bench are street furniture and
// counting them is how the first version of this file reported a full city.
const MIN_FOOT = 20;      // m2
const MIN_H = 4;          // m
const NEAR = 50;          // m — "how much city can you see from here"

const report = [];
const SX = 20;            // sample pitch, m — declared out here because the report needs it
for (const [name, path, fn, b] of LIST) {
  scene.clear();
  const mod = await import(path);
  let d;
  try { d = mod[fn](ctx); if (d.buildSet) d.buildSet(); }
  catch (err) { console.log(`  !! ${name}: ${err.message}`); continue; }
  scene.updateMatrixWorld(true);

  const box = new THREE.Box3();
  const blocks = [];       // { x, z, r, h, mass }
  let totalMass = 0;
  scene.traverse((o) => {
    if (!o.isMesh) return;
    box.setFromObject(o);
    if (!isFinite(box.min.y) || !isFinite(box.max.y)) return;
    const h = box.max.y - box.min.y;
    if (h < MIN_H) return;
    const w = box.max.x - box.min.x, dd = box.max.z - box.min.z;
    if (w <= 0 || dd <= 0) return;
    const foot = w * dd;
    if (foot < MIN_FOOT) return;
    const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
    const r = Math.hypot(w, dd) / 2;   // circumscribed, for the height query only
    blocks.push({ x: cx, z: cz, r, h, foot, mass: foot * h,
      // the BOX, not the circumscribed circle. `r` is kept for the height
      // queries, but coverage has to be measured to a wall: a 60 × 10 m
      // building has a circumscribed radius of 30 m, so anything within 30 m of
      // its centre read as "touching" it — up to 25 m of open ground counted as
      // covered. That is how OrleaRouge came to be reported as 0.7% open and
      // "the densest in the state" when it is the opposite (human report,
      // 2026-09-28, an aerial with the empty lots marked).
      minx: box.min.x, maxx: box.max.x, minz: box.min.z, maxz: box.max.z });
    totalMass += foot * h;
  });

  // Sample the plot.
  const nx = Math.floor((b.x1 - b.x0) / SX), nz = Math.floor((b.z1 - b.z0) / SX);
  const far = [];          // how far is the nearest real building
  const heights = [];
  let sumReach = 0, sumH = 0, n = 0;
  const open = [];
  for (let gz = 0; gz < nz; gz++) for (let gx = 0; gx < nx; gx++) {
    const px = b.x0 + (gx + 0.5) * SX, pz = b.z0 + (gz + 0.5) * SX;
    let best = Infinity, hNear = 0, hSum = 0, hN = 0;
    for (const s of blocks) {
      // distance to the AABB: 0 inside, else the gap to the nearest face
      const dx = Math.max(s.minx - px, 0, px - s.maxx);
      const dz = Math.max(s.minz - pz, 0, pz - s.maxz);
      const d = Math.hypot(dx, dz);
      if (d < best) { best = d; hNear = s.h; }
      if (d < NEAR) { hSum += s.h; hN++; }
    }
    if (!isFinite(best)) continue;
    // `best` is distance to the block's EDGE, so it goes negative when the point
    // is inside one. Reporting that gave OrleaRouge a median "reach" of -328 m,
    // which is a number about a block's size wearing a hat. Reach is a distance:
    // clamp it at zero.
    best = Math.max(0, best);
    sumReach += Math.min(best, 200);
    const meanH = hN ? hSum / hN : 0;
    sumH += meanH; n++;
    far.push(Math.min(best, 200));
    heights.push(meanH);
    open.push({ x: px, z: pz, reach: Math.min(best, 200), meanH });
  }
  far.sort((a, c) => a - c);
  heights.sort((a, c) => a - c);
  const med = (arr) => arr.length ? arr[arr.length >> 1] : 0;
  const pct = (arr, p) => arr.length ? arr[Math.min(arr.length - 1, Math.floor(arr.length * p))] : 0;
  const area = (b.x1 - b.x0) * (b.z1 - b.z0) / 1e4;   // hectares

  // The worst open ground: sample points more than 30 m from any building,
  // grouped so the report names real places rather than scattered points.
  const gaps = open.filter((p) => p.reach > 30).sort((a, c) => c.reach - a.reach);

  report.push({
    name, bounds: b, hectares: +area.toFixed(1), structures: blocks.length,
    massPerHa: Math.round(totalMass / area),
    medianReach: +med(far).toFixed(1),
    meanReach: +(sumReach / Math.max(1, n)).toFixed(1),
    p75Reach: +pct(far, 0.75).toFixed(1),
    over30m: +((gaps.length / Math.max(1, n)) * 100).toFixed(1),
    medianHeight: +med(heights).toFixed(1),
    p90Height: +pct(heights, 0.9).toFixed(1),
    maxHeight: +Math.max(0, ...blocks.map((s) => s.h)).toFixed(1),
    worst: gaps.slice(0, 10).map((p) => ({ x: Math.round(p.x), z: Math.round(p.z), reach: Math.round(p.reach), meanH: +p.meanH.toFixed(1) })),
  });
}

if (process.argv.includes("--json")) {
  console.log("---JSON---");
  process.on("exit", () => console.log(JSON.stringify(report, null, 2)));
} else {
  console.log(`\nplot sampled at ${SX} m; a "structure" is >= ${MIN_FOOT} m2 footprint and >= ${MIN_H} m tall\n`);
  console.log(`  ${"district".padEnd(12)} {"ha":>6} {"bldgs":>6} {"mass/ha":>8} {"medReach":>9} {"%>30m":>6} {"medH":>5} {"p90H":>5} {"maxH":>5}`);
  for (const r of report) {
    console.log(`  ${r.name.padEnd(12)} ${String(r.hectares).padStart(6)} ${String(r.structures).padStart(6)} ${String(r.massPerHa).padStart(8)} ${String(r.medianReach).padStart(8)}m ${(r.over30m + "%").padStart(6)} ${String(r.medianHeight).padStart(4)}m ${String(r.p90Height).padStart(4)}m ${String(r.maxHeight).padStart(4)}m`);
  }
  console.log(`\n  mass/ha = built footprint x height per hectare. It is the closest thing here`);
  console.log(`  to "concrete jungle": a district of 2-storey houses and one of towers have the same`);
  console.log(`  coverage and very different mass.`);
  for (const r of report) {
    if (!r.worst.length) continue;
    console.log(`\n=== ${r.name}: ${r.over30m}% of the plot is over 30 m from a building ===`);
    for (const p of r.worst.slice(0, 6)) {
      console.log(`   (${String(p.x).padStart(5)}, ${String(p.z).padStart(6)})   ${String(p.reach).padStart(3)} m to the nearest building, mean height around it ${p.meanH} m`);
    }
  }
}
