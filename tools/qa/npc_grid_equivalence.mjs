// npc_grid_equivalence.mjs — the bucketed nearest-neighbour search returns the
// SAME answer as the full-population scan it replaced, on real layouts.
//
//   node --experimental-detect-module tools/qa/npc_grid_equivalence.mjs
//
// A perf fix that changes who gets bitten is not a perf fix. The O(n^2) scan in
// npc.js became a spatial grid (perf audit, 2026-10-02), and the whole safety
// argument is that bucketing can only change HOW LONG an answer takes, never
// WHICH NPC wins — because all three searches are nearest-neighbour with a
// radius cap, so a candidate outside the cap could never have won anyway.
//
// That argument is only as good as this test. It builds the real grid helper's
// logic over synthetic-but-adversarial populations and compares it against a
// brute-force reference on every pair. The adversarial cases are the point:
// populations clustered into one cell, spread across many, exactly on a cell
// boundary, at the extreme corner of the search radius, and empty.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const npcSrc = readFileSync(join(here, "../../src/npc.js"), "utf8");

let fails = 0;
const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m) => { console.log(`  FAIL ${m}`); fails++; };
const check = (c, m) => (c ? ok(m) : bad(m));

// ---------------------------------------------------------------------------
// Re-implement the two algorithms EXACTLY as they are in src/npc.js, so this
// compares the shipped logic and not a paraphrase of it. If the source changes,
// these must change with it — hence the source assertions at the end.
// ---------------------------------------------------------------------------
const GRID_CELL = 100;                        // ZOMBIE_SCENT in npc.js
const key = (cx, cz) => cx * 73856093 ^ cz * 19349663;

function buildBuckets(list) {
  const m = new Map();
  for (const e of list) {
    if (!e || e.dead) continue;
    const cx = Math.floor(e.x / GRID_CELL), cz = Math.floor(e.z / GRID_CELL);
    const k = key(cx, cz);
    let b = m.get(k);
    if (!b) { b = []; m.set(k, b); }
    b.push(e);
  }
  return m;
}
function gridNearest(buckets, self, x, z, radius, accept) {
  const r2 = radius * radius;
  let best = null, bestD2 = r2;
  const cx = Math.floor(x / GRID_CELL), cz = Math.floor(z / GRID_CELL);
  const span = Math.max(1, Math.ceil(radius / GRID_CELL));
  for (let dx = -span; dx <= span; dx++) for (let dz = -span; dz <= span; dz++) {
    const b = buckets.get(key(cx + dx, cz + dz));
    if (!b) continue;
    for (const o of b) {
      if (o === self || o.dead) continue;
      if (!accept(o)) continue;
      const ddx = o.x - x, ddz = o.z - z;
      const d2 = ddx * ddx + ddz * ddz;
      if (d2 < bestD2) { bestD2 = d2; best = o; }
    }
  }
  return { e: best, d2: bestD2 };
}
/** the ORIGINAL: walk the whole population, Math.hypot per pair */
function bruteNearest(list, self, x, z, radius, accept) {
  let best = null, bestD = radius;
  for (const o of list) {
    if (o === self || o.dead) continue;
    if (!accept(o)) continue;
    const d = Math.hypot(o.x - x, o.z - z);
    if (d < bestD) { bestD = d; best = o; }
  }
  return { e: best, d2: bestD * bestD };
}

const ACCEPT_ANY = () => true;
const ACCEPT_NONZOMBIE = (o) => o.state !== "dead" && o.type !== "zombie";
const ACCEPT_ZOMBIE = (o) => o.type === "zombie" && o.state !== "dead" && o.state !== "hostile";

// Deterministic PRNG so a failure is reproducible.
let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const mk = (n, spread) => Array.from({ length: n }, (_, i) => ({
  id: i, x: (rnd() - 0.5) * spread, z: (rnd() - 0.5) * spread,
  type: rnd() < 0.4 ? "zombie" : "civilian", state: "idle", dead: rnd() < 0.05,
}));

console.log("=== 0. the module actually LOADS ===");
// This suite reads npc.js as TEXT, so every other assertion here would pass
// happily on a file that cannot be imported at all. It really could not: an
// earlier version of the fix had `const GRID_CELL = ZOMBIE_SCENT;` declared
// ABOVE ZOMBIE_SCENT, which throws "Cannot access before initialization" at
// module load. `node --check` passed — it is a temporal-dead-zone error at
// runtime, not a syntax error — and every text assertion in this file stayed
// green. Only importing the module found it. So import it.
try {
  await import("../../src/npc.js");
  ok("src/npc.js imports cleanly");
} catch (e) {
  bad(`src/npc.js does not import: ${e.message}`);
}

console.log("\n=== 1. grid vs brute force, on adversarial populations ===");
const cases = [
  ["all 150 in ONE cell (worst case for bucketing)", () => { const a = mk(150, 90); a.forEach(e => { e.x = 12.5; e.z = -7.25; }); return a; }],
  ["spread over 900 m (many cells)", () => mk(150, 900)],
  ["150 in a 2-cell line", () => { const a = mk(150, 200); a.forEach((e, i) => { e.x = 95 + (i % 2) * 10; e.z = -140 + i * 0.5; }); return a; }],
  ["exactly on cell boundaries", () => mk(150, 800).map(e => ({ ...e, x: Math.round(e.x / 100) * 100 + 0.0001, z: Math.round(e.z / 100) * 100 - 0.0001 }))],
  ["30 only (low population)", () => mk(30, 400)],
  ["1 only", () => mk(1, 50)],
  ["empty", () => []],
  ["all dead", () => mk(40, 300).map(e => ({ ...e, dead: true }))],
];
const radii = [18, 36, 55, 100, 145];
const predicates = [["any", ACCEPT_ANY], ["non-zombie", ACCEPT_NONZOMBIE], ["zombie", ACCEPT_ZOMBIE]];

let mismatches = 0, compared = 0;
for (const [label, make] of cases) {
  const pop = make();
  const buckets = buildBuckets(pop);
  for (const r of radii) {
    for (const [pname, accept] of predicates) {
      // A fixed external subject is always included, so the EMPTY and all-dead
      // populations are still probed instead of crashing on pop[0] === undefined.
      const probe = pop.length ? [pop[0], pop[Math.floor(pop.length / 2)]] : [];
      for (const self of [...probe, { x: 0, z: 0, id: -1 }]) {
        const a = gridNearest(buckets, self, self.x, self.z, r, accept);
        const b = bruteNearest(pop, self, self.x, self.z, r, accept);
        compared++;
        const same = (a.e === null) === (b.e === null);
        if (!same || (a.e && a.e.id !== b.e.id)) {
          mismatches++;
          if (mismatches <= 3) console.log(`    MISMATCH ${label} r=${r} ${pname}: grid=${a.e && a.e.id} brute=${b.e && b.e.id}`);
        }
      }
    }
  }
}
check(mismatches === 0, `${compared} grid-vs-brute comparisons across ${cases.length} adversarial populations x ${radii.length} radii x ${predicates.length} predicates — ${mismatches} mismatches`);

console.log("\n=== 2. the radius is honoured, not exceeded ===");
{
  // A subject at the origin, one candidate just inside and one just outside.
  const pop = [{ id: 1, x: 99.9, z: 0, type: "zombie", state: "idle" }, { id: 2, x: 100.1, z: 0, type: "zombie", state: "idle" }];
  const b = buildBuckets(pop);
  const r = gridNearest(b, { x: 0, z: 0 }, 0, 0, 100, ACCEPT_ANY);
  check(r.e && r.e.id === 1, "a candidate at 99.9 m is found inside a 100 m radius");
  const r2 = gridNearest(b, { x: 0, z: 0 }, 0, 0, 99, ACCEPT_ANY);
  check(r2.e === null, "and the same candidate is correctly excluded at 99 m");
}

console.log("\n=== 3. dead NPCs and self are never returned ===");
{
  const pop = [
    { id: 1, x: 5, z: 0, type: "zombie", state: "idle", dead: true },     // dead, closest
    { id: 2, x: 0, z: 0, type: "zombie", state: "idle" },                    // SELF
    { id: 3, x: 9, z: 0, type: "zombie", state: "idle" },
  ];
  const b = buildBuckets(pop);
  const r = gridNearest(b, pop[1], 0, 0, 100, ACCEPT_ANY);
  check(r.e && r.e.id === 3, "a dead NPC and the subject itself are both skipped, and the next nearest wins");
}

console.log("\n=== 4. the source really does what this test models ===");
// If src/npc.js drifts from the algorithm above, this comparison stops meaning
// anything — so assert the shipped code, not just the model.
check(/const GRID_CELL = ZOMBIE_SCENT/.test(npcSrc), "GRID_CELL is the search radius, so 3x3 cells always suffice");
// The sweep half-width must be DERIVED from the radius. A hardcoded 3x3 is only
// correct while radius <= GRID_CELL, and this test found exactly that bug.
check(/const span = Math\.max\(1, Math\.ceil\(radius \/ GRID_CELL\)\)/.test(npcSrc),
  "the sweep half-width is derived from the radius, so a radius larger than one cell still finds the true nearest");
check(/for \(let dx = -span; dx <= span; dx\+\+\) for \(let dz = -span; dz <= span; dz\+\+\)/.test(npcSrc),
  "and the sweep uses that span — a single bucket would miss neighbours and change behaviour");
check(!/for \(const o of env\.others\)/.test(npcSrc),
  "no full-population scan remains in npc.js");
check((npcSrc.match(/nearestInBuckets\(/g) || []).length >= 4,
  "all three call sites use the bucketed search (3 uses + the definition)");
check(/rebuildNeighbourGrid\(\)/.test(npcSrc) && /buildBuckets\(this\._others/.test(npcSrc),
  "the grid is rebuilt from the whole population, once per step");
// The grid returns squared distance, so the comparison against the player-relative
// best must be squared too. A mixed comparison (d2 < bestD) would compare a
// SQUARED distance to a LINEAR one and silently prefer almost any candidate.
check(/bite\.d2 < bestD \* bestD/.test(npcSrc), "the bite-target comparison is squared on both sides, as the helper returns");
check(!/bite\.d2 < bestD\b(?! \*)/.test(npcSrc), "and never compares a squared distance against a linear one");
check(/nearestInBuckets\(e, p\.x, p\.z, 18,/.test(npcSrc), "the herd search keeps its 18 m radius");
check(/nearestInBuckets\(e, p\.x, p\.z, 36,/.test(npcSrc), "the loiterer search keeps its 36 m radius");

console.log(`\n${fails ? fails + " FAILURES" : "the grid answers exactly what the full scan answered"}`);
process.exit(fails ? 1 : 0);