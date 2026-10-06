// Do the blocks have middles?
//
//   node --experimental-detect-module tools/qa/block_interiors_test.mjs [--report]
//
// Reported (human, 2026-09-28, an aerial shot with the empty ground outlined):
// "cant you see these empty spaces, make OrleaRouge and surrounding areas feel
//  like a city, all these gaps".
//
// WHAT THE GAPS ARE NOT. Every measurement of this city agreed on one thing:
// there is no hole in it. No 10 m cell anywhere in the 24.8 ha plot is more than
// 25 m from SOME mesh, and the whole thing is paved edge to edge. The first
// survey reported 0.0% bare ground, which sounded like a clean bill of health
// and was not, because the paving is a mesh.
//
// So the gap is not absence of geometry. It is a block whose MIDDLE is
// pavement: frontage rows hard against the streets, a hollow paved core behind
// them, and from the air — which is exactly how it was reported — a grid of
// buildings with the filling left out of the middle.
//
// MEASURING IT. `landuse.mjs` asks "how far to a real structure" over the whole
// plot, and a city where every frontage row is hard against the kerb scores well
// on that: the reach from a frontage wall is small. It cannot see a hollow
// because a hollow is measured against the frontage on all four sides, and each
// of those is close. This file measures the thing that is actually wrong: the
// distance from a ground sample INSIDE a block to the nearest thing that STANDS
// UP off that ground. Paint, kerbs, park lawn and a car park surface are all
// meshes and all of them lie down flat; a dumpster, a rear wing, a coach house
// and a hedge do not.
//
// Two properties make the number worth gating on:
//   - it is measured per plot, from the module's OWN block list, so a district
//     that quietly stops producing blocks cannot make the metric improve;
//   - it is bucketed into a 20 m grid, so the cost is linear in samples rather
//     than samples x eleven thousand meshes.
//
// THE SELF-TEST. Three detectors in this repo have shipped broken because a
// broken one reported a healthy number (road_clearance read `l.pts`; a
// crosswalk overlap had a typo; a lane check measured distance to the sample
// points instead of the segment). Every detector here gets a control that
// PROVES it can fail, and this one is checked against two synthetic blocks —
// one solid, one empty — before it is allowed to say anything about OrleaRouge.

import { installBrowserStub } from "./lib/browser_stub.mjs";
installBrowserStub();
globalThis.addEventListener = () => {};
globalThis.innerWidth = 1920;
globalThis.innerHeight = 1080;
process.on("unhandledRejection", () => {});

import * as THREE from "three";
import { readFileSync } from "node:fs";
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
  playerPos: new THREE.Vector3(0, 0, 130),
  // ROAD_X and ROAD_HALF are not optional. The ctx Proxy answers anything it
  // does not hold with a no-op FUNCTION, so a probe that forgets them hands
  // `zoneOf()` a function: `b.cx < ROAD_X` is then a comparison with NaN, every
  // test is false, and every block in the city is built as "midtown". The survey
  // below ran that way for a whole round and reported a dense, healthy city with
  // two dead plots in it. That is the fourth time this repository has been bitten
  // by that particular omission.
  ROAD_X: -6, ROAD_HALF: 5,
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

// ---- what counts as standing up ------------------------------------------
//
// A mesh has to be BOTH near the ground and taller than it is wide-ish to be a
// thing in a backland rather than a painted line. A 0.1 m slab is paint, a
// 0.5 m kerb is a kerb, a 4.2 m box is a shed. MIN_H is deliberately low: a
// dumpster is 1.3 m and counting it is the whole point — an alley that has been
// dressed with bins, wings and condensers is not the same ground as one that has
// not, and at this height a city block can only be filled with things this low
// or with buildings this low.
const MIN_H = 0.9;
const FOOT_Y = 1.6;        // its base has to be on the ground, not on a roof
const BUCKET = 20;
const SAMPLE = 2;          // m — sample pitch inside a plot
const HOLLOW = Number((process.env.HOLLOW_M) || 6);

/** Everything in `root` that stands on the ground, as AABBs, bucketed. */
function standing(root) {
  const box = new THREE.Box3();
  const out = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    box.setFromObject(o);
    if (![box.min.x, box.max.x, box.min.y, box.max.y, box.min.z, box.max.z].every(Number.isFinite)) return;
    if (box.min.y > FOOT_Y) return;                       // up a tower, on a roof
    if (box.max.y - box.min.y < MIN_H) return;            // paint, kerb, lawn
    const w = box.max.x - box.min.x, d = box.max.z - box.min.z;
    if (w <= 0 || d <= 0) return;
    out.push({ minx: box.min.x, maxx: box.max.x, minz: box.min.z, maxz: box.max.z, miny: box.min.y, maxy: box.max.y });
  });
  const grid = new Map();
  for (const s of out) {
    for (let x = Math.floor(s.minx / BUCKET); x <= Math.floor(s.maxx / BUCKET); x++) {
      for (let z = Math.floor(s.minz / BUCKET); z <= Math.floor(s.maxz / BUCKET); z++) {
        const k = `${x},${z}`;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(s);
      }
    }
  }
  return { all: out, grid };
}

/** Distance from a ground point to the nearest AABB, in 3x3 buckets. */
function reach(standing, px, pz) {
  const bx = Math.floor(px / BUCKET), bz = Math.floor(pz / BUCKET);
  let best = Infinity;
  for (let x = bx - 1; x <= bx + 1; x++) {
    for (let z = bz - 1; z <= bz + 1; z++) {
      const list = standing.grid.get(`${x},${z}`);
      if (!list) continue;
      for (const s of list) {
        const dx = Math.max(s.minx - px, 0, px - s.maxx);
        const dz = Math.max(s.minz - pz, 0, pz - s.maxz);
        const d = Math.hypot(dx, dz);
        if (d < best) best = d;
        if (best === 0) return 0;
      }
    }
  }
  return best;
}

/**
 * How much of ONE plot is open paving: the share of its samples more than
 * HOLLOW metres from anything standing up.
 *
 * It is a share and not a median on purpose. The first version of this asked for
 * the median reach inside a plot, and the median came back 0.0 m for a city that
 * is full of hollow middles — because on a 26 m deep plot the hollow band is 8 m
 * wide and a 4 m sample grid puts exactly one sample in it, next to two that sit
 * ON the frontage walls and read 0. A statistic that cannot be moved by the thing
 * it is supposed to detect is a statistic you must not gate a build on.
 *
 * A share sees it. The share is also the number a city planner would use, and it
 * weights by ground rather than by plot, so twenty small hollow courtyards do not
 * hide behind one big filled block.
 */
function plotHollow(standing, b, inset = 1) {
  const xs = [], zs = [];
  for (let x = b.x0 + inset; x <= b.x1 - inset; x += SAMPLE) xs.push(x);
  for (let z = b.z0 + inset; z <= b.z1 - inset; z += SAMPLE) zs.push(z);
  if (!xs.length || !zs.length) return null;
  let open = 0;
  const d = [];
  for (const x of xs) for (const z of zs) {
    const r = reach(standing, x, z);
    const v = Number.isFinite(r) ? r : 60;
    d.push(v);
    if (v > HOLLOW) open++;
  }
  d.sort((p, q) => p - q);
  return { frac: open / d.length, median: d[d.length >> 1], max: d[d.length - 1], n: d.length };
}

// ---- 0. THE SELF-TEST: the detector can tell a full plot from an empty one --
{
  const mk = (fill) => {
    const s = new THREE.Scene();
    const b = { x0: 0, x1: 34, z0: 0, z1: 30 };
    if (fill) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(34, 8, 30),
        new THREE.MeshStandardMaterial({ color: 0x888888 }));
      m.position.set(17, 4, 15);
      s.add(m);
    }
    return plotHollow(standing(s), b);
  };
  const full = mk(true), empty = mk(false);
  const okFull = full && full.frac === 0;
  const okEmpty = empty && empty.frac === 1;
  if (!okFull || !okEmpty) {
    console.error(` FAIL  self-test: solid plot hollow ${full?.frac}, empty plot hollow ${empty?.frac}`);
    console.error("block_interiors_test: the detector cannot fail, so it cannot pass. Fix it first.");
    if (!process.argv.includes("--scan")) process.exit(1);
  }
  console.log(`  ok    self-test: a solid plot is 0% hollow, an empty one 100%`);

  // The shape the actual bug has: a frontage row on each edge with a paved
  // middle. The band is sized from the THRESHOLD rather than fixed, because the
  // honest question is not "is 8 m of alley a gap" (it is an alley, and a city
  // full of alleys is a city) but "does this detector see a gap at the size it
  // claims to measure". So the control is a plot whose hollow is 2 m wider than
  // HOLLOW on each side, and the assertion is that it reads hollow.
  //
  // Built at a fixed size instead, this control is a trap: a band only just
  // wider than the threshold can never fire, because the middle of it is under
  // the threshold from the wall on either side. The first run of this file failed
  // exactly that way — a 16 m gap read 6% hollow, and the one sample row that
  // was far enough out was being asked to carry the assertion alone.
  const bandDepth = 9 + (HOLLOW * 4 + 8) + 9;
  const s2 = new THREE.Scene();
  const mkRow = (z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(42, 9, 9), new THREE.MeshStandardMaterial({ color: 0x998877 }));
    m.position.set(21, 4.5, z);
    s2.add(m);
  };
  mkRow(4.5); mkRow(bandDepth - 4.5);
  const frontage = plotHollow(standing(s2), { x0: 0, x1: 42, z0: 0, z1: bandDepth });
  const okFrontage = frontage.frac > 0.1;
  console.log(`${okFrontage ? "  ok  " : " FAIL " }  self-test: a ${(bandDepth - 18).toFixed(0)} m gap between two frontage rows reads ${(frontage.frac * 100).toFixed(0)}% hollow`);
  if (!okFrontage) {
    console.error("block_interiors_test: the frontage-with-a-hollow-middle control reads solid; the survey cannot see the reported bug.");
    if (!process.argv.includes("--scan")) process.exit(1);
  }

  // …and a lone LAWN must read as open. A flat plane is exactly what a backland
  // reads as, so if the metric counted planes the survey would be a tautology.
  const s3 = new THREE.Scene();
  const lawn = new THREE.Mesh(new THREE.BoxGeometry(34, 0.1, 30), new THREE.MeshStandardMaterial({ color: 0x4e6b34 }));
  lawn.position.set(17, 0.05, 15);
  s3.add(lawn);
  const r3 = plotHollow(standing(s3), { x0: 0, x1: 34, z0: 0, z1: 30 });
  const okLawn = r3.frac === 1;
  console.log(`${okLawn ? "  ok  " : " FAIL " }  self-test: a flat lawn reads as open ground (${(r3.frac * 100).toFixed(0)}% hollow)`);
  if (!okLawn) {
    console.error("block_interiors_test: 1 failure(s)");
    if (!process.argv.includes("--scan")) process.exit(1);
  }
}

// ---- 1. the city ---------------------------------------------------------
let checkEveryAlleyIsDressed = { n: -1, empty: -1 };
let seam = { pct: -1, tall: -1 }, floodwall = { pct: -1, tall: -1 };
const { createOrleaRouge } = await import("../../src/orlearouge.js");
const orlea = createOrleaRouge(ctx);
orlea.buildSet();                       // before .blocks: the plots are not made until then
scene.updateMatrixWorld(true);
const st = standing(scene);

const bl = orlea.blocks.filter((b) => !b.reserve);
const perPlot = bl.map((b) => ({ b, r: plotHollow(st, b) })).filter((p) => p.r);
const worstPlots = [...perPlot].sort((a, c) => c.r.frac - a.r.frac).slice(0, 8);

// area-weighted: a 42 x 26 plot and a 21 x 26 plot are not the same ground
let hollow = 0, total = 0;
for (const p of perPlot) {
  const a = (p.b.x1 - p.b.x0) * (p.b.z1 - p.b.z0);
  total += a;
  hollow += a * p.r.frac;
}
const hollowPct = (hollow / Math.max(1, total)) * 100;
const openPlots = perPlot.filter((p) => p.r.frac > 0.35);

console.log(`\n  OrleaRouge: ${perPlot.length} plots, ${st.all.length} things standing on the ground`);
console.log(`  ${hollowPct.toFixed(1)}% of the block area is open paving · ${openPlots.length} plots over a third hollow`);

// ---- 2. THE ALLEYS BEHIND THE FRONTAGE -----------------------------------
//
// A reach survey is the wrong instrument for an alley and the first draft of
// this file used one. A French Quarter plot is 26 m deep with 9 m terraces on
// each edge, so the gap between them is 8 m — and the MIDDLE of an 8 m gap is 4 m
// from a wall on either side, comfortably inside the 6 m threshold. An undressed
// alley and a dressed one therefore measure identically, and the survey reported
// the whole Quarter as fine while the blocks were two terraces round a stain.
//
// So the alleys are asked about directly: the module records the strips it
// dresses, and each one has to CONTAIN things standing on the ground. That is a
// different question from "is there room to stand here", which is the question
// the reach metric answers well, and the right one here.
//
// The self-test for it is the same shape as the others: a band with nothing in it
// must read empty, and a band with a dumpster in it must not.
{
  const band = { x0: 0, x1: 40, z0: 9, z1: 17 };
  const count = (root) => {
    const s = standing(root);
    let n = 0;
    for (let x = band.x0 + 1; x < band.x1 - 1; x += 2) {
      for (let z = band.z0 + 1; z < band.z1 - 1; z += 2) {
        if (reach(s, x, z) <= HOLLOW) n++;
      }
    }
    return n;
  };
  const bare = new THREE.Scene();
  const dressed = new THREE.Scene();
  for (const x of [8, 20, 32]) {
    const d = new THREE.Mesh(new THREE.BoxGeometry(2.3, 1.25, 1.35), new THREE.MeshStandardMaterial({ color: 0x2f4a3a }));
    d.position.set(x, 0.72, 13);
    dressed.add(d);
  }
  const nBare = count(bare), nDressed = count(dressed);
  const ok = nBare === 0 && nDressed > 0;
  console.log(`${ok ? "  ok  " : " FAIL " }  self-test: a bare alley band reads 0 dressed samples, a dressed one ${nDressed}`);
  if (!ok) { console.error("block_interiors_test: the alley counter cannot tell a bare band from a dressed one."); process.exit(1); }

  const bands = orlea.alleys;
  const empty = bands.filter((a) => {
    const n = Math.round(((a.x1 - a.x0) * (a.z1 - a.z0)) / 9);
    let dressed = 0;
    for (let x = a.x0 + 1; x < a.x1 - 1; x += 3) {
      for (let z = a.z0 + 1; z < a.z1 - 1; z += 1.5) if (reach(st, x, z) <= HOLLOW) dressed++;
    }
    return dressed < 3;
  });
  console.log(`\n  back-of-block strips: ${bands.length} dressed, ${empty.length} with nothing in them`);
  if (empty.length) {
    const e = empty[0];
    console.log(`    e.g. x ${e.x0.toFixed(0)}..${e.x1.toFixed(0)} z ${e.z0.toFixed(0)}..${e.z1.toFixed(0)}`);
  }
  checkEveryAlleyIsDressed = { n: bands.length, empty: empty.length };
}

// ---- 4. THE SEAM, AND THE FLOODWALL ---------------------------------------
//
// Two strips that are not plots and cannot be measured as plots, because
// neither of them is built on a block grid: the 142 x 64 m river edge between
// Downtown Bayou and the city, and the floodwall the city ends on.
//
// They are measured by FOOTPRINT instead — the share of the rect under the base
// of something standing on it. That is deliberate: a reach sweep cannot tell a
// warehouse from a road, and this strip is mostly road by design, so a
// distance-based number here would be a comment on the road layout. Footprint
// cannot be inflated by tarmac, which is the whole reason for using it.
function footprintIn(r) {
  let area = 0, tall = 0;
  for (const s of st.all) {
    const w = Math.min(s.maxx, r.x1) - Math.max(s.minx, r.x0);
    const d = Math.min(s.maxz, r.z1) - Math.max(s.minz, r.z0);
    if (w > 0 && d > 0) { area += w * d; if ((s.maxy - s.miny) >= 4) tall++; }
  }
  return { pct: (area / ((r.x1 - r.x0) * (r.z1 - r.z0))) * 100, tall };
}
const seamR = footprintIn(orlea.seam);
const floodwallR = footprintIn(orlea.floodwall);
seam = seamR; floodwall = floodwallR;
console.log(`\n  the river edge (z ${orlea.seam.z0}..${orlea.seam.z1}): ${seam.pct.toFixed(1)}% under something standing, ${seam.tall} structures`);
console.log(`  the floodwall strip (x ${orlea.floodwall.x0}..${orlea.floodwall.x1}): ${floodwall.pct.toFixed(1)}%, ${floodwall.tall} structures`);


//
// The report was "make OrleaRouge and SURROUNDING AREAS feel like a city", and
// the block survey is clean, which means the empty part is not inside the city.
// It was the ground WEST of it: measured before the grid was extended, 98.2% of
// a 9.7 ha band from x -136 out to x -456 had nothing standing on it at all, at
// the same latitude as downtown and on the same side of the river the player
// spawns on.
//
// The band is therefore an APPROACH, not a halo, and it is anchored to a
// constant rather than to the city's own edge: OLD_WEST_X is where the grid
// used to stop. Anchoring it to CITY.minX instead is a gate that moves with the
// thing it is gating — every time the city grows west, the test re-aims itself at
// the fresh empty ground and the city can never pass. That is the same mistake a
// keepout list makes when it is written from the district's current bounds.
//
// It is measured on PLOTS, like section 1, and not on a grid of raw samples. A
// raw sweep counts the avenues and the streets as open ground: a 9 m avenue
// with a 7 m setback has its centreline 7 m from the nearest wall, which this
// detector calls open, so 40% of any band of city reads as void no matter what
// is built on it. Carriageway is not emptiness.
//
// Two assertions, because either alone can be satisfied by a cheat: the plots
// have to EXIST (a district that quietly built nothing in the west would
// otherwise pass a test about the plots it did not build), and the plots that do
// exist have to be filled.
const OLD_WEST_X = -136;          // where the grid stopped before the West Bank
const { city: CITY } = orlea.grid;
const approach = perPlot.filter((p) => p.b.cx < OLD_WEST_X);
let appHollow = 0, appArea = 0;
for (const p of approach) {
  const a = (p.b.x1 - p.b.x0) * (p.b.z1 - p.b.z0);
  appArea += a;
  appHollow += a * p.r.frac;
}
const appPct = (appHollow / Math.max(1, appArea)) * 100;
const westReach = approach.length
  ? Math.min(...approach.map((p) => p.b.cx)) : 9999;
console.log(`  the western approach (x < ${OLD_WEST_X}): ${approach.length} plots, ` +
  `${appPct.toFixed(1)}% hollow, ${(appArea / 1e4).toFixed(1)} ha, reaching x ${Math.round(westReach)}\n`);

if (process.argv.includes("--report")) {
  for (const p of worstPlots) {
    console.log(`   (${String(Math.round(p.b.cx)).padStart(5)}, ${String(Math.round(p.b.cz)).padStart(5)})  ` +
      `${String(Math.round(p.b.x1 - p.b.x0)).padStart(3)} x ${String(Math.round(p.b.z1 - p.b.z0)).padStart(3)} m  ` +
      `${(p.r.frac * 100).toFixed(0).padStart(3)}% hollow`);
  }
  console.log("");
}

let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : " FAIL " } ${label}${detail ? `  — ${detail}` : ""}`);
};

// The gate. 12% of a downtown's ground being back-of-house is a real city's
// number; 40% is a plan with the middle left out.
check("under an eighth of the block area is open paving", hollowPct <= 12, `${hollowPct.toFixed(1)}%`);
check("under a fifth of the plots are over a third hollow",
  openPlots.length <= perPlot.length * 0.2, `${openPlots.length}/${perPlot.length}`);
// The back-of-block strips have to EXIST and have to be dressed: a Quarter with
// no alleys at all is as wrong as one with bare ones, and the reach survey above
// cannot tell the two apart. The first version of this check only counted the
// EMPTY ones, so deleting the call that dresses them — which is what a mutation
// test does — reported "0 empty strips" and passed. A gate that cannot see its
// own subject being removed is not a gate.
check("the back-of-block strips are dressed, and there are some",
  checkEveryAlleyIsDressed.n >= 8 && checkEveryAlleyIsDressed.empty === 0,
  `${checkEveryAlleyIsDressed.n} strips, ${checkEveryAlleyIsDressed.empty} empty`);
// The city is judged as a whole, and a downtown walled by emptiness is not a
// city that feels like one. A player who walks 200 m west of US-167 must still be
// somewhere. Before the West Bank there were no plots here at all and the raw
// ground read 98.2% open.
check("the city reaches 100 m past the old west edge", westReach < OLD_WEST_X - 100,
  `plots reach x ${Math.round(westReach)}`);
check("the western approach is built, not void", approach.length >= 20, `${approach.length} plots`);
check("the western approach is not mostly hollow", appPct <= 30, `${appPct.toFixed(1)}% hollow`);
// The two strips that are not block grid. Footprint, because tarmac cannot
// inflate it: this is a strip of road with warehouses on it and a distance
// survey would be measuring the road.
check("the river edge is built, not a gap between two cities",
  seam.pct >= 12 && seam.tall >= 5, `${seam.pct.toFixed(1)}% under something, ${seam.tall} structures`);
check("the city's west edge ends on something",
  floodwall.pct >= 1.5 && floodwall.tall >= 2,
  `${floodwall.pct.toFixed(1)}%, ${floodwall.tall} structures`);

// The floodwall opens where Parish Highway 9 crosses it, and that is a fact
// about two modules that cannot import each other — so the arithmetic is
// extracted, pure and exported, and checked here with a synthetic crossing. The
// contract that the query ARRIVES at all is a separate check below, because a
// wall that silently stops having gates is the same bug wearing a different hat.
{
  const crossing = (x, z) => Math.abs(x + 312) < 12 && z > 150 && z < 180;
  const whole = orlea.leveeRuns(-312, 136, 500, () => false);
  const gapped = orlea.leveeRuns(-312, 136, 500, crossing);
  const covered = whole.reduce((a, [x, y]) => a + (y - x), 0);
  const open = gapped.reduce((a, [x, y]) => a + (y - x), 0);
  const ok = whole.length === 1 && covered === 364
    && gapped.length === 2 && open < covered - 20;
  console.log(`  floodwall: ${whole.length} run with no road, ${gapped.length} runs with one crossing ` +
    `(${covered} m of wall -> ${open} m)`);
  if (!ok) {
    console.error("block_interiors_test: the floodwall does not open for a road crossing it.");
    process.exit(1);
  }
  // …and main.js has to hand the query over, or the gate logic is dead code.
  const mainSrc = readFileSync(new URL("../../src/main.js", import.meta.url), "utf8");
  const orleaArg = mainSrc.slice(mainSrc.indexOf("createOrleaRouge({"));
  const hands = /onParishHighway/.test(orleaArg.slice(0, orleaArg.indexOf("});")));
  check("main.js hands the highway query to the city", hands,
    "orlearouge.js cannot import westparish.js, so ctx is the only route");
}

if (failures) { console.error(`block_interiors_test: ${failures} failure(s)`); process.exit(1); }
console.log("block_interiors_test: all checks passed");
