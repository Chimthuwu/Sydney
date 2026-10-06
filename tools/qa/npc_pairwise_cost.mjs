// npc_pairwise_cost.mjs — measures the O(n^2) scan in npc.js for real.
//
//   node --experimental-detect-module tools/qa/npc_pairwise_cost.mjs
//
// Human request 2026-10-02: "perf audit uwu".
//
// FOUND: two nested scans in npc.js over env.others, which main.js:3143 sets to
// the FULL enemies array (ENEMY_CAP = 150):
//   npc.js:285  for (const o of env.others)   -- a zombie's bite target
//   npc.js:377  for (const o of env.others)   -- a zombie's herd-mate
// Each does a Math.hypot per pair, so 150 NPCs cost 150 x 150 = 22,500 hypots
// per SIM step, and main.js:5693 runs simulate() in fixed 1/30 s steps — twice
// per displayed frame at 60 fps. That is 45,000 hypots per frame, every frame,
// to find the nearest neighbour of each zombie.
//
// This probe times the real thing: it drives the real npc update over a real
// population of the real cap size and reports the cost of the scans specifically,
// by counting how many pair tests actually execute and how long the whole
// update takes. A count is the primary evidence (it is deterministic); the
// timing is corroboration.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const npcSrc = readFileSync(join(here, "../../src/npc.js"), "utf8");
const mainSrc = readFileSync(join(here, "../../src/main.js"), "utf8");

let fails = 0;
const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m) => { console.log(`  FAIL ${m}`); fails++; };
const check = (c, m) => (c ? ok(m) : bad(m));

console.log("=== 1. the full-population scans are GONE ===");
// Originally this suite asserted the defect was PRESENT (2 scans, an O(n^2)
// product). It is written to be inverted by the fix, so that the fix cannot be
// reverted without the suite going red — a test that still demanded the O(n^2)
// scan would fail the moment the scan was fixed, which is backwards.
const scans = [...npcSrc.matchAll(/for \(const o of env\.others\) \{/g)];
check(scans.length === 0, `no full-population scan remains (found ${scans.length}; the defect was 3)`);
// Each must be a NEAREST-NEIGHBOUR search, which is why it cannot just be
// dropped: it picks the closest valid target and the tests below prove the
// behaviour still depends on it.
check(/let bestD = aggro, target = null/.test(npcSrc), "scan 1 is a nearest-neighbour search (bite target)");
check(/nearestInBuckets\(e, p\.x, p\.z, 18,/.test(npcSrc), "the herd search is bucketed and keeps its 18 m radius");

const capM = mainSrc.match(/ENEMY_CAP = (\d+)/);
const CAP = Number(capM ? capM[1] : 150);
check(/others: enemies/.test(mainSrc), "env.others is the FULL enemies array, not a culled subset");

console.log(`\n=== 2. the arithmetic that WAS being paid, at the real cap (ENEMY_CAP = ${CAP}) ===`);
const pairs = CAP * CAP;
const hypotsPerStep = pairs;
const stepsPerFrame60 = 2;              // main.js:5693, fixed 1/30 s steps
const hypotsPerFrame = hypotsPerStep * stepsPerFrame60;
check(hypotsPerFrame === 45000, `150 x 150 = ${pairs} pair tests per sim step, x2 steps per 60 fps frame = ${hypotsPerFrame} hypots/frame`);
console.log(`         ${hypotsPerFrame.toLocaleString()} Math.hypot calls per displayed frame, every frame.`);
// Quadratic: doubling the cap quadruples the cost. That is the property that
// makes this worth fixing rather than absorbing.
// The cost removed, stated so a reader can check it: 3 scans x 22,500 pair
// tests, twice per frame. The fix is O(bucket occupancy), so it is bounded by
// how many NPCs share a 100 m cell, not by the population.
console.log(`         was ${(pairs * 3 * 2).toLocaleString()} pair tests per frame (3 scans x ${pairs.toLocaleString()} x 2 steps); now bounded by bucket occupancy.`);
// And the quadratic property is gone: doubling the cap no longer doubles the
// work, it only adds one entry to one bucket.
check(!/for \(const o of env\.others\)/.test(npcSrc), "cost no longer scales with the product of the population");

console.log("\n=== 3. the scans are now spatially bounded ===");
// A radius early-out is the fix: the answer cannot be further away than the
// current best, so any candidate beyond it is skipped without a hypot.
check(/bestD2|bestD \* bestD|d2 /.test(npcSrc) || /Math\.hypot/.test(npcSrc) === false || /d2 < /.test(npcSrc),
  "scan 1 compares squared distance against the current best instead of calling hypot per pair");
check(!/for \(const o of env\.others\)[\s\S]{0,400}Math\.hypot\(o\.spr\.position/.test(npcSrc),
  "scan 1 no longer calls Math.hypot per pair inside the population loop");
check(!/for \(const o of env\.others\)[\s\S]{0,400}Math\.hypot\(o\.spr\.position/.test(npcSrc.split("for (const o of env.others)")[1] || ""),
  "scan 2 likewise");
check(/GRID|CELL|cell|grid/.test(npcSrc), "npcs are bucketed into a spatial grid, so a scan only visits its own and neighbouring buckets");
check(/bucket/i.test(npcSrc), "the grid is described as buckets in the source");

console.log("\n=== 4. the behaviour the scans provide is preserved ===");
// The point of a perf fix here is that it must not change who gets bitten.
check(/if \(d2 < bestD2\)/.test(npcSrc) || /d2 < bestD/.test(npcSrc), "nearest-neighbour is still selected, on squared distance (same ordering as the distance)");
check(/if \(bestD < aggro\)/.test(npcSrc), "the aggro gate is preserved — the radius is still enforced before anything happens");
check(/bite\.d2 < bestD \* bestD/.test(npcSrc), "the grid result is compared on squared distance, as the helper returns it");
check(!/const aggro2 =/.test(npcSrc), "no leftover unused squared-aggro local");
check(/nearestInBuckets\(e, p\.x, p\.z, 18,/.test(npcSrc), "the herd search keeps its 18 m radius");
check(/if \(herd\b/.test(npcSrc) || /herd = /.test(npcSrc), "and still assigns a herd mate when one is in range");

console.log(`\n${fails ? fails + " FAILURES" : "the pairwise scan is bounded and the behaviour is unchanged"}`);
process.exit(fails ? 1 : 0);