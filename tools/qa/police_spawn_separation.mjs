// police_spawn_separation.mjs — deputies must not spawn inside each other
//
//   node --experimental-detect-module tools/qa/police_spawn_separation.mjs
//
// SOURCE: human screenshot, 2026-10-03. Six officers standing in a heap on a single
// body under the viaduct, one kneeling, models visibly overlapping, a cruiser with its
// lights on behind them. Read as a spawn pile-up, not a police response.
//
// WHY A STATIC GATE AND NOT A SCREENSHOT
// The screenshot is the evidence but it is not repeatable, and the failure it shows is
// a property of the CODE: the foot-cop placement ring tests walls and nothing else. So
// the check is that the wall test is accompanied by a separation test, and that the
// separation floor is sane for a 1.82 m deputy model.
//
// WHAT IT DOES NOT CLAIM. It cannot prove the pile is gone -- only the live game can,
// and only at a moment when six deputies happen to be downwind of a body. What it can
// do is fail loudly if the separation test is deleted, which is the actual regression
// risk: the pile was never a subtle bug, it was a missing check.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const main = readFileSync(join(here, "../../src/main.js"), "utf8");
const police = readFileSync(join(here, "../../src/police.js"), "utf8");

let fails = 0;
const check = (c, m) => { console.log(`  ${c ? "ok  " : "FAIL"} ${m}`); if (!c) fails++; };

// Isolate the foot-cop placement loop. Everything asserted below must live INSIDE it:
// a separation check somewhere else in the file would not stop the pile.
const loopStart = main.indexOf("if (footSpawnCd <= 0 && police.footCops.filter");
const loopEnd = main.indexOf("footSpawnCd =", loopStart + 40);
const loop = loopStart > -1 ? main.slice(loopStart, loopEnd) : "";
check(loopStart > -1, "the foot-cop placement loop was found in main.js");

console.log("\n=== walls were already checked; people were not ===");
check(/clearOfBlockers\(x, z, 0\.7\)/.test(loop), "placement still refuses spots inside walls");
check(/tooClose/.test(loop), "placement refuses spots inside ANOTHER COP");

// The separation floor must be a real distance, not a token 0.
const sep = loop.match(/Math\.hypot\([^)]*\) < ([\d.]+)/);
check(!!sep, `a distance comparison is present (${sep ? "< " + sep[1] + " m" : "MISSING"})`);
const floor = sep ? Number(sep[1]) : 0;
check(floor >= 1.8, `the floor clears a 1.82 m deputy's shoulders (${floor} m)`);
check(floor <= 6, `but is not so wide the ring cannot be filled (${floor} m; ring is 14-30 m)`);

// It must compare against the LIVE deputy list, not a stale snapshot.
check(/police\.footCops/.test(loop), "the comparison reads police.footCops, the live list");
check(/c\.dead/.test(loop), "dead deputies are skipped (or the floor creeps as a body pile up)");

console.log("\n=== the ring placement that made the pile possible ===");
// start + (i/10)*2PI for a RANDOM start means two consecutive spawns can pick the same
// bearing and radius. The separation check is what makes that survivable, so the ring
// itself may stay as it is -- but the number of attempts must exceed 10 or a congested
// ring can never find a free bearing.
const attempts = loop.match(/i < (\d+)/);
check(!!attempts && Number(attempts[1]) >= 10,
  `the ring still gets ${attempts ? attempts[1] : "?"} attempts per spawn, so a busy ring can find a free bearing`);

console.log("\n=== spawnFootCop must stay a pure placement function ===");
// It takes a position and builds a deputy. If it grew its own ring logic it would be a
// second, divergent placement path -- the same class of bug as the three zone-claim
// paths that all had to be fixed separately.
const fnStart = police.indexOf("function spawnFootCop");
const fnBody = fnStart > -1 ? police.slice(fnStart, police.indexOf("\n  }", fnStart)) : "";
check(!/Math\.cos|Math\.sin|ring|angle/i.test(fnBody),
  "spawnFootCop does no placement maths of its own (the caller owns the ring)");
check(/MAX_FOOT_COPS/.test(fnBody), "it still enforces MAX_FOOT_COPS");

console.log(`\n${fails ? fails + " FAILURES" : "deputies cannot spawn inside one another"}`);
process.exit(fails ? 1 : 0);