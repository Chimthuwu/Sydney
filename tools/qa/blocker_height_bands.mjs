// blocker_height_bands.mjs — pins WHY low geometry reads as an invisible wall.
//
//   node --experimental-detect-module tools/qa/blocker_height_bands.mjs
//
// Human report 2026-10-02: "There is hella like invisible walls in the game ...
// near some of the buildings there is invisible walls ... player cant walk thru
// em". And specifically: at Billy Jeans you cannot get up onto the stage next to
// the performer with the white glove.
//
// THE MECHANISM, from src/spatial.js BlockerGrid.resolve():
//
//     if (b.y0 !== undefined && ny !== undefined && (ny < b.y0 || ny > b.y1)) return false;
//     if (d2 < min * min) { push the mover out radially }
//
// The grid is 2-D: x, z and a radius. A blocker is therefore a VERTICAL CYLINDER
// solid from the ground to infinity -- unless it declares a height band (y0/y1).
// The band check IS honoured (my first grep missed it because it lives in
// spatial.js, not main.js), so the feature works.
//
// The defect is at the CALL SITES, not the resolver: addBlocker(x, z, r) with no
// y0/y1 is solid at every height. So a kerb, a stage lip, a planter edge or a low
// wall drawn as a box becomes an invisible vertical barrier -- invisible because
// the geometry justifying it is knee-high while the collision is infinite. That
// is exactly "an invisible wall near a building".
//
// THE STAGE, measured from src/franchiseClubs.js:
//
//     box(root, 18, 0.46, 3.1, mats.stage, 0, 0.45, -3.1);
//
// The deck is 0.46 m thick, top at y = 0.68 -- knee-high, meant to be climbed. The
// blockers ringing the room are declared with no band:
//
//     for (const lx of [-8.6, -6.4, -4.2, -2.6, 2.6, 4.2, 6.4, 8.6]) {
//       const p = worldAt(x, z, lx, -5.15, rot); addBlocker(p.x, p.z, 1.5);
//     }
//
// Those sit at z = -5.15, BEHIND the deck (which spans z -4.65..-1.55), so they
// are the rear wall and correct as full-height. There is no blocker along the
// stage FRONT -- which means the deck should already be climbable, and this suite
// asserts that from the real constants rather than assuming it. If the deck IS
// reachable in the running game, the complaint is about something else (see
// invisible_walls_test.mjs, the runtime companion) and this file says so.
//
// This suite checks declaration SHAPE and computes deck/blocker overlap from the
// source constants. It does not simulate walking -- that needs a browser and is a
// different kind of test.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, "../../src/", p), "utf8");
const clubs = read("franchiseClubs.js");
const spatial = read("spatial.js");
const main = read("main.js");

let fails = 0;
const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m) => { console.log(`  FAIL ${m}`); fails++; };
const check = (c, m) => (c ? ok(m) : bad(m));

console.log("=== 1. the resolver really does honour height bands ===");
// Guards against the band check being "simplified" away, which would make every
// low prop an infinite wall.
check(/if \(b\.y0 !== undefined && ny !== undefined && \(ny < b\.y0 \|\| ny > b\.y1\)\) return false;/.test(spatial),
  "BlockerGrid.resolve skips a banded blocker when the mover is outside its y range");
check(/const ny = next\.y;/.test(spatial), "resolve reads the mover's y (the grid itself is 2-D)");
check(/function addBlocker\(x, z, r, y0, y1\)/.test(main),
  "addBlocker accepts optional y0/y1 and main.js still stores them");

console.log("\n=== 2. the stage deck is knee-high, i.e. meant to be climbed ===");
const deck = clubs.match(/box\(root,\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*mats\.stage,\s*(-?[\d.]+),\s*([\d.]+),\s*(-?[\d.]+)\)/);
check(!!deck, "franchiseClubs.js declares the stage deck as box(...)");
if (deck) {
  const w = Number(deck[1]), h = Number(deck[2]), d = Number(deck[3]);
  const y = Number(deck[5]), z = Number(deck[6]);
  const top = y + h / 2;
  const deckZ0 = z - d / 2, deckZ1 = z + d / 2;
  console.log(`  deck: ${w} x ${d} m, ${h} m thick, top at y = ${top.toFixed(2)} m`);
  console.log(`  deck spans z ${deckZ0.toFixed(2)}..${deckZ1.toFixed(2)}`);
  check(top > 0 && top < 0.75, `the deck top is low enough to step onto (${top.toFixed(2)} m)`);
  check(h < 0.6, `the deck is a platform, not a wall (${h} m thick)`);

  const rear = clubs.match(/worldAt\(x, z, lx, (-?[\d.]+), rot\); addBlocker\(p\.x, p\.z, ([\d.]+)\)/);
  check(!!rear, "the room's rear blocker line is present in the source");
  if (rear) {
    const rz = Number(rear[1]), rr = Number(rear[2]);
    console.log(`  rear blockers at z ${rz}, radius ${rr}`);
    check(rz < deckZ0, `the rear blockers sit behind the stage, not across its front (${rz} < ${deckZ0.toFixed(2)})`);
    check(rz + rr <= deckZ0,
      `and do not reach into the deck footprint (clear by ${(deckZ0 - (rz + rr)).toFixed(2)} m)`);
  }
}

console.log("\n=== 3. the stage front is unobstructed ===");
// If this ever fails, a blocker HAS been placed across the stage and that is the
// invisible wall -- the geometry would be a knee-high deck with a full-height wall
// drawn on it.
const frontBlockers = [...clubs.matchAll(/worldAt\(x, z, ([-\d.]+), (-?[\d.]+), rot\); addBlocker\(([^)]*)\)/g)]
  .map((m) => ({ lx: Number(m[1]), lz: Number(m[2]), args: m[3] }))
  .filter((b) => b.lz > -4.65);
console.log(`  blocker lines in front of the deck's rear edge: ${frontBlockers.length}`);
check(frontBlockers.length === 0,
  "no blocker line crosses the stage front (deck is climbable from the floor)");

console.log("\n=== 4. bare (unbanded) blockers are counted, so regressions are visible ===");
// Not a pass/fail on the count -- these are usually correct full-height walls.
// The number is printed so a change in it is noticed and reasoned about.
const bare = [...clubs.matchAll(/addBlocker\(([^)]*)\)/g)].map((m) => m[1]);
const banded = bare.filter((a) => a.split(",").length >= 5);
console.log(`  addBlocker calls in franchiseClubs.js: ${bare.length} total, ${banded.length} height-banded`);
check(bare.length > 0, "franchiseClubs does declare blockers, so this file is genuinely covered");

console.log(`\n${fails ? fails + " FAILURES" : "height bands are honoured; the stage deck is climbable and clear of full-height blockers"}`);
process.exit(fails ? 1 : 0);