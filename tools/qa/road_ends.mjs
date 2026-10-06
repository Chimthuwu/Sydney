// ---------------------------------------------------------------------------
// road_ends.mjs — where the roads actually are, and where they stop.
//
//   node --experimental-detect-module tools/qa/road_ends.mjs [--json] [--map out.pgm]
//
// The first version of this guessed at a city's grid with a regular expression
// over its source, ignored the district modules it had not heard of, and
// consequently reported that the world was a cliff at x = 720 when the
// eastbound arterial had already been built. Guessing is what made it wrong.
//
// This one measures. Every district is created against a stub context, which is
// enough to get its `lanes` — a list of centrelines, the same data the traffic
// system drives on — and the centrelines are rasterised into a 25 m grid over
// the whole 2400 x 2400 m state. What comes out is a coverage map and a list of
// the empty holes in it, which is what "did we finish growing the city?" has to
// mean before it can be answered.
//
// Nothing here is loaded into a scene and no mesh is built: lanes are data, and
// this is a question about data.
//
// With --json it prints a sentinel line and then the result, so road_ends_test.mjs
// can consume it without having to filter the game's own console.info chatter
// (the terrain and freeway builders are chatty) out of stdout.
// ---------------------------------------------------------------------------

// The builders above kick off asset loads that cannot work under Node —
// three's FileLoader tries to fetch('./assets/...') with no base URL. A rejected
// promise with nothing awaiting it takes the process down AFTER the report has
// printed, which makes a working survey look like a crash. Asset loading has no
// bearing on lane geometry; note it and carry on.
process.on("unhandledRejection", (err) => {
  console.log(`  ~~ an asset load failed and was ignored: ${err && err.message ? err.message : err}`);
});

import fs from "node:fs";
import { installBrowserStub } from "./lib/browser_stub.mjs";
installBrowserStub();

import * as THREE from "three";
import { surface } from "../../src/graphics.js";

const noop = () => {};
// browser_stub points window at globalThis, which has no addEventListener — and
// adultContent.js installs the 18+ launch gate at import time, on a window. The
// gate is a browser concern; this survey is about lane data.
globalThis.addEventListener = noop;
globalThis.removeEventListener = noop;
globalThis.innerWidth = 1920;
globalThis.innerHeight = 1080;
const scene = new THREE.Scene();

// A district creator reaches for a great deal of the game context. It only
// needs `lanes` back, so everything else is inert — but it has to be inert in a
// way that does not lie: any property the districts use as a list must come
// back as a real array, because `for (const x of ctx.lots)` over a noop returns
// nothing silently and quietly changes the answer.
const ctx = new Proxy({
  scene, surface,
  addBlocker: noop, addLitSpot: noop, poolLight: noop, flashObjective: noop,
  addService: noop, makeBillboard: noop, makeFence: noop, makeBarrel: noop, makePallet: noop,
  makeNeonSign: () => new THREE.MeshStandardMaterial({ color: 0xff4fb3 }),
  // composer's C.road() falls back to this for its tarmac. The Proxy's default
  // is a noop, which returns undefined, and the first paved road in the state
  // then dies in tiled() with "cannot read properties of undefined (reading
  // 'map')" — a stub that fails silently into a wrong number.
  roadMaterial: () => new THREE.MeshStandardMaterial({ color: 0x2b2b30, roughness: 0.93 }),
  getSheriffProto: () => ({}),
  lots: [], services: [], pois: [], props: [], servicesByType: [],
  playerPos: new THREE.Vector3(0, 0, 300),
  worldTime: { isNight: () => false, hour: () => 12, day: () => 1 },
  document: globalThis.document, window: globalThis,
  resolveCollision: (_cur, next) => next,
  loadDsCar: () => new Promise(() => {}),
  // a promise that never settles: the GLB loaders are optional, and a rejected
  // or synchronously-returned stub changes which branch of a builder runs
  loadGLB: () => new Promise(() => {}),
  loadModel: () => new Promise(() => {}),
  loadVehicle: () => new Promise(() => {}),
  loadCharacter: () => new Promise(() => {}),
  loadKit: () => new Promise(() => {}),
  rng: Math.random,
}, {
  get: (t, k) => {
    if (k in t) return t[k];
    // Known-plural keys have to come back as real arrays, because the districts
    // iterate them. Everything else is a noop. A looser test — "ends in s" —
    // is what the other harnesses use and it is a trap: it matches
    // `makePopeyeS`, townkit's "is this builder available?" check sees a
    // truthy array, calls it, and the state build dies three towns in with
    // "ctx.makePopeyes is not a function".
    if (typeof k === "string" && /(lots|services|pois|props|occluders|clusters|blockers|regions|keepers|lamps|signs|lanes|people|actors|spots|names|items|markers|trees|rocks|shops|houses|vehicles|pedestrians|critters)$/.test(k)) return [];
    return noop;
  },
  // Assignments land in the target, or stateWorld's `ctx.otherLanes` never
  // arrives and its own lane lookup gets a noop back.
  set: (t, k, v) => { t[k] = v; return true; },
});

const { STATE_BOUNDS } = await import("../../src/stateWorld.js");
const { createStateWorld } = await import("../../src/stateWorld.js");
const { EAST_HWY } = await import("../../src/orleafeinge.js");

// Every district that owns traffic, in the order main.js asks for them. Adding a
// district here is the only way to keep the survey honest about a new one: the
// map is the union of what is listed, and a district that is not listed is a
// district the survey will call empty.
const DISTRICTS = [
  ["OrleaRouge", "../../src/orlearouge.js", "createOrleaRouge"],
  ["Metro", "../../src/metro.js", "createMetro"],
  ["CrownStrip", "../../src/crownstrip.js", "createCrownStrip"],
  ["WestParish", "../../src/westparish.js", "createWestParish"],
  ["EastBank", "../../src/eastbank.js", "createEastBank"],
  ["Tusouxroe", "../../src/tusouxroe.js", "createTusouxroe"],
  ["Chatboro", "../../src/chatboro.js", "createChatboro"],
  ["Shruston", "../../src/shruston.js", "createShruston"],
  ["Charsoufre", "../../src/charsoufre.js", "createCharsoufre"],
  ["StateWorld", "../../src/stateWorld.js", "createStateWorld"],
];

const sources = [];
const districtLanes = [];
for (const [name, path, fn] of DISTRICTS) {
  const mod = await import(path);
  if (typeof mod[fn] !== "function") { console.log(`  -- ${name}: no ${fn}(), skipped`); continue; }
  let district = null, lanes = [];
  try {
    district = mod[fn](ctx);
    lanes = district.lanes || [];
  } catch (err) {
    console.log(`  !! ${name}: ${err.message}`);
    continue;
  }
  // Dedupe down to one CENTRELINE per road. A four-lane divided street is eight
  // lane objects, each of them offset up to 5 m sideways from the middle of the
  // tarmac, so counting them all would both multiply a district's apparent road
  // length and paint the carriageway 5 m too wide either side. makeRoadway
  // records which way the offset was applied (right of travel), so it can be
  // undone exactly rather than guessed at.
  const seen = new Set();
  const uniq = [];
  for (const l of lanes) {
    if (!l || !Array.isArray(l.points) || l.points.length < 2) continue;
    const off = l.road && l.offset ? l.offset : 0;
    const centre = !off ? l.points : l.points.map((p, k) => {
      const a = l.points[Math.max(0, k - 1)], b = l.points[Math.min(l.points.length - 1, k + 1)];
      let dx = b[0] - a[0], dz = b[1] - a[1];
      const len = Math.hypot(dx, dz) || 1; dx /= len; dz /= len;
      return [p[0] - dz * off, p[1] + dx * off];   // subtract (dz, -dx) * off
    });
    const key = centre.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push({ name: l.road || l.name, points: centre, dir: l.dir });
  }
  districtLanes.push(...lanes);
  sources.push({ name, lanes: uniq, district });
}

// The state's own build is the only way to see the freeways, the four corner
// towns, the connector highways and the corridors: stateWorld.js pushes those
// lanes into its own array DURING buildSet(), so a survey that only calls the
// creator reports the biggest road network in the state as empty. That is
// exactly the mistake this file exists to stop making, so it runs the build.
{
  const sw = sources.find((s) => s.name === "StateWorld");
  if (sw && sw.district && typeof sw.district.buildSet === "function") {
    const t0 = Date.now();
    ctx.otherLanes = () => districtLanes;
    try {
      sw.district.buildSet();
      console.log(`  (stateWorld built in ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
      const fresh = sw.district.lanes || [];
      const seen = new Set();
      for (const l of fresh) {
        if (!l || !Array.isArray(l.points) || l.points.length < 2) continue;
        const key = l.points.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("|");
        if (seen.has(key)) continue;
        seen.add(key);
        const off = l.road && l.offset ? l.offset : 0;
        const centre = !off ? l.points : l.points.map((p, k) => {
          const a = l.points[Math.max(0, k - 1)], b = l.points[Math.min(l.points.length - 1, k + 1)];
          let dx = b[0] - a[0], dz = b[1] - a[1];
          const len = Math.hypot(dx, dz) || 1; dx /= len; dz /= len;
          return [p[0] - dz * off, p[1] + dx * off];
        });
        sw.lanes.push({ name: l.road || l.name, points: centre, dir: l.dir });
      }
    } catch (err) {
      console.log(`  !! StateWorld build failed: ${err.message}`);
      console.log(String(err.stack || "").split("\n").slice(1, 4).join("\n"));
      console.log("     the freeways and the corner towns are NOT in this report — do not trust it.");
    }
  }
}

// ---------------------------------------------------------------------------
// The two pieces of road that live outside a district module.
//
// US-167 is built in main.js, which cannot be imported headlessly — it is the
// game. Rather than transcribe its coordinates (which is how the first version
// of this file lied), READ them out of the source and fail if they are not
// found, so a refactor that moves the spine breaks this loudly.
// ---------------------------------------------------------------------------
{
  const src = fs.readFileSync(new URL("../../src/main.js", import.meta.url), "utf8");
  const x = src.match(/const ROAD_X\s*=\s*(-?[\d.]+)/);
  const spine = src.match(/points:\s*\[\[ROAD_X,\s*MAP\.maxZ\s*-\s*\d+\],\s*\[ROAD_X,\s*MAP\.minZ\s*\+\s*\d+\]\]/);
  if (!x || !spine) {
    console.log("  !! main.js: could not read the US-167 spine out of the source — the survey is now");
    console.log("     incomplete rather than wrong, but it needs fixing before it is trusted.");
  } else {
    const roadX = Number(x[1]);
    sources.push({
      name: "US-167",
      lanes: [{ name: "US167", points: [[roadX, STATE_BOUNDS.maxZ - 2], [roadX, STATE_BOUNDS.minZ + 2]] }],
    });
    sources.push({
      name: "East arterial",
      lanes: [{ name: "EAST_HWY", points: [[EAST_HWY.x0, EAST_HWY.z], [EAST_HWY.x1, EAST_HWY.z]] }],
    });
  }
}

// ---------------------------------------------------------------------------
// Rasterise. A 25 m cell is coarse enough to run in a second and fine enough
// that "the city stops dead" is visible as a hard line of empty cells rather
// than a gradient.
// ---------------------------------------------------------------------------
const CELL = 25;
const MIN = Math.min(STATE_BOUNDS.minX, STATE_BOUNDS.minZ);
const MAX = Math.max(STATE_BOUNDS.maxX, STATE_BOUNDS.maxZ);
const N = Math.round((MAX - MIN) / CELL);
const owner = new Int16Array(N * N).fill(-1);          // which district reached this cell
const PAVED = 9;                                       // half carriageway + shoulder, m

/**
 * Does segment a→b come within `half` of any point of the cell's square?
 *
 * The obvious implementation — measure from the cell CENTRE — is wrong, and
 * was: cell centres sit 25 m apart and a road's paved half-width is 9 m, so a
 * road at z = 348 has cells centred at 337.5 and 362.5 and NEITHER of them is
 * within 9 m of it. The east arterial was 506 m of road that the survey
 * reported as not existing. Coverage that misses the thing it is measuring is
 * worse than no coverage at all, because it looks like a finding.
 *
 * So: expand the cell by `half` and do an exact segment/box overlap (slab
 * method). Over-reporting by a fraction of a cell at the edges is fine; missing
 * a road is not.
 */
function segHitsCell(a, b, half, gx, gz) {
  const x0 = MIN + gx * CELL - half, x1 = x0 + CELL;
  const z0 = MIN + gz * CELL - half, z1 = z0 + CELL;
  let tmin = 0, tmax = 1;
  for (const [p, d, lo, hi] of [[a[0], b[0] - a[0], x0, x1], [a[1], b[1] - a[1], z0, z1]]) {
    if (Math.abs(d) < 1e-9) { if (p < lo || p > hi) return false; continue; }
    let t0 = (lo - p) / d, t1 = (hi - p) / d;
    if (t0 > t1) [t0, t1] = [t1, t0];
    tmin = Math.max(tmin, t0);
    tmax = Math.min(tmax, t1);
    if (tmin > tmax) return false;
  }
  return true;
}

function stamp(pts, half, who) {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const x0 = Math.min(a[0], b[0]) - half, x1 = Math.max(a[0], b[0]) + half;
    const z0 = Math.min(a[1], b[1]) - half, z1 = Math.max(a[1], b[1]) + half;
    for (let gz = Math.floor((z0 - MIN) / CELL); gz <= Math.ceil((z1 - MIN) / CELL); gz++) {
      if (gz < 0 || gz >= N) continue;
      for (let gx = Math.floor((x0 - MIN) / CELL); gx <= Math.ceil((x1 - MIN) / CELL); gx++) {
        if (gx < 0 || gx >= N) continue;
        if (!segHitsCell(a, b, half, gx, gz)) continue;
        const k = gz * N + gx;
        if (owner[k] === -1) owner[k] = who;
      }
    }
  }
}

let totalMetres = 0;
sources.forEach((s, i) => {
  let len = 0;
  for (const l of s.lanes) {
    for (let k = 1; k < l.points.length; k++) len += Math.hypot(l.points[k][0] - l.points[k - 1][0], l.points[k][1] - l.points[k - 1][1]);
    stamp(l.points, PAVED, i);
  }
  s.metres = len;
  totalMetres += len;
});

const cells = owner.reduce((n, v) => n + (v >= 0 ? 1 : 0), 0);

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------
// How far out each way the road actually gets. `pick` selects the signed
// distance for one direction and returns null where that direction has no
// cells at all — the case where a district's lanes are all on one side of the
// spawn strip and "the road never goes west" is a real finding, not a zero.
const DIRS = [
  ["west", (x, z) => x, (x, z) => x < 0],
  ["east", (x, z) => x, (x, z) => x > 0],
  ["north", (x, z) => z, (x, z) => z < 0],
  ["south", (x, z) => z, (x, z) => z > 0],
];
function reach(d) {
  const [, coord, inDir] = d;
  let best = null;
  for (let gz = 0; gz < N; gz++) for (let gx = 0; gx < N; gx++) {
    const who = owner[gz * N + gx];
    if (who < 0) continue;
    const x = MIN + (gx + 0.5) * CELL, z = MIN + (gz + 0.5) * CELL;
    if (!inDir(x, z)) continue;
    const c = coord(x, z);
    const away = d[0] === "west" || d[0] === "north" ? -c : c;
    if (best === null || away > best.away) best = { away, x, z, who };
  }
  return best;
}

// The biggest empty squares: this is the actual finding, because "where does
// the city stop" is always a patch of nothing, not a line.
const EMPTY = 200;                                     // m square to look for
const E = Math.round(EMPTY / CELL);
const holes = [];
for (let gz = 0; gz + E <= N; gz += E) for (let gx = 0; gx + E <= N; gx += E) {
  let n = 0;
  for (let j = 0; j < E; j++) for (let i = 0; i < E; i++) if (owner[(gz + j) * N + gx + i] >= 0) n++;
  if (n === 0) holes.push({ x0: MIN + gx * CELL, x1: MIN + (gx + E) * CELL, z0: MIN + gz * CELL, z1: MIN + (gz + E) * CELL });
}
holes.sort((a, b) => (a.x0 - b.x0) || (a.z0 - b.z0));

const out = {
  cell: CELL, grid: N,
  state: STATE_BOUNDS,
  districts: sources.map((s) => ({ name: s.name, lanes: s.lanes.length, metres: Math.round(s.metres) })),
  totalMetres: Math.round(totalMetres),
  pavedCells: cells,
  pavedKm2: +((cells * CELL * CELL) / 1e6).toFixed(2),
  reach: Object.fromEntries(DIRS.map((d) => {
    const r = reach(d);
    // `away` is distance travelled out from the origin in this direction, so the
    // shortfall to the map edge is always the half-extent minus that distance:
    // 1187 m north of spawn on a map that runs to 1200 is 13 m short, and
    // 362 m west on the same map is 825 m short.
    return [d[0], r ? {
      at: [Math.round(r.x), Math.round(r.z)],
      from: sources[r.who].name,
      gapToEdge: Math.round(Math.max(0, MAX - r.away - CELL / 2)),
    } : null];
  })),
  holes,
};

if (process.argv.includes("--json")) {
  // Printed from the exit handler, not here. Asset loads that reject long after
  // the survey finished still log to stdout, and a JSON consumer that takes
  // "everything after the sentinel" then trips over the trailing chatter.
  process.on("exit", () => {
    console.log("---JSON---");
    console.log(JSON.stringify(out, null, 2));
  });
} else {
  console.log(`\nstate ${MAX * 2} x ${MAX * 2} m, sampled at ${CELL} m — ${cells} road cells, ${out.pavedKm2} km2\n`);
  for (const d of out.districts) console.log(`  ${d.name.padEnd(14)} ${String(d.lanes).padStart(4)} lanes  ${String(d.metres).padStart(6)} m`);
  console.log(`  ${"TOTAL".padEnd(14)} ${String(sources.reduce((n, s) => n + s.lanes.length, 0)).padStart(4)} lanes  ${String(out.totalMetres).padStart(6)} m\n`);
  for (const [n, r] of Object.entries(out.reach)) {
    console.log(`  ${n.padEnd(6)} road reaches ${r ? `(${r.at[0]}, ${r.at[1]})` : "NOTHING"}` +
      (r ? ` via ${r.from}, ${r.gapToEdge} m short of the map edge` : ""));
  }
  console.log(`\n  ${EMPTY} m squares with no road in them at all: ${holes.length}`);
  for (const h of holes.slice(0, 40)) {
    console.log(`    x ${h.x0}…${h.x1}, z ${h.z0}…${h.z1}`);
  }
  if (holes.length > 40) console.log(`    ... +${holes.length - 40} more`);
}

// An ASCII map, because a table of numbers does not show a coastline.
if (process.argv.includes("--map")) {
  const rows = [];
  for (let gz = N - 1; gz >= 0; gz -= 2) {
    let row = "";
    for (let gx = 0; gx < N; gx += 1) {
      const v = owner[gz * N + gx];
      row += v < 0 ? (out.holes.some((h) => gx * CELL + MIN >= h.x0 && gx * CELL + MIN < h.x1 && gz * CELL + MIN >= h.z0 && gz * CELL + MIN < h.z1) ? "·" : " ") : "█";
    }
    rows.push(row);
  }
  console.log("\n" + rows.join("\n"));
}
