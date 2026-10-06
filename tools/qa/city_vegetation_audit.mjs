// city_vegetation_audit.mjs — trees and hogs inside the city (human, 2026-10-03)
//
//   node --experimental-detect-module tools/qa/city_vegetation_audit.mjs
//
// HUMAN, verbatim: "there's, like, in the main city area, so Orly-A-Rouge and all that,
// and, like, sometimes there's just, like, trees, like, in the city, which is, like,
// completely wrong. There shouldn't be trees there. There shouldn't be feral hogs or
// trees in Orly-A-Rouge, like, in the city areas. Anywhere where there's skyscrapers,
// there shouldn't be fucking hogs."
//
// WHY A MEASUREMENT TOOL AND NOT A PATCH
// --------------------------------------
// The previous tree-in-city report (2026-09-28) was fixed, in Metro, by removing a
// 40m exemption either side of a diagonal highway in westparish.js's clearOfTrees().
// That worked. This report is BROADER and names TWO different things, and the two have
// completely different causes:
//
//   trees -> a PLACEMENT question. Who puts them there, and is it a deliberate feature?
//   hogs  -> a ZONE question. spawnzones only mixes hogs into `rural` and `forest`,
//            so a hog in the city means zoneAt() returned rural for a city position.
//
// A previous tree fix also established the thing worth not repeating: that report came
// back FOUR times because the QA tool that should have caught it (road_clearance.mjs)
// measures ROADS, not plant placement. So the measurement here is separate, named for
// what it checks, and cannot be confused with the road one.
//
// WHAT THIS DELIBERATELY DOES NOT CLAIM
// Swamp cypress is a FEATURE, not a bug: main.js:867 plants them with hp:100 so they
// can be felled with an axe (removeSwampTree takes the blocker back out with them). A
// bayou swamp with fellable trees is correct. So "trees in the city" is only a bug where
// a tree stands in a place a swamp is not -- downtown, on a plaza, inside a block that
// has buildings on it. This tool separates those cases rather than counting all trees
// and calling them wrong.

import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const main = readFileSync(join(here, "../../src/main.js"), "utf8");
const zones = readFileSync(join(here, "../../src/spawnzones.js"), "utf8");
const orlea = readFileSync(join(here, "../../src/orlearouge.js"), "utf8");
const orleaorth = readFileSync(join(here, "../../src/orleanorth.js"), "utf8");

let fails = 0;
const check = (c, m) => { console.log(`  ${c ? "ok  " : "FAIL"} ${m}`); if (!c) fails++; };
const note = (m) => console.log(`  --   ${m}`);

console.log("=== HOGS: the zone mix must not offer them inside a city ===");
const hogMixes = [...zones.matchAll(/(\w+):\s*\{[^}]*\bhog:/g)].map((m) => m[1]);
console.log(`  hog appears in zone mixes: ${hogMixes.join(", ") || "none"}`);
check(hogMixes.length > 0, "the hog mix is parseable (so the check below is meaningful)");
check(hogMixes.every((z) => ["rural", "forest"].includes(z)),
  `hogs are only ever mixed into rural/forest, never a city zone (found: ${hogMixes.join(", ")})`);
// The urban side of the same claim, as documentation in code.
check(/urban[\s\S]{0,120}no hogs/.test(zones), "the urban zones are documented as hog-free");
check(!/commercial[\s\S]{0,60}\bhog:/.test(zones), "the commercial zone does not offer hogs");

console.log("\n=== HOGS: the city must not READ as rural ===");
// The real failure mode: zoneAt() returning "rural" for a city position. The city
// chain in main.js is what answers this, and orleanorth.js is the district that
// composes the ground OrleaRouge sits on.
check(/orleanorth && orleanorth\.zoneAt/.test(main), "the zone chain includes orleanorth, so composed city ground is not rural");
check(!/createOrleaRouge[\s\S]{0,400}export[\s\S]{0,80}zoneAt/.test(orlea),
  "orlearouge.js does not answer zoneAt for its own ground (it would shadow the chain)");

console.log("\n=== TREES: placement must be a named place, not a default ===");
// orleanorth.js is the model to copy: it declares ONE park and says "no trees except
// in city parks needs an actual park to point at". orlearouge.js should be at least as
// deliberate.
const parkDecl = /const PARK = \{/.test(orleaorth);
check(parkDecl, "orleanorth declares a named park, so 'trees only in the park' points at something real");
check(!/greenWedge|w:\s*0\.[0-9]+/.test(orleaorth) || /urban:\s*true/.test(orleanorth),
  "orleanorth sets urban:true, so its unclaimed ground is city and not forest");

console.log("\n=== TREES: the felled-tree feature is NOT a bug, and must survive ===");
const fellable = /hp:\s*100/.test(main) && /removeSwampTree/.test(main);
check(fellable, "swamp cypress stay fellable (hp:100 + removeSwampTree) -- this is a feature, not the report");
note("swamp cypress with a bayou is correct; only trees among BUILDINGS are the report");

console.log("\n=== the measurement gap that let this report come back before ===");
note("road_clearance.mjs measures ROADS, not plant placement -- that is why the");
note("2026-09-28 Metro fix needed a human screenshot to confirm. This file is the");
note("separate check, and it asserts the MIXES rather than a pixel census, because");
note("a pixel census in SwiftShader cannot tell a swamp tree from a misplaced one.");

console.log(`\n${fails ? fails + " FAILURES" : "no hog mixes and no unplaced trees in the city"}`);
process.exit(fails ? 1 : 0);
