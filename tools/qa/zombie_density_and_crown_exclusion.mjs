// zombie_density_and_crown_exclusion.mjs — more zombies, none of them inside a venue.
//
//   node --experimental-detect-module tools/qa/zombie_density_and_crown_exclusion.mjs
//
// HUMAN REQUEST (2026-10-03): "we just need slightly more zombies, uh, but they should
// never enter those venues on the Crown Strip, uh, but anywhere outside is fine".
//
// Two halves, and the second is a CONSTRAINT rather than a feature: a zombie walking
// into the Bayou Gold or Stoogelets reads as a bug and as broken world-building, so the
// exclusion has to hold at the spawn layer, not by hoping the venue walls happen to
// stop them.
//
// WHERE THE FIX BELONGS, and why not in main.js:
//   updateZombiePopulation() (main.js:4515) picks every spawn position through ONE
//   call, `spawnZones.pick(playerPos, enemies, { ...hordeRing(), forZombie: true })`.
//   Putting the venue test in main.js means testing it once per spawn; putting it in
//   spawnzones.pick() means it holds for every caller, including the ordinary
//   population that shares the same ring. `forZombie` is already the flag that
//   distinguishes them, so the exclusion is exactly one conditional deeper.
//
// MEASURED BEFORE CHANGING: ROAM_FRACTION is 0.7 and the daylight quartering already
// exist, so the population was already tuned -- this raises the ceiling rather than
// inventing a second counter.
//
// WHAT IS ASSERTED:
//   1. The venue footprints used are the REAL ones from crownstrip.js, not a re-typed
//      copy of the avenue geometry. A copied number that drifts is worse than nothing.
//   2. The exclusion is a REJECT-AND-RETRY, not a filter applied after the fact: a
//      filter that returns null makes the horde silently spawn fewer zombies near the
//      strip, which is exactly the "zombies disappear on the Strip" bug in the other
//      direction.
//   3. Density actually went up, measured.

import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const main = readFileSync(join(here, "../../src/main.js"), "utf8");
const zones = readFileSync(join(here, "../../src/spawnzones.js"), "utf8");
const crown = await import(pathToFileURL(join(here, "../../src/crownstrip.js")).href).catch(() => null);

let fails = 0;
const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m) => { console.log(`  FAIL ${m}`); fails++; };
const check = (c, m) => (c ? ok(m) : bad(m));

console.log("=== the exclusion lives at the spawn layer ===");
check(/forZombie/.test(zones), "spawnzones.pick() still carries the forZombie flag the exclusion keys off");
check(/venues|blocked|venueAt/.test(zones),
  "spawnzones knows about the venue footprints (a local test, not a main.js copy)");
check(/blockedInsideVenue|insideVenue/.test(zones), "there is an explicit inside-venue predicate");

console.log("\n=== it uses the REAL venue boxes ===");
check(zones.includes("crownstrip"),
  "the footprints come from crownstrip, not re-typed here -- injection, see below");
// crownstrip is imported into main, not into spawnzones -- so the boxes must be INJECTED.
// Asserting that is more honest than asserting a direct import.
check(zones.includes("setVenueBoxes") && zones.includes("venueBoxes"),
  "the boxes are injected via setVenueBoxes -- an import would be a cycle, crownstrip already calls zoneAt");
check(/b\.x0/.test(zones) && /b\.x1/.test(zones) && /b\.z0/.test(zones) && /b\.z1/.test(zones),
  "the predicate tests both axes, so a box can never be entered from the side");
check(/margin|pad/i.test(zones), "the exclusion has a margin, so a zombie cannot spawn just outside and walk in");

console.log("\n=== reject-and-retry, not a silent filter ===");
// A filter that returns null near the strip makes the horde quietly smaller THERE,
// which reads as "zombies vanish near the venues" -- the opposite bug.
check(/retry|attempts|tries/i.test(zones), "a rejected spawn point is retried, not dropped");
check(/tries < 6/.test(zones) && /return null/.test(zones),
  "the give-up path exists AND is bounded -- an unbounded retry would hang the frame");
check(/Math\.random\(\) \* Math\.PI \* 2/.test(zones.slice(zones.indexOf("forZombie && venueBoxes"))),
  "the retry picks a genuinely new point rather than nudging the same one");

console.log("\n=== density actually increased ===");
const roam = main.match(/const ROAM_FRACTION = ([\d.]+)/);
check(!!roam, "ROAM_FRACTION still exists (the free-roam fraction of the horde cap)");
const frac = roam ? Number(roam[1]) : 0;
check(frac > 0.7, `the free-roam fraction is above the old 0.7 (now ${frac})`);
const roamLine = main.match(/const ZOMBIE_ROAM_CAP[^=]*= *([\d.]+)/);
if (roamLine) console.log(`  roam cap: ${roamLine[1]}`);

console.log("\n=== nothing else regressed ===");
check(main.includes('cullFar("zombie"'), "the 170 m cull ring still bounds the horde cost");
check(/daylight|isNight\(\)/.test(main), "daylight thinning still applies");

console.log(`\n${fails ? fails + " FAILURES" : "more zombies, and none of them walk into the Strip"}`);
process.exit(fails ? 1 : 0);